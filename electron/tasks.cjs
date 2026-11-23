const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const active = (status) => ['queued', 'running', 'cancelling'].includes(status);
const unfinished = (status) => active(status) || status === 'paused';
const abortError = () => Object.assign(new Error('任务已取消'), { name: 'AbortError' });
function retryable(error) {
  const code = error.code || error.name;
  const status = error.$metadata?.httpStatusCode || error.status;
  return (
    [
      'ETIMEDOUT',
      'ECONNRESET',
      'EPIPE',
      'EAI_AGAIN',
      'RequestError',
      'ConnectionTimeoutError',
      'TimeoutError',
      'RequestTimeout',
      'SlowDown',
      'ServiceUnavailable',
      'InternalError',
      'ERR_STREAM_PREMATURE_CLOSE',
    ].includes(code) ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}
class TransferManager {
  constructor({ concurrency = 3, retryDelay = 1000 } = {}) {
    this.records = new Map();
    this.concurrency = concurrency;
    this.retryDelay = retryDelay;
    this.running = 0;
    this.waiters = [];
    this.writeQueue = Promise.resolve();
    this.jobs = new Set();
  }
  async initialize(directory, restore, emit) {
    this.file = path.join(directory, 'transfers.json');
    this.restore = restore;
    this.emit = emit;
    let rows;
    try {
      const stat = await fs.stat(this.file);
      if (stat.size > 128 * 1024 * 1024) throw new Error('任务记录过大');
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      rows = Array.isArray(saved) ? saved : saved.records;
      if (Number.isInteger(saved.concurrency) && saved.concurrency >= 1 && saved.concurrency <= 8)
        this.concurrency = saved.concurrency;
      if (!Array.isArray(rows)) throw new Error('任务记录格式无效');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      if (error.code) throw new Error('无法读取传输记录，请检查本地目录权限');
      await fs.rename(this.file, `${this.file}.damaged-${Date.now()}`);
      this.recoveryWarning =
        '历史传输记录已损坏，已保留备份。本次将重新记录任务，原云端文件和已下载文件不受影响。';
      return;
    }
    for (const row of rows) {
      if (
        !row?.metadata?.id ||
        !['upload', 'download', 'copy', 'move', 'delete'].includes(row.metadata.direction)
      )
        continue;
      const metadata = { ...row.metadata, speed: 0, remaining: undefined };
      metadata.canRetry = !!row.descriptor;
      if (unfinished(metadata.status)) {
        metadata.status = row.descriptor ? 'paused' : 'failed';
        metadata.error = row.descriptor ? undefined : '此任务无法恢复，请重新操作';
      }
      this.records.set(metadata.id, { metadata, descriptor: row.descriptor, emit });
    }
  }
  list() {
    return [...this.records.values()].map((task) => ({ ...task.metadata })).reverse();
  }
  scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush().catch(() => {});
    }, 150);
  }
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.file) return Promise.resolve();
    if (this.pendingFlush) return this.pendingFlush;
    const write = this.writeQueue
      .catch(() => {})
      .then(async () => {
        this.pendingFlush = undefined;
        const content = JSON.stringify({
          version: 1,
          concurrency: this.concurrency,
          records: [...this.records.values()].map(({ metadata, descriptor }) => ({
            metadata,
            descriptor,
          })),
        });
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
        try {
          await fs.writeFile(temporary, content, { mode: 0o600 });
          for (let attempt = 0; ; attempt++) {
            try {
              await fs.rename(temporary, this.file);
              break;
            } catch (error) {
              if (
                process.platform !== 'win32' ||
                !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) ||
                attempt >= 3
              )
                throw error;
              await delay(25 * 2 ** attempt);
            }
          }
        } finally {
          await fs.rm(temporary, { force: true });
        }
      });
    this.writeQueue = write;
    this.pendingFlush = write;
    return write;
  }
  async acquire(signal) {
    signal.throwIfAborted();
    if (this.running < this.concurrency) {
      this.running++;
      return;
    }
    await new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => {
          signal.removeEventListener('abort', abort);
          resolve();
        },
      };
      const abort = () => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(signal.reason);
      };
      this.waiters.push(waiter);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  release() {
    if (this.running > this.concurrency) {
      this.running--;
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve();
    else this.running--;
  }
  async configureConcurrency(value) {
    if (!Number.isInteger(value) || value < 1 || value > 8) throw new Error('同时传输数应为 1–8');
    this.concurrency = value;
    while (this.running < this.concurrency && this.waiters.length) {
      this.running++;
      this.waiters.shift().resolve();
    }
    await this.flush();
    return value;
  }
  run(metadata, worker, emit, record, descriptor) {
    const job = this.execute(metadata, worker, emit, record, descriptor);
    this.jobs.add(job);
    job.finally(() => this.jobs.delete(job)).catch(() => {});
    return job;
  }
  async execute(metadata, worker, emit, record, descriptor) {
    if (record?.restoreCancelled) return { ...record.metadata, status: 'cancelled' };
    const task = record || {
      metadata: { ...metadata, id: randomUUID(), progress: 0, startedAt: Date.now() },
      descriptor,
    };
    task.worker = worker;
    task.emit = emit;
    task.controller = new AbortController();
    const signal = task.controller.signal;
    task.metadata = {
      ...task.metadata,
      status: 'queued',
      error: undefined,
      speed: 0,
      remaining: undefined,
      attempt: 0,
      canRetry: true,
    };
    this.records.set(task.metadata.id, task);
    for (const [id, item] of this.records) {
      if (this.records.size <= 200) break;
      if (
        !unfinished(item.metadata.status) &&
        !item.descriptor?.state?.checkpoint &&
        !item.descriptor?.state?.temporary
      )
        this.records.delete(id);
    }
    let lastSample = Date.now(),
      lastBytes = 0;
    const report = (patch) => {
      task.metadata = { ...task.metadata, ...patch };
      if (patch.transferred !== undefined) {
        const now = Date.now(),
          elapsed = now - lastSample;
        if (patch.transferred < lastBytes) {
          lastBytes = patch.transferred;
          lastSample = now;
        } else if (elapsed >= 250) {
          const speed = Math.round(((patch.transferred - lastBytes) * 1000) / elapsed);
          task.metadata.speed = speed;
          task.metadata.remaining = speed
            ? Math.ceil((task.metadata.size - patch.transferred) / speed)
            : undefined;
          lastSample = now;
          lastBytes = patch.transferred;
        }
      }
      if (!active(task.metadata.status)) {
        task.metadata.speed = 0;
        task.metadata.remaining = undefined;
      }
      task.emit({ ...task.metadata });
      this.scheduleSave();
    };
    const context = {
      state: task.descriptor?.state || {},
      save: async () => {
        if (task.descriptor) task.descriptor.state = context.state;
        await this.flush();
      },
    };
    let acquired = false;
    report({});
    try {
      await this.flush();
      await this.acquire(signal);
      acquired = true;
      signal.throwIfAborted();
      report({ status: 'running' });
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await task.worker(signal, report, context);
          report({
            status: result === 'skipped' ? 'skipped' : 'completed',
            progress: 100,
            error: undefined,
          });
          break;
        } catch (error) {
          if (
            signal.aborted ||
            !['upload', 'download'].includes(task.metadata.direction) ||
            !retryable(error) ||
            attempt >= 2
          )
            throw error;
          report({
            attempt: attempt + 1,
            error: `网络中断，正在自动重试（${attempt + 1}/2）…`,
            speed: 0,
          });
          await context.save();
          await delay(this.retryDelay * 2 ** attempt, undefined, { signal });
          report({ error: undefined });
        }
      }
    } catch (error) {
      const paused = signal.reason?.name === 'PauseError';
      const cancelled = signal.aborted || error.name === 'AbortError' || error.name === 'cancel';
      const { friendlyError } = require('./oss.cjs');
      report({
        status: paused ? 'paused' : cancelled ? 'cancelled' : 'failed',
        error: cancelled ? undefined : friendlyError(error),
      });
    } finally {
      if (acquired) this.release();
      await this.flush();
    }
    return { ...task.metadata };
  }
  async cancel(id) {
    const task = this.records.get(id);
    if (!task) return;
    if (task.metadata.status === 'paused') {
      if (task.restoring) task.restoreCancelled = true;
      await this.cleanup?.(task);
      task.metadata.status = 'cancelled';
      task.metadata.error = undefined;
      task.emit({ ...task.metadata });
      await this.flush();
      return;
    }
    if (!active(task.metadata.status)) return;
    task.metadata.status = 'cancelling';
    task.emit({ ...task.metadata });
    task.controller.abort(abortError());
  }
  pause(id) {
    const task = this.records.get(id);
    if (
      !task ||
      !active(task.metadata.status) ||
      !['upload', 'download'].includes(task.metadata.direction)
    )
      return;
    task.metadata.status = 'cancelling';
    task.emit({ ...task.metadata });
    task.controller.abort(Object.assign(new Error('任务已暂停'), { name: 'PauseError' }));
  }
  async retry(id) {
    const task = this.records.get(id);
    if (
      !task ||
      task.restoring ||
      !['failed', 'cancelled', 'paused'].includes(task.metadata.status)
    )
      throw new Error('此任务无法重试或正在恢复');
    if (!task.worker) {
      if (!task.descriptor || !this.restore) throw new Error('此任务无法恢复，请重新操作');
      task.restoring = true;
      try {
        return await this.restore(task);
      } finally {
        task.restoring = false;
        task.restoreCancelled = false;
      }
    }
    return this.run(task.metadata, task.worker, task.emit, task);
  }
  async clear() {
    for (const [id, task] of this.records)
      if (!unfinished(task.metadata.status)) {
        await this.cleanup?.(task);
        this.records.delete(id);
      }
    await this.flush();
  }
  async shutdown() {
    for (const [id, task] of this.records) {
      if (active(task.metadata.status)) {
        task.controller?.abort(
          Object.assign(new Error('应用关闭，任务已暂停'), { name: 'PauseError' }),
        );
      }
    }
    await Promise.allSettled([...this.jobs]);
    await this.flush();
  }
}
module.exports = {
  TransferManager,
  taskManager: new TransferManager(),
  abortError,
  active,
  unfinished,
  retryable,
};
