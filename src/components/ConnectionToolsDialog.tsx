import { useState } from 'react';
import { Modal } from './Modal';
import { storage } from '../lib/storage';
import type { Connection, ConnectionInput } from '../types';
type Preview = { id: string; encrypted: boolean; connections: Connection[] };
export function ConnectionToolsDialog({
  onClose,
  onImported,
  onDraft,
}: {
  onClose(): void;
  onImported(): void;
  onDraft(draft: Partial<ConnectionInput>): void;
}) {
  const [password, setPassword] = useState(''),
    [encrypted, setEncrypted] = useState(false),
    [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="连接导入与导出"
      subtitle="配置文件不含密钥；完整备份使用密码加密"
      onClose={() => !busy && onClose()}
    >
      <label className="remember-field">
        <input
          type="checkbox"
          checked={encrypted}
          onChange={(event) => setEncrypted(event.target.checked)}
        />
        导出带凭据的加密备份
      </label>
      <label className="field">
        备份密码（加密导出至少 12 位；导入加密文件时也在此填写）
        <input
          aria-label="备份密码"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="feature-actions">
        <button
          className="button secondary"
          disabled={busy || (encrypted && password.length < 12)}
          onClick={() =>
            void run(async () => {
              const result = await storage.feature<{ saved: boolean }>('connections:export', {
                encrypted,
                password,
              });
              if (result.saved) setMessage('连接备份已导出');
            })
          }
        >
          导出连接
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await storage.feature<Preview | undefined>('connections:inspect', {
                password,
              });
              setPreview(result);
              setMessage('');
            })
          }
        >
          选择文件预览导入
        </button>
      </div>
      {preview && (
        <div className="feature-confirm">
          <strong>将导入 {preview.connections.length} 个连接</strong>
          <p className="selection-note">
            {preview.encrypted
              ? '将使用新 ID 导入并通过本机系统安全存储加密，不替换已有连接。'
              : '配置不含密钥，选择连接后补充凭据并保存。'}
          </p>
          {preview.connections.map((item, index) => (
            <div className="archive-row" key={index}>
              <span>
                {item.name} · {item.provider === 's3' ? 'S3' : 'OSS'}
              </span>
              {!preview.encrypted && (
                <button className="button secondary" disabled={busy} onClick={() => onDraft(item)}>
                  填写凭据
                </button>
              )}
            </div>
          ))}
          {preview.encrypted && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await storage.feature('connections:import', { planId: preview.id });
                  setPreview(undefined);
                  setPassword('');
                  setMessage('连接已导入');
                  onImported();
                })
              }
            >
              确认导入加密连接
            </button>
          )}
        </div>
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
