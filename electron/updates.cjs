const { autoUpdater } = require('electron-updater');
function setupUpdates(app) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const supported =
    app.isPackaged &&
    !process.env.PORTABLE_EXECUTABLE_FILE &&
    (process.platform !== 'linux' || !!process.env.APPIMAGE);
  let state = {
    status: !app.isPackaged ? 'development' : supported ? 'idle' : 'manual',
    currentVersion: app.getVersion(),
  };
  autoUpdater.on('checking-for-update', () => {
    state = { ...state, status: 'checking', error: undefined };
  });
  autoUpdater.on('update-available', (info) => {
    state = { ...state, status: 'available', version: info.version };
  });
  autoUpdater.on('update-not-available', () => {
    state = { ...state, status: 'latest' };
  });
  autoUpdater.on('download-progress', (progress) => {
    state = { ...state, status: 'downloading', progress: Math.round(progress.percent) };
  });
  autoUpdater.on('update-downloaded', () => {
    state = { ...state, status: 'downloaded' };
  });
  autoUpdater.on('error', () => {
    state = {
      ...state,
      status: 'error',
      error: '更新服务不可用，请稍后重试或从项目发布页下载安装包',
    };
  });
  return async function updates(action) {
    if (!['status', 'check', 'download', 'install'].includes(action))
      throw new Error('更新操作无效');
    if (action === 'status') return state;
    if (!supported)
      throw new Error('当前分发形式不执行自动更新，请使用受支持的安装版或手动下载新版');
    if (action === 'check') {
      try {
        await autoUpdater.checkForUpdates();
      } catch {}
    }
    if (action === 'download') {
      if (state.status !== 'available') throw new Error('请先检查可用更新');
      await autoUpdater.downloadUpdate();
    }
    if (action === 'install') {
      if (state.status !== 'downloaded') throw new Error('请先下载更新');
      autoUpdater.quitAndInstall(false, true);
    }
    return state;
  };
}
module.exports = { setupUpdates };
