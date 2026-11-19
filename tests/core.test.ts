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
  for (const p of temporary.splice(0)) {
    if (
      path.dirname(p) !== path.resolve(os.tmpdir()) ||
      !path.basename(p).startsWith('ossdesk-test-')
    )
      throw new Error('Invalid test cleanup path');
    await fs.rm(p, { recursive: true, force: true });
  }
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
