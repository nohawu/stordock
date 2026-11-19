import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  CircleAlert,
  HardDriveDownload,
  Loader2,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { Transfer } from '../types';
import { formatBytes } from '../lib/objects';
export function Transfers({ transfers, onClear }: { transfers: Transfer[]; onClear(): void }) {
  const [filter, setFilter] = useState('all');
  const visible = transfers.filter(
    (t) =>
      filter === 'all' || (filter === 'running' ? t.status === 'running' : t.direction === filter),
  );
  const running = transfers.filter((t) => t.status === 'running').length;
  return (
    <div className="transfers-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">TRANSFER CENTER</div>
          <h1>
            传输中心<span className="heading-dot">.</span>
          </h1>
          <p>云端与本地，每一次传输都有迹可循。</p>
        </div>
        <button
          className="button secondary"
          disabled={!transfers.some((t) => t.status !== 'running')}
          onClick={onClear}
        >
          <Trash2 size={15} />
          清除已结束
        </button>
      </div>
      <div className="transfer-summary">
        <span className="summary-symbol">
          <HardDriveDownload size={26} />
        </span>
        <div>
          <strong>{running ? `${running} 个任务正在传输` : '一切就绪，等待下一次传输'}</strong>
          <p>
            {transfers.length} 个任务 · {transfers.filter((t) => t.status === 'completed').length}{' '}
            个已完成
          </p>
        </div>
      </div>
      <div className="file-toolbar">
        <div className="filter-tabs">
          {[
            ['all', '全部任务'],
            ['running', '传输中'],
            ['upload', '上传'],
            ['download', '下载'],
          ].map(([value, name]) => (
            <button
              key={value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="transfer-list">
        {!visible.length ? (
          <div className="large-empty">
            <HardDriveDownload size={38} strokeWidth={1.2} />
            <h3>这里还很安静</h3>
            <p>上传或下载文件后，可以在这里查看进度和结果。</p>
          </div>
        ) : (
          visible.map((t) => (
            <div className="transfer-row" key={t.id}>
              <span className={`transfer-direction ${t.direction}`}>
                {t.direction === 'upload' ? (
                  <ArrowUpFromLine size={20} />
                ) : (
                  <ArrowDownToLine size={20} />
                )}
              </span>
              <div className="transfer-detail">
                <strong>{t.name}</strong>
                <small>
                  {t.bucket} <span>·</span> {formatBytes(t.size)} <span>·</span>{' '}
                  {t.direction === 'upload' ? '上传' : '下载'}
                </small>
                {t.status === 'running' && (
                  <div className="progress-track">
                    <i style={{ width: `${t.progress}%` }} />
                  </div>
                )}
                {t.error && <p className="error-text">{t.error}</p>}
              </div>
              <span className={`transfer-status ${t.status}`}>
                {t.status === 'running' ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    {t.progress}%
                  </>
                ) : t.status === 'completed' ? (
                  <>
                    <CheckCircle2 size={15} />
                    已完成
                  </>
                ) : (
                  <>
                    <CircleAlert size={15} />
                    传输失败
                  </>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
