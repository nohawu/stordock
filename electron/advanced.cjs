const {
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCopyCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  DeleteObjectTaggingCommand,
  ListObjectVersionsCommand,
  RestoreObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { ensureKey } = require('./core.cjs');
function versionId(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value))
    throw new Error('版本 ID 无效');
  return value;
}
function pairs(input, limit = 100) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length > limit
  )
    throw new Error('键值对格式或数量无效');
  for (const [key, value] of Object.entries(input)) {
    if (
      !key ||
      key.length > 128 ||
      typeof value !== 'string' ||
      value.length > 2048 ||
      /[\x00-\x1f\x7f]/.test(key + value)
    )
      throw new Error('键值对包含无效字符或超出长度限制');
  }
  return input;
}
function validatePatch(input) {
  if (!input || typeof input !== 'object' || typeof input.etag !== 'string' || !input.etag)
    throw new Error('请先读取对象 ETag');
  const patch = { etag: input.etag, metadata: pairs(input.metadata) };
  let bytes = 0;
  for (const [key, value] of Object.entries(patch.metadata)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key) || /[^\x20-\x7e]/.test(value))
      throw new Error('HTTP 元数据键仅支持字母、数字、下划线和连字符，值需为可打印 ASCII 字符');
    bytes += Buffer.byteLength(key + value);
  }
  if (bytes > 8192) throw new Error('自定义元数据不能超过 8 KB');
  for (const field of [
    'contentType',
    'cacheControl',
    'contentDisposition',
    'contentEncoding',
    'contentLanguage',
    'expires',
    'storageClass',
  ]) {
    const value = input[field];
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > 2048 || /[^\x20-\x7e]/.test(value))
    )
      throw new Error('HTTP 属性包含无效字符');
    patch[field] = value || undefined;
  }
  if (patch.expires && !Number.isFinite(Date.parse(patch.expires)))
    throw new Error('Expires 日期无效');
  return patch;
}
function sameEtag(a, b) {
  return String(a).replaceAll('"', '') === String(b).replaceAll('"', '');
}
function sourcePath(bucket, key, version) {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}${version ? `?versionId=${encodeURIComponent(version)}` : ''}`;
}
async function s3Copy(client, request, size, signal) {
  if (!Number.isFinite(size) || size < 0) throw new Error('服务未返回有效的对象大小');
  if (size <= 5 * 1024 ** 3)
    return client.send(new CopyObjectCommand(request), { abortSignal: signal });
  const {
    CopySource,
    CopySourceIfMatch,
    MetadataDirective,
    TaggingDirective,
    IfMatch,
    IfNoneMatch,
    ...create
  } = request;
  const [source, version] = CopySource.split('?versionId=');
  const slash = source.indexOf('/');
  const original = {
    Bucket: source.slice(0, slash),
    Key: decodeURIComponent(source.slice(slash + 1)),
    VersionId: version ? decodeURIComponent(version) : undefined,
  };
  if (MetadataDirective !== 'REPLACE') {
    const head = await client.send(new HeadObjectCommand(original), { abortSignal: signal });
    Object.assign(create, {
      Metadata: head.Metadata,
      ContentType: head.ContentType,
      CacheControl: head.CacheControl,
      ContentDisposition: head.ContentDisposition,
      ContentEncoding: head.ContentEncoding,
      ContentLanguage: head.ContentLanguage,
      Expires: head.Expires,
      StorageClass: head.StorageClass,
    });
  }
  if (!create.Tagging && TaggingDirective !== 'REPLACE') {
    const tags = await client.send(new GetObjectTaggingCommand(original), { abortSignal: signal });
    create.Tagging = (tags.TagSet || [])
      .map((tag) => `${encodeURIComponent(tag.Key)}=${encodeURIComponent(tag.Value || '')}`)
      .join('&');
  }
  const started = await client.send(new CreateMultipartUploadCommand(create), {
    abortSignal: signal,
  });
  const UploadId = started.UploadId;
  if (!UploadId) throw new Error('服务未返回分片上传 ID');
  try {
    const parts = [],
      partSize = Math.max(128 * 1024 ** 2, Math.ceil(size / 10000));
    for (let offset = 0; offset < size; offset += partSize) {
      signal?.throwIfAborted();
      const part = await client.send(
        new UploadPartCopyCommand({
          Bucket: request.Bucket,
          Key: request.Key,
          UploadId,
          PartNumber: parts.length + 1,
          CopySource,
          CopySourceIfMatch,
          CopySourceRange: `bytes=${offset}-${Math.min(size - 1, offset + partSize - 1)}`,
        }),
        { abortSignal: signal },
      );
      if (!part.CopyPartResult?.ETag) throw new Error('服务未返回复制分片 ETag');
      parts.push({ PartNumber: parts.length + 1, ETag: part.CopyPartResult.ETag });
    }
    return await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: request.Bucket,
        Key: request.Key,
        UploadId,
        MultipartUpload: { Parts: parts },
        IfMatch,
        IfNoneMatch,
      }),
      { abortSignal: signal },
    );
  } catch (error) {
    await client.send(
      new AbortMultipartUploadCommand({ Bucket: request.Bucket, Key: request.Key, UploadId }),
    );
    throw error;
  }
}
async function editProperties(provider, connection, bucket, key, input) {
  ensureKey(key, connection.provider === 's3' ? 1024 : 1023);
  const patch = validatePatch(input);
  const info = await provider.objectInfo(connection, bucket, key);
  if (!sameEtag(info.etag, patch.etag)) throw new Error('对象已变化，请刷新属性后再保存');
  const classes =
    connection.provider === 's3'
      ? [
          'STANDARD',
          'STANDARD_IA',
          'ONEZONE_IA',
          'INTELLIGENT_TIERING',
          'GLACIER',
          'DEEP_ARCHIVE',
          'GLACIER_IR',
        ]
      : ['Standard', 'IA', 'Archive', 'ColdArchive', 'DeepColdArchive'];
  if (patch.storageClass && !classes.includes(patch.storageClass)) throw new Error('存储类型无效');
  if (connection.provider === 's3') {
    const client = provider.s3Client(connection);
    await s3Copy(
      client,
      {
        Bucket: bucket,
        Key: key,
        CopySource: sourcePath(bucket, key),
        CopySourceIfMatch: info.etag,
        IfMatch: info.etag,
        MetadataDirective: 'REPLACE',
        Metadata: patch.metadata,
        ContentType: patch.contentType,
        CacheControl: patch.cacheControl,
        ContentDisposition: patch.contentDisposition,
        ContentEncoding: patch.contentEncoding,
        ContentLanguage: patch.contentLanguage,
        Expires: patch.expires ? new Date(patch.expires) : undefined,
        StorageClass:
          patch.storageClass || (info.storageClass === 'Standard' ? 'STANDARD' : info.storageClass),
      },
      info.size,
    );
  } else {
    const sdk = provider.client(connection, bucket);
    const headers = {
      'x-oss-copy-source-if-match': info.etag,
      'x-oss-metadata-directive': 'REPLACE',
    };
    for (const [field, header] of Object.entries({
      contentType: 'Content-Type',
      cacheControl: 'Cache-Control',
      contentDisposition: 'Content-Disposition',
      contentEncoding: 'Content-Encoding',
      contentLanguage: 'Content-Language',
      expires: 'Expires',
    }))
      if (patch[field]) headers[header] = patch[field];
    if (patch.storageClass) headers['x-oss-storage-class'] = patch.storageClass;
    if (info.size > 1024 ** 3)
      await sdk.multipartUploadCopy(
        key,
        { sourceKey: key, sourceBucketName: bucket },
        { headers, meta: patch.metadata },
      );
    else await sdk.copy(key, key, bucket, { headers, meta: patch.metadata });
  }
  return provider.objectInfo(connection, bucket, key);
}
async function tags(provider, connection, bucket, key, values) {
  ensureKey(key, connection.provider === 's3' ? 1024 : 1023);
  if (values !== undefined) pairs(values, 10);
  if (values !== undefined && Object.values(values).some((value) => value.length > 256))
    throw new Error('标签值最多 256 个字符');
  if (connection.provider === 's3') {
    const sdk = provider.s3Client(connection);
    if (values === undefined) {
      const result = await sdk.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
      return Object.fromEntries((result.TagSet || []).map((tag) => [tag.Key, tag.Value || '']));
    }
    if (!Object.keys(values).length)
      await sdk.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }));
    else
      await sdk.send(
        new PutObjectTaggingCommand({
          Bucket: bucket,
          Key: key,
          Tagging: { TagSet: Object.entries(values).map(([Key, Value]) => ({ Key, Value })) },
        }),
      );
  } else {
    const sdk = provider.client(connection, bucket);
    if (values === undefined) return (await sdk.getObjectTagging(key)).tag || {};
    if (!Object.keys(values).length) await sdk.deleteObjectTagging(key);
    else await sdk.putObjectTagging(key, values);
  }
  return values;
}
async function versions(provider, connection, bucket, key, cursor) {
  ensureKey(key, connection.provider === 's3' ? 1024 : 1023);
  if (
    cursor &&
    (typeof cursor !== 'object' ||
      Object.values(cursor).some((value) => typeof value !== 'string' || value.length > 4096))
  )
    throw new Error('版本分页参数无效');
  let result;
  if (connection.provider === 's3') {
    const data = await provider.s3Client(connection).send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: key,
        MaxKeys: 200,
        KeyMarker: cursor?.keyMarker,
        VersionIdMarker: cursor?.versionIdMarker,
      }),
    );
    result = {
      objects: (data.Versions || []).map((item) => ({
        key: item.Key,
        versionId: item.VersionId,
        size: item.Size,
        lastModified: item.LastModified?.toISOString(),
        etag: item.ETag,
        isLatest: item.IsLatest,
        storageClass: item.StorageClass,
      })),
      deletes: (data.DeleteMarkers || []).map((item) => ({
        key: item.Key,
        versionId: item.VersionId,
        lastModified: item.LastModified?.toISOString(),
        isLatest: item.IsLatest,
        deleted: true,
      })),
      cursor: data.IsTruncated
        ? { keyMarker: data.NextKeyMarker, versionIdMarker: data.NextVersionIdMarker || '' }
        : undefined,
    };
  } else {
    const data = await provider.client(connection, bucket).getBucketVersions({
      prefix: key,
      maxKeys: 200,
      keyMarker: cursor?.keyMarker,
      versionIdMarker: cursor?.versionIdMarker,
    });
    result = {
      objects: (data.objects || []).map((item) => ({ ...item, key: item.name })),
      deletes: (data.deleteMarker || []).map((item) => ({
        ...item,
        key: item.name,
        deleted: true,
      })),
      cursor: data.isTruncated
        ? { keyMarker: data.nextKeyMarker, versionIdMarker: data.nextVersionIdMarker || '' }
        : undefined,
    };
  }
  return {
    versions: [...result.objects, ...result.deletes]
      .filter((item) => item.key === key)
      .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified)),
    cursor: result.cursor,
  };
}
async function restoreVersion(provider, connection, bucket, key, id) {
  versionId(id);
  ensureKey(key, connection.provider === 's3' ? 1024 : 1023);
  const sdk = provider.client(connection, bucket);
  const head = await sdk.head(key, { versionId: id });
  if (connection.provider === 's3')
    await s3Copy(
      provider.s3Client(connection),
      {
        Bucket: bucket,
        Key: key,
        CopySource: sourcePath(bucket, key, id),
        CopySourceIfMatch: head.res.headers.etag,
      },
      Number(head.res.headers['content-length']),
    );
  else if (Number(head.res.headers['content-length']) > 1024 ** 3) {
    const headers = Object.fromEntries(
      Object.entries(head.res.headers).filter(
        ([name]) =>
          /^x-oss-meta-/.test(name) ||
          [
            'content-type',
            'cache-control',
            'content-disposition',
            'content-language',
            'content-encoding',
            'expires',
            'x-oss-storage-class',
          ].includes(name),
      ),
    );
    headers['x-oss-copy-source-if-match'] = head.res.headers.etag;
    await sdk.multipartUploadCopy(
      key,
      { sourceKey: key, sourceBucketName: bucket },
      { versionId: id, headers },
    );
  } else
    await sdk.copy(key, key, bucket, {
      versionId: id,
      headers: { 'x-oss-copy-source-if-match': head.res.headers.etag },
    });
}
async function restoreArchive(provider, connection, bucket, key, days, tier) {
  ensureKey(key, connection.provider === 's3' ? 1024 : 1023);
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 30 ||
    !['Standard', 'Bulk', 'Expedited'].includes(tier)
  )
    throw new Error('解冻天数或优先级无效');
  if (connection.provider === 's3')
    await provider.s3Client(connection).send(
      new RestoreObjectCommand({
        Bucket: bucket,
        Key: key,
        RestoreRequest: { Days: days, GlacierJobParameters: { Tier: tier } },
      }),
    );
  else {
    const info = await provider.objectInfo(connection, bucket, key);
    await provider
      .client(connection, bucket)
      .restore(key, { type: info.storageClass, Days: days, JobParameters: tier });
  }
}
module.exports = {
  validatePatch,
  pairs,
  versionId,
  editProperties,
  tags,
  versions,
  restoreVersion,
  restoreArchive,
  s3Copy,
};
