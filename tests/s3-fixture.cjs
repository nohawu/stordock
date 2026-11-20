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
  const uploads = new Map();
  const requests = [];
  const controls = { failCopyKey: options.failCopyKey, failDeleteKey: options.failDeleteKey };
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
        response.writeHead(status, { 'Content-Type': 'application/xml' });
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
        if (request.headers['x-amz-copy-source']) {
          if (controls.failCopyKey === key) return error(403, 'AccessDenied');
          const sourceKey = decodeURIComponent(request.headers['x-amz-copy-source'])
            .replace(/^\//, '')
            .slice(bucket.length + 1);
          const source = objects.get(sourceKey);
          if (!source) return error(404, 'NoSuchKey');
          if (request.headers['if-none-match'] === '*' && objects.has(key))
            return error(412, 'PreconditionFailed');
          if (
            request.headers['x-amz-copy-source-if-match'] &&
            request.headers['x-amz-copy-source-if-match'] !== etag(source)
          )
            return error(412, 'PreconditionFailed');
          objects.set(key, Buffer.from(source));
          return sendXml(
            200,
            `<CopyObjectResult><LastModified>2026-11-20T00:00:00Z</LastModified><ETag>${xml(etag(source))}</ETag></CopyObjectResult>`,
          );
        }
        if (request.headers['if-none-match'] === '*' && objects.has(key))
          return error(412, 'PreconditionFailed');
        objects.set(key, body);
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
        objects.delete(key);
        response.writeHead(204);
        return response.end();
      }
      if (request.method === 'HEAD' || request.method === 'GET') {
        const value = objects.get(key);
        if (!value) return error(404, 'NoSuchKey');
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
        const output = range ? value.subarray(Number(range[1]), Number(range[2]) + 1) : value;
        response.writeHead(range ? 206 : 200, {
          'Content-Length': output.length,
          'Content-Type': 'application/octet-stream',
          ETag: etag(value),
          ...(range
            ? {
                'Content-Range': `bytes ${range[1]}-${Math.min(value.length - 1, Number(range[2]))}/${value.length}`,
              }
            : {}),
        });
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
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
module.exports = { createS3Fixture };
