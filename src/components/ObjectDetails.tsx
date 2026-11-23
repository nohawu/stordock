import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import type { Connection, ObjectInfo, StorageObject } from '../types';
import { storage } from '../lib/storage';
import { copyText } from '../lib/clipboard';
import { objectAddress } from '../lib/addresses';
import { dateLabel, formatBytes } from '../lib/objects';
import { DEMO_ID } from '../lib/demo';

function CopyableInfo({
  label,
  value,
  onCopyError,
}: {
  label: string;
  value: string;
  onCopyError(): void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await copyText(value);
      setCopied(true);
    } catch {
      onCopyError();
    }
  }
  return (
    <div className="object-info-field">
      <div className="path-label">
        {label}
        <button
          className="icon-button"
          aria-label={`复制${label}`}
          title={copied ? '已复制' : `复制${label}`}
          onClick={() => void copy()}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <code className="object-path">{value}</code>
    </div>
  );
}

export function ObjectDetails({
  object,
  connection,
  bucket,
  region,
  active,
  previewSize,
  onCopyError,
}: {
  object: StorageObject;
  connection?: Connection;
  bucket: string;
  region: string;
  active: boolean;
  previewSize?: number;
  onCopyError(): void;
}) {
  const [info, setInfo] = useState<ObjectInfo>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const isDemo = connection?.id === DEMO_ID;
  useEffect(() => {
    if (!active || !connection || object.kind === 'folder') return;
    let alive = true;
    setInfo(undefined);
    setError('');
    setLoading(true);
    void storage
      .objectInfo(connection.id, bucket, object.key)
      .then((result) => {
        if (alive) setInfo(result);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : '对象信息加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active, connection?.id, bucket, object.key, object.etag, object.lastModified, revision]);
  let address: ReturnType<typeof objectAddress> | undefined;
  if (connection && !isDemo) {
    try {
      address = objectAddress({ ...connection, region }, bucket, object.key);
    } catch {
      /* Validated connection details may still be unavailable while a tab is closing. */
    }
  }
  const size = info?.size ?? previewSize ?? object.size;
  const storageClass = info?.storageClass || object.storageClass;
  const uriLabel = connection?.provider === 's3' ? 'S3 URI' : 'OSS URI';
  const details: [string, string | undefined][] = [
    ['Content-Type', info?.contentType],
    ['Cache-Control', info?.cacheControl],
    ['Content-Disposition', info?.contentDisposition],
    ['Content-Encoding', info?.contentEncoding],
    ['Content-Language', info?.contentLanguage],
    ['版本 ID', info?.versionId],
    ['解冻状态', info?.restore],
  ];
  return (
    <div className="metadata">
      <div className="section-label">对象信息</div>
      <dl>
        {object.kind === 'file' && (
          <>
            <div>
              <dt>文件大小</dt>
              <dd title={`${size} 字节`}>
                {formatBytes(size)}
                {active && <small className="exact-file-size">{size.toLocaleString()} 字节</small>}
              </dd>
            </div>
            <div>
              <dt>存储类型</dt>
              <dd>{['Standard', 'STANDARD'].includes(storageClass) ? '标准存储' : storageClass}</dd>
            </div>
            <div>
              <dt>最后修改</dt>
              <dd>{dateLabel(info?.lastModified || object.lastModified)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>存储桶</dt>
          <dd>{bucket}</dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{region}</dd>
        </div>
        {connection && (
          <div>
            <dt>连接</dt>
            <dd>
              {connection.name} · {isDemo ? '演示' : connection.provider === 's3' ? 'S3' : 'OSS'}
            </dd>
          </div>
        )}
      </dl>
      <CopyableInfo label="对象路径" value={object.key} onCopyError={onCopyError} />
      {address && (
        <>
          {object.kind === 'file' && (
            <>
              <CopyableInfo label="HTTP 链接" value={address.httpUrl} onCopyError={onCopyError} />
              <p className="selection-note">未签名地址；私有对象请使用「分享文件」生成临时链接。</p>
            </>
          )}
          <CopyableInfo label={uriLabel} value={address.uri} onCopyError={onCopyError} />
        </>
      )}
      {isDemo && <p className="selection-note">本地演示空间，不提供真实 HTTP 访问地址。</p>}
      {object.kind === 'folder' && <p className="selection-note">双击文件夹或按 Enter 进入。</p>}
      {active && (
        <>
          <CopyableInfo
            label="完整对象路径"
            value={`${bucket}/${object.key}`}
            onCopyError={onCopyError}
          />
          {address && (
            <CopyableInfo label="Endpoint" value={address.endpoint} onCopyError={onCopyError} />
          )}
          {(info?.etag || object.etag) && (
            <CopyableInfo
              label="ETag"
              value={info?.etag || object.etag!}
              onCopyError={onCopyError}
            />
          )}
          {loading && (
            <div className="object-info-loading" role="status">
              <Loader2 size={13} className="spin" />
              正在读取对象属性…
            </div>
          )}
          {error && (
            <div className="object-info-error" role="alert">
              <p>{error}</p>
              <button
                className="button secondary"
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw size={13} />
                重新读取属性
              </button>
            </div>
          )}
          {details
            .filter(([, value]) => value !== undefined)
            .map(([label, value]) => (
              <CopyableInfo key={label} label={label} value={value!} onCopyError={onCopyError} />
            ))}
          {info && Object.keys(info.metadata).length > 0 && (
            <div className="object-custom-metadata">
              <div className="section-label">自定义元数据</div>
              {Object.entries(info.metadata).map(([name, value]) => (
                <CopyableInfo key={name} label={name} value={value} onCopyError={onCopyError} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
