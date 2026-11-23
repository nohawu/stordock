import { useState } from 'react';
import { Copy, Link, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { storage } from '../lib/storage';
import { copyText } from '../lib/clipboard';

export type ShareContext = { connectionId: string; bucket: string; objectKey: string };
export function ShareDialog({
  connectionId,
  bucket,
  objectKey,
  onClose,
}: ShareContext & { onClose(): void }) {
  const [expires, setExpires] = useState(3600);
  const [result, setResult] = useState<{ url: string; expiresAt: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function generate() {
    setBusy(true);
    setError('');
    setResult(undefined);
    setCopied(false);
    try {
      setResult(await storage.signedUrl(connectionId, bucket, objectKey, expires));
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成链接失败');
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await copyText(result!.url);
      setCopied(true);
      setError('');
    } catch {
      setError('复制失败，请手动选择并复制链接');
    }
  }
  return (
    <Modal title="分享文件" subtitle={`${bucket} · ${objectKey}`} onClose={onClose}>
      <label className="field">
        链接有效期
        <select
          aria-label="链接有效期"
          value={expires}
          disabled={busy}
          onChange={(e) => {
            setExpires(Number(e.target.value));
            setResult(undefined);
            setCopied(false);
          }}
        >
          <option value={900}>15 分钟</option>
          <option value={3600}>1 小时</option>
          <option value={86400}>1 天</option>
          <option value={604800}>7 天</option>
        </select>
      </label>
      <p className="selection-note">
        持有链接的人可在有效期内访问该文件。使用临时凭据时，链接会随凭据提前失效。
      </p>
      {result && (
        <div className="share-result">
          <label className="field">
            签名下载链接
            <textarea
              aria-label="签名下载链接"
              readOnly
              value={result.url}
              rows={4}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="selection-note">预计到期：{new Date(result.expiresAt).toLocaleString()}</p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer right">
        <button className="button ghost" onClick={onClose}>
          关闭
        </button>
        {result ? (
          <button className="button primary" onClick={() => void copy()}>
            <Copy size={14} />
            {copied ? '已复制' : '复制链接'}
          </button>
        ) : (
          <button className="button primary" disabled={busy} onClick={() => void generate()}>
            {busy ? <Loader2 size={14} className="spin" /> : <Link size={14} />}生成链接
          </button>
        )}
      </div>
    </Modal>
  );
}
