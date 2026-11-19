import { Check, Copy, Download, Eye, FileQuestion, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import type { Preview, StorageObject } from '../types';
import { dateLabel, extension, formatBytes } from '../lib/objects';
import { ObjectIcon } from './ObjectIcon';
export function PreviewPanel({
  object,
  preview,
  loading,
  error,
  onClose,
  onDownload,
  bucket,
}: {
  object?: StorageObject;
  preview?: Preview;
  loading: boolean;
  error?: string;
  onClose(): void;
  onDownload(): void;
  bucket: string;
}) {
  const [tab, setTab] = useState<'preview' | 'info'>('preview');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(object!.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }
  return (
    <aside className="inspector" aria-label="文件预览">
      <div className="inspector-heading">
        <strong>文件详情</strong>
        <button className="icon-button" aria-label="关闭预览" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {!object ? (
        <div className="inspector-empty">
          <span className="empty-preview-icon">
            <Eye size={28} strokeWidth={1.2} />
          </span>
          <h3>每个文件，都有细节</h3>
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
          <div className="metadata">
            <div className="section-label">对象信息</div>
            <dl>
              <div>
                <dt>文件大小</dt>
                <dd>{formatBytes(preview?.size ?? object.size)}</dd>
              </div>
              <div>
                <dt>存储类型</dt>
                <dd>{object.storageClass === 'Standard' ? '标准存储' : object.storageClass}</dd>
              </div>
              <div>
                <dt>最后修改</dt>
                <dd>{dateLabel(object.lastModified)}</dd>
              </div>
              <div>
                <dt>存储桶</dt>
                <dd>{bucket}</dd>
              </div>
            </dl>
            <div className="path-label">
              对象路径
              <button
                className="icon-button"
                onClick={copy}
                title={copied ? '已复制' : '复制对象路径'}
                aria-label="复制对象路径"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <code className="object-path">{object.key}</code>
            {tab === 'info' && object.etag && (
              <>
                <div className="path-label">ETag</div>
                <code className="object-path">{object.etag}</code>
              </>
            )}
          </div>
          <div className="inspector-footer">
            <button className="button secondary" onClick={onDownload}>
              <Download size={15} />
              下载文件
            </button>
            <span>
              <span className="status-dot" />
              通过安全连接访问
            </span>
          </div>
        </>
      )}
    </aside>
  );
}
