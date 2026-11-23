const fs = require('node:fs/promises');
const path = require('node:path');
const { safeFilename } = require('./core.cjs');
const { validateRelativePath, deduplicateObjects } = require('./operations.cjs');
async function collectUploads(paths, options = {}) {
  const items = [];
  async function visit(filePath, relativePath) {
    if (options.ignore?.(relativePath)) return;
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) throw new Error('上传目录中包含符号链接，请移除后重试');
    if (stat.isDirectory()) {
      const entries = await fs.readdir(filePath);
      if (!entries.length)
        items.push({
          path: filePath,
          name: path.basename(filePath),
          relativePath: relativePath + '/',
          directory: true,
        });
      for (const name of entries) await visit(path.join(filePath, name), `${relativePath}/${name}`);
    } else if (stat.isFile())
      items.push({ path: filePath, name: path.basename(filePath), relativePath });
    else throw new Error('上传项不是普通文件或目录');
    if (items.length > 100000) throw new Error('单次最多上传 100000 项，请分目录处理');
  }
  for (const item of paths)
    await visit(item.path, (item.relativePath || path.basename(item.path)).replace(/\/$/, ''));
  return items;
}
function downloadEntries(entries, objects) {
  const roots = deduplicateObjects(objects);
  const directories = new Map();
  const used = new Set();
  return entries.map((entry) => {
    const root = roots.find(
      (object) =>
        object.key === entry.key || (object.kind === 'folder' && entry.key.startsWith(object.key)),
    );
    const relative =
      root.kind === 'folder'
        ? root.key.replace(/\/$/, '').split('/').pop() + '/' + entry.key.slice(root.key.length)
        : entry.key.split('/').pop();
    const isFolder = entry.key.endsWith('/');
    const parts = relative.replace(/\/$/, '').split('/');
    let original = '';
    let local = '';
    for (const component of isFolder ? parts : parts.slice(0, -1)) {
      original += '/' + component;
      const directoryKey = root.key + '\0' + original;
      if (!directories.has(directoryKey)) {
        const safe = safeFilename(component);
        let candidate = safe,
          index = 1;
        while (used.has((local + candidate).toLowerCase())) candidate = `${safe} (${index++})`;
        used.add((local + candidate).toLowerCase());
        directories.set(directoryKey, candidate);
      }
      local += directories.get(directoryKey) + '/';
    }
    const relativePath = isFolder ? local.replace(/\/$/, '') : local + safeFilename(parts.at(-1));
    validateRelativePath(relativePath);
    return { ...entry, relativePath };
  });
}
module.exports = { collectUploads, downloadEntries };
