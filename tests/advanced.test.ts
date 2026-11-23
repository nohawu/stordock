import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const advanced = require('../electron/advanced.cjs');
const archives = require('../electron/archives.cjs');
const { executeMigration } = require('../electron/migration.cjs');
const { prepareSync, executeSync, excludes } = require('../electron/sync.cjs');
const { S3Provider } = require('../electron/s3.cjs');
const { validateConnection } = require('../electron/connection.cjs');
const { prepareOperation } = require('../electron/operations.cjs');
const { createS3Fixture } = require('./s3-fixture.cjs');
const { taskManager } = require('../electron/tasks.cjs');
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await taskManager.clear();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(options = {}) {
  const server = await createS3Fixture(options);
  cleanup.push(() => server.close());
  const connection = validateConnection({
    name: 'S3',
    provider: 's3',
    endpoint: server.endpoint,
    bucket: server.bucket,
    accessKeyId: 'fixture-key',
    accessKeySecret: 'fixture-secret',
    region: 'us-east-1',
    forcePathStyle: true,
    allowInsecure: true,
  });
  return { server, connection, provider: new S3Provider() };
}
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stordock-advanced-'));
  cleanup.push(async () => {
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('stordock-advanced-')
    )
      throw new Error('Invalid cleanup');
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}
describe('advanced S3 object management', () => {
  it('updates metadata conditionally, preserves content and refuses stale ETags', async () => {
    const { server, connection, provider } = await fixture();
    const original = Buffer.from(server.objects.get('hello.json'));
    const info = await provider.objectInfo(connection, server.bucket, 'hello.json');
    await advanced.editProperties(provider, connection, server.bucket, 'hello.json', {
      ...info,
      contentType: 'application/json',
      cacheControl: 'max-age=60',
      metadata: { project: 'updated' },
      storageClass: 'STANDARD_IA',
    });
    const next = await provider.objectInfo(connection, server.bucket, 'hello.json');
    expect(next).toMatchObject({
      contentType: 'application/json',
      cacheControl: 'max-age=60',
      storageClass: 'STANDARD_IA',
      metadata: { project: 'updated' },
    });
    expect(server.objects.get('hello.json').equals(original)).toBe(true);
    await expect(
      advanced.editProperties(provider, connection, server.bucket, 'hello.json', {
        ...info,
        etag: 'stale',
      }),
    ).rejects.toThrow('已变化');
    expect(() =>
      advanced.validatePatch({ etag: 'x', metadata: {}, cacheControl: 'a\r\ninjected: b' }),
    ).toThrow();
  });
  it('reads, replaces and clears tags independently', async () => {
    const { server, connection, provider } = await fixture();
    await advanced.tags(provider, connection, server.bucket, 'hello.json', {
      project: 'test',
      env: 'dev',
    });
    expect(await advanced.tags(provider, connection, server.bucket, 'hello.json')).toEqual({
      project: 'test',
      env: 'dev',
    });
    await advanced.tags(provider, connection, server.bucket, 'hello.json', {});
    expect(await advanced.tags(provider, connection, server.bucket, 'hello.json')).toEqual({});
  });
  it('lists exact-key historical versions and restores content as a new current version', async () => {
    const { server, connection, provider } = await fixture({ versioning: true });
    const before = await advanced.versions(provider, connection, server.bucket, 'hello.json');
    expect(before.versions).toHaveLength(1);
    const id = before.versions[0].versionId,
      original = Buffer.from(server.objects.get('hello.json'));
    const dir = await directory(),
      file = path.join(dir, 'hello.json');
    await fs.writeFile(file, 'new version');
    await provider.upload(connection, server.bucket, '', [{ path: file }], () => {}, 'overwrite');
    await advanced.restoreVersion(provider, connection, server.bucket, 'hello.json', id);
    expect(server.objects.get('hello.json').equals(original)).toBe(true);
    expect(
      (await advanced.versions(provider, connection, server.bucket, 'hello.json')).versions,
    ).toHaveLength(3);
    await advanced.restoreArchive(provider, connection, server.bucket, 'hello.json', 3, 'Standard');
    expect((await provider.objectInfo(connection, server.bucket, 'hello.json')).restore).toContain(
      'ongoing-request',
    );
  });
});
describe('migration and sync', () => {
  it('rejects a sync root that changes after preview', async () => {
    const { server, connection, provider } = await fixture();
    const root = await directory();
    const plan = await prepareSync(provider, connection, server.bucket, '', root, 'download', '');
    await fs.rmdir(root);
    await fs.writeFile(root, 'not a directory anymore');
    await expect(executeSync(provider, connection, plan, () => {})).rejects.toThrow('根目录已变化');
  });
  it('copies all sources before deleting and retries only unfinished migration work', async () => {
    const source = await fixture(),
      target = await fixture();
    const original = Buffer.from(source.server.objects.get('hello.json'));
    const plan = await prepareOperation(
      source.provider,
      source.connection,
      source.server.bucket,
      [
        { key: 'hello.json', kind: 'file' },
        { key: 'folder/nested.txt', kind: 'file' },
      ],
      'move',
      'incoming/',
      { differentTarget: true },
    );
    plan.destination = { connectionId: target.connection.id, bucket: target.server.bucket };
    target.server.controls.failPutKey = 'incoming/nested.txt';
    const result = await executeMigration(
      source.provider,
      source.connection,
      target.provider,
      target.connection,
      plan,
      () => {},
    );
    expect(result.status).toBe('failed');
    expect(source.server.objects.get('hello.json').equals(original)).toBe(true);
    expect(source.server.objects.has('folder/nested.txt')).toBe(true);
    expect(target.server.objects.get('incoming/hello.json').equals(original)).toBe(true);
    target.server.controls.failPutKey = undefined;
    expect((await taskManager.retry(result.id)).status).toBe('completed');
    expect(source.server.objects.has('hello.json')).toBe(false);
    expect(
      target.server.requests.filter(
        (item: any) => item.method === 'PUT' && item.path.endsWith('/incoming/hello.json'),
      ),
    ).toHaveLength(1);
  });
  it('compares local/remote trees, excludes patterns, requires unchanged snapshots and never deletes', async () => {
    const { server, connection, provider } = await fixture();
    const root = await directory();
    await fs.writeFile(path.join(root, 'hello.json'), 'updated');
    await fs.writeFile(path.join(root, 'new.txt'), 'new');
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules/ignored.txt'), 'ignored');
    const plan = await prepareSync(
      provider,
      connection,
      server.bucket,
      '',
      root,
      'upload',
      'node_modules/**',
    );
    expect(plan.items.map((item: any) => item.relative).sort()).toEqual(['hello.json', 'new.txt']);
    const result = await executeSync(provider, connection, plan, () => {});
    expect(result).toMatchObject({ completed: 2, failed: 0 });
    expect(server.objects.has('folder/nested.txt')).toBe(true);
    expect(server.objects.get('hello.json').toString()).toBe('updated');
    const changed = await prepareSync(provider, connection, server.bucket, '', root, 'upload', '');
    await fs.writeFile(path.join(root, 'new.txt'), 'changed after preview');
    // Force this row to be considered an update for the snapshot guard.
    changed.items.find((item: any) => item.relative === 'new.txt').action = 'update';
    await expect(executeSync(provider, connection, changed, () => {})).rejects.toThrow(
      '本地文件已变化',
    );
    expect(excludes('*.tmp')[0].test('dir/file.tmp')).toBe(true);
    expect(excludes('**/*.tmp')[0].test('file.tmp')).toBe(true);
    expect(excludes('**/*.tmp')[0].test('dir/sub/file.tmp')).toBe(true);
  });
});
describe('portable connection backups', () => {
  it('exports no plaintext secrets and validates encrypted backups without trusting connection IDs', () => {
    const row = {
      id: 'existing',
      name: 'OSS',
      provider: 'aliyun',
      region: 'cn-hangzhou',
      endpoint: '',
      bucket: 'my-bucket',
      accessKeyId: 'id',
      accessKeySecret: 'private-secret',
      stsToken: 'private-token',
      credentialRefreshToken: 'private-refresh',
      remember: true,
    };
    expect(JSON.stringify(archives.configuration(row))).not.toContain('private-');
    const encrypted = archives.encrypt([row], 'long-enough-password');
    expect(JSON.stringify(encrypted)).not.toContain('private-');
    const result = archives.inspect(encrypted, 'long-enough-password');
    expect(result.connections[0].accessKeySecret).toBe('private-secret');
    expect(result.connections[0].id).not.toBe('existing');
    expect(JSON.stringify(result.preview)).not.toContain('private-');
    expect(() => archives.inspect(encrypted, 'wrong-password')).toThrow('密码错误');
  });
});
