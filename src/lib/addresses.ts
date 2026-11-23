import type { Connection } from '../types';

// Encode each key segment once and keep its directory separators intact.
export function objectAddress(
  connection: Pick<Connection, 'provider' | 'endpoint' | 'region' | 'forcePathStyle'>,
  bucket: string,
  key: string,
) {
  const endpoint = new URL(
    connection.endpoint || `https://oss-${connection.region.replace(/^oss-/, '')}.aliyuncs.com`,
  );
  const encodedKey = key
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
  const isIp =
    /^\[.*\]$/.test(endpoint.hostname) || /^(\d{1,3}\.){3}\d{1,3}$/.test(endpoint.hostname);
  // The S3 SDK uses path-style for IP endpoints and dotted buckets over TLS.
  const pathStyle =
    connection.provider === 's3' &&
    (connection.forcePathStyle !== false ||
      isIp ||
      (endpoint.protocol === 'https:' && bucket.includes('.')));
  const basePath = endpoint.pathname.replace(/\/$/, '');
  if (!pathStyle && !(connection.provider === 'aliyun' && isIp))
    endpoint.hostname = `${bucket}.${endpoint.hostname}`;
  // Concatenation preserves literal percent signs, leading slashes and repeated slashes in keys.
  return {
    httpUrl: `${endpoint.origin}${basePath}/${pathStyle ? `${encodeURIComponent(bucket)}/` : ''}${encodedKey}`,
    uri: `${connection.provider === 's3' ? 's3' : 'oss'}://${bucket}/${key}`,
    endpoint:
      connection.endpoint || `https://oss-${connection.region.replace(/^oss-/, '')}.aliyuncs.com`,
  };
}
