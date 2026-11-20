import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createS3Fixture } = createRequire(import.meta.url)('../tests/s3-fixture.cjs');
const s3 = await createS3Fixture();
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(
    page.getByRole('button', { name: 'cover-landscape.svg', exact: true }),
  ).toBeVisible();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
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
  await expect(page.locator('.text-preview')).toContainText('你好');
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
  await app.close();
  app = undefined;
  // Relaunch reads the persisted connection with the operating system decryptor.
  app = await electron.launch({ args: ['tests/desktop-entry.cjs'], env, timeout: 60000 });
  const restored = await app.firstWindow();
  await restored.getByRole('button', { name: '桌面集成测试 OSS', exact: true }).click();
  await restored.getByRole('button', { name: 'integration-bucket', exact: true }).click();
  await expect(
    restored.getByRole('button', { name: 'native-check.json', exact: true }),
  ).toBeVisible();
  await restored.getByRole('button', { name: 'S3 集成测试 S3', exact: true }).click();
  await restored.getByRole('button', { name: 'media.bucket', exact: true }).click();
  await expect(restored.getByRole('button', { name: 'hello.json', exact: true })).toBeVisible();
  console.log(
    'Desktop smoke passed: isolated IPC, OS encryption, connection editing, persisted credentials, native file/folder upload and recursive download, server-side copy, move, rename and delete. Aliyun network mocked; S3 SDK tested against a local HTTP endpoint.',
  );
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
