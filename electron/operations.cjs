const { ensureKey } = require('./core.cjs');
function validateRelativePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    /[\\\x00-\x1f]/.test(value) ||
    value.split('/').some((part) => part === '..' || part === '.' || !part)
  )
    throw new Error('相对路径无效，不能包含空目录、反斜线或 . / ..');
  return value;
}
function uniqueName(key, index) {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  const split = dot > slash + 1 ? dot : key.length;
  return `${key.slice(0, split)} (${index})${key.slice(split)}`;
}
function deduplicateObjects(objects) {
  if (!Array.isArray(objects) || !objects.length || objects.length > 1000)
    throw new Error('请选择 1–1000 项');
  for (const object of objects) {
    ensureKey(object?.key, 1024);
    if (
      !['file', 'folder'].includes(object.kind) ||
      (object.kind === 'folder' && !object.key.endsWith('/'))
    )
      throw new Error('对象类型无效');
  }
  return objects.filter(
    (object, index) =>
      objects.findIndex((other) => other.key === object.key) === index &&
      !objects.some(
        (parent) =>
          parent.kind === 'folder' &&
          parent.key !== object.key &&
          object.key.startsWith(parent.key),
      ),
  );
}
async function expandObjects(provider, connection, bucket, objects) {
  const result = new Map();
  const sdk = provider.client(connection, bucket);
  for (const object of deduplicateObjects(objects)) {
    if (object.kind === 'file') {
      const head = await sdk.head(object.key);
      result.set(object.key, {
        ...object,
        size: Number(head.res.headers['content-length']),
        etag: head.res.headers.etag,
      });
    } else {
      let cursor;
      const seen = new Set();
      do {
        const page = await sdk.listV2({
          prefix: object.key,
          'max-keys': 1000,
          'continuation-token': cursor,
        });
        for (const item of page.objects || []) {
          if (!item.name.startsWith(object.key))
            throw new Error('服务返回了目录外的对象，已停止操作');
          result.set(item.name, {
            key: item.name,
            size: Number(item.size),
            kind: item.name.endsWith('/') ? 'folder' : 'file',
            etag: item.etag,
          });
        }
        if (result.size > 100000) throw new Error('单次最多处理 100000 个对象，请分目录处理');
        cursor = page.isTruncated ? page.nextContinuationToken : undefined;
        if (cursor && seen.has(cursor)) throw new Error('服务返回重复分页标记，已停止操作');
        seen.add(cursor);
      } while (cursor);
    }
  }
  return [...result.values()];
}
async function prepareOperation(provider, connection, bucket, objects, operation, target) {
  if (!['copy', 'move', 'rename', 'delete'].includes(operation)) throw new Error('操作类型无效');
  const roots = deduplicateObjects(objects);
  if (operation === 'rename' && roots.length !== 1) throw new Error('每次只能重命名一项');
  if (operation !== 'delete') {
    if (typeof target !== 'string') throw new Error('目标路径无效');
    if (target) ensureKey(target, connection.provider === 's3' ? 1024 : 1023);
    if (operation === 'rename') validateRelativePath(target.replace(/\/$/, ''));
    else if (target && !target.endsWith('/')) throw new Error('目标目录必须以 / 结尾');
    for (const root of roots) {
      const destination =
        operation === 'rename'
          ? target
          : target +
            root.key.replace(/\/$/, '').split('/').pop() +
            (root.kind === 'folder' ? '/' : '');
      if (destination === root.key || (root.kind === 'folder' && destination.startsWith(root.key)))
        throw new Error('目标不能是原路径或源文件夹的子目录');
    }
  }
  const entries = await expandObjects(provider, connection, bucket, roots);
  for (const entry of entries) {
    const root = roots.find(
      (item) =>
        item.key === entry.key || (item.kind === 'folder' && entry.key.startsWith(item.key)),
    );
    if (operation !== 'delete') {
      const base =
        operation === 'rename'
          ? target
          : target +
            root.key.replace(/\/$/, '').split('/').pop() +
            (root.kind === 'folder' ? '/' : '');
      entry.target = ensureKey(
        base + entry.key.slice(root.key.length),
        connection.provider === 's3' ? 1024 : 1023,
      );
    }
  }
  if (
    operation !== 'delete' &&
    new Set(entries.map((entry) => entry.target)).size !== entries.length
  )
    throw new Error('多个源对象映射到相同目标，请分开操作');
  return {
    operation,
    bucket,
    entries,
    count: entries.length,
    size: entries.reduce((sum, item) => sum + item.size, 0),
  };
}
module.exports = {
  validateRelativePath,
  uniqueName,
  deduplicateObjects,
  expandObjects,
  prepareOperation,
};
