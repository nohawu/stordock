import { useEffect, useState } from 'react';
import { storage } from '../lib/storage';
type State = {
  status: string;
  currentVersion: string;
  version?: string;
  progress?: number;
  error?: string;
};
export function UpdateControls() {
  const [state, setState] = useState<State>(),
    [error, setError] = useState('');
  async function action(value: string) {
    try {
      setError('');
      setState(await storage.feature<State>('updates', { action: value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新操作失败');
    }
  }
  useEffect(() => {
    void action('status');
    const timer = setInterval(() => void action('status'), 2000);
    return () => clearInterval(timer);
  }, []);
  if (!window.ossDesk) return null;
  return (
    <div className="update-controls">
      <strong>客户端更新{state ? ` · ${state.currentVersion}` : ''}</strong>
      <p className="selection-note">
        {error ||
          state?.error ||
          {
            idle: '手动检查新版本',
            development: '开发模式，更新功能在安装版中可用',
            manual: '当前分发形式请从项目发布页手动下载新版',
            checking: '正在检查更新…',
            latest: '当前已是最新版本',
            available: `发现 ${state?.version}，可下载后安装`,
            downloading: `下载更新 ${state?.progress || 0}%`,
            downloaded: '更新已下载，可以重启安装',
          }[state?.status || 'idle']}
      </p>
      <div className="feature-actions">
        <button
          className="button secondary"
          disabled={
            !state || ['development', 'manual', 'checking', 'downloading'].includes(state.status)
          }
          onClick={() => void action('check')}
        >
          检查更新
        </button>
        {state?.status === 'available' && (
          <button className="button primary" onClick={() => void action('download')}>
            下载更新
          </button>
        )}
        {state?.status === 'downloaded' && (
          <button className="button primary" onClick={() => void action('install')}>
            重启并安装
          </button>
        )}
      </div>
    </div>
  );
}
