import { useState } from 'react';
import { Modal } from './Modal';
import type { ConflictPolicy, UploadItem } from '../types';
export type UploadContext = {
  connectionId: string;
  bucket: string;
  prefix: string;
  items: UploadItem[];
};
export function UploadDialog({
  context,
  onClose,
  onStart,
}: {
  context: UploadContext;
  onClose(): void;
  onStart(policy: ConflictPolicy): void;
}) {
  const [policy, setPolicy] = useState<ConflictPolicy>('reject');
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Modal
      title="上传到存储桶"
      subtitle={`目标：${context.bucket}/${context.prefix}`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (policy === 'overwrite' && !confirmed) return;
          onStart(policy);
        }}
      >
        <div className="operation-sources">
          {context.items.slice(0, 6).map((item, index) => (
            <code key={index}>{item.relativePath || item.name}</code>
          ))}
          {context.items.length > 6 && <small>另有 {context.items.length - 6} 项</small>}
        </div>
        <label className="field">
          同名文件处理
          <select
            aria-label="同名文件处理"
            value={policy}
            onChange={(event) => {
              setPolicy(event.target.value as ConflictPolicy);
              setConfirmed(false);
            }}
          >
            <option value="reject">保留原文件，同名项报告失败</option>
            <option value="skip">跳过同名文件</option>
            <option value="rename">自动重命名上传文件</option>
            <option value="overwrite">覆盖同名文件</option>
          </select>
        </label>
        {policy === 'overwrite' && (
          <label className="remember-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我确认覆盖目标中的同名文件
          </label>
        )}
        <div className="modal-footer right">
          <button type="button" className="button ghost" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={policy === 'overwrite' && !confirmed}>
            开始上传
          </button>
        </div>
      </form>
    </Modal>
  );
}
