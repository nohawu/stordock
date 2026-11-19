const OSS = require('ali-oss');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');
const { mapListing, validateFolder, ensureKey, safeFilename } = require('./core.cjs');

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
    const key = ensureKey(object.key);
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
    const key = ensureKey(`${prefix}${validateFolder(name)}/`);
    await this.client(connection, bucket).put(key, Buffer.alloc(0), {
      headers: { 'x-oss-forbid-overwrite': 'true' },
    });
  }
  async upload(connection, bucket, prefix, items, emit) {
    for (const item of items) {
      const transfer = {
        id: randomUUID(),
        name: path.basename(item.path),
        direction: 'upload',
        status: 'running',
        progress: 0,
        size: 0,
        bucket,
        startedAt: Date.now(),
      };
      const sdk = this.client(connection, bucket);
      emit({ ...transfer });
      try {
        const stat = await fsp.stat(item.path);
        if (!stat.isFile()) throw new Error('只能上传文件');
        transfer.size = stat.size;
        const key = ensureKey(`${prefix}${path.basename(item.path)}`);
        const options = { headers: { 'x-oss-forbid-overwrite': 'true' } };
        if (stat.size < 1024 * 1024) await sdk.put(key, item.path, options);
        else
          await sdk.multipartUpload(key, item.path, {
            ...options,
            parallel: 3,
            partSize: 1024 * 1024,
            progress: async (p) => {
              transfer.progress = Math.round(p * 100);
              emit({ ...transfer });
            },
          });
        emit({ ...transfer, progress: 100, status: 'completed' });
      } catch (error) {
        emit({ ...transfer, status: 'failed', error: friendlyError(error) });
      }
    }
  }
  async download(connection, bucket, objects, destination, emit, batch = false) {
    for (const object of objects) {
      const transfer = {
        id: randomUUID(),
        name: safeFilename(object.key),
        direction: 'download',
        status: 'running',
        progress: 0,
        size: object.size,
        bucket,
        startedAt: Date.now(),
      };
      emit({ ...transfer });
      let target = batch ? path.join(destination, transfer.name) : destination;
      const temporary = path.join(path.dirname(target), `.ossdesk-${transfer.id}.part`);
      try {
        if (batch) {
          const parsed = path.parse(target);
          let index = 1;
          while (fs.existsSync(target))
            target = path.join(parsed.dir, `${parsed.name} (${index++})${parsed.ext}`);
        }
        const result = await this.client(connection, bucket).getStream(ensureKey(object.key));
        const actualSize = Number(result.res.headers['content-length']);
        transfer.size = Number.isFinite(actualSize) ? actualSize : object.size;
        let received = 0;
        let lastUpdate = 0;
        const meter = new Transform({
          transform(chunk, encoding, callback) {
            received += chunk.length;
            if (Date.now() - lastUpdate > 120) {
              lastUpdate = Date.now();
              transfer.progress = transfer.size
                ? Math.min(99, Math.round((received / transfer.size) * 100))
                : 0;
              emit({ ...transfer });
            }
            callback(null, chunk);
          },
        });
        await pipeline(result.stream, meter, fs.createWriteStream(temporary, { flags: 'wx' }));
        if (batch) {
          await fsp.link(temporary, target);
          await fsp.unlink(temporary);
        } else await fsp.rename(temporary, target);
        emit({ ...transfer, progress: 100, status: 'completed' });
      } catch (error) {
        await fsp.rm(temporary, { force: true }).catch(() => {});
        emit({ ...transfer, status: 'failed', error: friendlyError(error) });
      }
    }
  }
}
function friendlyError(error) {
  const codes = {
    AccessDenied: '没有访问权限，请检查 RAM 授权、Bucket 和 Region',
    InvalidAccessKeyId: 'AccessKey ID 无效，请检查连接信息',
    SignatureDoesNotMatch: '签名验证失败，请检查密钥和 Region',
    SecurityTokenExpired: 'STS 凭据已过期，请重新创建连接',
    InvalidSecurityToken: 'STS Token 无效，请检查临时凭据',
    NoSuchBucket: 'Bucket 不存在，请检查名称和 Region',
    NoSuchKey: '文件已不存在，请刷新列表',
    FileAlreadyExists: '同名文件已存在，本次上传未覆盖',
    ObjectAlreadyExists: '同名对象已存在，本次上传未覆盖',
    RequestError: '无法连接 OSS，请检查网络和 Endpoint',
    ConnectionTimeoutError: '连接超时，请检查网络后重试',
    ENOENT: '本地文件不存在或已被移动',
    EACCES: '无法访问本地文件，请检查目录权限',
    EEXIST: '目标文件已存在，请重新选择保存位置',
  };
  if (codes[error.code]) return codes[error.code];
  if (error.status) return `OSS 请求失败（${error.code || error.status}），请检查连接配置与权限`;
  // SDK error messages can include signed requests; never pass them to the renderer.
  if (error.name !== 'Error' || /https?:|accesskey|signature/i.test(error.message || ''))
    return '操作失败，请检查网络、连接配置和文件权限';
  return (error.message || '操作失败，请重试').slice(0, 240);
}
module.exports = { AliyunProvider, friendlyError };
