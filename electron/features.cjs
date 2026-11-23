const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { safeFilename, ensureKey } = require('./core.cjs');
const { prepareOperation } = require('./operations.cjs');
const advanced = require('./advanced.cjs');
const archives = require('./archives.cjs');
const { executeMigration } = require('./migration.cjs');
const { prepareSync, executeSync } = require('./sync.cjs');
function setupFeatures(handle, context) {
  const {
    vault,
    connectionFor,
    providerFor,
    emit,
    dialog,
    window: mainWindow,
    serialize,
    refresh,
    updates,
  } = context;
  const plans = new Map();
  function save(type, value) {
    for (const [id, plan] of plans) if (plan.expires < Date.now()) plans.delete(id);
    if (plans.size >= 20) throw new Error('待确认任务过多，请先完成或等待旧任务过期');
    const id = `${type}-${randomUUID()}`;
    plans.set(id, { type, value, expires: Date.now() + 600000 });
    return id;
  }
  function take(id, type) {
    const plan = plans.get(id);
    plans.delete(id);
    if (!plan || plan.type !== type || plan.expires < Date.now())
      throw new Error('操作确认已过期，请重新准备');
    return plan.value;
  }
  async function remote(input) {
    if (!input || typeof input !== 'object') throw new Error('参数无效');
    const connection = await connectionFor(input.connectionId, input.bucket);
    if (input.key !== undefined) ensureKey(input.key, connection.provider === 's3' ? 1024 : 1023);
    return { connection, provider: providerFor(connection) };
  }
  handle('feature:invoke', async (action, input = {}) => {
    switch (action) {
      case 'object:edit': {
        const { provider, connection } = await remote(input);
        return advanced.editProperties(provider, connection, input.bucket, input.key, input.patch);
      }
      case 'object:tags': {
        const { provider, connection } = await remote(input);
        return advanced.tags(provider, connection, input.bucket, input.key, input.values);
      }
      case 'object:versions': {
        const { provider, connection } = await remote(input);
        return advanced.versions(provider, connection, input.bucket, input.key, input.cursor);
      }
      case 'object:restore-version': {
        if (input.confirmation !== '恢复') throw new Error('请输入恢复确认');
        const { provider, connection } = await remote(input);
        await advanced.restoreVersion(
          provider,
          connection,
          input.bucket,
          input.key,
          input.versionId,
        );
        return;
      }
      case 'object:download-version': {
        const { provider, connection } = await remote(input);
        advanced.versionId(input.versionId);
        const head = await provider
          .client(connection, input.bucket)
          .head(input.key, { versionId: input.versionId });
        const result = await dialog.showSaveDialog(mainWindow(), {
          title: '保存历史版本',
          defaultPath: safeFilename(input.key),
        });
        if (!result.canceled && result.filePath)
          await provider.download(
            connection,
            input.bucket,
            [
              {
                key: input.key,
                kind: 'file',
                size: Number(head.res.headers['content-length']),
                versionId: input.versionId,
              },
            ],
            result.filePath,
            emit,
          );
        return;
      }
      case 'object:restore-archive': {
        const { provider, connection } = await remote(input);
        return advanced.restoreArchive(
          provider,
          connection,
          input.bucket,
          input.key,
          input.days,
          input.tier,
        );
      }
      case 'migration:prepare': {
        if (!['copy', 'move'].includes(input.operation)) throw new Error('迁移操作无效');
        const source = await connectionFor(input.connectionId, input.bucket),
          destination = await connectionFor(
            input.destination.connectionId,
            input.destination.bucket,
          );
        if (source.id === destination.id && input.bucket === input.destination.bucket)
          throw new Error('请选择其他存储桶或连接');
        const plan = await prepareOperation(
          providerFor(source),
          source,
          input.bucket,
          input.objects,
          input.operation,
          input.target,
          { differentTarget: true, targetMaxBytes: destination.provider === 's3' ? 1024 : 1023 },
        );
        plan.destination = input.destination;
        const id = save('migration', { source, destination, plan });
        return { id, count: plan.count, size: plan.size };
      }
      case 'migration:execute': {
        const { source, destination, plan } = take(input.planId, 'migration');
        return executeMigration(
          providerFor(source),
          source,
          providerFor(destination),
          destination,
          plan,
          emit,
        );
      }
      case 'sync:prepare': {
        const { provider, connection } = await remote(input);
        const picked = await dialog.showOpenDialog(mainWindow(), {
          title: '选择同步目录',
          properties: ['openDirectory'],
        });
        if (picked.canceled || !picked.filePaths[0]) return;
        const plan = await prepareSync(
          provider,
          connection,
          input.bucket,
          input.prefix,
          picked.filePaths[0],
          input.direction,
          input.rules,
        );
        const id = save('sync', { plan, connection });
        return {
          id,
          ...plan,
          items: plan.items.map(({ relative, action, size }) => ({ relative, action, size })),
        };
      }
      case 'sync:execute': {
        const { connection, plan } = take(input.planId, 'sync');
        return executeSync(providerFor(connection), connection, plan, emit);
      }
      case 'connections:export': {
        const list = await vault.list(),
          encrypted = input.encrypted === true;
        const content = encrypted
          ? archives.encrypt(
              await Promise.all(list.map((item) => vault.get(item.id))),
              input.password,
            )
          : {
              format: 'stordock-connections',
              version: 1,
              connections: list.map(archives.configuration),
            };
        const picked = await dialog.showSaveDialog(mainWindow(), {
          title: '导出连接',
          defaultPath: encrypted
            ? 'stordock-connections.encrypted.json'
            : 'stordock-connections.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!picked.canceled && picked.filePath)
          await fs.writeFile(picked.filePath, JSON.stringify(content, null, 2), { mode: 0o600 });
        return { saved: !picked.canceled };
      }
      case 'connections:inspect': {
        const picked = await dialog.showOpenDialog(mainWindow(), {
          title: '导入连接',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (picked.canceled || !picked.filePaths[0]) return;
        const file = picked.filePaths[0];
        if ((await fs.stat(file)).size > 4 * 1024 * 1024) throw new Error('连接备份不能超过 4 MB');
        let content;
        try {
          content = JSON.parse(await fs.readFile(file, 'utf8'));
        } catch {
          throw new Error('连接文件格式无效');
        }
        const result = archives.inspect(content, input.password);
        const id = save('import', result);
        return { id, encrypted: result.encrypted, connections: result.preview };
      }
      case 'connections:import': {
        const result = take(input.planId, 'import');
        if (!result.encrypted) return { drafts: result.preview };
        return serialize(async () => ({ connections: await vault.importMany(result.connections) }));
      }
      case 'updates':
        return updates(input.action);
      default:
        throw new Error('不支持的功能操作');
    }
  });
}
module.exports = { setupFeatures };
