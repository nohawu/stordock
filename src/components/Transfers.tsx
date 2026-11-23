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
  FolderOpen,
  Pause,
  Play,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Transfer } from '../types';
import { formatBytes } from '../lib/objects';
import { isActiveTransfer, directionLabel } from '../lib/transfers';
import { storage } from '../lib/storage';
export function Transfers({
  transfers,
  onClear,
  onCancel,
  onRetry,
  onPause,
  onReveal,
}: {
  transfers: Transfer[];
  onClear(): void;
  onCancel(id: string): void;
  onRetry(id: string): void;
  onPause(id: string): void;
  onReveal(id: string): void;
}) {
  const [filter, setFilter] = useState('all');
  const [concurrency, setConcurrency] = useState(3);
  const [configError, setConfigError] = useState('');
  const [configBusy, setConfigBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void storage
      .getTransferConcurrency()
      .then((value) => {
        if (alive) setConcurrency(value);
      })
      .catch((error) => {
        if (alive) setConfigError(error.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function changeConcurrency(value: number) {
    setConfigBusy(true);
    setConfigError('');
    try {
      setConcurrency(await storage.setTransferConcurrency(value));
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : '设置失败');
    } finally {
      setConfigBusy(false);
    }
  }
  const visible = transfers.filter(
    (t) =>
      filter === 'all' ||
      (filter === 'running'
        ? isActiveTransfer(t)
        : ['completed', 'failed', 'cancelled', 'skipped', 'paused'].includes(filter)
          ? t.status === filter
          : t.direction === filter),
  );
  const running = transfers.filter(isActiveTransfer).length;
  return (
    <div className="transfers-page">
      <div className="page-heading">
        <div>
          <h1>传输中心</h1>
          <p>管理传输进度，继续未完成的任务或打开下载位置</p>
        </div>
        <div className="transfer-controls">
          {window.ossDesk && (
            <label>
              同时传输{' '}
              <select
                aria-label="同时传输数"
                value={concurrency}
                disabled={configBusy}
                onChange={(event) => void changeConcurrency(Number(event.target.value))}
              >
                {Array.from({ length: 8 }, (_, index) => (
                  <option key={index} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button secondary"
            disabled={!transfers.some((t) => !isActiveTransfer(t) && t.status !== 'paused')}
            onClick={onClear}
          >
            <Trash2 size={15} />
            清除已结束
          </button>
        </div>
      </div>
      {configError && (
        <p className="error-text" role="alert">
          {configError}
        </p>
      )}
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
            ['paused', '已暂停'],
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
                <strong>
                  {t.status === 'completed' && t.direction === 'download' && t.localPath ? (
                    <button
                      className="transfer-filename"
                      title="打开所在目录"
                      onClick={() => onReveal(t.id)}
                    >
                      {t.name}
                    </button>
                  ) : (
                    t.name
                  )}
                </strong>
                <small>
                  {t.bucket} <span>·</span> {formatBytes(t.size)} <span>·</span> {directionLabel(t)}
                </small>
                {isActiveTransfer(t) && (
                  <div className="progress-track">
                    <i style={{ width: `${t.progress}%` }} />
                  </div>
                )}
                {t.error && <p className="error-text">{t.error}</p>}
                {isActiveTransfer(t) && !!t.speed && (
                  <small>
                    {formatBytes(t.speed)}/s
                    {t.remaining !== undefined
                      ? ` · 剩余约 ${t.remaining < 60 ? `${t.remaining} 秒` : `${Math.ceil(t.remaining / 60)} 分钟`}`
                      : ''}
                  </small>
                )}
                {t.localPath && t.status === 'completed' && (
                  <small title={t.localPath}>{t.localPath}</small>
                )}
              </div>
              <span className={`transfer-status ${t.status}`}>
                {isActiveTransfer(t) ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    {t.status === 'cancelling'
                      ? '正在停止…'
                      : t.status === 'queued'
                        ? '等待传输'
                        : `${t.progress}%`}
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
                  <>
                    {t.status === 'paused'
                      ? '已暂停'
                      : t.status === 'cancelled'
                        ? '已取消'
                        : '已跳过'}
                  </>
                )}
              </span>
              <div className="transfer-actions">
                {isActiveTransfer(t) &&
                  t.status !== 'cancelling' &&
                  t.canPause !== false &&
                  !t.id.startsWith('demo-') &&
                  ['upload', 'download'].includes(t.direction) && (
                    <button
                      className="icon-button"
                      aria-label={`暂停任务 ${t.name}`}
                      title="暂停"
                      onClick={() => onPause(t.id)}
                    >
                      <Pause size={14} />
                    </button>
                  )}
                {t.status === 'completed' && t.direction === 'download' && t.localPath && (
                  <button
                    className="icon-button reveal-download"
                    aria-label={`打开保存目录 ${t.name}`}
                    title={`打开所在目录：${t.localPath}`}
                    onClick={() => onReveal(t.id)}
                  >
                    <FolderOpen size={17} />
                  </button>
                )}
                {t.status === 'paused' && (
                  <button
                    className="icon-button"
                    aria-label={`取消任务 ${t.name}`}
                    title="取消并清理临时文件或分片"
                    onClick={() => onCancel(t.id)}
                  >
                    <X size={14} />
                  </button>
                )}
                {isActiveTransfer(t) ? (
                  <button
                    className="icon-button"
                    aria-label={`取消任务 ${t.name}`}
                    disabled={t.status === 'cancelling'}
                    onClick={() => onCancel(t.id)}
                  >
                    <X size={14} />
                  </button>
                ) : ['failed', 'cancelled', 'paused'].includes(t.status) ? (
                  <button
                    className="button mini"
                    aria-label={`${t.status === 'paused' ? '继续任务' : '重试任务'} ${t.name}`}
                    disabled={t.canRetry === false}
                    title={t.canRetry === false ? '请重新选择对象并确认操作' : undefined}
                    onClick={() => onRetry(t.id)}
                  >
                    {t.status === 'paused' ? <Play size={13} /> : <RotateCcw size={13} />}
                    {t.status === 'paused' ? '继续' : '重试'}
                  </button>
                ) : (
                  <span className="transfer-action-placeholder" />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
