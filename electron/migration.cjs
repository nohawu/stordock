const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pipeline } = require('node:stream/promises');
const { taskManager } = require('./tasks.cjs');
const { ensureKey } = require('./core.cjs');
const equal = (a, b) =>
  !!a && !!b && String(a).replaceAll('"', '') === String(b).replaceAll('"', '');
async function executeMigration(
  sourceProvider,
  source,
  destinationProvider,
  destination,
  plan,
  emit,
) {
  const copied = new Map(),
    removed = new Set();
  return taskManager.run(
    {
      name: `${plan.operation === 'move' ? '迁移' : '跨桶复制'} ${plan.count} 个对象 → ${plan.destination.bucket}`,
      direction: plan.operation,
      size: plan.size,
      bucket: plan.bucket,
      connectionId: source.id,
    },
    async (signal, report) => {
      source = await sourceProvider.refreshConnection(source, plan.bucket);
      destination = await destinationProvider.refreshConnection(
        destination,
        plan.destination.bucket,
      );
      const from = sourceProvider.client(source, plan.bucket),
        to = destinationProvider.client(destination, plan.destination.bucket);
      await destinationProvider.assertNoOverwrite(destination, plan.destination.bucket, to);
      let completed = 0;
      const total = plan.entries.length * (plan.operation === 'move' ? 2 : 1);
      const progress = () =>
        report({ progress: Math.min(99, Math.round((++completed / Math.max(1, total)) * 100)) });
      for (const entry of plan.entries) {
        signal.throwIfAborted();
        ensureKey(entry.target, destination.provider === 's3' ? 1024 : 1023);
        if (copied.has(entry.key)) {
          if (!equal((await to.head(entry.target)).res.headers.etag, copied.get(entry.key)))
            throw new Error('迁移目标已变化，停止操作并保留源对象');
          progress();
          continue;
        }
        const head = await from.head(entry.key);
        if (!head.res.headers.etag || (entry.etag && !equal(entry.etag, head.res.headers.etag)))
          throw new Error('源对象已变化或缺少 ETag，请重新统计');
        entry.etag = head.res.headers.etag;
        const headers = {
          'x-oss-forbid-overwrite': 'true',
          'x-oss-copy-source-if-match': entry.etag,
        };
        if (
          source.id === destination.id &&
          source.provider === destination.provider &&
          source.region === destination.region
        ) {
          if (source.provider !== 's3' && entry.size > 1024 ** 3)
            await to.multipartUploadCopy(
              entry.target,
              { sourceKey: entry.key, sourceBucketName: plan.bucket },
              { headers, signal },
            );
          else
            await to.copy(entry.target, entry.key, plan.bucket, {
              headers,
              signal,
              size: entry.size,
            });
        } else if (entry.key.endsWith('/'))
          await to.put(entry.target, Buffer.alloc(0), { headers, signal });
        else {
          const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'stordock-migrate-'));
          try {
            const file = path.join(temporary, 'payload');
            const result = await from.getStream(entry.key, {
              signal,
              headers: { 'If-Match': entry.etag },
            });
            await pipeline(result.stream, fss.createWriteStream(file, { flags: 'wx' }), { signal });
            if ((await fs.stat(file)).size !== Number(head.res.headers['content-length']))
              throw new Error('迁移读取内容不完整，源对象保留');
            if (!equal((await from.head(entry.key)).res.headers.etag, entry.etag))
              throw new Error('源对象在读取时发生变化，已停止迁移');
            const info = await sourceProvider.objectInfo(source, plan.bucket, entry.key);
            for (const [field, header] of Object.entries({
              contentType: 'Content-Type',
              cacheControl: 'Cache-Control',
              contentDisposition: 'Content-Disposition',
              contentEncoding: 'Content-Encoding',
              contentLanguage: 'Content-Language',
            }))
              if (info[field]) headers[header] = info[field];
            const options = { headers, meta: info.metadata, signal };
            if (entry.size >= 1024 * 1024)
              await to.multipartUpload(entry.target, file, {
                ...options,
                parallel: 3,
                partSize: 1024 * 1024,
              });
            else await to.put(entry.target, file, options);
          } finally {
            if (
              path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
              !path.basename(temporary).startsWith('stordock-migrate-')
            )
              throw new Error('临时目录无效');
            await fs.rm(temporary, { recursive: true, force: true });
          }
        }
        const saved = await to.head(entry.target);
        if (
          !saved.res.headers.etag ||
          Number(saved.res.headers['content-length']) !== Number(head.res.headers['content-length'])
        )
          throw new Error('目标校验未通过，源对象保留');
        copied.set(entry.key, saved.res.headers.etag);
        progress();
      }
      if (plan.operation === 'move')
        for (const entry of plan.entries) {
          signal.throwIfAborted();
          if (!removed.has(entry.key)) {
            if (!equal((await from.head(entry.key)).res.headers.etag, entry.etag))
              throw new Error('源对象已变化，停止删除；已复制目标保留');
            await from.delete(entry.key, {
              signal,
              headers: source.provider === 's3' ? { 'If-Match': entry.etag } : {},
            });
            removed.add(entry.key);
          }
          progress();
        }
    },
    emit,
  );
}
module.exports = { executeMigration };
