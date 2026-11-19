import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleHelp,
  Cloud,
  KeyRound,
  Loader2,
  LockKeyhole,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { Modal } from './Modal';
import { storage } from '../lib/storage';
import type { Connection, ConnectionInput } from '../types';
export function ConnectionDialog({
  onClose,
  onSaved,
}: {
  onClose(): void;
  onSaved(connection: Connection): void;
}) {
  const [form, setForm] = useState<ConnectionInput>({
    name: '',
    provider: 'aliyun',
    region: 'cn-hangzhou',
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    accessKeySecret: '',
    stsToken: '',
    remember: true,
  });
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [result, setResult] = useState<{ error?: string; success?: string }>({});
  const [advanced, setAdvanced] = useState(false);
  function update<K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setResult({});
  }
  async function execute(action: 'test' | 'save', event?: FormEvent) {
    event?.preventDefault();
    setBusy(action);
    setResult({});
    try {
      if (action === 'test') {
        const result = await storage.testConnection(form);
        setResult({ success: `连接成功，可访问 ${result.buckets.length} 个存储桶` });
      } else {
        onSaved(await storage.saveConnection(form));
      }
    } catch (e) {
      setResult({
        error:
          e instanceof Error
            ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
            : '连接失败，请重试',
      });
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal
      title="新建存储连接"
      subtitle="让云端资源，触手可及。"
      onClose={() => !busy && onClose()}
      wide
    >
      <form onSubmit={(e) => execute('save', e)}>
        <div className="provider-option">
          <span className="aliyun-logo">
            <Cloud size={23} />
          </span>
          <div>
            <strong>阿里云 OSS</strong>
            <small>Alibaba Cloud Object Storage</small>
          </div>
          <span className="provider-check">
            <Check size={15} />
          </span>
        </div>
        {!window.ossDesk && (
          <div className="form-notice">
            <CircleHelp size={17} />
            <span>当前为浏览器演示。连接真实 OSS，请在桌面客户端中打开（npm run desktop）。</span>
          </div>
        )}
        <fieldset disabled={!!busy}>
          <label className="field">
            连接名称
            <input
              required
              autoFocus
              placeholder="例如：生产环境 · 静态资源"
              maxLength={80}
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              地域 Region
              <input
                required
                list="regions"
                placeholder="cn-hangzhou"
                value={form.region}
                onChange={(e) => update('region', e.target.value)}
              />
              <datalist id="regions">
                <option value="cn-hangzhou" />
                <option value="cn-shanghai" />
                <option value="cn-beijing" />
                <option value="cn-shenzhen" />
                <option value="cn-hongkong" />
                <option value="ap-southeast-1" />
                <option value="us-west-1" />
              </datalist>
            </label>
            <label className="field">
              Bucket <span className="optional">可选</span>
              <input
                placeholder="留空以列出可访问的存储桶"
                value={form.bucket}
                onChange={(e) => update('bucket', e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>
              <KeyRound size={13} /> AccessKey ID
            </span>
            <input
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="输入 AccessKey ID"
              value={form.accessKeyId}
              onChange={(e) => update('accessKeyId', e.target.value)}
            />
          </label>
          <label className="field">
            <span>
              <LockKeyhole size={13} /> AccessKey Secret
            </span>
            <input
              required
              autoComplete="new-password"
              type="password"
              placeholder="输入 AccessKey Secret"
              value={form.accessKeySecret}
              onChange={(e) => update('accessKeySecret', e.target.value)}
            />
          </label>
          <button type="button" className="advanced-toggle" onClick={() => setAdvanced((v) => !v)}>
            <Server size={14} />
            {advanced ? '收起高级配置' : '高级配置'}
            <span>{advanced ? '−' : '+'}</span>
          </button>
          {advanced && (
            <div className="advanced-fields">
              <label className="field">
                自定义 Endpoint
                <input
                  type="url"
                  placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                  value={form.endpoint}
                  onChange={(e) => update('endpoint', e.target.value)}
                />
              </label>
              <label className="field">
                STS Token <span className="optional">可选</span>
                <textarea
                  rows={2}
                  placeholder="使用临时凭据时填写，过期后需要重新连接"
                  value={form.stsToken}
                  onChange={(e) => update('stsToken', e.target.value)}
                />
              </label>
            </div>
          )}
          <label className="remember-field">
            <input
              type="checkbox"
              checked={form.remember}
              onChange={(e) => update('remember', e.target.checked)}
            />
            <span>
              记住连接凭据<small>使用操作系统安全存储加密，仅保存在本机</small>
            </span>
            <ShieldCheck size={19} />
          </label>
        </fieldset>
        {result.error && (
          <div className="inline-error" role="alert">
            {result.error}
          </div>
        )}
        {result.success && (
          <div className="inline-success" role="status">
            <CheckCircle2 size={16} />
            {result.success}
          </div>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={!!busy}
            onClick={() => execute('test')}
          >
            {busy === 'test' ? <Loader2 className="spin" size={15} /> : <Server size={15} />}
            测试连接
          </button>
          <div className="footer-right">
            <button type="button" className="button ghost" disabled={!!busy} onClick={onClose}>
              取消
            </button>
            <button className="button primary" disabled={!!busy}>
              {busy === 'save' ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
              保存并连接
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
