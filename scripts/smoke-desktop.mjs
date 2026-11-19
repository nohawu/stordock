import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const testRoot = path.resolve('test-results');
await fs.mkdir(testRoot, { recursive: true });
const data = await fs.mkdtemp(path.join(testRoot, 'desktop-session-'));
const fixture = 'Native upload and streaming download. 中文内容';
await fs.writeFile(path.join(data, 'upload-fixture.txt'), fixture);
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
  await page.getByRole('button', { name: '上传文件', exact: true }).click();
  await expect(page.getByRole('button', { name: 'upload-fixture.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下载 upload-fixture.txt', exact: true }).click();
  await expect
    .poll(async () => fs.readFile(path.join(data, 'download-result.txt'), 'utf8').catch(() => ''))
    .toBe(fixture);
  assert.deepEqual(errors, []);
  await app.close();
  app = undefined;
  // Relaunch reads the persisted connection with the operating system decryptor.
  app = await electron.launch({ args: ['tests/desktop-entry.cjs'], env, timeout: 60000 });
  const restored = await app.firstWindow();
  await restored.getByRole('button', { name: '桌面集成测试', exact: true }).click();
  await restored.getByRole('button', { name: 'integration-bucket', exact: true }).click();
  await expect(
    restored.getByRole('button', { name: 'native-check.json', exact: true }),
  ).toBeVisible();
  console.log(
    'Desktop smoke passed: custom protocol, isolated IPC, OS encryption, persisted connection, list, preview, native upload and streaming download. Cloud network mocked.',
  );
} finally {
  if (app) await app.close();
  const resolved = path.resolve(data);
  if (
    resolved.startsWith(testRoot + path.sep) &&
    path.basename(resolved).startsWith('desktop-session-')
  )
    await fs.rm(resolved, { recursive: true, force: true });
}
