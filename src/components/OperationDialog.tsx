import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { storage } from '../lib/storage';
import { folderNameError, formatBytes } from '../lib/objects';
import type { Connection, ObjectOperation, OperationPlan, StorageObject } from '../types';
export type OperationContext = {
  connectionId: string;
  bucket: string;
  objects: StorageObject[];
  operation: ObjectOperation;
};
const labels = { copy: '复制', move: '移动', rename: '重命名', delete: '删除' };
export function OperationDialog({
  context,
  onClose,
  onExecute,
}: {
  context: OperationContext;
  onClose(): void;
  onExecute(planId: string): void;
}) {
  const { connectionId, bucket, objects, operation } = context;
  const [target, setTarget] = useState(
    operation === 'rename' ? objects[0].key.replace(/\/$/, '').split('/').pop()! : '',
  );
  const [targetConnection, setTargetConnection] = useState(connectionId);
  const [targetBucket, setTargetBucket] = useState(bucket);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [buckets, setBuckets] = useState<string[]>([]);
  const canMigrate = connectionId !== 'demo-studio' && ['copy', 'move'].includes(operation);
  useEffect(() => {
    if (canMigrate)
      void storage
        .connections()
        .then((items) => setConnections(items.filter((item) => item.id !== 'demo-studio')))
        .catch(() => {});
  }, []);
  useEffect(() => {
    if (canMigrate)
      void storage
        .buckets(targetConnection)
        .then((items) => setBuckets(items.map((item) => item.name)))
        .catch(() => setBuckets([]));
  }, [targetConnection]);
  const [plan, setPlan] = useState<OperationPlan>();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = labels[operation];
  async function prepare() {
    setError('');
    if (operation === 'rename') {
      const error = folderNameError(target);
      if (error) {
        setError(error);
        return;
      }
    }
    let destination = target;
    if (operation === 'rename') {
      const original = objects[0].key.replace(/\/$/, '');
      destination =
        original.slice(0, original.lastIndexOf('/') + 1) +
        target +
        (objects[0].kind === 'folder' ? '/' : '');
    } else if (destination && !destination.endsWith('/')) destination += '/';
    setBusy(true);
    try {
      setPlan(
        canMigrate && (targetConnection !== connectionId || targetBucket !== bucket)
          ? await storage.feature<OperationPlan>('migration:prepare', {
              connectionId,
              bucket,
              objects,
              operation,
              target: destination,
              destination: { connectionId: targetConnection, bucket: targetBucket },
            })
          : await storage.prepareOperation(connectionId, bucket, objects, operation, destination),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法统计操作范围');
    } finally {
      setBusy(false);
    }
  }
  function execute() {
    if (plan?.count && (operation !== 'delete' || confirmation === '删除')) onExecute(plan.id);
  }
  return (
    <Modal
      title={`${label}对象`}
      subtitle={`${bucket} · 已选择 ${objects.length} 项`}
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (plan ? execute() : prepare());
        }}
      >
        <div className="operation-sources">
          {objects.slice(0, 5).map((object) => (
            <code key={object.key}>{object.key}</code>
          ))}
          {objects.length > 5 && <small>另有 {objects.length - 5} 项</small>}
        </div>
        {canMigrate && (
          <>
            <label className="field">
              目标连接
              <select
                aria-label="目标连接"
                disabled={busy || !!plan}
                value={targetConnection}
                onChange={(event) => {
                  setTargetConnection(event.target.value);
                  setTargetBucket('');
                }}
              >
                {connections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              目标 Bucket
              <input
                list="migration-buckets"
                aria-label="目标 Bucket"
                required
                disabled={busy || !!plan}
                value={targetBucket}
                onChange={(event) => setTargetBucket(event.target.value)}
              />
              <datalist id="migration-buckets">
                {buckets.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </datalist>
            </label>
            <p className="selection-note">
              跨连接复制通过本机临时文件中转，可能产生网络流量和临时磁盘占用。全部复制并校验成功后，移动操作才会删除源对象。
            </p>
          </>
        )}
        {operation !== 'delete' && (
          <label className="field">
            {operation === 'rename' ? '新名称' : '目标目录'}
            <input
              autoFocus
              disabled={busy || !!plan}
              aria-label={operation === 'rename' ? '新名称' : '目标目录'}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="例如 archive/2026/，留空为根目录"
            />
          </label>
        )}
        {!plan && (
          <p className="selection-note">
            先统计完整操作范围，再确认执行。复制、移动和重命名遇到同名目标时会停止，不会覆盖。
          </p>
        )}
        {plan && (
          <div className="operation-summary">
            <strong>
              将{label} {plan.count} 个对象 · {formatBytes(plan.size)}
            </strong>
            <p>
              {operation === 'delete'
                ? '包含所选文件夹内的对象；删除后能否恢复取决于 Bucket 的版本控制设置。'
                : operation === 'copy'
                  ? `复制到 ${targetBucket || bucket}，保留源对象。`
                  : '先复制，再删除源对象；部分失败或取消时，已复制的目标会保留，请在任务中心检查结果。'}
            </p>
          </div>
        )}
        {plan && operation === 'delete' && (
          <label className="field">
            输入「删除」确认
            <input
              aria-label="删除确认"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </label>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer right">
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          {plan && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setPlan(undefined)}
            >
              修改范围
            </button>
          )}
          <button
            className={`button ${operation === 'delete' && plan ? 'danger-button' : 'primary'}`}
            disabled={
              busy ||
              (!!plan && (!plan.count || (operation === 'delete' && confirmation !== '删除')))
            }
          >
            {busy && <Loader2 size={14} className="spin" />}
            {busy ? '正在处理…' : plan ? `确认${label}` : '统计操作范围'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
