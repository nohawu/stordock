const { randomUUID } = require('node:crypto');

function validateBucket(bucket, provider = 'aliyun') {
  const valid =
    provider === 's3'
      ? /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) &&
        !/\.\.|\.-|-\.|^\d+\.\d+\.\d+\.\d+$/.test(bucket)
      : /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket);
  if (typeof bucket !== 'string' || !valid) throw new Error('Bucket 名称格式无效');
  return bucket;
}
function validateConnection(input) {
  if (!input || typeof input !== 'object') throw new Error('连接参数无效');
  const text = (key, required = true) => {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if ((required && !value) || value.length > 4096) throw new Error(`请填写有效的 ${key}`);
    return value;
  };
  const provider = input.provider ?? 'aliyun';
  if (!['aliyun', 's3'].includes(provider)) throw new Error('不支持的存储服务类型');
  const region =
    provider === 'aliyun'
      ? text('region').replace(/^oss-/, '')
      : text('region', false) || 'us-east-1';
  const regionPattern = provider === 's3' ? /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/ : /^[a-z0-9-]+$/;
  if (!regionPattern.test(region)) throw new Error('Region 格式无效');
  const endpoint = text('endpoint', provider === 's3');
  if (endpoint) {
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('Endpoint 地址无效，请填写完整的服务地址');
    }
    const allowHttp = provider === 's3' && input.allowInsecure === true;
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:'))
      throw new Error('Endpoint 必须使用 HTTPS；S3 自建服务使用 HTTP 时需要显式启用');
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (provider === 'aliyun' && url.pathname !== '/')
    )
      throw new Error('Endpoint 不能包含账号、查询参数或片段；阿里云地址不能包含路径');
  }
  const bucket = text('bucket', false);
  if (bucket) validateBucket(bucket, provider);
  const credentialRefreshUrl = text('credentialRefreshUrl', false);
  if (credentialRefreshUrl) {
    let url;
    try {
      url = new URL(credentialRefreshUrl);
    } catch {
      throw new Error('凭据刷新地址无效');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error('凭据刷新地址必须为无账号、查询参数和片段的 HTTPS URL');
  }
  return {
    id: input.id || randomUUID(),
    name: text('name'),
    provider,
    region,
    endpoint,
    bucket,
    accessKeyId: text('accessKeyId', !credentialRefreshUrl),
    accessKeySecret: text('accessKeySecret', !credentialRefreshUrl),
    stsToken: text('stsToken', false),
    remember: input.remember === true,
    credentialRefreshUrl,
    credentialRefreshToken: text('credentialRefreshToken', false),
    ...(provider === 's3'
      ? {
          forcePathStyle: input.forcePathStyle !== false,
          allowInsecure: input.allowInsecure === true,
        }
      : {}),
  };
}
module.exports = { validateConnection, validateBucket };
