const fs = require('node:fs/promises');
const path = require('node:path');
const { collectUploads } = require('./files.cjs');
const { validateRelativePath } = require('./operations.cjs');
const { safeFilename, ensureKey } = require('./core.cjs');
function excludes(text) {
  if (typeof text !== 'string' || text.length > 8192) throw new Error('排除规则过长');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((glob) => {
      if (glob.includes('..') || glob.startsWith('/') || glob.includes('\\'))
        throw new Error('排除规则必须为相对路径');
      let pattern = '';
      for (let index = 0; index < glob.length; index++) {
        const character = glob[index];
        if (character === '*' && glob[index + 1] === '*') {
          if (glob[index + 2] === '/') {
            pattern += '(?:.*/)?';
            index += 2;
          } else {
            pattern += '.*';
            index++;
          }
        } else if (character === '*') pattern += '[^/]*';
        else if (character === '?') pattern += '[^/]';
        else pattern += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      return new RegExp(`^(?:${glob.includes('/') ? '' : '(?:.*/)?'}${pattern})$`);
    });
}
async function prepareSync(provider, connection, bucket, prefix, root, direction, rules) {
  if (!['upload', 'download'].includes(direction)) throw new Error('同步方向无效');
  if (typeof prefix !== 'string' || (prefix && !prefix.endsWith('/')))
    throw new Error('同步路径无效');
  if (prefix) ensureKey(prefix, connection.provider === 's3' ? 1024 : 1023);
  const ignored = excludes(rules),
    ignore = (key) => ignored.some((pattern) => pattern.test(key));
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('请选择普通目录');
  const local = new Map();
  for (const item of await collectUploads([{ path: root, relativePath: 'root' }], {
    ignore: (relative) =>
      relative.startsWith('root/') &&
      (ignore(relative.slice(5)) || ignore(relative.slice(5) + '/')),
  })) {
    const relative = item.relativePath.slice(5);
    if (item.directory || ignore(relative)) continue;
    const stat = await fs.lstat(item.path);
    local.set(relative, { path: item.path, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  const remote = new Map(),
    sdk = provider.client(connection, bucket),
    seen = new Set();
  let cursor,
    scanned = 0;
  do {
    const page = await sdk.listV2({ prefix, 'max-keys': 1000, 'continuation-token': cursor });
    scanned += (page.objects || []).length;
    if (scanned > 100000) throw new Error('单次同步最多扫描 100000 个远端对象');
    for (const object of page.objects || []) {
      if (!object.name.startsWith(prefix)) throw new Error('服务返回了同步目录外的对象');
      const relative = object.name.slice(prefix.length);
      if (!relative || relative.endsWith('/') || ignore(relative)) continue;
      remote.set(relative, {
        key: object.name,
        size: Number(object.size),
        etag: object.etag,
        lastModified: object.lastModified,
      });
      if (remote.size > 100000) throw new Error('单次同步最多扫描 100000 个远端文件');
    }
    cursor = page.isTruncated ? page.nextContinuationToken : undefined;
    if (cursor && seen.has(cursor)) throw new Error('远端返回了重复分页标记');
    seen.add(cursor);
  } while (cursor);
  const items = [];
  for (const [relative, source] of direction === 'upload' ? local : remote) {
    validateRelativePath(relative);
    if (relative.split('/').some((part) => safeFilename(part) !== part))
      throw new Error(`文件名无法安全映射到本地：${relative}`);
    const destination = (direction === 'upload' ? remote : local).get(relative);
    const sourceTime = direction === 'upload' ? source.mtimeMs : Date.parse(source.lastModified);
    const targetTime =
      direction === 'upload' ? Date.parse(destination?.lastModified) : destination?.mtimeMs;
    const action = !destination
      ? 'create'
      : source.size !== destination.size || sourceTime > targetTime + 1000
        ? 'update'
        : 'skip';
    items.push({
      relative,
      action,
      size: source.size,
      local: local.get(relative),
      remote: remote.get(relative),
    });
  }
  return {
    root,
    bucket,
    prefix,
    direction,
    items,
    count: items.filter((item) => item.action !== 'skip').length,
    size: items.filter((item) => item.action !== 'skip').reduce((sum, item) => sum + item.size, 0),
  };
}
async function executeSync(provider, connection, plan, emit) {
  const summary = { completed: 0, failed: 0, skipped: 0 };
  for (const item of plan.items) {
    if (item.action === 'skip') {
      summary.skipped++;
      continue;
    }
    connection = await provider.refreshConnection(connection, plan.bucket);
    let directory = path.resolve(plan.root);
    const rootStat = await fs.lstat(directory);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
      throw new Error('同步根目录已变化或变为符号链接，请重新比较');
    if (item.local) {
      const relative = path.relative(directory, path.dirname(item.local.path));
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('同步路径越界');
      for (const part of relative.split(path.sep).filter(Boolean)) {
        directory = path.join(directory, part);
        const stat = await fs.lstat(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new Error('同步目录已变化或包含符号链接');
      }
    }
    if (item.local) {
      const stat = await fs.lstat(item.local.path);
      if (
        stat.isSymbolicLink() ||
        stat.size !== item.local.size ||
        stat.mtimeMs !== item.local.mtimeMs
      )
        throw new Error(`本地文件已变化：${item.relative}，请重新比较`);
    }
    if (item.remote) {
      const head = await provider.client(connection, plan.bucket).head(item.remote.key);
      if (
        !item.remote.etag ||
        String(head.res.headers.etag).replaceAll('"', '') !==
          String(item.remote.etag).replaceAll('"', '')
      )
        throw new Error(`远端文件已变化：${item.relative}，请重新比较`);
    }
    if (plan.direction === 'upload') {
      const result = await provider.upload(
        connection,
        plan.bucket,
        plan.prefix,
        [
          {
            path: item.local.path,
            name: item.relative,
            relativePath: item.relative,
            expectedEtag: item.remote?.etag,
          },
        ],
        emit,
        item.action === 'update' ? 'overwrite' : 'reject',
      );
      summary.completed += result.completed;
      summary.failed += result.failed;
    } else {
      const target = path.resolve(plan.root, ...item.relative.split('/'));
      if (!target.startsWith(path.resolve(plan.root) + path.sep)) throw new Error('同步路径越界');
      let parent = path.resolve(plan.root);
      for (const part of path
        .relative(parent, path.dirname(target))
        .split(path.sep)
        .filter(Boolean)) {
        parent = path.join(parent, part);
        await fs.mkdir(parent).catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
        const stat = await fs.lstat(parent);
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new Error('同步目录不能包含符号链接');
      }
      try {
        const stat = await fs.lstat(target);
        if (!item.local || stat.isSymbolicLink())
          throw new Error('本地目标已出现或变为符号链接，请重新比较');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const events = [];
      await provider.download(
        connection,
        plan.bucket,
        [{ ...item.remote, kind: 'file' }],
        target,
        (task) => {
          emit(task);
          events.push(task);
        },
      );
      if (events.at(-1)?.status === 'completed') summary.completed++;
      else summary.failed++;
    }
  }
  return summary;
}
module.exports = { excludes, prepareSync, executeSync };
