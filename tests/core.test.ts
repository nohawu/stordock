import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { folderNameError, sortObjects } from '../src/lib/objects';
const require = createRequire(import.meta.url);
const {
  validateConnection,
  publicConnection,
  validateFolder,
  safeFilename,
  mapListing,
} = require('../electron/core.cjs');
const { ConnectionVault } = require('../electron/vault.cjs');
const { AliyunProvider, friendlyError } = require('../electron/oss.cjs');
const { taskManager } = require('../electron/tasks.cjs');
const input = {
  name: 'Test',
  region: 'oss-cn-hangzhou',
  accessKeyId: 'test-id',
  accessKeySecret: 'test-secret',
  bucket: 'my-bucket',
  remember: true,
};
const temporary: string[] = [];
async function tempDir() {
  const p = await fs.mkdtemp(path.join(os.tmpdir(), 'ossdesk-test-'));
  temporary.push(p);
  return p;
}
afterEach(async () => {
  await taskManager.clear();
  for (const p of temporary.splice(0)) {
    if (
      path.dirname(p) !== path.resolve(os.tmpdir()) ||
      !path.basename(p).startsWith('ossdesk-test-')
    )
      throw new Error('Invalid test cleanup path');
    await fs.rm(p, { recursive: true, force: true });
  }
});

describe('transfer safety and connection edits', () => {
  it('refuses conditional writes when OSS versioning makes no-overwrite ineffective', async () => {
    let writes = 0;
    const provider = new AliyunProvider(() => ({
      getBucketVersioning: async () => ({ versionStatus: 'Enabled' }),
      put: async () => {
        writes++;
      },
    }));
    await expect(
      provider.createFolder({ provider: 'aliyun' }, 'bucket', '', 'folder'),
    ).rejects.toThrow('版本控制');
    await expect(
      provider.upload({ provider: 'aliyun' }, 'bucket', '', [], () => {}),
    ).rejects.toThrow('版本控制');
    expect(writes).toBe(0);
  });
  it('never replays a task against a changed connection target', async () => {
    const provider = new AliyunProvider(() => ({}));
    const connection = {
      id: 'edited',
      provider: 's3',
      endpoint: 'https://original.example',
      bucket: 'bucket',
    };
    provider.resolveConnection = async () => ({
      ...connection,
      endpoint: 'https://changed.example',
    });
    await expect(provider.refreshConnection(connection, 'bucket')).rejects.toThrow(
      '连接目标已更改',
    );
  });
  it('cancels a streaming download, removes its partial file and retries successfully', async () => {
    const dir = await tempDir();
    const destination = path.join(dir, 'download.txt');
    const provider = new AliyunProvider(() => ({
      getStream: async () => ({
        stream: Readable.from([Buffer.from('retry stream')]),
        res: { headers: { 'content-length': '12' } },
      }),
    }));
    let cancel = true,
      id = '';
    await provider.download(
      { id: 'test', provider: 'aliyun' },
      'bucket',
      [{ key: 'file.txt', size: 12 }],
      destination,
      (task: any) => {
        id = task.id;
        if (cancel && task.progress > 0 && task.status === 'running') {
          cancel = false;
          taskManager.cancel(id);
        }
      },
    );
    expect(taskManager.records.get(id).metadata.status).toBe('cancelled');
    expect(await fs.readdir(dir)).toEqual([]);
    expect((await taskManager.retry(id)).status).toBe('completed');
    expect(await fs.readFile(destination, 'utf8')).toBe('retry stream');
  });
});
describe('connection and path boundaries', () => {
  it('normalizes region and excludes secret credentials from renderer metadata', () => {
    const c = validateConnection(input);
    expect(c.region).toBe('cn-hangzhou');
    expect(publicConnection({ ...c, stsToken: 'sensitive-token' })).not.toHaveProperty(
      'accessKeySecret',
    );
    expect(publicConnection(c)).not.toHaveProperty('stsToken');
  });
  it('rejects malformed connections and non-HTTPS endpoints', () => {
    expect(() => validateConnection({ ...input, accessKeySecret: '' })).toThrow();
    for (const endpoint of [
      'http://localhost',
      'https://user:pass@host',
      'https://host/path',
      'https://host?secret=key',
    ])
      expect(() => validateConnection({ ...input, endpoint })).toThrow();
    expect(
      validateConnection({ ...input, endpoint: 'https://oss-cn-hangzhou.aliyuncs.com' }).endpoint,
    ).toContain('https:');
  });
  it('validates folder names consistently on both sides of IPC', () => {
    for (const name of ['', '..', '.', 'a/b', 'a\\b', 'x\0y', '字'.repeat(100)]) {
      expect(folderNameError(name)).toBeTruthy();
      expect(() => validateFolder(name)).toThrow();
    }
    expect(validateFolder('设计资源')).toBe('设计资源');
  });
  it('keeps remote keys from becoming local paths or reserved Windows names', () => {
    expect(safeFilename('../../secrets.txt')).toBe('secrets.txt');
    expect(safeFilename('a/x:y?.txt')).toBe('x_y_.txt');
    expect(safeFilename('CON.txt')).toMatch(/^object-/);
  });
});
describe('paginated OSS listings', () => {
  it('maps folders, skips directory markers and preserves opaque continuation tokens', () => {
    const result = mapListing(
      {
        prefixes: ['assets/images/'],
        objects: [
          { name: 'assets/' },
          {
            name: 'assets/a.json',
            size: '12',
            lastModified: '2026-01-01',
            storageClass: 'Standard',
          },
        ],
        isTruncated: true,
        nextContinuationToken: 'opaque+/=',
      },
      'assets/',
    );
    expect(result.objects.map((o: any) => o.name)).toEqual(['images', 'a.json']);
    expect(result.cursor).toBe('opaque+/=');
  });
  it('searches nested names case-insensitively while keeping the cursor on empty pages', () => {
    const result = mapListing(
      {
        objects: [{ name: 'base/sub/LOGO.svg', size: 10 }],
        isTruncated: true,
        nextContinuationToken: 'next',
      },
      'base/',
      'logo',
    );
    expect(result.objects[0].name).toBe('sub/LOGO.svg');
    expect(
      mapListing({ objects: [], isTruncated: true, nextContinuationToken: 'next' }, '', 'missing')
        .cursor,
    ).toBe('next');
  });
  it('keeps folders first even with descending sort', () => {
    const objects = [
      { kind: 'file', name: 'b', size: 1 },
      { kind: 'folder', name: 'z', size: 0 },
      { kind: 'file', name: 'a', size: 2 },
    ];
    expect(sortObjects(objects as any, 'name', false).map((o) => o.name)).toEqual(['z', 'b', 'a']);
  });
});
describe('credential vault', () => {
  const encryption = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text: string) => Buffer.from(text).reverse(),
    decryptStringAsync: async (bytes: Buffer) => ({
      result: Buffer.from(bytes).reverse().toString(),
      shouldReEncrypt: false,
    }),
    getSelectedStorageBackend: () => 'test',
  };
  it('persists encrypted credentials and reconstructs them without exposing secrets in lists', async () => {
    const dir = await tempDir();
    const vault = new ConnectionVault(dir, encryption);
    const metadata = await vault.save(validateConnection(input));
    const raw = await fs.readFile(path.join(dir, 'connections.json'), 'utf8');
    expect(raw).not.toContain('test-secret');
    expect((await vault.list())[0]).not.toHaveProperty('accessKeySecret');
    const reloaded = new ConnectionVault(dir, encryption);
    expect((await reloaded.get(metadata.id)).accessKeySecret).toBe('test-secret');
    await reloaded.remove(metadata.id);
    expect(await reloaded.list()).toEqual([]);
  });
  it('refuses plaintext fallback while allowing session-only credentials', async () => {
    const dir = await tempDir();
    const vault = new ConnectionVault(dir, {
      ...encryption,
      isAsyncEncryptionAvailable: async () => false,
    });
    await expect(vault.save(validateConnection(input))).rejects.toThrow('安全存储不可用');
    const metadata = await vault.save(validateConnection({ ...input, remember: false }));
    expect(metadata.temporary).toBe(true);
    expect(await fs.readFile(path.join(dir, 'connections.json'), 'utf8')).toBe('[]');
    expect((await vault.get(metadata.id)).accessKeySecret).toBe('test-secret');
    expect(await new ConnectionVault(dir, encryption).list()).toEqual([]);
  });
});
describe('provider preview and transfer behavior', () => {
  it('exposes common OSS headers and user metadata without exposing request credentials', async () => {
    const provider = new AliyunProvider(() => ({
      head: async () => ({
        res: {
          headers: {
            'content-length': '123',
            'Content-Type': 'application/json',
            'cache-control': 'max-age=60',
            etag: 'tag',
            'x-oss-version-id': 'version-1',
            'x-oss-storage-class': 'IA',
            'x-oss-meta-project': 'example',
            authorization: 'private-authorization',
            'x-oss-security-token': 'private-token',
          },
        },
      }),
    }));
    const result = await provider.objectInfo(input, 'my-bucket', 'file.json');
    expect(result).toMatchObject({
      size: 123,
      contentType: 'application/json',
      cacheControl: 'max-age=60',
      etag: 'tag',
      versionId: 'version-1',
      storageClass: 'IA',
      metadata: { project: 'example' },
    });
    expect(JSON.stringify(result)).not.toContain('private-');
  });
  it.each([false, true])(
    'resumes downloads with ETag and byte range checks (remote changed: %s)',
    async (changed) => {
      const dir = await tempDir();
      const destination = path.join(dir, 'resume.txt');
      const ranges: string[] = [];
      const provider = new AliyunProvider(() => ({
        head: async () => ({
          res: { headers: { 'content-length': '10', etag: changed ? 'v2' : 'v1' } },
        }),
        getStream: async (_key: string, options: any) => {
          if (options.headers.Range) {
            ranges.push(options.headers.Range);
            expect(options.headers['If-Match']).toBe('v1');
            return {
              stream: Readable.from([Buffer.from('efghij')]),
              res: {
                headers: { 'content-length': '6', 'content-range': 'bytes 4-9/10', etag: 'v1' },
              },
            };
          }
          return {
            stream: Readable.from(
              (async function* () {
                yield Buffer.from('abcd');
                await new Promise((resolve) => setTimeout(resolve, 100));
                yield Buffer.from('efghij');
              })(),
            ),
            res: { headers: { 'content-length': '10', etag: 'v1' } },
          };
        },
      }));
      let id = '',
        pausing = false;
      await provider.download(
        { id: 'test' },
        'bucket',
        [{ key: 'file.txt', size: 10 }],
        destination,
        (task: any) => {
          id = task.id;
          if (!pausing && task.progress > 0 && task.status === 'running') {
            pausing = true;
            setTimeout(() => taskManager.pause(id), 15);
          }
        },
      );
      expect(taskManager.records.get(id).metadata.status).toBe('paused');
      const result = await taskManager.retry(id);
      if (changed) {
        expect(result.status).toBe('failed');
        expect(result.error).toContain('远端文件已发生变化');
        expect(await fs.readdir(dir)).toEqual([]);
      } else {
        expect(result).toMatchObject({ status: 'completed', localPath: destination });
        expect(ranges).toEqual(['bytes=4-9']);
        expect(await fs.readFile(destination, 'utf8')).toBe('abcdefghij');
      }
    },
  );
  it('uses actual HEAD size to refuse oversized previews and handles empty text', async () => {
    let reads = 0;
    const provider = new AliyunProvider(() => ({
      head: async () => ({ res: { headers: { 'content-length': 20_000_000 } } }),
      getStream: async () => {
        reads++;
      },
    }));
    expect((await provider.preview(input, 'my-bucket', { key: 'large.png', size: 1 })).kind).toBe(
      'unsupported',
    );
    expect(reads).toBe(0);
    const empty = new AliyunProvider(() => ({
      head: async () => ({ res: { headers: { 'content-length': 0 } } }),
    }));
    expect(await empty.preview(input, 'my-bucket', { key: 'empty.txt' })).toMatchObject({
      kind: 'text',
      content: '',
    });
  });
  it('bounds streamed preview bytes even when the remote object changes after HEAD', async () => {
    const provider = new AliyunProvider(() => ({
      head: async () => ({ res: { headers: { 'content-length': 3 } } }),
      getStream: async () => ({ stream: Readable.from([Buffer.alloc(2 * 1024 * 1024)]) }),
    }));
    await expect(provider.preview(input, 'my-bucket', { key: 'changed.txt' })).rejects.toThrow(
      '预览大小限制',
    );
  });
  it('streams downloads and preserves existing same-name files in batch downloads', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'test.txt'), 'existing');
    const provider = new AliyunProvider(() => ({
      getStream: async () => ({
        stream: Readable.from([Buffer.from('hello')]),
        res: { headers: { 'content-length': 5 } },
      }),
    }));
    const events: any[] = [];
    await provider.download(
      input,
      'my-bucket',
      [{ key: 'nested/test.txt', size: 5 }],
      dir,
      (t: any) => events.push(t),
      true,
    );
    expect(await fs.readFile(path.join(dir, 'test.txt'), 'utf8')).toBe('existing');
    expect(await fs.readFile(path.join(dir, 'test (1).txt'), 'utf8')).toBe('hello');
    expect(events.at(-1)).toMatchObject({ status: 'completed', progress: 100 });
  });
  it('removes partial downloads after stream failure', async () => {
    const dir = await tempDir();
    const provider = new AliyunProvider(() => ({
      getStream: async () => ({
        stream: new Readable({
          read() {
            this.destroy(new Error('stream failure'));
          },
        }),
        res: { headers: { 'content-length': 5 } },
      }),
    }));
    const events: any[] = [];
    await provider.download(
      input,
      'my-bucket',
      [{ key: 'test.txt', size: 5 }],
      path.join(dir, 'test.txt'),
      (t: any) => events.push(t),
    );
    expect(await fs.readdir(dir)).toEqual([]);
    expect(events.at(-1).status).toBe('failed');
  });
  it('passes forbid-overwrite to uploads and reports conflicts as failed transfers', async () => {
    const dir = await tempDir();
    const source = path.join(dir, 'test.txt');
    await fs.writeFile(source, 'upload');
    let headers;
    const provider = new AliyunProvider(() => ({
      put: async (_key: string, _file: string, options: any) => {
        headers = options.headers;
        throw Object.assign(new Error('conflict'), { code: 'FileAlreadyExists' });
      },
    }));
    const events: any[] = [];
    await provider.upload(input, 'my-bucket', '', [{ path: source }], (t: any) => events.push(t));
    expect(headers).toEqual({ 'x-oss-forbid-overwrite': 'true' });
    expect(events.at(-1)).toMatchObject({
      status: 'failed',
      error: '同名文件已存在，本次上传未覆盖',
    });
  });
  it('does not leak signed URLs or SDK request details in errors', () => {
    expect(friendlyError(new Error('failed https://bucket/path?Signature=secret'))).not.toContain(
      'secret',
    );
    expect(
      friendlyError({ code: 'AccessDenied', status: 403, message: 'signed request' }),
    ).toContain('RAM');
  });
});
