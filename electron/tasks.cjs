const { randomUUID } = require('node:crypto');
const active = (status) => ['queued', 'running', 'cancelling'].includes(status);
const abortError = () => Object.assign(new Error('任务已取消'), { name: 'AbortError' });
class TransferManager {
  constructor() {
    this.records = new Map();
  }
  async run(metadata, worker, emit, record) {
    const task = record || {
      metadata: {
        ...metadata,
        id: randomUUID(),
        status: 'queued',
        progress: 0,
        startedAt: Date.now(),
      },
      worker,
      emit,
    };
    task.controller = new AbortController();
    task.metadata = {
      ...task.metadata,
      status: 'running',
      progress: 0,
      error: undefined,
      startedAt: Date.now(),
    };
    this.records.set(task.metadata.id, task);
    // Evict only ended tasks; running tasks must always remain cancellable.
    for (const [id, item] of this.records) {
      if (this.records.size <= 200) break;
      if (!active(item.metadata.status)) this.records.delete(id);
    }
    const report = (patch) => {
      task.metadata = { ...task.metadata, ...patch };
      task.emit({ ...task.metadata });
    };
    report({});
    try {
      const result = await task.worker(task.controller.signal, report);
      report({ status: result === 'skipped' ? 'skipped' : 'completed', progress: 100 });
    } catch (error) {
      const cancelled = error.name === 'AbortError' || error.name === 'cancel';
      const { friendlyError } = require('./oss.cjs');
      report({
        status: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? undefined : friendlyError(error),
      });
    }
    return { ...task.metadata };
  }
  cancel(id) {
    const task = this.records.get(id);
    if (!task || !active(task.metadata.status)) return;
    task.metadata.status = 'cancelling';
    task.emit({ ...task.metadata });
    task.controller.abort();
  }
  retry(id) {
    const task = this.records.get(id);
    if (!task || !['failed', 'cancelled'].includes(task.metadata.status))
      throw new Error('此任务无法重试');
    return this.run(task.metadata, task.worker, task.emit, task);
  }
  clear() {
    for (const [id, task] of this.records)
      if (!active(task.metadata.status)) this.records.delete(id);
  }
}
module.exports = { TransferManager, taskManager: new TransferManager(), abortError, active };
