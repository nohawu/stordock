import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  CircleAlert,
  HardDriveDownload,
  Loader2,
  Trash2,
  RotateCcw,
  X,
  Files,
} from 'lucide-react';
import { useState } from 'react';
import type { Transfer } from '../types';
import { formatBytes } from '../lib/objects';
import { isActiveTransfer, directionLabel } from '../lib/transfers';
export function Transfers({
  transfers,
  onClear,
  onCancel,
  onRetry,
}: {
  transfers: Transfer[];
  onClear(): void;
  onCancel(id: string): void;
  onRetry(id: string): void;
}) {
  const [filter, setFilter] = useState('all');
  const visible = transfers.filter(
    (t) =>
      filter === 'all' ||
      (filter === 'running'
        ? isActiveTransfer(t)
        : ['completed', 'failed', 'cancelled', 'skipped'].includes(filter)
          ? t.status === filter
          : t.direction === filter),
  );
  const running = transfers.filter(isActiveTransfer).length;
  return (
    <div className="transfers-page">
      <div className="page-heading">
        <div>
          <h1>传输中心</h1>
          <p>查看本次会话的上传和下载任务</p>
        </div>
        <button
          className="button secondary"
          disabled={!transfers.some((t) => !isActiveTransfer(t))}
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
          <strong>{running ? `${running} 个任务正在传输` : '没有正在进行的传输'}</strong>
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
            ['failed', '失败'],
            ['completed', '已完成'],
            ['cancelled', '已取消'],
            ['skipped', '已跳过'],
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
            <h3>{filter === 'all' ? '没有传输任务' : '没有符合条件的任务'}</h3>
            <p>
              {filter === 'all'
                ? '上传或下载文件后，可以在这里查看进度和结果。'
                : '切换筛选条件，查看其他传输记录。'}
            </p>
          </div>
        ) : (
          visible.map((t) => (
            <div className="transfer-row" key={t.id}>
              <span className={`transfer-direction ${t.direction}`}>
                {t.direction === 'upload' ? (
                  <ArrowUpFromLine size={20} />
                ) : t.direction === 'download' ? (
                  <ArrowDownToLine size={20} />
                ) : (
                  <Files size={20} />
                )}
              </span>
              <div className="transfer-detail">
                <strong>{t.name}</strong>
                <small>
                  {t.bucket} <span>·</span> {formatBytes(t.size)} <span>·</span> {directionLabel(t)}
                </small>
                {isActiveTransfer(t) && (
                  <div className="progress-track">
                    <i style={{ width: `${t.progress}%` }} />
                  </div>
                )}
                {t.error && <p className="error-text">{t.error}</p>}
              </div>
              <span className={`transfer-status ${t.status}`}>
                {isActiveTransfer(t) ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    {t.status === 'cancelling' ? '取消中…' : `${t.progress}%`}
                  </>
                ) : t.status === 'completed' ? (
                  <>
                    <CheckCircle2 size={15} />
                    已完成
                  </>
                ) : t.status === 'failed' ? (
                  <>
                    <CircleAlert size={15} />
                    传输失败
                  </>
                ) : (
                  <>{t.status === 'cancelled' ? '已取消' : '已跳过'}</>
                )}
              </span>
              {isActiveTransfer(t) ? (
                <button
                  className="icon-button"
                  aria-label={`取消任务 ${t.name}`}
                  disabled={t.status === 'cancelling'}
                  onClick={() => onCancel(t.id)}
                >
                  <X size={14} />
                </button>
              ) : ['failed', 'cancelled'].includes(t.status) ? (
                <button
                  className="button mini"
                  aria-label={`重试任务 ${t.name}`}
                  onClick={() => onRetry(t.id)}
                >
                  <RotateCcw size={13} />
                  重试
                </button>
              ) : (
                <span className="transfer-action-placeholder" />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
