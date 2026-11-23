import { useEffect, useState } from 'react';
import { Loader2, Download, RotateCcw } from 'lucide-react';
import { Modal } from './Modal';
import { storage } from '../lib/storage';
import { formatBytes, dateLabel } from '../lib/objects';
import type { Connection, ObjectInfo, StorageObject } from '../types';
type Version = {
  versionId: string;
  size?: number;
  lastModified: string;
  isLatest?: boolean;
  deleted?: boolean;
};
export function ObjectToolsDialog({
  connection,
  bucket,
  object,
  onClose,
  onChanged,
}: {
  connection: Connection;
  bucket: string;
  object: StorageObject;
  onClose(): void;
  onChanged(): void;
}) {
  const [tab, setTab] = useState('properties'),
    [info, setInfo] = useState<ObjectInfo>(),
    [metadata, setMetadata] = useState('{}');
  const [tagText, setTagText] = useState('{}'),
    [versions, setVersions] = useState<Version[]>([]),
    [cursor, setCursor] = useState<Record<string, string>>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Version>(),
    [confirmation, setConfirmation] = useState(''),
    [days, setDays] = useState(2),
    [tier, setTier] = useState('Standard');
  const input = { connectionId: connection.id, bucket, key: object.key };
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  async function loadProperties() {
    const value = await storage.objectInfo(connection.id, bucket, object.key);
    setInfo({
      ...value,
      storageClass:
        connection.provider === 's3'
          ? (value.storageClass || object.storageClass).replace(/^Standard$/, 'STANDARD')
          : value.storageClass || object.storageClass,
    });
    setMetadata(JSON.stringify(value.metadata, null, 2));
  }
  async function loadVersions(more = false) {
    const result = await storage.feature<{ versions: Version[]; cursor?: Record<string, string> }>(
      'object:versions',
      { ...input, cursor: more ? cursor : undefined },
    );
    setVersions((previous) => (more ? [...previous, ...result.versions] : result.versions));
    setCursor(result.cursor);
  }
  useEffect(() => {
    void run(async () => {
      if (tab === 'properties' || tab === 'archive') await loadProperties();
      if (tab === 'tags')
        setTagText(JSON.stringify(await storage.feature('object:tags', input), null, 2));
      if (tab === 'versions') await loadVersions();
    });
  }, [tab]);
  const classes =
    connection.provider === 's3'
      ? [
          'STANDARD',
          'STANDARD_IA',
          'ONEZONE_IA',
          'INTELLIGENT_TIERING',
          'GLACIER',
          'DEEP_ARCHIVE',
          'GLACIER_IR',
        ]
      : ['Standard', 'IA', 'Archive', 'ColdArchive', 'DeepColdArchive'];
  return (
    <Modal
      title="管理对象"
      subtitle={`${bucket}/${object.key}`}
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="filter-tabs feature-tabs">
        {[
          ['properties', '属性'],
          ['tags', '标签'],
          ['versions', '历史版本'],
          ['archive', '归档解冻'],
        ].map(([value, label]) => (
          <button
            key={value}
            disabled={busy}
            className={tab === value ? 'active' : ''}
            onClick={() => {
              setSelected(undefined);
              setTab(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'properties' && info && (
        <>
          {(
            [
              'contentType',
              'cacheControl',
              'contentDisposition',
              'contentEncoding',
              'contentLanguage',
              'expires',
            ] as const
          ).map((field) => (
            <label className="field" key={field}>
              {
                {
                  contentType: 'Content-Type',
                  cacheControl: 'Cache-Control',
                  contentDisposition: 'Content-Disposition',
                  contentEncoding: 'Content-Encoding',
                  contentLanguage: 'Content-Language',
                  expires: 'Expires',
                }[field]
              }
              <input
                aria-label={field}
                value={info[field] || ''}
                disabled={busy}
                onChange={(event) => setInfo({ ...info, [field]: event.target.value })}
              />
            </label>
          ))}
          <label className="field">
            存储类型
            <select
              aria-label="存储类型"
              disabled={busy}
              value={info.storageClass}
              onChange={(event) => setInfo({ ...info, storageClass: event.target.value })}
            >
              {classes.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            自定义元数据（JSON 键值对）
            <textarea
              aria-label="自定义元数据"
              rows={5}
              disabled={busy}
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
            />
          </label>
          <p className="selection-note">
            通过服务端复制修改属性，版本控制桶会产生新版本。保存前校验 ETag；原有对象内容保持不变。
          </p>
          <button
            className="button primary"
            disabled={busy || !info.etag}
            onClick={() =>
              void run(async () => {
                await storage.feature('object:edit', {
                  ...input,
                  patch: { ...info, metadata: JSON.parse(metadata) },
                });
                await loadProperties();
                onChanged();
                setMessage('对象属性已保存');
              })
            }
          >
            保存属性
          </button>
        </>
      )}
      {tab === 'tags' && (
        <>
          <label className="field">
            对象标签（JSON，最多 10 组）
            <textarea
              aria-label="对象标签"
              rows={7}
              value={tagText}
              disabled={busy}
              onChange={(event) => setTagText(event.target.value)}
            />
          </label>
          <p className="selection-note">
            保存会替换对象标签；空对象清除全部标签。需要服务端标签读取和写入权限。
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await storage.feature('object:tags', { ...input, values: JSON.parse(tagText) });
                setMessage('对象标签已保存');
                onChanged();
              })
            }
          >
            保存标签
          </button>
        </>
      )}
      {tab === 'versions' && (
        <>
          <div className="version-list">
            {!busy && !versions.length && (
              <p className="selection-note">没有可显示的历史版本，或该桶未开启版本控制。</p>
            )}
            {versions.map((version) => (
              <div className="version-row" key={`${version.versionId}/${version.deleted}`}>
                <code title={version.versionId}>{version.versionId}</code>
                <small>
                  {dateLabel(version.lastModified)} ·{' '}
                  {version.deleted ? '删除标记' : formatBytes(version.size || 0)}
                  {version.isLatest ? ' · 当前版本' : ''}
                </small>
                {!version.deleted && (
                  <div className="feature-actions">
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await storage.feature('object:download-version', {
                            ...input,
                            versionId: version.versionId,
                          });
                          setMessage('历史版本下载已处理，请查看传输中心');
                        })
                      }
                    >
                      <Download size={13} />
                      下载此版本
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        setSelected(version);
                        setConfirmation('');
                      }}
                    >
                      <RotateCcw size={13} />
                      恢复此版本
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {cursor && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run(() => loadVersions(true))}
            >
              加载更多版本
            </button>
          )}
          {selected && (
            <div className="feature-confirm">
              <p>将版本 {selected.versionId} 复制为当前对象，替换当前内容。历史版本保留。</p>
              <label className="field">
                输入「恢复」确认
                <input
                  aria-label="恢复确认"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={busy || confirmation !== '恢复'}
                onClick={() =>
                  void run(async () => {
                    await storage.feature('object:restore-version', {
                      ...input,
                      versionId: selected.versionId,
                      confirmation,
                    });
                    setSelected(undefined);
                    await loadVersions();
                    onChanged();
                    setMessage('已恢复为当前版本');
                  })
                }
              >
                确认恢复版本
              </button>
            </div>
          )}
        </>
      )}
      {tab === 'archive' && (
        <>
          <p className="selection-note">
            当前存储类型：{info?.storageClass || object.storageClass}。解冻状态：
            {info?.restore || '未返回解冻状态'}。
          </p>
          <label className="field">
            解冻保留天数
            <input
              aria-label="解冻保留天数"
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </label>
          <label className="field">
            解冻优先级
            <select value={tier} onChange={(event) => setTier(event.target.value)}>
              <option value="Standard">标准</option>
              <option value="Bulk">批量</option>
              <option value="Expedited">加急</option>
            </select>
          </label>
          <p className="selection-note">
            解冻会产生服务商相关费用；支持的优先级和完成时间取决于存储类型。提交后可刷新状态。
          </p>
          <div className="feature-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await storage.feature('object:restore-archive', { ...input, days, tier });
                  await loadProperties();
                  setMessage('解冻请求已提交，请稍后刷新状态');
                  onChanged();
                })
              }
            >
              提交解冻请求
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run(loadProperties)}
            >
              刷新状态
            </button>
          </div>
        </>
      )}
      {busy && (
        <p className="object-info-loading">
          <Loader2 size={14} className="spin" />
          正在处理…
        </p>
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
