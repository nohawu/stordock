const OSS = require('ali-oss');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');
const { mapListing, validateFolder, ensureKey, safeFilename } = require('./core.cjs');
const { taskManager, abortError } = require('./tasks.cjs');
const { validateRelativePath, uniqueName, prepareOperation } = require('./operations.cjs');

const IMAGE_MIMES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
};
const TEXT_EXT = new Set([
  'txt',
  'md',
  'json',
  'csv',
  'log',
  'js',
  'ts',
  'tsx',
  'jsx',
  'html',
  'css',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'sql',
  'sh',
  'env',
]);
function client(connection, bucket) {
  return new OSS({
    region: `oss-${connection.region}`,
    endpoint: connection.endpoint || undefined,
    accessKeyId: connection.accessKeyId,
    accessKeySecret: connection.accessKeySecret,
    stsToken: connection.stsToken || undefined,
    bucket: bucket || connection.bucket || undefined,
    secure: true,
    authorizationV4: true,
    timeout: 120000,
  });
}
class AliyunProvider {
  constructor(makeClient = client) {
    this.client = makeClient;
  }
  async refreshConnection(connection, bucket) {
    if (!this.resolveConnection) return connection;
    const next = await this.resolveConnection(connection.id, bucket);
    if (
      (next.provider || 'aliyun') !== (connection.provider || 'aliyun') ||
      next.endpoint !== connection.endpoint ||
      next.bucket !== connection.bucket
    )
      throw new Error('连接目标已更改，请重新选择文件或操作对象');
    return next;
  }
  async assertNoOverwrite(connection, bucket, sdk) {
    if (connection.provider === 's3' || !sdk.getBucketVersioning) return;
    const result = await sdk.getBucketVersioning(bucket);
    if (['Enabled', 'Suspended'].includes(result.versionStatus))
      throw new Error(
        '此 OSS Bucket 已启用或暂停版本控制，禁止覆盖条件无效；请明确选择覆盖上传。复制和移动已停止',
      );
  }
  async buckets(connection) {
    const sdk = this.client(connection);
    if (connection.bucket) {
      await sdk.listV2({ 'max-keys': 1 });
      return [{ name: connection.bucket, region: connection.region }];
    }
    let marker;
    const buckets = [];
    do {
      const result = await sdk.listBuckets({ 'max-keys': 1000, marker });
      buckets.push(
        ...(result.buckets || []).map((b) => ({
          name: b.name,
          region: (b.region || b.location || connection.region).replace(/^oss-/, ''),
          createdAt: b.creationDate,
        })),
      );
      marker = result.isTruncated ? result.nextMarker : undefined;
    } while (marker);
    return buckets;
  }
  async list(connection, request) {
    const sdk = this.client(connection, request.bucket);
    const result = await sdk.listV2({
      prefix: request.prefix || '',
      delimiter: request.query ? undefined : '/',
      'max-keys': request.query ? 1000 : 200,
      'continuation-token': request.cursor || undefined,
    });
    return mapListing(result, request.prefix || '', request.query || '');
  }
  async preview(connection, bucket, object) {
    const key = ensureKey(object.key, connection.provider === 's3' ? 1024 : 1023);
    const sdk = this.client(connection, bucket);
    const head = await sdk.head(key);
    const size = Number(head.res.headers['content-length']);
    const ext = key.split('.').pop().toLowerCase();
    const mime = IMAGE_MIMES[ext];
    const isText = TEXT_EXT.has(ext);
    const limit = mime ? 10 * 1024 * 1024 : 1024 * 1024;
    if ((!mime && !isText) || !Number.isFinite(size) || size > limit)
      return { kind: 'unsupported', size };
    if (size === 0) return { kind: isText ? 'text' : 'unsupported', content: '', size };
    const result = await sdk.getStream(key, { headers: { Range: `bytes=0-${limit}` } });
    const chunks = [];
    let received = 0;
    try {
      for await (const chunk of result.stream) {
        received += chunk.length;
        if (received > limit) throw new Error('文件超出预览大小限制，请下载后查看');
        chunks.push(chunk);
      }
    } finally {
      result.stream.destroy();
    }
    const buffer = Buffer.concat(chunks);
    return mime
      ? { kind: 'image', content: `data:${mime};base64,${buffer.toString('base64')}`, mime, size }
      : { kind: 'text', content: buffer.toString('utf8'), mime: 'text/plain', size };
  }
  async createFolder(connection, bucket, prefix, name) {
    const key = ensureKey(
      `${prefix}${validateFolder(name)}/`,
      connection.provider === 's3' ? 1024 : 1023,
    );
    const sdk = this.client(connection, bucket);
    await this.assertNoOverwrite(connection, bucket, sdk);
    await sdk.put(key, Buffer.alloc(0), {
      headers: { 'x-oss-forbid-overwrite': 'true' },
    });
  }
  async upload(connection, bucket, prefix, items, emit, conflict = 'reject') {
    if (!['reject', 'skip', 'rename', 'overwrite'].includes(conflict))
      throw new Error('同名处理方式无效');
    const summary = { completed: 0, failed: 0, skipped: 0, cancelled: 0 };
    if (conflict !== 'overwrite')
      await this.assertNoOverwrite(connection, bucket, this.client(connection, bucket));
    for (const item of items) {
      let resolvedKey;
      const result = await taskManager.run(
        {
          name: item.relativePath || path.basename(item.path),
          direction: 'upload',
          size: 0,
          bucket,
          connectionId: connection.id,
        },
        async (signal, report) => {
          connection = await this.refreshConnection(connection, bucket);
          signal.throwIfAborted();
          const sdk = this.client(connection, bucket);
          const stat = await fsp.stat(item.path);
          if (stat.isDirectory() && item.directory) {
            const key = ensureKey(
              prefix + validateRelativePath(item.relativePath.replace(/\/$/, '')) + '/',
              connection.provider === 's3' ? 1024 : 1023,
            );
            try {
              await sdk.put(key, Buffer.alloc(0), {
                headers: { 'x-oss-forbid-overwrite': 'true' },
                signal,
              });
            } catch (error) {
              if (
                ['PreconditionFailed', 'FileAlreadyExists', 'ObjectAlreadyExists'].includes(
                  error.code || error.name,
                )
              )
                return 'skipped';
              throw error;
            }
            return;
          }
          if (!stat.isFile()) throw new Error('只能上传文件');
          report({ size: stat.size });
          const original = ensureKey(
            `${prefix}${item.relativePath ? validateRelativePath(item.relativePath) : path.basename(item.path)}`,
            connection.provider === 's3' ? 1024 : 1023,
          );
          let index = 1;
          let checkpoint;
          const cancel = () => sdk.cancel?.();
          signal.addEventListener('abort', cancel, { once: true });
          try {
            while (true) {
              signal.throwIfAborted();
              const key = resolvedKey || original;
              const options = {
                headers: conflict === 'overwrite' ? {} : { 'x-oss-forbid-overwrite': 'true' },
                signal,
              };
              try {
                if (stat.size < 1024 * 1024) await sdk.put(key, item.path, options);
                else
                  await sdk.multipartUpload(key, item.path, {
                    ...options,
                    parallel: 3,
                    partSize: 1024 * 1024,
                    progress: async (p, point) => {
                      checkpoint = point || checkpoint;
                      report({ progress: Math.round(p * 100) });
                    },
                  });
                return;
              } catch (error) {
                if (checkpoint?.uploadId && sdk.abortMultipartUpload) {
                  await sdk.abortMultipartUpload(key, checkpoint.uploadId).catch(() => {
                    throw new Error('上传失败且未能清理分片，请检查未完成分片');
                  });
                  checkpoint = undefined;
                }
                if (signal.aborted) throw abortError();
                if (
                  !['PreconditionFailed', 'FileAlreadyExists', 'ObjectAlreadyExists'].includes(
                    error.code || error.name,
                  )
                )
                  throw error;
                if (conflict === 'skip') return 'skipped';
                if (conflict !== 'rename' || index > 1000) throw error;
                resolvedKey = uniqueName(original, index++);
                ensureKey(resolvedKey, connection.provider === 's3' ? 1024 : 1023);
              }
            }
          } finally {
            signal.removeEventListener('abort', cancel);
          }
        },
        emit,
      );
      summary[result.status]++;
    }
    return summary;
  }
  async download(connection, bucket, objects, destination, emit, batch = false) {
    for (const object of objects) {
      let target;
      await taskManager.run(
        {
          name: object.relativePath || safeFilename(object.key),
          direction: 'download',
          size: object.size,
          bucket,
          connectionId: connection.id,
        },
        async (signal, report) => {
          connection = await this.refreshConnection(connection, bucket);
          signal.throwIfAborted();
          target = batch
            ? path.join(
                destination,
                ...(object.relativePath || safeFilename(object.key)).split('/'),
              )
            : destination;
          if (batch) {
            const relative = path.relative(path.resolve(destination), path.resolve(target));
            if (relative.startsWith('..') || path.isAbsolute(relative))
              throw new Error('下载路径超出目标目录');
            let directory = path.resolve(destination);
            for (const part of path
              .relative(directory, object.kind === 'folder' ? target : path.dirname(target))
              .split(path.sep)
              .filter(Boolean)) {
              directory = path.join(directory, part);
              try {
                const stat = await fsp.lstat(directory);
                if (stat.isSymbolicLink() || !stat.isDirectory())
                  throw new Error('下载目录不能包含符号链接或同名文件');
              } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                await fsp.mkdir(directory);
              }
            }
          }
          if (batch && object.kind === 'folder') return;
          const temporary = path.join(path.dirname(target), `.ossdesk-${randomUUID()}.part`);
          try {
            if (batch) {
              const parsed = path.parse(target);
              let index = 1;
              while (fs.existsSync(target))
                target = path.join(parsed.dir, `${parsed.name} (${index++})${parsed.ext}`);
            }
            const result = await this.client(connection, bucket).getStream(
              ensureKey(object.key, connection.provider === 's3' ? 1024 : 1023),
              { signal },
            );
            const actualSize = Number(result.res.headers['content-length']);
            const size = Number.isFinite(actualSize) ? actualSize : object.size;
            report({ size });
            let received = 0;
            let lastUpdate = 0;
            const meter = new Transform({
              transform(chunk, encoding, callback) {
                received += chunk.length;
                if (Date.now() - lastUpdate > 120) {
                  lastUpdate = Date.now();
                  report({
                    progress: size ? Math.min(99, Math.round((received / size) * 100)) : 0,
                  });
                }
                callback(null, chunk);
              },
            });
            await pipeline(result.stream, meter, fs.createWriteStream(temporary, { flags: 'wx' }), {
              signal,
            });
            if (batch) {
              await fsp.link(temporary, target);
              await fsp.unlink(temporary);
            } else await fsp.rename(temporary, target);
          } catch (error) {
            await fsp.rm(temporary, { force: true }).catch(() => {});
            throw error;
          }
        },
        emit,
      );
    }
  }
  prepareOperation(connection, bucket, objects, operation, target) {
    return prepareOperation(this, connection, bucket, objects, operation, target);
  }
  async copyEntry(connection, bucket, sdk, entry, signal) {
    const headers = {
      'x-oss-forbid-overwrite': 'true',
      ...(entry.etag ? { 'x-oss-copy-source-if-match': entry.etag } : {}),
    };
    let checkpoint;
    const cancel = () => sdk.cancel?.();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (connection.provider !== 's3' && entry.size > 1024 ** 3)
        await sdk.multipartUploadCopy(
          entry.target,
          { sourceKey: entry.key, sourceBucketName: bucket },
          {
            headers,
            signal,
            progress: async (_progress, point) => {
              checkpoint = point || checkpoint;
            },
          },
        );
      else await sdk.copy(entry.target, entry.key, bucket, { headers, signal, size: entry.size });
    } catch (error) {
      if (checkpoint?.uploadId && sdk.abortMultipartUpload)
        await sdk.abortMultipartUpload(entry.target, checkpoint.uploadId).catch(() => {
          throw new Error('复制失败且未能清理分片，请检查未完成分片；源对象保留');
        });
      if (signal.aborted) throw abortError();
      if (
        [
          'PreconditionFailed',
          'FileAlreadyExists',
          'ObjectAlreadyExists',
          'ConditionalRequestConflict',
        ].includes(error.code || error.name)
      )
        throw new Error('目标已存在或源对象已变化，已停止操作；已复制目标及未删除的源对象保留');
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
  async executeOperation(connection, plan, emit) {
    const copied = new Map();
    const removed = new Set();
    return taskManager.run(
      {
        name: `${plan.operation === 'delete' ? '删除' : plan.operation === 'copy' ? '复制' : plan.operation === 'rename' ? '重命名' : '移动'} ${plan.count} 个对象`,
        direction: plan.operation === 'rename' ? 'move' : plan.operation,
        size: plan.size,
        bucket: plan.bucket,
        connectionId: connection.id,
      },
      async (signal, report) => {
        connection = await this.refreshConnection(connection, plan.bucket);
        const sdk = this.client(connection, plan.bucket);
        if (plan.operation !== 'delete') await this.assertNoOverwrite(connection, plan.bucket, sdk);
        let completed = 0;
        const total = plan.entries.length * (['move', 'rename'].includes(plan.operation) ? 2 : 1);
        const progress = () =>
          report({ progress: Math.min(99, Math.round((++completed / (total || 1)) * 100)) });
        // A move copies the complete snapshot before deleting any source object.
        if (plan.operation !== 'delete') {
          for (const entry of plan.entries) {
            signal.throwIfAborted();
            if (copied.has(entry.key)) {
              const head = await sdk.head(entry.target);
              if (
                String(head.res.headers.etag).replaceAll('"', '') !==
                String(copied.get(entry.key)).replaceAll('"', '')
              )
                throw new Error('目标对象已被修改，源对象保留，请检查后重新操作');
            } else {
              await this.copyEntry(connection, plan.bucket, sdk, entry, signal);
              const targetEtag = (await sdk.head(entry.target)).res.headers.etag;
              if (!targetEtag)
                throw new Error('目标已复制，但服务未返回 ETag；源对象保留，请人工检查目标');
              copied.set(entry.key, targetEtag);
            }
            progress();
          }
        }
        if (plan.operation !== 'copy') {
          for (const entry of plan.entries) {
            signal.throwIfAborted();
            if (!removed.has(entry.key)) {
              if (entry.etag) {
                const head = await sdk.head(entry.key);
                if (
                  String(head.res.headers.etag).replaceAll('"', '') !==
                  String(entry.etag).replaceAll('"', '')
                )
                  throw new Error('源对象已发生变化，已停止删除；已复制目标保留');
              }
              await sdk.delete(entry.key, {
                headers:
                  connection.provider === 's3' && entry.etag ? { 'If-Match': entry.etag } : {},
                signal,
              });
              removed.add(entry.key);
            }
            progress();
          }
        }
      },
      emit,
    );
  }
}
function friendlyError(error) {
  const code = error.code || error.name;
  const status = error.$metadata?.httpStatusCode || error.status;
  const codes = {
    AccessDenied: '没有访问权限，请检查 RAM / IAM 授权、Bucket 和 Region',
    InvalidAccessKeyId: 'AccessKey ID 无效，请检查连接信息',
    SignatureDoesNotMatch: '签名验证失败，请检查密钥和 Region',
    SecurityTokenExpired: 'STS 凭据已过期，请重新创建连接',
    InvalidSecurityToken: 'STS Token 无效，请检查临时凭据',
    NoSuchBucket: 'Bucket 不存在，请检查名称和 Region',
    NoSuchKey: '文件已不存在，请刷新列表',
    NotFound: '对象不存在，请刷新列表',
    PreconditionFailed: '同名文件已存在，本次上传未覆盖',
    ConditionalRequestConflict: '对象写入冲突，本次上传未覆盖，请刷新后重试',
    ExpiredToken: '临时凭据已过期，请重新创建连接',
    InvalidToken: 'Session Token 无效，请检查临时凭据',
    PermanentRedirect: 'Endpoint 或 Region 不匹配，请检查服务地址',
    AuthorizationHeaderMalformed: '签名地域不匹配，请检查 Region',
    NotImplemented: '此服务不支持所需的 S3 操作或条件写入，未执行兼容性降级',
    ENOTFOUND: '无法解析 Endpoint，请检查服务地址',
    ECONNREFUSED: '无法连接存储服务，请检查地址、端口及服务状态',
    ETIMEDOUT: '连接超时，请检查网络后重试',
    FileAlreadyExists: '同名文件已存在，本次上传未覆盖',
    ObjectAlreadyExists: '同名对象已存在，本次上传未覆盖',
    RequestError: '无法连接存储服务，请检查网络和 Endpoint',
    ConnectionTimeoutError: '连接超时，请检查网络后重试',
    ENOENT: '本地文件不存在或已被移动',
    EACCES: '无法访问本地文件，请检查目录权限',
    EEXIST: '目标文件已存在，请重新选择保存位置',
  };
  if (codes[code]) return codes[code];
  if (status)
    return `存储请求失败（${/^[a-zA-Z0-9_]+$/.test(code || '') ? code : status}），请检查连接配置与权限`;
  if (error.$metadata) return 'S3 请求失败，请检查连接配置与服务端权限';
  // SDK error messages can include signed requests; never pass them to the renderer.
  if (error.name !== 'Error' || /https?:|accesskey|signature/i.test(error.message || ''))
    return '操作失败，请检查网络、连接配置和文件权限';
  return (error.message || '操作失败，请重试').slice(0, 240);
}
module.exports = { AliyunProvider, friendlyError };
