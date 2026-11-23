import { useState } from 'react';
import { Modal } from './Modal';
import { storage } from '../lib/storage';
import { formatBytes } from '../lib/objects';
type Plan = {
  id: string;
  root: string;
  count: number;
  size: number;
  items: { relative: string; action: string; size: number }[];
};
export function SyncDialog({
  connectionId,
  bucket,
  prefix,
  onClose,
  onChanged,
}: {
  connectionId: string;
  bucket: string;
  prefix: string;
  onClose(): void;
  onChanged(): void;
}) {
  const [direction, setDirection] = useState('upload'),
    [rules, setRules] = useState('.git/**\nnode_modules/**\n.DS_Store\nThumbs.db'),
    [plan, setPlan] = useState<Plan>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  async function act(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="同步本地目录"
      subtitle={`${bucket}/${prefix}`}
      onClose={() => !busy && onClose()}
      wide
    >
      {!plan ? (
        <>
          <label className="field">
            同步方向
            <select
              aria-label="同步方向"
              value={direction}
              disabled={busy}
              onChange={(event) => setDirection(event.target.value)}
            >
              <option value="upload">本地 → 当前远端目录</option>
              <option value="download">当前远端目录 → 本地</option>
            </select>
          </label>
          <label className="field">
            排除规则（每行一个，支持 *、**、?）
            <textarea
              aria-label="同步排除规则"
              rows={5}
              value={rules}
              onChange={(event) => setRules(event.target.value)}
            />
          </label>
          <p className="selection-note">
            只新增文件或更新大小不同、来源更新的文件；按大小和修改时间比较，不删除任一侧的文件。执行前展示差异清单。
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await storage.feature<Plan | undefined>('sync:prepare', {
                  connectionId,
                  bucket,
                  prefix,
                  direction,
                  rules,
                });
                setPlan(result);
                setConfirmed(false);
                setMessage('');
              })
            }
          >
            {busy ? '正在比较…' : '选择本地目录并比较'}
          </button>
        </>
      ) : (
        <>
          <p className="selection-note">本地目录：{plan.root}</p>
          <strong>
            {plan.count} 项待同步 · {formatBytes(plan.size)}
          </strong>
          <div className="sync-plan">
            {plan.items.map((item) => (
              <div key={item.relative}>
                <span>{{ create: '新增', update: '更新', skip: '跳过' }[item.action]}</span>
                <code>{item.relative}</code>
                <small>{formatBytes(item.size)}</small>
              </div>
            ))}
          </div>
          <label className="remember-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            确认同步以上差异，允许替换标记为「更新」的文件
          </label>
          <div className="feature-actions">
            <button className="button secondary" disabled={busy} onClick={() => setPlan(undefined)}>
              重新比较
            </button>
            <button
              className="button primary"
              disabled={busy || !confirmed || !plan.count}
              onClick={() =>
                void act(async () => {
                  const result = await storage.feature<{
                    completed: number;
                    failed: number;
                    skipped: number;
                  }>('sync:execute', { planId: plan.id });
                  setPlan(undefined);
                  onChanged();
                  setMessage(
                    `同步已处理：${result.completed} 项完成，${result.failed} 项失败，${result.skipped} 项跳过。请在传输中心查看明细。`,
                  );
                })
              }
            >
              {busy ? '同步中…' : '执行同步'}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-success" role="status">
          {message}
        </p>
      )}
      <div className="modal-footer right">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
    </Modal>
  );
}
