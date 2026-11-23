// Deterministic network boundary for desktop integration tests; never included in builds.
const OSS = require('ali-oss');
const fs = require('node:fs/promises');
const { Readable } = require('node:stream');
const { dialog, shell } = require('electron');
const fsSync = require('node:fs');
const path = require('node:path');
const recordReveal = (filePath) =>
  fsSync.appendFileSync(
    path.join(process.env.OSS_DESK_TEST_DATA, 'revealed-paths.jsonl'),
    JSON.stringify(filePath) + '\n',
  );
shell.showItemInFolder = recordReveal;
shell.openPath = async (filePath) => {
  recordReveal(filePath);
  return '';
};
const content = new Map([
  ['native-check.json', Buffer.from('{"source":"desktop integration","safe":true}')],
]);
OSS.prototype.listBuckets = async () => ({
  buckets: [{ name: 'integration-bucket', region: 'oss-cn-hangzhou' }],
  isTruncated: false,
});
OSS.prototype.listV2 = async function (query = {}) {
  const prefix = query.prefix || '';
  return {
    objects: [...content]
      .filter(([key]) => key.startsWith(prefix))
      .map(([name, body]) => ({
        name,
        size: body.length,
        lastModified: '2026-11-19T02:30:00Z',
        storageClass: 'Standard',
      })),
    prefixes: [],
    isTruncated: false,
  };
};
OSS.prototype.head = async (key) => ({
  res: {
    headers: {
      'content-length': content.get(key).length,
      'content-type': key.endsWith('.json') ? 'application/json' : 'text/plain',
      'cache-control': 'max-age=3600',
      etag: 'desktop-etag',
      'last-modified': 'Thu, 19 Nov 2026 02:30:00 GMT',
      'x-oss-meta-project': 'desktop integration',
    },
  },
});
OSS.prototype.getBucketVersioning = async () => ({ versionStatus: undefined });
OSS.prototype.getStream = async (key) => ({
  stream: Readable.from([content.get(key)]),
  res: { headers: { 'content-length': content.get(key).length } },
});
OSS.prototype.put = async (key, file) => {
  if (content.has(key)) throw Object.assign(new Error('existing'), { code: 'FileAlreadyExists' });
  content.set(key, Buffer.isBuffer(file) ? file : await fs.readFile(file));
};
dialog.showOpenDialog = async (_window, options) => ({
  canceled: false,
  filePaths: [
    ...(options.title === '导入连接'
      ? [path.join(process.env.OSS_DESK_TEST_DATA, 'connections-backup.json')]
      : [
          path.join(
            process.env.OSS_DESK_TEST_DATA,
            options.properties.includes('openDirectory')
              ? options.title === '选择下载目录'
                ? 'downloads'
                : 'upload-folder'
              : 'upload-fixture.txt',
          ),
        ]),
  ],
});
dialog.showSaveDialog = async (_window, options) => ({
  canceled: false,
  filePath: path.join(
    process.env.OSS_DESK_TEST_DATA,
    options.title === '导出连接' ? 'connections-backup.json' : 'download-result.txt',
  ),
});
require('../electron/main.cjs');
