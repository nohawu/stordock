const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('ossDesk', {
  platform: process.platform,
  setAppearance: (theme) => ipcRenderer.invoke('window:appearance', theme),
  connections: () => ipcRenderer.invoke('connections:list'),
  saveConnection: (input) => ipcRenderer.invoke('connections:save', input),
  testConnection: (input) => ipcRenderer.invoke('connections:test', input),
  removeConnection: (id) => ipcRenderer.invoke('connections:remove', id),
  buckets: (id) => ipcRenderer.invoke('storage:buckets', id),
  list: (request) => ipcRenderer.invoke('storage:list', request),
  preview: (id, bucket, object) => ipcRenderer.invoke('storage:preview', id, bucket, object),
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
  prepareOperation: (id, bucket, objects, operation, target) =>
    ipcRenderer.invoke('storage:prepare-operation', id, bucket, objects, operation, target),
  executeOperation: (planId) => ipcRenderer.invoke('storage:execute-operation', planId),
  cancelTransfer: (id) => ipcRenderer.invoke('transfer:cancel', id),
  retryTransfer: (id) => ipcRenderer.invoke('transfer:retry', id),
  clearTransfers: () => ipcRenderer.invoke('transfer:clear'),
  onTransfer: (listener) => {
    const handler = (_event, transfer) => listener(transfer);
    ipcRenderer.on('transfer:progress', handler);
    return () => ipcRenderer.removeListener('transfer:progress', handler);
  },
});
