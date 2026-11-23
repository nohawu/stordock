import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { objectAddress } from '../src/lib/addresses';
const require = createRequire(import.meta.url);
const { validateConnection, validateBucket, publicConnection } = require('../electron/core.cjs');
const { S3Provider, createS3Client } = require('../electron/s3.cjs');
const { providerFor } = require('../electron/providers.cjs');
const { friendlyError } = require('../electron/oss.cjs');
const { taskManager } = require('../electron/tasks.cjs');
const { expandObjects } = require('../electron/operations.cjs');
const { collectUploads, downloadEntries } = require('../electron/files.cjs');
const { createS3Fixture } = require('./s3-fixture.cjs');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await taskManager.clear();
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('recursive operations and recoverable transfers', () => {
  it('uploads a local tree including empty directories and downloads nested paths', async () => {
    const { provider, connection, server } = await fixture({ pageSize: 1 });
    const dir = await directory();
    const root = path.join(dir, 'photos');
    await fs.mkdir(path.join(root, 'empty'), { recursive: true });
    await fs.mkdir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'sub', '中文.txt'), 'nested content');
    const items = await collectUploads([{ path: root }]);
    expect(items.map((item: any) => item.relativePath).sort()).toEqual([
      'photos/empty/',
      'photos/sub/中文.txt',
    ]);
    const summary = await provider.upload(connection, server.bucket, '', items, () => {});
    expect(summary.completed).toBe(2);
    expect(server.objects.has('photos/empty/')).toBe(true);
    const roots = [
      { key: 'photos/', kind: 'folder' },
      { key: 'photos/sub/中文.txt', kind: 'file' },
    ];
    const expanded = await expandObjects(provider, connection, server.bucket, roots);
    expect(expanded).toHaveLength(2);
    const entries = downloadEntries(expanded, roots);
    expect(entries.find((entry: any) => entry.kind === 'file').relativePath).toBe(
      'photos/sub/中文.txt',
    );
    const output = path.join(dir, 'output');
    await fs.mkdir(output);
    await provider.download(connection, server.bucket, entries, output, () => {}, true);
    expect(await fs.readFile(path.join(output, 'photos/sub/中文.txt'), 'utf8')).toBe(
      'nested content',
    );
  });
  it('supports skip, atomic rename and explicit overwrite policies', async () => {
    const { provider, connection, server } = await fixture();
    const dir = await directory();
    const file = path.join(dir, 'hello.json');
    await fs.writeFile(file, 'replacement');
    expect(
      (await provider.upload(connection, server.bucket, '', [{ path: file }], () => {}, 'skip'))
        .skipped,
    ).toBe(1);
    expect(server.objects.get('hello.json').toString()).toContain('你好');
    expect(
      (await provider.upload(connection, server.bucket, '', [{ path: file }], () => {}, 'rename'))
        .completed,
    ).toBe(1);
    expect(server.objects.get('hello (1).json').toString()).toBe('replacement');
    await provider.upload(connection, server.bucket, '', [{ path: file }], () => {}, 'overwrite');
    expect(server.objects.get('hello.json').toString()).toBe('replacement');
  });
  it('copies the full snapshot before moving, and retries only unfinished work', async () => {
    const { provider, connection, server } = await fixture({
      failCopyKey: 'archive/folder/z.txt',
      pageSize: 1,
    });
    server.objects.set('folder/z.txt', Buffer.from('last'));
    const plan = await provider.prepareOperation(
      connection,
      server.bucket,
      [{ key: 'folder/', kind: 'folder' }],
      'move',
      'archive/',
    );
    const result = await provider.executeOperation(connection, plan, () => {});
    expect(result.status).toBe('failed');
    expect(server.objects.has('folder/nested.txt')).toBe(true);
    expect(server.objects.has('folder/z.txt')).toBe(true);
    expect(server.objects.has('archive/folder/nested.txt')).toBe(true);
    expect(server.requests.some((request: any) => request.method === 'DELETE')).toBe(false);
    server.controls.failCopyKey = undefined;
    expect((await taskManager.retry(result.id)).status).toBe('completed');
    expect(server.objects.has('folder/nested.txt')).toBe(false);
    expect(server.objects.get('archive/folder/z.txt').toString()).toBe('last');
    const copies = server.requests.filter((request: any) => request.headers['x-amz-copy-source']);
    expect(copies.every((request: any) => request.headers['if-none-match'] === '*')).toBe(true);
    expect(
      server.requests
        .filter((request: any) => request.method === 'DELETE')
        .every((request: any) => !!request.headers['if-match']),
    ).toBe(true);
  });
  it('never overwrites copy targets and rejects moving a folder into itself', async () => {
    const { provider, connection, server } = await fixture();
    await expect(
      provider.prepareOperation(
        connection,
        server.bucket,
        [{ key: 'folder/', kind: 'folder' }],
        'move',
        'folder/sub/',
      ),
    ).rejects.toThrow('子目录');
    server.objects.set('target/nested.txt', Buffer.from('keep'));
    const plan = await provider.prepareOperation(
      connection,
      server.bucket,
      [{ key: 'folder/nested.txt', kind: 'file' }],
      'move',
      'target/',
    );
    expect((await provider.executeOperation(connection, plan, () => {})).status).toBe('failed');
    expect(server.objects.get('target/nested.txt').toString()).toBe('keep');
    expect(server.objects.has('folder/nested.txt')).toBe(true);
  });
  it('deletes only confirmed snapshot keys and stops when source content changes', async () => {
    const { provider, connection, server } = await fixture();
    const plan = await provider.prepareOperation(
      connection,
      server.bucket,
      [{ key: 'folder/', kind: 'folder' }],
      'delete',
    );
    server.objects.set('folder/new.txt', Buffer.from('new after confirmation'));
    expect((await provider.executeOperation(connection, plan, () => {})).status).toBe('completed');
    expect(server.objects.has('folder/new.txt')).toBe(true);
    expect(server.objects.has('folder/nested.txt')).toBe(false);
    const changed = await provider.prepareOperation(
      connection,
      server.bucket,
      [{ key: 'hello.json', kind: 'file' }],
      'delete',
    );
    server.objects.set('hello.json', Buffer.from('changed'));
    expect((await provider.executeOperation(connection, changed, () => {})).status).toBe('failed');
    expect(server.objects.get('hello.json').toString()).toBe('changed');
  });
  it('cancels multipart uploads, cleans unfinished parts and retries the same task', async () => {
    const { provider, connection, server } = await fixture();
    const dir = await directory();
    const file = path.join(dir, 'cancelled.bin');
    await fs.writeFile(file, Buffer.alloc(9 * 1024 ** 2));
    let cancelled = false;
    let taskId = '';
    const summary = await provider.upload(
      connection,
      server.bucket,
      '',
      [{ path: file }],
      (task: any) => {
        taskId = task.id;
        if (!cancelled && task.status === 'running' && task.progress > 0) {
          cancelled = true;
          taskManager.cancel(task.id);
        }
      },
    );
    expect(summary.cancelled).toBe(1);
    expect(server.uploads.size).toBe(0);
    expect(server.objects.has('cancelled.bin')).toBe(false);
    expect((await taskManager.retry(taskId)).status).toBe('completed');
    expect(server.objects.get('cancelled.bin').length).toBe(9 * 1024 ** 2);
  });
  it('blocks junction traversal before creating local download directories', async () => {
    const { provider, connection, server } = await fixture();
    const dir = await directory();
    const output = path.join(dir, 'output'),
      outside = path.join(dir, 'outside');
    await fs.mkdir(output);
    await fs.mkdir(outside);
    await fs.symlink(
      outside,
      path.join(output, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const events: any[] = [];
    await provider.download(
      connection,
      server.bucket,
      [{ key: 'hello.json', size: 10, relativePath: 'escape/new/hello.json' }],
      output,
      (task: any) => events.push(task),
      true,
    );
    expect(events.at(-1).status).toBe('failed');
    await expect(fs.stat(path.join(outside, 'new'))).rejects.toThrow();
  });
  it('uses conditional multipart copy above the single-request S3 limit', async () => {
    const calls: any[] = [];
    const provider = new S3Provider(() => ({
      send: async (command: any) => {
        calls.push(command);
        if (command.constructor.name === 'CreateMultipartUploadCommand')
          return { UploadId: 'copy-upload' };
        if (command.constructor.name === 'UploadPartCopyCommand')
          return { CopyPartResult: { ETag: 'part-etag' } };
        return {};
      },
    }));
    const size = 5 * 1024 ** 3 + 1;
    await provider.client({ provider: 's3' }, 'bucket').copy('target.bin', '源文件.bin', 'bucket', {
      size,
      headers: { 'x-oss-copy-source-if-match': 'source-etag' },
    });
    expect(
      calls.filter((command) => command.constructor.name === 'UploadPartCopyCommand'),
    ).toHaveLength(41);
    expect(calls.at(-1).input.IfNoneMatch).toBe('*');
    expect(calls[1].input.CopySourceIfMatch).toBe('source-etag');
  });
});
async function fixture(options = {}) {
  const server = await createS3Fixture(options);
  cleanup.push(() => server.close());
  const connection = validateConnection({
    name: 'S3 test',
    provider: 's3',
    endpoint: server.endpoint,
    region: 'us-east-1',
    accessKeyId: 'fixture-key',
    accessKeySecret: 'fixture-secret',
    stsToken: 'fixture-token',
    allowInsecure: true,
    forcePathStyle: true,
    remember: false,
  });
  return { server, connection, provider: new S3Provider() };
}
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stordock-s3-'));
  cleanup.push(async () => {
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('stordock-s3-')
    )
      throw new Error('Invalid cleanup path');
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}
describe('S3 connection boundaries', () => {
  const input = {
    provider: 's3',
    name: 'Custom',
    endpoint: 'https://storage.example.com:9443/proxy/s3',
    accessKeyId: 'id',
    accessKeySecret: 'secret',
    bucket: 'media.bucket',
  };
  it('requires an endpoint, defaults signing region, and keeps S3 options without exposing tokens', () => {
    const c = validateConnection({ ...input, stsToken: 'private-token' });
    expect(c).toMatchObject({
      provider: 's3',
      region: 'us-east-1',
      forcePathStyle: true,
      allowInsecure: false,
    });
    expect(publicConnection(c)).not.toHaveProperty('stsToken');
    expect(() => validateConnection({ ...input, endpoint: '' })).toThrow('endpoint');
    expect(() => validateConnection({ ...input, provider: 'unknown' })).toThrow('类型');
  });
  it('allows HTTP only with explicit S3 opt-in and still rejects embedded credentials', () => {
    expect(() => validateConnection({ ...input, endpoint: 'http://localhost:9000' })).toThrow(
      '显式启用',
    );
    expect(
      validateConnection({ ...input, endpoint: 'http://localhost:9000', allowInsecure: true })
        .allowInsecure,
    ).toBe(true);
    expect(() =>
      validateConnection({
        ...input,
        provider: 'aliyun',
        region: 'cn-hangzhou',
        endpoint: 'http://localhost',
        allowInsecure: true,
      }),
    ).toThrow('HTTPS');
    expect(() => validateConnection({ ...input, endpoint: 'https://user:secret@host' })).toThrow(
      '账号',
    );
  });
  it('supports dotted S3 buckets while preserving OSS naming rules', () => {
    expect(validateBucket('media.bucket', 's3')).toBe('media.bucket');
    for (const invalid of ['a..b', 'a.-b', '127.0.0.1', '../escape', 'ABCD'])
      expect(() => validateBucket(invalid, 's3')).toThrow();
    expect(() => validateBucket('media.bucket', 'aliyun')).toThrow();
    expect(providerFor({ provider: 's3' })).toBeInstanceOf(S3Provider);
    expect(() => providerFor({ provider: 'unsupported' })).toThrow();
  });
  it('passes the chosen virtual-host mode, region and session credentials to the SDK', async () => {
    const c = validateConnection({
      ...input,
      region: 'auto',
      forcePathStyle: false,
      stsToken: 'session',
    });
    const sdk = createS3Client(c);
    expect(sdk.config.forcePathStyle).toBe(false);
    expect(await sdk.config.region()).toBe('auto');
    expect(await sdk.config.credentials()).toMatchObject({
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      sessionToken: 'session',
    });
  });
});
describe('S3 protocol through the actual AWS SDK and a local HTTP endpoint', () => {
  it('returns safe object metadata and generates the same unsigned address as the SDK', async () => {
    const { connection, provider, server } = await fixture({ basePath: '/proxy/s3' });
    const info = await provider.objectInfo(connection, server.bucket, 'hello.json');
    expect(info).toMatchObject({
      size: server.objects.get('hello.json').length,
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=3600',
      contentDisposition: 'inline',
      metadata: { project: 'fixture-project' },
    });
    expect(JSON.stringify(info)).not.toContain('fixture-token');
    const key = '目录/a b+#?%.txt';
    const signed = await provider.signedUrl(connection, server.bucket, key, 900);
    expect(objectAddress(connection, server.bucket, key).httpUrl).toBe(signed.split('?')[0]);
    const virtual = {
      ...connection,
      endpoint: 'https://storage.example.com:9443/proxy',
      forcePathStyle: false,
    };
    expect(objectAddress(virtual, server.bucket, key).httpUrl).toBe(
      (await provider.signedUrl(virtual, server.bucket, key, 900)).split('?')[0],
    );
  });
  it('generates signed GET links with the configured endpoint, token and expiration', async () => {
    const { connection, provider, server } = await fixture({ basePath: '/proxy/s3' });
    const url = new URL(
      await provider.signedUrl(connection, server.bucket, '目录/中文 file.txt', 900),
    );
    expect(url.pathname).toBe(
      '/proxy/s3/media.bucket/%E7%9B%AE%E5%BD%95/%E4%B8%AD%E6%96%87%20file.txt',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('fixture-token');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.toString()).not.toContain('fixture-secret');
  });
  it('pauses multipart uploads and continues with the same upload ID without resending completed parts', async () => {
    const { server, connection, provider } = await fixture();
    const dir = await directory();
    const file = path.join(dir, 'resume.bin');
    await fs.writeFile(file, Buffer.alloc(17 * 1024 ** 2, 71));
    let id = '',
      paused = false;
    await provider.upload(connection, server.bucket, '', [{ path: file }], (task: any) => {
      id = task.id;
      if (!paused && task.progress > 0 && task.status === 'running') {
        paused = true;
        taskManager.pause(id);
      }
    });
    const task = taskManager.records.get(id);
    expect(task.metadata.status).toBe('paused');
    expect(server.uploads.size).toBe(1);
    const checkpoint = task.descriptor.state.checkpoint;
    const done = checkpoint.doneParts.map((part: any) => part.PartNumber);
    expect(done.length).toBeGreaterThan(0);
    const before = server.requests.length;
    expect((await taskManager.retry(id)).status).toBe('completed');
    expect(
      server.requests.filter((request: any) => request.query.uploads !== undefined),
    ).toHaveLength(1);
    expect(
      server.requests
        .slice(before)
        .filter((request: any) => request.query.partNumber)
        .every((request: any) => !done.includes(Number(request.query.partNumber))),
    ).toBe(true);
    expect(server.objects.get('resume.bin').equals(Buffer.alloc(17 * 1024 ** 2, 71))).toBe(true);
    expect(server.uploads.size).toBe(0);
  });
  it('lists buckets, signed requests, folders and paginated recursive search', async () => {
    const { server, connection, provider } = await fixture({ pageSize: 1 });
    expect((await provider.buckets(connection))[0].name).toBe('media.bucket');
    const first = await provider.list(connection, { bucket: server.bucket, prefix: '' });
    expect(first.objects[0].kind).toBe('folder');
    expect(first.cursor).toBeTruthy();
    const search = await provider.list(connection, {
      bucket: server.bucket,
      prefix: '',
      query: 'HELLO',
    });
    expect(search.objects).toEqual([]);
    expect(search.cursor).toBeTruthy();
    const next = await provider.list(connection, {
      bucket: server.bucket,
      prefix: '',
      query: 'HELLO',
      cursor: search.cursor,
    });
    expect(next.objects[0]).toMatchObject({ key: 'hello.json', storageClass: 'Standard' });
    const request = server.requests.find((r: any) => r.query['list-type'] === '2');
    expect(request.path).toBe('/media.bucket/');
    expect(request.headers.authorization).toMatch(
      /AWS4-HMAC-SHA256 Credential=fixture-key\/\d{8}\/us-east-1\/s3\/aws4_request/,
    );
    expect(request.headers['x-amz-security-token']).toBe('fixture-token');
  });
  it('tests a pinned bucket without requiring list-buckets permission and previews ranged UTF-8 text', async () => {
    const { server, connection, provider } = await fixture();
    const pinned = { ...connection, bucket: server.bucket };
    expect(await provider.buckets(pinned)).toHaveLength(1);
    expect(server.requests.every((r: any) => r.path.startsWith('/media.bucket'))).toBe(true);
    const preview = await provider.preview(connection, server.bucket, { key: 'hello.json' });
    expect(preview).toMatchObject({ kind: 'text', content: '{"storage":"s3","message":"你好"}' });
    expect(
      server.requests.find((r: any) => r.method === 'GET' && r.path.endsWith('/hello.json')).headers
        .range,
    ).toBe('bytes=0-1048576');
  });
  it('creates folders, uploads, refuses overwrites and streams exact download bytes', async () => {
    const { server, connection, provider } = await fixture();
    const dir = await directory();
    await provider.createFolder(connection, server.bucket, '', 'new-folder');
    expect(server.objects.has('new-folder/')).toBe(true);
    const file = path.join(dir, 'payload.txt');
    const payload = Buffer.from('S3 上传下载\nexact bytes');
    await fs.writeFile(file, payload);
    const events: any[] = [];
    await provider.upload(connection, server.bucket, 'new-folder/', [{ path: file }], (t: any) =>
      events.push(t),
    );
    expect(events.at(-1).status).toBe('completed');
    await provider.upload(connection, server.bucket, 'new-folder/', [{ path: file }], (t: any) =>
      events.push(t),
    );
    expect(events.at(-1)).toMatchObject({
      status: 'failed',
      error: '同名文件已存在，本次上传未覆盖',
    });
    const target = path.join(dir, 'download.txt');
    await provider.download(
      connection,
      server.bucket,
      [{ key: 'new-folder/payload.txt', size: 1 }],
      target,
      (t: any) => events.push(t),
    );
    expect(await fs.readFile(target)).toEqual(payload);
    expect(events.at(-1).size).toBe(payload.length);
    const upload = server.requests.find(
      (r: any) => r.method === 'PUT' && r.path.endsWith('payload.txt'),
    );
    expect(upload.headers['if-none-match']).toBe('*');
    expect(upload.headers['content-encoding']).toBeUndefined();
  });
  it('uploads multiple valid S3 parts, completes in order, and reports progress', async () => {
    const { server, connection, provider } = await fixture();
    const dir = await directory();
    const body = Buffer.alloc(9 * 1024 * 1024, 73);
    const file = path.join(dir, 'large.bin');
    await fs.writeFile(file, body);
    const events: any[] = [];
    await provider.upload(connection, server.bucket, '', [{ path: file }], (t: any) =>
      events.push(t),
    );
    expect(events.at(-1)).toMatchObject({ status: 'completed', progress: 100 });
    expect(server.objects.get('large.bin').equals(body)).toBe(true);
    expect(server.uploads.size).toBe(0);
    const parts = server.requests.filter((r: any) => r.query.partNumber);
    expect(parts.map((r: any) => r.bytes).sort((a: number, b: number) => b - a)).toEqual([
      8 * 1024 * 1024,
      1024 * 1024,
    ]);
    expect(events.some((t) => t.progress > 0 && t.progress < 100)).toBe(true);
    expect(
      server.requests.find((r: any) => r.method === 'POST' && r.query.uploadId).headers[
        'if-none-match'
      ],
    ).toBe('*');
  });
  it('aborts unfinished parts after a failed part', async () => {
    const { server, connection, provider } = await fixture({ failPart: 2 });
    const dir = await directory();
    const file = path.join(dir, 'broken.bin');
    await fs.writeFile(file, Buffer.alloc(9 * 1024 * 1024));
    const events: any[] = [];
    await provider.upload(connection, server.bucket, '', [{ path: file }], (t: any) =>
      events.push(t),
    );
    expect(events.at(-1).status).toBe('failed');
    expect(server.uploads.size).toBe(0);
    expect(server.objects.has('broken.bin')).toBe(false);
    expect(server.requests.some((r: any) => r.method === 'DELETE' && r.query.uploadId)).toBe(true);
  });
  it('aborts after a completion conflict and preserves the existing object', async () => {
    const { server, connection, provider } = await fixture();
    const dir = await directory();
    const file = path.join(dir, 'existing.bin');
    server.objects.set('existing.bin', Buffer.from('original'));
    await fs.writeFile(file, Buffer.alloc(2 * 1024 * 1024));
    const events: any[] = [];
    await provider.upload(connection, server.bucket, '', [{ path: file }], (t: any) =>
      events.push(t),
    );
    expect(events.at(-1)).toMatchObject({
      status: 'failed',
      error: '同名文件已存在，本次上传未覆盖',
    });
    expect(server.objects.get('existing.bin').toString()).toBe('original');
    expect(server.uploads.size).toBe(0);
  });
  it('preserves reverse-proxy base paths and Unicode object keys', async () => {
    const { server, connection, provider } = await fixture({ basePath: '/gateway/storage' });
    const dir = await directory();
    const name = '中文 report #1.txt';
    const file = path.join(dir, name);
    await fs.writeFile(file, 'Unicode S3 key');
    const events: any[] = [];
    await provider.upload(connection, server.bucket, '', [{ path: file }], (t: any) =>
      events.push(t),
    );
    expect(events.at(-1).status).toBe('completed');
    expect(server.objects.has(name)).toBe(true);
    expect(server.requests[0].path).toContain('/gateway/storage/media.bucket/');
    expect((await provider.preview(connection, server.bucket, { key: name })).content).toBe(
      'Unicode S3 key',
    );
  });
  it('previews S3 keys at the protocol limit of 1024 UTF-8 bytes', async () => {
    const { server, connection, provider } = await fixture();
    const key = 'a'.repeat(1020) + '.txt';
    server.objects.set(key, Buffer.from('long key'));
    expect((await provider.preview(connection, server.bucket, { key })).content).toBe('long key');
    await expect(provider.preview(connection, server.bucket, { key: 'a' + key })).rejects.toThrow(
      '路径无效',
    );
  });
  it('redacts unknown SDK errors and explains S3 credential errors', () => {
    expect(friendlyError({ name: 'ExpiredToken', $metadata: { httpStatusCode: 403 } })).toContain(
      '临时凭据',
    );
    expect(
      friendlyError({
        name: 'Unknown',
        $metadata: { httpStatusCode: 500 },
        message: 'https://host?Signature=private',
      }),
    ).not.toContain('private');
  });
});
