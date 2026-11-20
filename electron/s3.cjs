const {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  UploadPartCopyCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Readable } = require('node:stream');
const { Agent: HttpAgent } = require('node:http');
const { Agent: HttpsAgent } = require('node:https');
const { AliyunProvider } = require('./oss.cjs');

// Shared pools keep per-operation clients from creating unbounded idle socket pools.
const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 32 });
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 32 });
function createS3Client(connection) {
  return new S3Client({
    endpoint: connection.endpoint,
    region: connection.region || 'us-east-1',
    credentials: {
      accessKeyId: connection.accessKeyId,
      secretAccessKey: connection.accessKeySecret,
      sessionToken: connection.stsToken || undefined,
    },
    forcePathStyle: connection.forcePathStyle !== false,
    followRegionRedirects: true,
    maxAttempts: 2,
    // Many S3-compatible endpoints do not implement optional AWS checksum trailers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { httpAgent, httpsAgent, connectionTimeout: 10000, socketTimeout: 120000 },
  });
}
function contentType(key) {
  const extension = key.split('.').pop().toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
      svg: 'image/svg+xml',
      json: 'application/json',
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
    }[extension] || 'application/octet-stream'
  );
}
function adapter(connection, bucket, makeClient) {
  const sdk = makeClient(connection);
  const Bucket = bucket || connection.bucket || undefined;
  return {
    async listBuckets(query = {}) {
      const result = await sdk.send(new ListBucketsCommand({ ContinuationToken: query.marker }));
      return {
        buckets: (result.Buckets || []).map((b) => ({
          name: b.Name,
          region: b.BucketRegion || connection.region,
          creationDate: b.CreationDate?.toISOString(),
        })),
        isTruncated: !!result.ContinuationToken,
        nextMarker: result.ContinuationToken,
      };
    },
    async listV2(query = {}) {
      const result = await sdk.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: query.prefix,
          Delimiter: query.delimiter,
          MaxKeys: query['max-keys'],
          ContinuationToken: query['continuation-token'],
        }),
      );
      return {
        objects: (result.Contents || []).map((o) => ({
          name: o.Key,
          size: o.Size || 0,
          lastModified: o.LastModified?.toISOString() || '',
          storageClass:
            !o.StorageClass || o.StorageClass === 'STANDARD' ? 'Standard' : o.StorageClass,
          etag: o.ETag,
        })),
        prefixes: (result.CommonPrefixes || []).map((p) => p.Prefix),
        isTruncated: result.IsTruncated,
        nextContinuationToken: result.NextContinuationToken,
      };
    },
    async head(key) {
      const result = await sdk.send(new HeadObjectCommand({ Bucket, Key: key }));
      return {
        res: { headers: { 'content-length': String(result.ContentLength), etag: result.ETag } },
      };
    },
    async getStream(key, options = {}) {
      const result = await sdk.send(
        new GetObjectCommand({ Bucket, Key: key, Range: options.headers?.Range }),
        { abortSignal: options.signal },
      );
      if (!result.Body && result.ContentLength !== 0) throw new Error('服务未返回文件内容');
      return {
        stream: result.Body || Readable.from([]),
        res: { headers: { 'content-length': String(result.ContentLength) } },
      };
    },
    async put(key, file, options = {}) {
      // The shared provider calls put only for small files or zero-byte directory markers.
      const body = Buffer.isBuffer(file) ? file : await fsp.readFile(file);
      return sdk.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentLength: body.length,
          ContentType: contentType(key),
          IfNoneMatch: options.headers?.['x-oss-forbid-overwrite'] === 'true' ? '*' : undefined,
        }),
        { abortSignal: options.signal },
      );
    },
    async delete(key, options = {}) {
      return sdk.send(
        new DeleteObjectCommand({ Bucket, Key: key, IfMatch: options.headers?.['If-Match'] }),
        { abortSignal: options.signal },
      );
    },
    async copy(key, source, sourceBucket, options = {}) {
      const CopySource = `${sourceBucket}/${source.split('/').map(encodeURIComponent).join('/')}`;
      const CopySourceIfMatch = options.headers?.['x-oss-copy-source-if-match'];
      if (options.size <= 5 * 1024 ** 3)
        return sdk.send(
          new CopyObjectCommand({
            Bucket,
            Key: key,
            CopySource,
            CopySourceIfMatch,
            IfNoneMatch: '*',
          }),
          { abortSignal: options.signal },
        );
      const initiated = await sdk.send(
        new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType(key) }),
        { abortSignal: options.signal },
      );
      const UploadId = initiated.UploadId;
      if (!UploadId) throw new Error('服务未返回分片复制 ID');
      try {
        const partSize = Math.max(128 * 1024 ** 2, Math.ceil(options.size / 10000));
        const parts = [];
        for (let start = 0; start < options.size; start += partSize) {
          const PartNumber = parts.length + 1;
          const part = await sdk.send(
            new UploadPartCopyCommand({
              Bucket,
              Key: key,
              UploadId,
              PartNumber,
              CopySource,
              CopySourceIfMatch,
              CopySourceRange: `bytes=${start}-${Math.min(options.size - 1, start + partSize - 1)}`,
            }),
            { abortSignal: options.signal },
          );
          if (!part.CopyPartResult?.ETag) throw new Error('服务未返回复制分片 ETag');
          parts.push({ PartNumber, ETag: part.CopyPartResult.ETag });
        }
        await sdk.send(
          new CompleteMultipartUploadCommand({
            Bucket,
            Key: key,
            UploadId,
            MultipartUpload: { Parts: parts },
            IfNoneMatch: '*',
          }),
          { abortSignal: options.signal },
        );
      } catch (error) {
        await sdk.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId }));
        throw error;
      }
    },
    async multipartUpload(key, file, options = {}) {
      const { size } = await fsp.stat(file);
      const MiB = 1024 * 1024;
      const partSize = Math.max(8 * MiB, Math.ceil(size / 10000 / MiB) * MiB);
      if (partSize > 5 * 1024 * MiB) throw new Error('文件超出 S3 分片上传大小限制');
      const initiated = await sdk.send(
        new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType(key) }),
        { abortSignal: options.signal },
      );
      const UploadId = initiated.UploadId;
      if (!UploadId) throw new Error('服务未返回分片上传 ID');
      const parts = [];
      let next = 1,
        completedBytes = 0;
      const partCount = Math.max(1, Math.ceil(size / partSize));
      let failed;
      try {
        const worker = async () => {
          while (!failed && next <= partCount) {
            const PartNumber = next++;
            const start = (PartNumber - 1) * partSize;
            const length = Math.min(partSize, size - start);
            const body = fs.createReadStream(file, { start, end: start + length - 1 });
            try {
              const result = await sdk.send(
                new UploadPartCommand({
                  Bucket,
                  Key: key,
                  UploadId,
                  PartNumber,
                  Body: body,
                  ContentLength: length,
                }),
                { abortSignal: options.signal },
              );
              if (!result.ETag) throw new Error('服务未返回分片 ETag');
              parts.push({ PartNumber, ETag: result.ETag });
              completedBytes += length;
              await options.progress?.(Math.min(0.99, completedBytes / size));
            } catch (error) {
              failed = error;
              throw error;
            } finally {
              body.destroy();
            }
          }
        };
        // Wait for all in-flight parts before aborting; no part races with cleanup.
        const results = await Promise.allSettled(
          Array.from({ length: Math.min(3, partCount) }, worker),
        );
        const rejected = results.find((r) => r.status === 'rejected');
        if (rejected) throw rejected.reason;
        await sdk.send(
          new CompleteMultipartUploadCommand({
            Bucket,
            Key: key,
            UploadId,
            MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
            IfNoneMatch: options.headers?.['x-oss-forbid-overwrite'] === 'true' ? '*' : undefined,
          }),
          { abortSignal: options.signal },
        );
      } catch (error) {
        try {
          await sdk.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId }));
        } catch {
          throw new Error('上传失败且未能清理分片，请检查服务端未完成的分片上传');
        }
        throw error;
      }
    },
  };
}
// Reuse bounded preview, streaming downloads, transfer progress and directory semantics.
class S3Provider extends AliyunProvider {
  async buckets(connection) {
    const sdk = this.client(connection);
    if (connection.bucket) {
      await sdk.listV2({ 'max-keys': 1 });
      return [{ name: connection.bucket, region: connection.region }];
    }
    const buckets = [];
    let marker;
    do {
      const result = await sdk.listBuckets({ marker });
      buckets.push(
        ...(result.buckets || []).map((b) => ({
          name: b.name,
          region: b.region || connection.region,
          createdAt: b.creationDate,
        })),
      );
      marker = result.isTruncated ? result.nextMarker : undefined;
    } while (marker);
    return buckets;
  }

  constructor(makeClient = createS3Client) {
    super((connection, bucket) => adapter(connection, bucket, makeClient));
  }
}
module.exports = { S3Provider, createS3Client };
