const { randomUUID } = require('node:crypto');

function validateConnection(input) {
  if (!input || typeof input !== 'object') throw new Error('连接参数无效');
  const text = (key, required = true) => {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if ((required && !value) || value.length > 4096) throw new Error(`请填写有效的 ${key}`);
    return value;
  };
  const region = text('region').replace(/^oss-/, '');
  if (!/^[a-z0-9-]+$/.test(region)) throw new Error('Region 格式无效，例如 cn-hangzhou');
  const endpoint = text('endpoint', false);
  if (endpoint) {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('Endpoint 必须是 HTTPS 服务地址，不能包含路径、查询参数或账号');
  }
  const bucket = text('bucket', false);
  if (bucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error('Bucket 名称格式无效');
  return {
    id: input.id || randomUUID(),
    name: text('name'),
    provider: 'aliyun',
    region,
    endpoint,
    bucket,
    accessKeyId: text('accessKeyId'),
    accessKeySecret: text('accessKeySecret'),
    stsToken: text('stsToken', false),
    remember: Boolean(input.remember),
  };
}
function publicConnection(connection) {
  const { accessKeySecret, stsToken, remember, ...metadata } = connection;
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
function ensureKey(key) {
  if (typeof key !== 'string' || !key || Buffer.byteLength(key) > 1023 || key.includes('\0'))
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
  publicConnection,
  validateFolder,
  safeFilename,
  ensureKey,
  mapListing,
};
