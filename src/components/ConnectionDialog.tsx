import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Box,
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
  connection,
  draft,
}: {
  onClose(): void;
  onSaved(connection: Connection): void;
  connection?: Connection;
  draft?: Partial<ConnectionInput>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState<ConnectionInput>({
    name: '',
    provider: 'aliyun',
    region: 'cn-hangzhou',
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    accessKeySecret: '',
    stsToken: '',
    forcePathStyle: true,
    allowInsecure: false,
    remember: true,
    ...connection,
    ...draft,
    keepCredentials: !!connection,
    ...(connection ? { remember: !connection.temporary } : {}),
  });
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [result, setResult] = useState<{ error?: string; success?: string }>({});
  const [advanced, setAdvanced] = useState(false);
  const isS3 = form.provider === 's3';
  const isHttp = /^http:/i.test(form.endpoint.trim());
  function update<K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setResult({});
  }
  function chooseProvider(provider: Connection['provider']) {
    if (provider === form.provider) return;
    setForm((f) => ({
      ...f,
      provider,
      region: provider === 's3' ? 'us-east-1' : 'cn-hangzhou',
      endpoint: '',
      forcePathStyle: true,
      allowInsecure: false,
    }));
    setResult({});
    setAdvanced(false);
  }
  async function execute(action: 'test' | 'save', event?: FormEvent) {
    event?.preventDefault();
    if (!formRef.current?.reportValidity()) return;
    if (isS3 && isHttp && !form.allowInsecure) {
      setResult({ error: '此 Endpoint 使用 HTTP，请显式勾选“允许 HTTP 连接”后再继续' });
      return;
    }
    setBusy(action);
    setResult({});
    try {
      if (action === 'test') {
        const response = await storage.testConnection(form);
        setResult({ success: `连接成功，可访问 ${response.buckets.length} 个存储桶` });
      } else onSaved(await storage.saveConnection(form));
    } catch (error) {
      setResult({
        error:
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
            : '连接失败，请重试',
      });
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal
      title={connection ? '编辑存储连接' : '新建存储连接'}
      subtitle={
        connection
          ? '密钥留空保留原凭据；修改账号或服务类型后需要重新填写'
          : '选择存储类型，配置服务地址和访问凭据'
      }
      onClose={() => !busy && onClose()}
      wide
    >
      <form ref={formRef} onSubmit={(event) => execute('save', event)}>
        <div className="provider-options" role="group" aria-label="存储类型">
          <button
            type="button"
            className="provider-option provider-tile"
            aria-label="阿里云 OSS"
            aria-pressed={!isS3}
            disabled={!!busy}
            onClick={() => chooseProvider('aliyun')}
          >
            <span className="aliyun-logo">
              <Cloud size={22} />
            </span>
            <span>
              <strong>阿里云 OSS</strong>
              <small>Alibaba Cloud</small>
            </span>
            <span className="provider-check">{!isS3 && <Check size={12} />}</span>
          </button>
          <button
            type="button"
            className="provider-option provider-tile"
            aria-label="S3 兼容"
            aria-pressed={isS3}
            disabled={!!busy}
            onClick={() => chooseProvider('s3')}
          >
            <span className="s3-logo">
              <Box size={22} />
            </span>
            <span>
              <strong>S3 兼容</strong>
              <small>自定义 S3 API 服务</small>
            </span>
            <span className="provider-check">{isS3 && <Check size={12} />}</span>
          </button>
        </div>
        {!window.ossDesk && (
          <div className="form-notice">
            <CircleHelp size={16} />
            <span>
              当前为浏览器演示。连接真实存储服务，请在桌面客户端中打开（npm run desktop）。
            </span>
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
          {isS3 && (
            <>
              <label className="field">
                Endpoint
                <input
                  required
                  type="url"
                  spellCheck={false}
                  aria-label="Endpoint"
                  aria-describedby="s3-endpoint-help"
                  placeholder="https://s3.example.com 或 http://127.0.0.1:9000"
                  value={form.endpoint}
                  onChange={(e) => update('endpoint', e.target.value)}
                />
                <small className="field-help" id="s3-endpoint-help">
                  填写 S3 API 地址，支持端口和反向代理路径；不要填写管理控制台地址。
                </small>
              </label>
              <label className="field">
                访问方式
                <select
                  aria-label="访问方式"
                  value={form.forcePathStyle === false ? 'virtual' : 'path'}
                  onChange={(e) => update('forcePathStyle', e.target.value === 'path')}
                >
                  <option value="path">Path-style · endpoint/bucket/key</option>
                  <option value="virtual">虚拟主机 · bucket.endpoint/key</option>
                </select>
              </label>
            </>
          )}
          <div className="form-grid">
            <label className="field">
              {isS3 ? 'Region' : '地域 Region'}
              <input
                required
                list="regions"
                placeholder={isS3 ? 'us-east-1' : 'cn-hangzhou'}
                value={form.region}
                onChange={(e) => update('region', e.target.value)}
              />
              <datalist id="regions">
                {(isS3
                  ? ['us-east-1', 'us-west-2', 'ap-southeast-1', 'eu-west-1', 'auto']
                  : [
                      'cn-hangzhou',
                      'cn-shanghai',
                      'cn-beijing',
                      'cn-shenzhen',
                      'cn-hongkong',
                      'ap-southeast-1',
                      'us-west-1',
                    ]
                ).map((r) => (
                  <option key={r} value={r} />
                ))}
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
              <KeyRound size={13} /> {isS3 ? 'Access Key ID' : 'AccessKey ID'}
            </span>
            <input
              required={!form.credentialRefreshUrl}
              autoComplete="off"
              spellCheck={false}
              placeholder={isS3 ? '输入 Access Key ID' : '输入 AccessKey ID'}
              value={form.accessKeyId}
              onChange={(e) => update('accessKeyId', e.target.value)}
            />
          </label>
          <label className="field">
            <span>
              <LockKeyhole size={13} /> {isS3 ? 'Secret Access Key' : 'AccessKey Secret'}
            </span>
            <input
              required={
                !form.credentialRefreshUrl &&
                (!connection ||
                  form.provider !== connection.provider ||
                  form.accessKeyId !== connection.accessKeyId)
              }
              autoComplete="new-password"
              type="password"
              placeholder={
                connection
                  ? '留空保留原密钥'
                  : isS3
                    ? '输入 Secret Access Key'
                    : '输入 AccessKey Secret'
              }
              value={form.accessKeySecret}
              onChange={(e) => update('accessKeySecret', e.target.value)}
            />
          </label>
          {isS3 && (
            <label className={`http-optin ${isHttp ? 'is-http' : ''}`}>
              <input
                type="checkbox"
                checked={!!form.allowInsecure}
                onChange={(e) => update('allowInsecure', e.target.checked)}
              />
              <span>
                允许 HTTP 连接（未加密）<small>仅在自建服务未启用 HTTPS 时使用</small>
              </span>
            </label>
          )}
          <button
            type="button"
            className="advanced-toggle"
            aria-label={advanced ? '收起高级配置' : '高级配置'}
            aria-expanded={advanced}
            onClick={() => setAdvanced((v) => !v)}
          >
            <Server size={14} />
            {advanced ? '收起高级配置' : '高级配置'}
            <span>{advanced ? '−' : '+'}</span>
          </button>
          {advanced && (
            <div className="advanced-fields">
              {!isS3 && (
                <label className="field">
                  自定义 Endpoint
                  <input
                    type="url"
                    spellCheck={false}
                    placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                    value={form.endpoint}
                    onChange={(e) => update('endpoint', e.target.value)}
                  />
                </label>
              )}
              <label className="field">
                临时凭据刷新 URL <span className="optional">可选</span>
                <input
                  type="url"
                  aria-label="临时凭据刷新 URL"
                  placeholder="https://auth.example.com/storage-credentials"
                  value={form.credentialRefreshUrl || ''}
                  onChange={(event) => update('credentialRefreshUrl', event.target.value)}
                />
                <small className="field-help">
                  通过 HTTPS GET 获取临时凭据和
                  Expiration，到期前自动刷新。现有云端密钥不会发送到此地址。
                </small>
              </label>
              <label className="field">
                刷新服务 Bearer Token <span className="optional">可选</span>
                <input
                  type="password"
                  autoComplete="off"
                  aria-label="刷新服务 Bearer Token"
                  placeholder={
                    connection ? '留空保留；修改刷新地址时重新填写' : '仅在主进程使用并加密保存'
                  }
                  value={form.credentialRefreshToken || ''}
                  onChange={(event) => update('credentialRefreshToken', event.target.value)}
                />
              </label>
              <label className="field">
                {isS3 ? 'Session Token' : 'STS Token'} <span className="optional">可选</span>
                <textarea
                  rows={2}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={connection ? '留空保留原 Token；填写以替换' : '使用临时凭据时填写'}
                  value={form.stsToken}
                  onChange={(e) => update('stsToken', e.target.value)}
                />
              </label>
              {connection && (
                <label className="remember-field">
                  <input
                    type="checkbox"
                    checked={!!form.clearStsToken}
                    onChange={(e) => update('clearStsToken', e.target.checked)}
                  />
                  清除已保存的 Token
                </label>
              )}
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
