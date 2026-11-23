const { randomUUID } = require('node:crypto');

const { validateConnection, validateBucket } = require('./connection.cjs');
function publicConnection(connection) {
  const { accessKeySecret, stsToken, credentialRefreshToken, remember, ...metadata } = connection;
  return { ...metadata, hasSecret: true, temporary: !remember };
}
function validateFolder(name) {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    /[\\/\x00-\x1f]/.test(name) ||
    name === '.' ||
    name === '..' ||
    Buffer.byteLength(name) > 255
  )
    throw new Error('文件夹名称无效');
  return name.trim();
}
function safeFilename(key) {
  const name = key
    .split('/')
    .pop()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '');
  if (!name || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(name))
    return `object-${randomUUID().slice(0, 8)}`;
  return name;
}
function ensureKey(key, maxBytes = 1023) {
  if (typeof key !== 'string' || !key || Buffer.byteLength(key) > maxBytes || key.includes('\0'))
    throw new Error('对象路径无效');
  return key;
}
function mapListing(result, prefix, query = '') {
  const folders = (result.prefixes || []).map((key) => ({
    key,
    name: key.slice(prefix.length).replace(/\/$/, ''),
    kind: 'folder',
    size: 0,
    lastModified: '',
    storageClass: '',
  }));
  const files = (result.objects || [])
    .filter(
      (o) =>
        o.name !== prefix &&
        !o.name.endsWith('/') &&
        (!query || o.name.toLowerCase().includes(query.toLowerCase())),
    )
    .map((o) => ({
      key: o.name,
      name: query ? o.name.slice(prefix.length) : o.name.split('/').pop(),
      kind: 'file',
      size: Number(o.size),
      lastModified: o.lastModified,
      storageClass: o.storageClass || 'Standard',
      etag: o.etag,
    }));
  return {
    objects: [...folders, ...files],
    cursor: result.isTruncated ? result.nextContinuationToken : undefined,
    scanned: (result.objects || []).length,
  };
}
module.exports = {
  validateConnection,
  validateBucket,
  publicConnection,
  validateFolder,
  safeFilename,
  ensureKey,
  mapListing,
};
