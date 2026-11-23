import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createS3Fixture } = createRequire(import.meta.url)('../tests/s3-fixture.cjs');
const s3 = await createS3Fixture({ versioning: true });
const testRoot = path.resolve('test-results');
await fs.mkdir(testRoot, { recursive: true });
const data = await fs.mkdtemp(path.join(testRoot, 'desktop-session-'));
const fixture = 'Native upload and streaming download. 中文内容';
await fs.writeFile(path.join(data, 'upload-fixture.txt'), fixture);
await fs.mkdir(path.join(data, 'upload-folder/sub'), { recursive: true });
await fs.mkdir(path.join(data, 'upload-folder/empty'), { recursive: true });
await fs.mkdir(path.join(data, 'downloads'));
await fs.writeFile(path.join(data, 'upload-folder/sub/nested.txt'), 'Recursive native transfer');
const env = { ...process.env, OSS_DESK_SMOKE: '1', OSS_DESK_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OSS_DESK_DEV_URL;
let app;
try {
  app = await electron.launch({ args: ['tests/desktop-entry.cjs'], env, timeout: 60000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(
    page.getByRole('button', { name: 'cover-landscape.svg', exact: true }),
  ).toBeVisible();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.getByRole('button', { name: '下载 README.md', exact: true }).click();
  await page.getByRole('button', { name: '查看传输任务', exact: true }).click();
  const demoReveal = page.getByRole('button', { name: '打开保存目录 README.md', exact: true });
  await expect(demoReveal).toBeVisible();
  await expect(demoReveal.locator('svg')).toHaveCount(1);
  await demoReveal.click();
  await expect
    .poll(async () => fs.readFile(path.join(data, 'revealed-paths.jsonl'), 'utf8').catch(() => ''))
    .toContain(JSON.stringify(path.join(data, 'download-result.txt')));
  await page.getByRole('button', { name: '文件浏览', exact: true }).click();
  await page.getByRole('button', { name: '切换深色主题', exact: true }).click();
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  await page.getByRole('button', { name: '切换浅色主题', exact: true }).click();
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
  const security = await app.evaluate(async ({ BrowserWindow, safeStorage }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    const encrypted = await safeStorage.encryptStringAsync('native-encryption-check');
    return {
      isolated: prefs.contextIsolation,
      sandbox: prefs.sandbox,
      node: prefs.nodeIntegration,
      encryption: (await safeStorage.decryptStringAsync(encrypted)).result,
    };
  });
  assert.deepEqual(security, {
    isolated: true,
    sandbox: true,
    node: false,
    encryption: 'native-encryption-check',
  });
  await page.getByRole('button', { name: '新建存储连接', exact: true }).click();
  await page.getByRole('textbox', { name: '连接名称', exact: true }).fill('桌面集成测试');
  await page.getByRole('textbox', { name: 'AccessKey ID', exact: true }).fill('integration-key');
  await page.getByLabel('AccessKey Secret', { exact: true }).fill('integration-secret');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接成功');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await expect(page.getByRole('button', { name: 'native-check.json', exact: true })).toBeVisible();
  const persisted = await fs.readFile(path.join(data, 'connections.json'), 'utf8');
  assert.ok(!persisted.includes('integration-secret'));
  await page.getByRole('button', { name: 'native-check.json', exact: true }).click();
  await expect(page.locator('.text-preview')).toContainText('desktop integration');
  // The native bridge must work even when the renderer clipboard API is denied.
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () => Promise.reject(new Error('renderer clipboard denied')),
    }),
  );
  await page.getByRole('button', { name: '复制对象路径', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制对象路径', exact: true })).toHaveAttribute(
    'title',
    '已复制',
  );
  assert.ok(
    await app.evaluate(
      async ({ clipboard }) => (await clipboard.readText()) === 'native-check.json',
    ),
    'Native object-path clipboard copy failed',
  );
  await page.getByRole('button', { name: '复制当前路径', exact: true }).click();
  assert.ok(
    await app.evaluate(
      async ({ clipboard }) => (await clipboard.readText()) === 'integration-bucket/',
    ),
    'Native current-path clipboard copy failed',
  );
  await page.getByRole('button', { name: '对象信息', exact: true }).click();
  await expect(page.locator('.metadata')).toContainText('application/json');
  await expect(page.locator('.metadata')).toContainText('max-age=3600');
  await expect(page.locator('.metadata')).toContainText('desktop integration');
  await page.screenshot({ path: 'test-results/object-information.png', animations: 'disabled' });
  const ossHttpLink = 'https://integration-bucket.oss-cn-hangzhou.aliyuncs.com/native-check.json';
  await expect(page.locator('.metadata')).toContainText(ossHttpLink);
  await page.getByRole('button', { name: '复制HTTP 链接', exact: true }).click();
  assert.ok(
    await app.evaluate(
      async ({ clipboard }, expected) => (await clipboard.readText()) === expected,
      ossHttpLink,
    ),
    'Native HTTP-link clipboard copy failed',
  );
  await page.getByRole('button', { name: '分享文件', exact: true }).click();
  await page.getByRole('combobox', { name: '链接有效期' }).selectOption('900');
  await page.getByRole('button', { name: '生成链接', exact: true }).click();
  const ossLink = new URL(await page.getByRole('textbox', { name: '签名下载链接' }).inputValue());
  assert.equal(ossLink.searchParams.get('x-oss-expires'), '900');
  assert.equal(ossLink.searchParams.get('x-oss-signature-version'), 'OSS4-HMAC-SHA256');
  await page.getByRole('button', { name: '复制链接', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  assert.ok(
    await app.evaluate(
      async ({ clipboard }, expected) => (await clipboard.readText()) === expected,
      ossLink.href,
    ),
    'Native signed-link clipboard copy failed',
  );
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '桌面集成测试连接菜单', exact: true }).click();
  await page.getByRole('button', { name: '编辑连接', exact: true }).click();
  await expect(page.getByLabel('AccessKey Secret', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接成功');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await expect(page.getByRole('button', { name: 'native-check.json', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上传文件', exact: true }).click();
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByRole('button', { name: 'upload-fixture.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下载 upload-fixture.txt', exact: true }).click();
  await expect
    .poll(async () => fs.readFile(path.join(data, 'download-result.txt'), 'utf8').catch(() => ''))
    .toBe(fixture);
  // S3 exercises the actual SDK and local HTTP service through the native IPC path.
  await page.getByRole('button', { name: '新建存储连接', exact: true }).click();
  await page.getByRole('button', { name: 'S3 兼容', exact: true }).click();
  await page.getByRole('textbox', { name: '连接名称', exact: true }).fill('S3 集成测试');
  await page.getByRole('textbox', { name: 'Endpoint', exact: true }).fill(s3.endpoint);
  await page.getByRole('textbox', { name: 'Bucket', exact: false }).fill(s3.bucket);
  await page.getByRole('textbox', { name: 'Access Key ID', exact: true }).fill('fixture-key');
  await page.getByLabel('Secret Access Key', { exact: true }).fill('fixture-secret');
  await page.getByRole('checkbox', { name: /允许 HTTP 连接/ }).check();
  await page.getByRole('button', { name: '高级配置', exact: true }).click();
  await page.getByRole('textbox', { name: /Session Token/ }).fill('fixture-token');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接成功');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await expect(page.getByRole('button', { name: 'hello.json', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'hello.json', exact: true }).click();
  await page.getByRole('button', { name: '内容预览', exact: true }).click();
  await expect(page.locator('.text-preview')).toContainText('你好');
  await page.getByRole('button', { name: '对象信息', exact: true }).click();
  await expect(page.locator('.metadata')).toContainText(`${s3.endpoint}/${s3.bucket}/hello.json`);
  await expect(page.locator('.metadata')).toContainText('fixture-project');
  await page.getByRole('button', { name: '管理属性、版本与归档', exact: true }).click();
  await page.getByRole('textbox', { name: 'contentType', exact: true }).fill('application/json');
  await page.getByRole('textbox', { name: 'cacheControl', exact: true }).fill('max-age=120');
  await page
    .getByRole('textbox', { name: '自定义元数据', exact: true })
    .fill('{"project":"managed"}');
  await page.getByRole('button', { name: '保存属性', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('对象属性已保存');
  await page.getByRole('button', { name: '标签', exact: true }).click();
  await page.getByRole('textbox', { name: '对象标签', exact: true }).fill('{"env":"desktop"}');
  await page.getByRole('button', { name: '保存标签', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('对象标签已保存');
  assert.equal(s3.tagSets.get('hello.json').env, 'desktop');
  await page.getByRole('button', { name: '历史版本', exact: true }).click();
  await expect(page.locator('.version-row')).toHaveCount(2);
  await page.getByRole('button', { name: '恢复此版本', exact: true }).last().click();
  await page.getByRole('textbox', { name: '恢复确认', exact: true }).fill('恢复');
  await page.getByRole('button', { name: '确认恢复版本', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已恢复为当前版本');
  await page.screenshot({ path: 'test-results/object-management.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'hello.json', exact: true }).click();
  await page.getByRole('button', { name: '分享文件', exact: true }).click();
  await page.getByRole('button', { name: '生成链接', exact: true }).click();
  const s3Link = new URL(await page.getByRole('textbox', { name: '签名下载链接' }).inputValue());
  assert.equal(s3Link.searchParams.get('X-Amz-Expires'), '3600');
  assert.equal(s3Link.searchParams.get('X-Amz-Security-Token'), 'fixture-token');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '上传文件', exact: true }).click();
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByRole('button', { name: 'upload-fixture.txt', exact: true })).toBeVisible();
  await fs.rm(path.join(data, 'download-result.txt'));
  await page.getByRole('button', { name: '下载 upload-fixture.txt', exact: true }).click();
  await expect
    .poll(async () => fs.readFile(path.join(data, 'download-result.txt'), 'utf8').catch(() => ''))
    .toBe(fixture);
  const savedS3 = await fs.readFile(path.join(data, 'connections.json'), 'utf8');
  assert.ok(!savedS3.includes('fixture-secret') && !savedS3.includes('fixture-token'));
  await page.getByRole('button', { name: '上传文件夹', exact: true }).click();
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByRole('button', { name: 'upload-folder', exact: true })).toBeVisible();
  const nativeOperations = await page.evaluate(async () => {
    const bridge = window.ossDesk;
    const connection = (await bridge.connections()).find((item) => item.name === 'S3 集成测试');
    const objects = [
      {
        key: 'upload-folder/',
        kind: 'folder',
        name: 'upload-folder',
        size: 0,
        lastModified: '',
        storageClass: '',
      },
    ];
    await bridge.download(connection.id, 'media.bucket', objects);
    const copied = await bridge.prepareOperation(
      connection.id,
      'media.bucket',
      objects,
      'copy',
      'copied/',
    );
    const copyResult = await bridge.executeOperation(copied.id);
    const moved = await bridge.prepareOperation(
      connection.id,
      'media.bucket',
      objects,
      'move',
      'moved/',
    );
    const moveResult = await bridge.executeOperation(moved.id);
    const renamed = await bridge.prepareOperation(
      connection.id,
      'media.bucket',
      [{ ...objects[0], key: 'moved/upload-folder/', name: 'upload-folder' }],
      'rename',
      'renamed-folder/',
    );
    const renameResult = await bridge.executeOperation(renamed.id);
    const deleted = await bridge.prepareOperation(
      connection.id,
      'media.bucket',
      [{ ...objects[0], key: 'renamed-folder/', name: 'renamed-folder' }],
      'delete',
    );
    const deleteResult = await bridge.executeOperation(deleted.id);
    return [copyResult.status, moveResult.status, renameResult.status, deleteResult.status];
  });
  assert.deepEqual(nativeOperations, ['completed', 'completed', 'completed', 'completed']);
  assert.equal(
    await fs.readFile(path.join(data, 'downloads/upload-folder/sub/nested.txt'), 'utf8'),
    'Recursive native transfer',
  );
  assert.ok((await fs.stat(path.join(data, 'downloads/upload-folder/empty'))).isDirectory());
  assert.ok(s3.objects.has('copied/upload-folder/sub/nested.txt'));
  assert.ok(
    !s3.objects.has('upload-folder/sub/nested.txt') &&
      !s3.objects.has('renamed-folder/sub/nested.txt'),
  );
  assert.deepEqual(errors, []);
  await page.getByRole('button', { name: '同步本地目录', exact: true }).click();
  await page.getByRole('button', { name: '选择本地目录并比较', exact: true }).click();
  await expect(page.locator('.sync-plan')).toContainText('sub/nested.txt');
  await page.getByRole('checkbox', { name: /确认同步以上差异/ }).check();
  await page.getByRole('button', { name: '执行同步', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 项完成');
  assert.ok(s3.objects.has('sub/nested.txt'));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '连接导入 / 导出', exact: true }).click();
  await page.getByRole('checkbox', { name: '导出带凭据的加密备份', exact: true }).check();
  await page.getByLabel('备份密码', { exact: true }).fill('desktop-test-backup-password');
  await page.getByRole('button', { name: '导出连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接备份已导出');
  const backup = await fs.readFile(path.join(data, 'connections-backup.json'), 'utf8');
  assert.ok(!backup.includes('fixture-secret') && !backup.includes('fixture-token'));
  await page.getByRole('button', { name: '选择文件预览导入', exact: true }).click();
  await expect(page.locator('.feature-confirm')).toContainText('2 个连接');
  await page.getByRole('button', { name: '确认导入加密连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接已导入');
  assert.equal((await page.evaluate(() => window.ossDesk.connections())).length, 4);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const savedTasks = await page.evaluate(() => window.ossDesk.listTransfers());
  const downloadTask = savedTasks.find(
    (task) => task.direction === 'download' && task.name === 'upload-folder/sub/nested.txt',
  );
  assert.equal(downloadTask.localPath, path.join(data, 'downloads/upload-folder/sub/nested.txt'));
  await page.getByRole('button', { name: '查看传输任务', exact: true }).click();
  const revealIcon = page.getByRole('button', {
    name: '打开保存目录 upload-folder/sub/nested.txt',
    exact: true,
  });
  await expect(revealIcon.locator('svg')).toHaveCount(1);
  await expect(revealIcon).toHaveText('');
  await page.screenshot({
    path: 'test-results/download-directory-icon.png',
    animations: 'disabled',
  });
  await page.getByRole('combobox', { name: '同时传输数', exact: true }).selectOption('2');
  await page
    .getByRole('button', { name: '打开保存目录 upload-folder/sub/nested.txt', exact: true })
    .click();
  await expect
    .poll(async () => fs.readFile(path.join(data, 'revealed-paths.jsonl'), 'utf8').catch(() => ''))
    .toContain(JSON.stringify(downloadTask.localPath));
  const rejectedReveal = await page.evaluate(async () => {
    try {
      await window.ossDesk.revealTransfer('../arbitrary');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejectedReveal, true);
  // Keep a real ranged download checkpoint across an actual Electron restart.
  s3.objects.set('resume-restart.bin', Buffer.alloc(64 * 1024, 82));
  s3.controls.slowDownloadKey = 'resume-restart.bin';
  await page.evaluate(() => {
    void (async () => {
      const bridge = window.ossDesk;
      const connection = (await bridge.connections()).find((item) => item.name === 'S3 集成测试');
      await bridge.download(connection.id, 'media.bucket', [
        {
          key: 'resume-restart.bin',
          name: 'resume-restart.bin',
          kind: 'file',
          size: 65536,
          lastModified: '',
          storageClass: '',
        },
      ]);
    })();
  });
  let interrupted;
  await expect
    .poll(async () => {
      interrupted = (await page.evaluate(() => window.ossDesk.listTransfers())).find(
        (task) => task.name === 'resume-restart.bin',
      );
      return interrupted?.status === 'running' && interrupted.progress > 0;
    })
    .toBe(true);
  await page.evaluate((id) => window.ossDesk.pauseTransfer(id), interrupted.id);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ossDesk.listTransfers())).find(
          (task) => task.id === interrupted.id,
        )?.status,
    )
    .toBe('paused');
  await app.close();
  app = undefined;
  // Relaunch reads the persisted connection with the operating system decryptor.
  app = await electron.launch({ args: ['tests/desktop-entry.cjs'], env, timeout: 60000 });
  const restored = await app.firstWindow();
  restored.setDefaultTimeout(15000);
  const restoredTasks = await restored.evaluate(() => window.ossDesk.listTransfers());
  assert.ok(
    restoredTasks.some(
      (task) => task.name === 'README.md' && task.direction === 'download' && task.localPath,
    ),
  );
  assert.ok(
    restoredTasks.some(
      (task) => task.id === downloadTask.id && task.localPath === downloadTask.localPath,
    ),
  );
  assert.ok(restoredTasks.some((task) => task.id === interrupted.id && task.status === 'paused'));
  s3.controls.slowDownloadKey = undefined;
  await restored.evaluate((id) => window.ossDesk.retryTransfer(id), interrupted.id);
  assert.ok(
    (await fs.readFile(path.join(data, 'download-result.txt'))).equals(Buffer.alloc(64 * 1024, 82)),
  );
  assert.ok(
    s3.requests.some(
      (request) =>
        request.path.endsWith('/resume-restart.bin') &&
        request.headers.range === 'bytes=16384-65535',
    ),
  );
  await restored.getByRole('button', { name: '查看传输任务', exact: true }).click();
  await expect(restored.getByRole('combobox', { name: '同时传输数', exact: true })).toHaveValue(
    '2',
  );
  await restored
    .getByRole('button', { name: '打开保存目录 upload-folder/sub/nested.txt', exact: true })
    .click();
  const journal = await fs.readFile(path.join(data, 'transfers.json'), 'utf8');
  assert.ok(
    !journal.includes('integration-secret') &&
      !journal.includes('fixture-secret') &&
      !journal.includes('fixture-token'),
  );
  await restored.getByRole('button', { name: '文件浏览', exact: true }).click();
  await restored.getByRole('button', { name: '桌面集成测试 OSS', exact: true }).first().click();
  await restored
    .locator('.connection-tree')
    .getByRole('button', { name: 'integration-bucket', exact: true })
    .first()
    .click();
  await expect(
    restored.getByRole('button', { name: 'native-check.json', exact: true }),
  ).toBeVisible();
  await restored.getByRole('button', { name: 'S3 集成测试 S3', exact: true }).first().click();
  await restored
    .locator('.connection-tree')
    .getByRole('button', { name: 'media.bucket', exact: true })
    .first()
    .click();
  await expect(restored.getByRole('button', { name: 'hello.json', exact: true })).toBeVisible();
  console.log(
    'Desktop smoke passed: isolated IPC, OS encryption, persisted credentials and transfers, OSS/S3 signed links, native upload/download, reveal saved files, resume ranged downloads after restart, and server-side object operations. Aliyun network mocked; S3 SDK tested against a local HTTP endpoint.',
  );
} catch (error) {
  console.error(error);
  const page = app?.windows()[0];
  if (page) await page.screenshot({ path: 'test-results/desktop-failure.png' }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
  await s3.close();
  const resolved = path.resolve(data);
  if (
    resolved.startsWith(testRoot + path.sep) &&
    path.basename(resolved).startsWith('desktop-session-')
  )
    await fs.rm(resolved, { recursive: true, force: true });
}
