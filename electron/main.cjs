const { app, BrowserWindow, ipcMain, dialog, protocol, net, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ConnectionVault } = require('./vault.cjs');
const { validateConnection, safeFilename } = require('./core.cjs');
const { AliyunProvider, friendlyError } = require('./oss.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'ossdesk', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (!app.isPackaged && process.env.OSS_DESK_TEST_DATA)
  app.setPath('userData', process.env.OSS_DESK_TEST_DATA);
let mainWindow;
let vault;
const provider = new AliyunProvider();
const uploadGrants = new Set();
const bucketRegions = new Map();
function rememberBuckets(id, buckets) {
  for (const bucket of buckets) bucketRegions.set(id + '/' + bucket.name, bucket.region);
  return buckets;
}
let vaultQueue = Promise.resolve();
const serialize = (operation) => {
  const next = vaultQueue.then(operation);
  vaultQueue = next.catch(() => {});
  return next;
};
function trusted(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  )
    throw new Error('请求来源无效');
  const url = new URL(event.senderFrame.url);
  if (
    !(url.protocol === 'ossdesk:' && url.host === 'app') &&
    !(process.env.OSS_DESK_DEV_URL && url.origin === 'http://127.0.0.1:5173')
  )
    throw new Error('请求来源无效');
}
function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      trusted(event);
      return await handler(...args);
    } catch (error) {
      throw new Error(friendlyError(error));
    }
  });
}
async function connectionFor(id, bucket) {
  const connection = await vault.get(id);
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error('Bucket 名称无效');
  if (connection.bucket && connection.bucket !== bucket)
    throw new Error('此连接仅允许访问配置的 Bucket');
  return { ...connection, region: bucketRegions.get(id + '/' + bucket) || connection.region };
}
function emit(transfer) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('transfer:progress', transfer);
}
function setupHandlers() {
  handle('connections:list', () => vault.list());
  handle('connections:save', (input) =>
    serialize(async () => {
      const connection = validateConnection(input);
      await provider.buckets(connection);
      return vault.save(connection);
    }),
  );
  handle('connections:test', async (input) => ({
    buckets: await provider.buckets(validateConnection(input)),
  }));
  handle('connections:remove', (id) => serialize(() => vault.remove(id)));
  handle('storage:buckets', async (id) =>
    rememberBuckets(id, await provider.buckets(await vault.get(id))),
  );
  handle('storage:list', async (request) => {
    if (
      !request ||
      typeof request.prefix !== 'string' ||
      request.prefix.length > 1023 ||
      (request.query && (typeof request.query !== 'string' || request.query.length > 200))
    )
      throw new Error('搜索参数无效');
    return provider.list(await connectionFor(request.connectionId, request.bucket), request);
  });
  handle('storage:preview', async (id, bucket, object) =>
    provider.preview(await connectionFor(id, bucket), bucket, object),
  );
  handle('storage:folder', async (id, bucket, prefix, name) => {
    if (typeof prefix !== 'string') throw new Error('目录路径无效');
    return provider.createFolder(await connectionFor(id, bucket), bucket, prefix, name);
  });
  ipcMain.on('files:grant', (event, filePath) => {
    try {
      trusted(event);
      if (typeof filePath === 'string' && path.isAbsolute(filePath)) uploadGrants.add(filePath);
    } catch {}
  });
  handle('files:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => {
      uploadGrants.add(filePath);
      return { path: filePath, name: path.basename(filePath) };
    });
  });
  handle('storage:upload', async (id, bucket, prefix, items) => {
    if (!Array.isArray(items) || !items.length || items.length > 500 || typeof prefix !== 'string')
      throw new Error('请选择 1–500 个上传文件');
    for (const item of items)
      if (!uploadGrants.has(item.path)) throw new Error('请通过文件选择器或拖放重新选择文件');
    const connection = await connectionFor(id, bucket);
    await provider.upload(connection, bucket, prefix, items, emit);
    for (const item of items) uploadGrants.delete(item.path);
  });
  handle('storage:download', async (id, bucket, objects) => {
    if (
      !Array.isArray(objects) ||
      !objects.length ||
      objects.length > 500 ||
      objects.some((o) => o.kind !== 'file')
    )
      throw new Error('请选择 1–500 个文件下载');
    const connection = await connectionFor(id, bucket);
    if (objects.length === 1) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存文件',
        defaultPath: safeFilename(objects[0].key),
      });
      if (!result.canceled && result.filePath)
        await provider.download(connection, bucket, objects, result.filePath, emit);
    } else {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择下载目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (!result.canceled && result.filePaths[0])
        await provider.download(connection, bucket, objects, result.filePaths[0], emit, true);
    }
  });
}
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: process.env.OSS_DESK_SMOKE !== '1',
    title: 'StorDock',
    icon: path.join(__dirname, '../build/icon.png'),
    backgroundColor: '#f7f8fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (process.env.OSS_DESK_DEV_URL === 'http://127.0.0.1:5173' && !app.isPackaged)
    await mainWindow.loadURL(process.env.OSS_DESK_DEV_URL);
  else await mainWindow.loadURL('ossdesk://app/index.html');
}
app.whenReady().then(async () => {
  protocol.handle('ossdesk', (request) => {
    const url = new URL(request.url);
    const dist = path.resolve(__dirname, '../dist');
    const file = path.resolve(
      dist,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
    );
    if (url.host !== 'app' || !file.startsWith(`${dist}${path.sep}`))
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  vault = new ConnectionVault(app.getPath('userData'), require('electron').safeStorage);
  setupHandlers();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
