// Deterministic network boundary for desktop integration tests; never included in builds.
const OSS = require('ali-oss');
const fs = require('node:fs/promises');
const { Readable } = require('node:stream');
const { dialog } = require('electron');
const path = require('node:path');
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
  res: { headers: { 'content-length': content.get(key).length } },
});
OSS.prototype.getStream = async (key) => ({
  stream: Readable.from([content.get(key)]),
  res: { headers: { 'content-length': content.get(key).length } },
});
OSS.prototype.put = async (key, file) => {
  if (content.has(key)) throw Object.assign(new Error('existing'), { code: 'FileAlreadyExists' });
  content.set(key, Buffer.isBuffer(file) ? file : await fs.readFile(file));
};
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [path.join(process.env.OSS_DESK_TEST_DATA, 'upload-fixture.txt')],
});
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: path.join(process.env.OSS_DESK_TEST_DATA, 'download-result.txt'),
});
require('../electron/main.cjs');
