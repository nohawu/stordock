import type { Transfer } from '../types';
export const isActiveTransfer = (task: Transfer) =>
  ['queued', 'running', 'cancelling'].includes(task.status);
export const directionLabel = (task: Transfer) =>
  ({ upload: '上传', download: '下载', copy: '复制', move: '移动', delete: '删除' })[
    task.direction
  ];
type Worker = (
  signal: AbortSignal,
  report: (patch: Partial<Transfer>) => void,
) => Promise<void | 'skipped'>;
export class DemoTasks {
  private records = new Map<
    string,
    { task: Transfer; worker: Worker; controller: AbortController }
  >();
  constructor(private emit: (task: Transfer) => void) {}
  async run(
    metadata: Pick<Transfer, 'name' | 'direction' | 'size' | 'bucket'>,
    worker: Worker,
    id = `demo-${crypto.randomUUID()}`,
  ): Promise<Transfer> {
    const task: Transfer = {
      ...metadata,
      id,
      status: 'running',
      progress: 0,
      startedAt: Date.now(),
    };
    const record = { task, worker, controller: new AbortController() };
    this.records.set(id, record);
    for (const [key, value] of this.records) {
      if (this.records.size <= 200) break;
      if (!isActiveTransfer(value.task)) this.records.delete(key);
    }
    const report = (patch: Partial<Transfer>) => {
      Object.assign(task, patch);
      this.emit({ ...task });
    };
    report({});
    try {
      const result = await worker(record.controller.signal, report);
      report({ status: result === 'skipped' ? 'skipped' : 'completed', progress: 100 });
    } catch (error) {
      report({
        status: record.controller.signal.aborted ? 'cancelled' : 'failed',
        error: record.controller.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : '操作失败',
      });
    }
    return { ...task };
  }
  async cancel(id: string) {
    const record = this.records.get(id);
    if (record && isActiveTransfer(record.task)) {
      record.task.status = 'cancelling';
      this.emit({ ...record.task });
      record.controller.abort();
    }
  }
  async retry(id: string) {
    const record = this.records.get(id);
    if (!record || !['cancelled', 'failed'].includes(record.task.status))
      throw new Error('此任务无法重试');
    return this.run(record.task, record.worker, id);
  }
  async clear() {
    for (const [id, record] of this.records)
      if (!isActiveTransfer(record.task)) this.records.delete(id);
  }
}
