import { Download, Eye, FileQuestion, Files, Loader2, RefreshCw, X, Link } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Connection, Preview, StorageObject } from '../types';
import { extension, formatBytes } from '../lib/objects';
import { ObjectIcon } from './ObjectIcon';
import { ObjectDetails } from './ObjectDetails';
export function PreviewPanel({
  object,
  selection,
  preview,
  loading,
  error,
  onClose,
  onDownload,
  bucket,
  downloadBusy,
  onRetry,
  onCopyError,
  previewVersion,
  onShare,
  onManage,
  connection,
  region,
}: {
  object?: StorageObject;
  selection: StorageObject[];
  preview?: Preview;
  loading: boolean;
  error?: string;
  onClose(): void;
  onDownload(): void;
  bucket: string;
  connection?: Connection;
  region: string;
  downloadBusy: boolean;
  onRetry(): void;
  onCopyError(): void;
  previewVersion: number;
  onShare?: () => void;
  onManage?: () => void;
}) {
  const [tab, setTab] = useState<'preview' | 'info'>('preview');
  useEffect(() => {
    setTab('preview');
  }, [previewVersion]);
  const single = selection.length === 1 ? selection[0] : undefined;
  const selectedFiles = selection.filter((item) => item.kind === 'file');
  return (
    <aside className="inspector" aria-label="文件预览">
      <div className="inspector-heading">
        <strong>
          <Eye size={14} /> 文件详情
        </strong>
        <button className="icon-button" aria-label="关闭预览" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {selection.length > 1 ? (
        <>
          <div className="inspector-selection">
            <Files size={30} strokeWidth={1.3} />
            <h3>已选择 {selection.length} 项</h3>
            <p>
              {selectedFiles.length} 个文件 · {selection.length - selectedFiles.length} 个文件夹
            </p>
          </div>
          <div className="metadata">
            <div className="section-label">选择摘要</div>
            <dl>
              <div>
                <dt>文件总大小</dt>
                <dd>{formatBytes(selectedFiles.reduce((sum, item) => sum + item.size, 0))}</dd>
              </div>
              <div>
                <dt>存储桶</dt>
                <dd>{bucket}</dd>
              </div>
            </dl>
            <p className="selection-note">大小仅统计所选文件，不包含文件夹内的内容。</p>
          </div>
          <div className="inspector-footer">
            <button
              className="button secondary"
              disabled={downloadBusy || !selection.length}
              onClick={onDownload}
            >
              <Download size={15} />
              下载所选 ({selection.length})
            </button>
          </div>
        </>
      ) : single?.kind === 'folder' ? (
        <>
          <div className="inspector-file">
            <ObjectIcon object={single} size={28} />
            <h3>{single.name}</h3>
            <span>文件夹</span>
          </div>
          <ObjectDetails
            key={`${connection?.id}/${bucket}/${single.key}`}
            object={single}
            connection={connection}
            bucket={bucket}
            region={region}
            active={false}
            onCopyError={onCopyError}
          />
          <div className="inspector-footer">
            <button className="button secondary" disabled={downloadBusy} onClick={onDownload}>
              <Download size={15} />
              下载文件夹
            </button>
          </div>
        </>
      ) : !object ? (
        <div className="inspector-empty">
          <span className="empty-preview-icon">
            <Eye size={28} strokeWidth={1.2} />
          </span>
          <h3>未选择文件</h3>
          <p>
            选择一个文件，即可查看
            <br />
            内容预览与对象信息
          </p>
          <span className="subtle-note">图片 · 文本 · JSON · Markdown</span>
        </div>
      ) : (
        <>
          <div className="inspector-file">
            <ObjectIcon object={object} size={22} />
            <h3 title={object.name}>{object.name}</h3>
            <span>
              {extension(object.name).toUpperCase()} 文件 <i /> {formatBytes(object.size)}
            </span>
          </div>
          <div className="inspector-tabs">
            <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>
              内容预览
            </button>
            <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>
              对象信息
            </button>
          </div>
          {tab === 'preview' && (
            <div className="preview-content">
              {loading ? (
                <div className="preview-placeholder">
                  <Loader2 className="spin" size={24} />
                  <p>正在读取文件…</p>
                </div>
              ) : error ? (
                <div className="preview-placeholder error-text">
                  <FileQuestion size={28} />
                  <p>{error}</p>
                  <button className="button secondary" onClick={onRetry}>
                    <RefreshCw size={14} />
                    重新预览
                  </button>
                </div>
              ) : preview?.kind === 'image' ? (
                <>
                  <div className="image-preview">
                    <img src={preview.content} alt={object.name} />
                  </div>
                  <span className="preview-caption">
                    <Eye size={12} /> 图片预览
                  </span>
                </>
              ) : preview?.kind === 'text' ? (
                <pre className="text-preview">{preview.content}</pre>
              ) : (
                <div className="preview-placeholder">
                  <FileQuestion size={30} strokeWidth={1.3} />
                  <strong>暂不支持在线预览</strong>
                  <p>图片支持 10 MB 以内，文本支持 1 MB 以内。其他文件可下载后查看。</p>
                </div>
              )}
            </div>
          )}
          <ObjectDetails
            key={`${connection?.id}/${bucket}/${object.key}/${object.etag}/${object.lastModified}`}
            object={object}
            connection={connection}
            bucket={bucket}
            region={region}
            active={tab === 'info'}
            previewSize={preview?.size}
            onCopyError={onCopyError}
          />
          <div className="inspector-footer">
            <button className="button secondary" disabled={downloadBusy} onClick={onDownload}>
              <Download size={15} />
              下载文件
            </button>
            {onManage && (
              <button className="button secondary" onClick={onManage}>
                管理属性、版本与归档
              </button>
            )}
            {onShare && (
              <button className="button secondary" onClick={onShare}>
                <Link size={15} />
                分享文件
              </button>
            )}
            <span>
              <span className="status-dot" />
              {connection?.id === 'demo-studio'
                ? '本地演示空间'
                : connection?.endpoint.startsWith('http:')
                  ? 'HTTP 连接'
                  : 'TLS 加密连接'}
            </span>
          </div>
        </>
      )}
    </aside>
  );
}
