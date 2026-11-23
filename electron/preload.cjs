const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('ossDesk', {
  platform: process.platform,
  feature: (action, input) => ipcRenderer.invoke('feature:invoke', action, input),
  writeClipboardText: (value) => ipcRenderer.invoke('clipboard:write', value),
  setAppearance: (theme) => ipcRenderer.invoke('window:appearance', theme),
  connections: () => ipcRenderer.invoke('connections:list'),
  saveConnection: (input) => ipcRenderer.invoke('connections:save', input),
  testConnection: (input) => ipcRenderer.invoke('connections:test', input),
  removeConnection: (id) => ipcRenderer.invoke('connections:remove', id),
  buckets: (id) => ipcRenderer.invoke('storage:buckets', id),
  list: (request) => ipcRenderer.invoke('storage:list', request),
  preview: (id, bucket, object) => ipcRenderer.invoke('storage:preview', id, bucket, object),
  objectInfo: (id, bucket, key) => ipcRenderer.invoke('storage:object-info', id, bucket, key),
  signedUrl: (id, bucket, key, expires) =>
    ipcRenderer.invoke('storage:signed-url', id, bucket, key, expires),
  createFolder: (id, bucket, prefix, name) =>
    ipcRenderer.invoke('storage:folder', id, bucket, prefix, name),
  pickUpload: (mode) => ipcRenderer.invoke('files:pick', mode),
  filePath: (file) => {
    const filePath = webUtils.getPathForFile(file);
    if (filePath) ipcRenderer.send('files:grant', filePath);
    return filePath;
  },
  upload: (id, bucket, prefix, items, conflict) =>
    ipcRenderer.invoke(
      'storage:upload',
      id,
      bucket,
      prefix,
      items.map(({ path, name, relativePath, directory }) => ({
        path,
        name,
        relativePath,
        directory,
      })),
      conflict,
    ),
  download: (id, bucket, objects) => ipcRenderer.invoke('storage:download', id, bucket, objects),
  saveDemoDownload: (bucket, key, content) =>
    ipcRenderer.invoke('files:save-demo-download', bucket, key, content),
  prepareOperation: (id, bucket, objects, operation, target) =>
    ipcRenderer.invoke('storage:prepare-operation', id, bucket, objects, operation, target),
  executeOperation: (planId) => ipcRenderer.invoke('storage:execute-operation', planId),
  cancelTransfer: (id) => ipcRenderer.invoke('transfer:cancel', id),
  pauseTransfer: (id) => ipcRenderer.invoke('transfer:pause', id),
  listTransfers: () => ipcRenderer.invoke('transfer:list'),
  getTransferConcurrency: () => ipcRenderer.invoke('transfer:concurrency'),
  setTransferConcurrency: (value) => ipcRenderer.invoke('transfer:concurrency', value),
  revealTransfer: (id) => ipcRenderer.invoke('transfer:reveal', id),
  retryTransfer: (id) => ipcRenderer.invoke('transfer:retry', id),
  clearTransfers: () => ipcRenderer.invoke('transfer:clear'),
  onTransfer: (listener) => {
    const handler = (_event, transfer) => listener(transfer);
    ipcRenderer.on('transfer:progress', handler);
    return () => ipcRenderer.removeListener('transfer:progress', handler);
  },
});
