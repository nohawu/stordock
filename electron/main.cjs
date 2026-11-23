const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  session,
  nativeTheme,
  shell,
  clipboard,
} = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { ConnectionVault } = require('./vault.cjs');
const { validateConnection, validateBucket, safeFilename, ensureKey } = require('./core.cjs');
const { friendlyError } = require('./oss.cjs');
const { providerFor } = require('./providers.cjs');
const { taskManager } = require('./tasks.cjs');
const { collectUploads, downloadEntries } = require('./files.cjs');
const { expandObjects } = require('./operations.cjs');
const { randomUUID } = require('node:crypto');
const { CredentialRefresh } = require('./credentials.cjs');
const { setupFeatures } = require('./features.cjs');
const { setupUpdates } = require('./updates.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'ossdesk', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (!app.isPackaged && process.env.OSS_DESK_TEST_DATA)
  app.setPath('userData', process.env.OSS_DESK_TEST_DATA);
const profileDirectory = app.commandLine.getSwitchValue('user-data-dir');
if (profileDirectory && path.isAbsolute(profileDirectory))
  app.setPath('userData', profileDirectory);
let mainWindow;
let vault;
let refresh;
const uploadGrants = new Set();
const bucketRegions = new Map();
const operationPlans = new Map();
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
  const connection = await refresh.get(id);
  validateBucket(bucket, connection.provider || 'aliyun');
  if (connection.bucket && connection.bucket !== bucket)
    throw new Error('此连接仅允许访问配置的 Bucket');
  providerFor(connection).resolveConnection = connectionFor;
  return { ...connection, region: bucketRegions.get(id + '/' + bucket) || connection.region };
}
function emit(transfer) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('transfer:progress', transfer);
}
function setupHandlers() {
  handle('clipboard:write', async (value) => {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1024 * 1024)
      throw new Error('复制内容无效或超出 1 MB 限制');
    await clipboard.writeText(value);
  });
  async function connectionInput(input) {
    if (input?.id && input.keepCredentials) {
      const previous = await vault.get(input.id);
      const sameIdentity =
        (input.provider || 'aliyun') === (previous.provider || 'aliyun') &&
        input.accessKeyId === previous.accessKeyId;
      input = {
        ...input,
        accessKeySecret: input.accessKeySecret || (sameIdentity ? previous.accessKeySecret : ''),
        credentialRefreshToken:
          input.credentialRefreshToken ||
          (input.credentialRefreshUrl === previous.credentialRefreshUrl
            ? previous.credentialRefreshToken
            : ''),
        stsToken: input.clearStsToken
          ? ''
          : input.stsToken || (sameIdentity ? previous.stsToken : ''),
      };
    }
    return validateConnection(input);
  }
  handle('window:appearance', (theme) => {
    if (theme !== 'light' && theme !== 'dark') throw new Error('外观主题无效');
    nativeTheme.themeSource = theme;
    mainWindow.setBackgroundColor(theme === 'dark' ? '#131416' : '#ffffff');
    if (process.platform !== 'darwin')
      mainWindow.setTitleBarOverlay({
        color: theme === 'dark' ? '#19191c' : '#fafafa',
        symbolColor: theme === 'dark' ? '#d7d7db' : '#525252',
        height: 43,
      });
  });
  handle('connections:list', () => vault.list());
  handle('connections:save', (input) =>
    serialize(async () => {
      let connection = await connectionInput(input);
      if (connection.credentialRefreshUrl) connection = await refresh.refresh(connection, false);
      await providerFor(connection).buckets(connection);
      for (const [key, value] of operationPlans)
        if (value.id === connection.id) operationPlans.delete(key);
      for (const key of bucketRegions.keys())
        if (key.startsWith(connection.id + '/')) bucketRegions.delete(key);
      refresh.invalidate(connection.id);
      return vault.save(connection);
    }),
  );
  handle('connections:test', async (input) => {
    let connection = await connectionInput(input);
    if (connection.credentialRefreshUrl) connection = await refresh.refresh(connection, false);
    return { buckets: await providerFor(connection).buckets(connection) };
  });
  handle('connections:remove', (id) => serialize(() => vault.remove(id)));
  handle('storage:buckets', async (id) => {
    const connection = await refresh.get(id);
    return rememberBuckets(id, await providerFor(connection).buckets(connection));
  });
  handle('storage:list', async (request) => {
    if (
      !request ||
      typeof request.prefix !== 'string' ||
      request.prefix.length > 1024 ||
      (request.query && (typeof request.query !== 'string' || request.query.length > 200))
    )
      throw new Error('搜索参数无效');
    const connection = await connectionFor(request.connectionId, request.bucket);
    if (request.prefix) ensureKey(request.prefix, connection.provider === 's3' ? 1024 : 1023);
    return providerFor(connection).list(connection, request);
  });
  handle('storage:preview', async (id, bucket, object) => {
    const connection = await connectionFor(id, bucket);
    return providerFor(connection).preview(connection, bucket, object);
  });
  handle('storage:object-info', async (id, bucket, key) => {
    const connection = await connectionFor(id, bucket);
    ensureKey(key, connection.provider === 's3' ? 1024 : 1023);
    return providerFor(connection).objectInfo(connection, bucket, key);
  });
  handle('storage:signed-url', async (id, bucket, key, expires) => {
    if (
      !Number.isInteger(expires) ||
      expires < 60 ||
      expires > 604800 ||
      typeof key !== 'string' ||
      key.endsWith('/')
    )
      throw new Error('请选择文件，有效期应为 1 分钟至 7 天');
    const connection = await connectionFor(id, bucket);
    ensureKey(key, connection.provider === 's3' ? 1024 : 1023);
    const url = await providerFor(connection).signedUrl(connection, bucket, key, expires);
    return { url, expiresAt: Date.now() + expires * 1000 };
  });
  handle('storage:folder', async (id, bucket, prefix, name) => {
    if (typeof prefix !== 'string') throw new Error('目录路径无效');
    const connection = await connectionFor(id, bucket);
    return providerFor(connection).createFolder(connection, bucket, prefix, name);
  });
  ipcMain.on('files:grant', (event, filePath) => {
    try {
      trusted(event);
      if (typeof filePath === 'string' && path.isAbsolute(filePath)) uploadGrants.add(filePath);
    } catch {}
  });
  handle('files:pick', async (mode = 'files') => {
    if (!['files', 'folder'].includes(mode)) throw new Error('选择模式无效');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: mode === 'folder' ? '选择要上传的文件夹' : '选择要上传的文件',
      properties: mode === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    const items = await collectUploads(result.filePaths.map((filePath) => ({ path: filePath })));
    for (const item of items) uploadGrants.add(item.path);
    return items;
  });
  handle('storage:upload', async (id, bucket, prefix, items, conflict = 'reject') => {
    if (
      !Array.isArray(items) ||
      !items.length ||
      items.length > 100000 ||
      typeof prefix !== 'string'
    )
      throw new Error('请选择 1–100000 个上传项');
    for (const item of items)
      if (!uploadGrants.has(item.path)) throw new Error('请通过文件选择器或拖放重新选择文件');
    const connection = await connectionFor(id, bucket);
    if (prefix) ensureKey(prefix, connection.provider === 's3' ? 1024 : 1023);
    const expanded = await collectUploads(items);
    const summary = await providerFor(connection).upload(
      connection,
      bucket,
      prefix,
      expanded,
      emit,
      conflict,
    );
    for (const item of items) uploadGrants.delete(item.path);
    return summary;
  });
  handle('storage:download', async (id, bucket, objects) => {
    if (!Array.isArray(objects) || !objects.length || objects.length > 1000)
      throw new Error('请选择 1–1000 项下载');
    const connection = await connectionFor(id, bucket);
    const provider = providerFor(connection);
    const entries = downloadEntries(
      await expandObjects(provider, connection, bucket, objects),
      objects,
    );
    if (!entries.length) throw new Error('所选目录中没有可下载的文件');
    if (objects.length === 1 && objects[0].kind === 'file') {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存文件',
        defaultPath: safeFilename(objects[0].key),
      });
      if (!result.canceled && result.filePath)
        await provider.download(connection, bucket, entries, result.filePath, emit);
    } else {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择下载目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (!result.canceled && result.filePaths[0])
        await providerFor(connection).download(
          connection,
          bucket,
          entries,
          result.filePaths[0],
          emit,
          true,
        );
    }
  });
  handle('files:save-demo-download', async (bucket, key, content) => {
    validateBucket(bucket);
    ensureKey(key, 1024);
    if (!(content instanceof ArrayBuffer) || content.byteLength > 2 * 1024 * 1024)
      throw new Error('演示下载内容无效或超过 2 MB');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: safeFilename(key),
    });
    if (result.canceled || !result.filePath) return;
    await taskManager.run(
      {
        name: safeFilename(key),
        direction: 'download',
        size: content.byteLength,
        bucket,
        canPause: false,
      },
      async (signal, report) => {
        signal.throwIfAborted();
        const temporary = path.join(path.dirname(result.filePath), `.ossdesk-${randomUUID()}.part`);
        try {
          await fsp.writeFile(temporary, Buffer.from(content), { flag: 'wx', signal });
          signal.throwIfAborted();
          await fsp.rename(temporary, result.filePath);
          report({ localPath: result.filePath });
        } finally {
          await fsp.rm(temporary, { force: true });
        }
      },
      emit,
    );
  });
  handle('storage:prepare-operation', async (id, bucket, objects, operation, target) => {
    const connection = await connectionFor(id, bucket);
    const plan = await providerFor(connection).prepareOperation(
      connection,
      bucket,
      objects,
      operation,
      target,
    );
    const planId = randomUUID();
    for (const [key, value] of operationPlans)
      if (Date.now() - value.created > 600000) operationPlans.delete(key);
    if (operationPlans.size >= 20) operationPlans.delete(operationPlans.keys().next().value);
    operationPlans.set(planId, { plan, id, created: Date.now() });
    return { id: planId, count: plan.count, size: plan.size };
  });
  handle('storage:execute-operation', async (planId) => {
    const prepared = operationPlans.get(planId);
    operationPlans.delete(planId);
    if (!prepared || Date.now() - prepared.created > 600000)
      throw new Error('操作确认已过期，请重新选择');
    const connection = await connectionFor(prepared.id, prepared.plan.bucket);
    return providerFor(connection).executeOperation(connection, prepared.plan, emit);
  });
  handle('transfer:cancel', (id) => taskManager.cancel(id));
  handle('transfer:pause', (id) => taskManager.pause(id));
  handle('transfer:list', () => taskManager.list());
  handle('transfer:concurrency', (value) =>
    value === undefined ? taskManager.concurrency : taskManager.configureConcurrency(value),
  );
  handle('transfer:reveal', async (id) => {
    const task = taskManager.records.get(id);
    if (
      task?.metadata.direction !== 'download' ||
      task.metadata.status !== 'completed' ||
      !task.metadata.localPath
    )
      throw new Error('此任务没有已保存的本地文件');
    await fsp.access(task.metadata.localPath);
    if (task.descriptor?.object?.kind === 'folder') {
      const error = await shell.openPath(task.metadata.localPath);
      if (error) throw new Error('无法打开保存目录，请检查目录是否存在');
    } else shell.showItemInFolder(task.metadata.localPath);
  });
  handle('transfer:retry', async (id) => {
    const task = taskManager.records.get(id);
    if (!task) throw new Error('任务记录已清除');
    if (task.metadata.connectionId)
      await connectionFor(task.metadata.connectionId, task.metadata.bucket);
    return taskManager.retry(id);
  });
  handle('transfer:clear', () => taskManager.clear());
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
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#fafafa', symbolColor: '#525252', height: 43 },
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 14 } } : {}),
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
  refresh = new CredentialRefresh(vault);
  await taskManager.initialize(
    app.getPath('userData'),
    async (task) => {
      const descriptor = task.descriptor;
      const connection = await connectionFor(task.metadata.connectionId, descriptor.bucket);
      const identity = descriptor.connection;
      if (
        !identity ||
        (connection.provider || 'aliyun') !== identity.provider ||
        connection.endpoint !== identity.endpoint ||
        connection.bucket !== identity.bucket
      )
        throw new Error('连接目标已更改，请重新选择文件或保存位置');
      connection.region = identity.region;
      const provider = providerFor(connection);
      if (descriptor.type === 'upload')
        return provider.upload(
          connection,
          descriptor.bucket,
          descriptor.prefix,
          [descriptor.item],
          emit,
          descriptor.conflict,
          task,
        );
      if (descriptor.type === 'download')
        return provider.download(
          connection,
          descriptor.bucket,
          [descriptor.object],
          descriptor.destination,
          emit,
          descriptor.batch,
          task,
        );
      throw new Error('此任务无法恢复，请重新操作');
    },
    emit,
  );
  taskManager.cleanup = async (task) => {
    const descriptor = task.descriptor;
    if (!descriptor?.state?.checkpoint && !descriptor?.state?.temporary) return;
    const connection = await connectionFor(task.metadata.connectionId, descriptor.bucket);
    const identity = descriptor.connection;
    if (
      !identity ||
      (connection.provider || 'aliyun') !== identity.provider ||
      connection.endpoint !== identity.endpoint ||
      connection.bucket !== identity.bucket
    )
      throw new Error('连接目标已更改，无法清理原任务，请先恢复原连接配置');
    await providerFor(connection).cleanupTransfer(
      { ...connection, region: identity.region },
      descriptor,
    );
  };
  setupHandlers();
  setupFeatures(handle, {
    vault,
    refresh,
    connectionFor,
    providerFor,
    emit,
    dialog,
    window: () => mainWindow,
    serialize,
    updates: setupUpdates(app),
  });
  await createWindow();
  if (taskManager.recoveryWarning)
    void dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '无法恢复历史任务',
      message: taskManager.recoveryWarning,
    });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  taskManager.shutdown().then(
    () => app.quit(),
    () => app.quit(),
  );
});
