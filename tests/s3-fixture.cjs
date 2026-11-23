const http = require('node:http');
const { createHash, randomUUID } = require('node:crypto');
const xml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const etag = (body) => '"' + createHash('md5').update(body).digest('hex') + '"';
async function createS3Fixture(options = {}) {
  const bucket = options.bucket || 'media.bucket';
  const objects = new Map([
    ['hello.json', Buffer.from('{"storage":"s3","message":"你好"}')],
    ['folder/nested.txt', Buffer.from('Nested S3 object')],
  ]);
  const attributes = new Map();
  const tagSets = new Map();
  const history = new Map();
  function capture(key, body, deleted = false) {
    if (!options.versioning) return;
    const entries = history.get(key) || [];
    entries.unshift({
      id: randomUUID(),
      body: Buffer.from(body || ''),
      deleted,
      modified: new Date().toISOString(),
      attributes: { ...(attributes.get(key) || {}) },
    });
    history.set(key, entries);
  }
  if (options.versioning) for (const [key, body] of objects) capture(key, body);
  const uploads = new Map();
  const requests = [];
  const controls = {
    failCopyKey: options.failCopyKey,
    failDeleteKey: options.failDeleteKey,
    failPutKey: undefined,
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://fixture');
      const fullPath = decodeURIComponent(url.pathname);
      const resource = fullPath.slice((options.basePath || '').length).replace(/^\//, '');
      const slash = resource.indexOf('/');
      const requestBucket = slash < 0 ? resource : resource.slice(0, slash);
      const key = slash < 0 ? '' : resource.slice(slash + 1);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      requests.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: request.headers,
        bytes: body.length,
        xml: request.method === 'POST' ? body.toString() : undefined,
      });
      const sendXml = (status, content) => {
        response.writeHead(status, { 'content-type': 'application/xml' });
        response.end(content);
      };
      const error = (status, code) =>
        sendXml(status, `<Error><Code>${code}</Code><Message>Fixture error</Message></Error>`);
      if (request.method === 'GET' && !requestBucket)
        return sendXml(
          200,
          `<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>fixture</ID><DisplayName>fixture</DisplayName></Owner><Buckets><Bucket><Name>${bucket}</Name><CreationDate>2026-11-20T00:00:00Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>`,
        );
      if (requestBucket !== bucket) return error(404, 'NoSuchBucket');
      if (request.method === 'GET' && url.searchParams.has('versions')) {
        const prefix = url.searchParams.get('prefix') || '';
        const rows = [...history]
          .filter(([name]) => name.startsWith(prefix))
          .flatMap(([name, versions]) =>
            versions.map(
              (item, index) =>
                `<${item.deleted ? 'DeleteMarker' : 'Version'}><Key>${xml(name)}</Key><VersionId>${item.id}</VersionId><IsLatest>${index === 0}</IsLatest><LastModified>${item.modified}</LastModified><Size>${item.body.length}</Size><ETag>${xml(etag(item.body))}</ETag><StorageClass>STANDARD</StorageClass><Owner><ID>fixture</ID><DisplayName>fixture</DisplayName></Owner></${item.deleted ? 'DeleteMarker' : 'Version'}>`,
            ),
          )
          .join('');
        return sendXml(
          200,
          `<ListVersionsResult><Name>${bucket}</Name><IsTruncated>false</IsTruncated>${rows}</ListVersionsResult>`,
        );
      }
      if (url.searchParams.has('tagging')) {
        if (request.method === 'GET')
          return sendXml(
            200,
            `<Tagging><TagSet>${Object.entries(tagSets.get(key) || {})
              .map(([k, v]) => `<Tag><Key>${xml(k)}</Key><Value>${xml(v)}</Value></Tag>`)
              .join('')}</TagSet></Tagging>`,
          );
        if (request.method === 'PUT')
          tagSets.set(
            key,
            Object.fromEntries(
              [
                ...body.toString().matchAll(/<Tag><Key>(.*?)<\/Key><Value>(.*?)<\/Value><\/Tag>/g),
              ].map((item) => [item[1], item[2]]),
            ),
          );
        if (request.method === 'DELETE') tagSets.delete(key);
        response.writeHead(request.method === 'DELETE' ? 204 : 200);
        return response.end();
      }
      if (request.method === 'POST' && url.searchParams.has('restore')) {
        attributes.set(key, {
          ...(attributes.get(key) || {}),
          'x-amz-restore': 'ongoing-request="true"',
        });
        response.writeHead(202);
        return response.end();
      }
      if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || '';
        const delimiter = url.searchParams.get('delimiter');
        const entries = new Map();
        for (const [name, value] of [...objects].sort(([a], [b]) => a.localeCompare(b))) {
          if (!name.startsWith(prefix)) continue;
          const suffix = name.slice(prefix.length);
          if (delimiter && suffix.includes(delimiter)) {
            const folder = prefix + suffix.slice(0, suffix.indexOf(delimiter) + delimiter.length);
            entries.set(folder, { folder });
          } else entries.set(name, { key: name, value });
        }
        const start = Number(
          (url.searchParams.get('continuation-token') || 'offset:0').split(':')[1],
        );
        const limit = Math.min(
          Number(url.searchParams.get('max-keys') || 1000),
          options.pageSize || 1000,
        );
        const page = [...entries.values()].slice(start, start + limit);
        const more = start + limit < entries.size;
        const contents = page
          .map((o) =>
            o.folder
              ? `<CommonPrefixes><Prefix>${xml(o.folder)}</Prefix></CommonPrefixes>`
              : `<Contents><Key>${xml(o.key)}</Key><LastModified>2026-11-20T00:00:00Z</LastModified><ETag>${xml(etag(o.value))}</ETag><Size>${o.value.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
          )
          .join('');
        return sendXml(
          200,
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${limit}</MaxKeys><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>offset:${start + limit}</NextContinuationToken>` : ''}${contents}</ListBucketResult>`,
        );
      }
      if (request.method === 'POST' && url.searchParams.has('uploads')) {
        const id = randomUUID();
        uploads.set(id, { key, parts: new Map() });
        return sendXml(
          200,
          `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${xml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
        );
      }
      const id = url.searchParams.get('uploadId');
      if (request.method === 'PUT' && id) {
        const part = Number(url.searchParams.get('partNumber'));
        if (!uploads.has(id)) return error(404, 'NoSuchUpload');
        if (options.failPart === part) return error(400, 'InvalidPart');
        uploads.get(id).parts.set(part, body);
        response.writeHead(200, { ETag: etag(body) });
        return response.end();
      }
      if (request.method === 'DELETE' && id) {
        uploads.delete(id);
        response.writeHead(204);
        return response.end();
      }
      if (request.method === 'POST' && id) {
        const upload = uploads.get(id);
        if (!upload) return error(404, 'NoSuchUpload');
        if (options.failComplete || (request.headers['if-none-match'] === '*' && objects.has(key)))
          return error(412, 'PreconditionFailed');
        const numbers = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) =>
          Number(m[1]),
        );
        if (!numbers.length || numbers.some((n, i) => n !== i + 1))
          return error(400, 'InvalidPartOrder');
        objects.set(key, Buffer.concat(numbers.map((n) => upload.parts.get(n))));
        uploads.delete(id);
        return sendXml(
          200,
          `<CompleteMultipartUploadResult><Location>fixture</Location><Bucket>${bucket}</Bucket><Key>${xml(key)}</Key><ETag>${xml(etag(objects.get(key)))}</ETag></CompleteMultipartUploadResult>`,
        );
      }
      if (request.method === 'PUT') {
        if (controls.failPutKey === key) return error(403, 'AccessDenied');
        if (
          request.headers['if-match'] &&
          (!objects.has(key) || request.headers['if-match'] !== etag(objects.get(key)))
        )
          return error(412, 'PreconditionFailed');
        if (request.headers['x-amz-copy-source']) {
          if (controls.failCopyKey === key) return error(403, 'AccessDenied');
          const [encodedSource, sourceVersion] =
            request.headers['x-amz-copy-source'].split('?versionId=');
          const sourceKey = decodeURIComponent(encodedSource)
            .replace(/^\//, '')
            .slice(bucket.length + 1);
          const source = sourceVersion
            ? history.get(sourceKey)?.find((item) => item.id === decodeURIComponent(sourceVersion))
                ?.body
            : objects.get(sourceKey);
          if (!source) return error(404, 'NoSuchKey');
          if (request.headers['if-none-match'] === '*' && objects.has(key))
            return error(412, 'PreconditionFailed');
          if (
            request.headers['x-amz-copy-source-if-match'] &&
            request.headers['x-amz-copy-source-if-match'] !== etag(source)
          )
            return error(412, 'PreconditionFailed');
          objects.set(key, Buffer.from(source));
          if (request.headers['x-amz-metadata-directive'] === 'REPLACE')
            attributes.set(
              key,
              Object.fromEntries(
                Object.entries(request.headers).filter(
                  ([name]) =>
                    [
                      'content-type',
                      'cache-control',
                      'content-disposition',
                      'content-language',
                      'content-encoding',
                      'expires',
                      'x-amz-storage-class',
                    ].includes(name) || name.startsWith('x-amz-meta-'),
                ),
              ),
            );
          else if (attributes.has(sourceKey)) attributes.set(key, { ...attributes.get(sourceKey) });
          capture(key, source);
          return sendXml(
            200,
            `<CopyObjectResult><LastModified>2026-11-20T00:00:00Z</LastModified><ETag>${xml(etag(source))}</ETag></CopyObjectResult>`,
          );
        }
        if (request.headers['if-none-match'] === '*' && objects.has(key))
          return error(412, 'PreconditionFailed');
        objects.set(key, body);
        capture(key, body);
        response.writeHead(200, { ETag: etag(body) });
        return response.end();
      }
      if (request.method === 'DELETE') {
        if (controls.failDeleteKey === key) return error(403, 'AccessDenied');
        if (
          request.headers['if-match'] &&
          objects.has(key) &&
          request.headers['if-match'] !== etag(objects.get(key))
        )
          return error(412, 'PreconditionFailed');
        capture(key, undefined, true);
        objects.delete(key);
        response.writeHead(204);
        return response.end();
      }
      if (request.method === 'HEAD' || request.method === 'GET') {
        const version = url.searchParams.get('versionId');
        const storedVersion = version
          ? history.get(key)?.find((item) => item.id === version && !item.deleted)
          : undefined;
        const value = version ? storedVersion?.body : objects.get(key);
        if (!value) return error(404, 'NoSuchKey');
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
        const output = range ? value.subarray(Number(range[1]), Number(range[2]) + 1) : value;
        response.writeHead(range ? 206 : 200, {
          'Content-Length': output.length,
          'content-type': 'application/octet-stream',
          ETag: etag(value),
          'Last-Modified': 'Thu, 19 Nov 2026 02:30:00 GMT',
          'cache-control': 'public, max-age=3600',
          'content-disposition': 'inline',
          'x-amz-meta-project': 'fixture-project',
          ...(storedVersion?.attributes || attributes.get(key) || {}),
          ...(storedVersion ? { 'x-amz-version-id': storedVersion.id } : {}),
          ...(range
            ? {
                'Content-Range': `bytes ${range[1]}-${Math.min(value.length - 1, Number(range[2]))}/${value.length}`,
              }
            : {}),
        });
        if (request.method === 'GET' && !range && controls.slowDownloadKey === key) {
          response.write(output.subarray(0, 16 * 1024));
          const timer = setTimeout(() => response.end(output.subarray(16 * 1024)), 30000);
          response.once('close', () => clearTimeout(timer));
          return;
        }
        return response.end(request.method === 'HEAD' ? undefined : output);
      }
      return error(501, 'NotImplemented');
    } catch {
      response.writeHead(500);
      response.end('Fixture failure');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    endpoint: `http://127.0.0.1:${server.address().port}${options.basePath || ''}`,
    bucket,
    objects,
    uploads,
    requests,
    controls,
    attributes,
    tagSets,
    history,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
module.exports = { createS3Fixture };
