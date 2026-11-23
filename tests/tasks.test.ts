import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const { TransferManager } = createRequire(import.meta.url)('../electron/tasks.cjs');
const directories: string[] = [];
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stordock-tasks-'));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('stordock-tasks-')
    )
      throw new Error('Invalid test cleanup path');
    await fs.rm(dir, { recursive: true, force: true });
  }
});
const metadata = {
  name: 'file.txt',
  direction: 'download',
  size: 5,
  bucket: 'bucket',
  connectionId: 'connection',
};

describe('persistent transfer scheduling', () => {
  it.runIf(process.platform === 'win32')(
    'retries transient Windows journal locks and removes its unique temporary files',
    async () => {
      const dir = await directory();
      const manager = new TransferManager();
      await manager.initialize(dir, undefined, () => {});
      const rename = fs.rename.bind(fs);
      let locks = 0;
      const mock = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
        if (destination === path.join(dir, 'transfers.json') && locks++ < 2)
          throw Object.assign(new Error('temporarily locked'), { code: 'EPERM' });
        return rename(source, destination);
      });
      try {
        const task = await manager.run(
          metadata,
          async () => {},
          () => {},
        );
        expect(task.status, task.error).toBe('completed');
        expect(locks).toBeGreaterThanOrEqual(3);
        expect((await fs.readdir(dir)).filter((file) => file.includes('.tmp-'))).toEqual([]);
      } finally {
        mock.mockRestore();
      }
    },
  );
  it('preserves a damaged journal and starts a fresh task history', async () => {
    const dir = await directory();
    await fs.writeFile(path.join(dir, 'transfers.json'), '{incomplete');
    const manager = new TransferManager();
    await manager.initialize(dir, undefined, () => {});
    expect(manager.recoveryWarning).toContain('已损坏');
    expect((await fs.readdir(dir)).some((file) => file.startsWith('transfers.json.damaged-'))).toBe(
      true,
    );
    await manager.run(
      metadata,
      async () => {},
      () => {},
    );
    expect(
      JSON.parse(await fs.readFile(path.join(dir, 'transfers.json'), 'utf8')).records,
    ).toHaveLength(1);
  });
  it('limits concurrency, persists queued jobs, restores interrupted jobs as paused and keeps paused jobs when clearing', async () => {
    const dir = await directory();
    const manager = new TransferManager({ concurrency: 1 });
    await manager.initialize(dir, undefined, () => {});
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = manager.run(
      metadata,
      async (signal: AbortSignal) => {
        started();
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
      () => {},
      undefined,
      { type: 'download', state: {} },
    );
    const second = manager.run(
      { ...metadata, name: 'queued.txt' },
      async () => {
        throw new Error('must not start');
      },
      () => {},
      undefined,
      { type: 'download', state: {} },
    );
    await entered;
    await manager.flush();
    expect(
      manager
        .list()
        .map((task: any) => task.status)
        .sort(),
    ).toEqual(['queued', 'running']);
    await manager.shutdown();
    await Promise.all([first, second]);
    const recovered = new TransferManager();
    await recovered.initialize(
      dir,
      (task: any) =>
        recovered.run(
          task.metadata,
          async () => {},
          () => {},
          task,
        ),
      () => {},
    );
    expect(recovered.list().every((task: any) => task.status === 'paused')).toBe(true);
    await recovered.clear();
    expect(recovered.list()).toHaveLength(2);
    const id = recovered.list()[0].id;
    expect((await recovered.retry(id)).status).toBe('completed');
    expect(recovered.records.size).toBe(2);
    expect(manager.list().every((task: any) => task.status === 'paused')).toBe(true);
  });
  it('retries transient failures twice but stops immediately for permission errors', async () => {
    const manager = new TransferManager({ retryDelay: 1 });
    let attempts = 0;
    const result = await manager.run(
      metadata,
      async () => {
        if (++attempts < 3) throw Object.assign(new Error('network'), { code: 'ECONNRESET' });
      },
      () => {},
    );
    expect(result.status).toBe('completed');
    expect(attempts).toBe(3);
    attempts = 0;
    const denied = await manager.run(
      metadata,
      async () => {
        attempts++;
        throw Object.assign(new Error('denied'), { code: 'AccessDenied' });
      },
      () => {},
    );
    expect(denied.status).toBe('failed');
    expect(attempts).toBe(1);
  });
  it('persists checkpoints and actual saved paths across restarts', async () => {
    const dir = await directory();
    const manager = new TransferManager();
    await manager.initialize(dir, undefined, () => {});
    await manager.configureConcurrency(2);
    const saved = path.join(dir, 'renamed (1).txt');
    const completed = await manager.run(
      metadata,
      async (_signal: any, report: any, context: any) => {
        context.state.offset = 5;
        await context.save();
        report({ localPath: saved });
      },
      () => {},
      undefined,
      { type: 'download', connection: { id: 'connection' }, state: {} },
    );
    expect(completed.status, completed.error).toBe('completed');
    const recovered = new TransferManager();
    await recovered.initialize(dir, undefined, () => {});
    expect(recovered.concurrency).toBe(2);
    expect(recovered.list()[0]).toMatchObject({
      id: completed.id,
      status: 'completed',
      localPath: saved,
    });
    expect(recovered.records.get(completed.id).descriptor.state).toEqual({ offset: 5 });
  });
});
