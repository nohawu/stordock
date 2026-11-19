import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'cover-landscape.svg', exact: true }),
  ).toBeVisible();
});
test('browse folders, back, recursive search, text preview and tabs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('.image-preview img')).toBeVisible();
  await page.getByRole('button', { name: 'images', exact: true }).click();
  await expect(page.getByRole('button', { name: 'morning-hills.svg', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索文件' }).fill('guidelines');
  await expect(
    page.getByRole('button', { name: 'brand/guidelines.md', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'brand/guidelines.md', exact: true }).click();
  await expect(page.locator('.text-preview')).toContainText('Studio Brand');
  await page.getByRole('button', { name: '清除搜索' }).click();
  await page.getByRole('button', { name: 'project-backups', exact: true }).click();
  await expect(page.locator('.workspace-tab')).toHaveCount(2);
  await page.getByRole('button', { name: '关闭 project-backups 标签' }).click();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('create folder, upload, prevent overwrite and download exact content', async ({ page }) => {
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '文件夹名称' }).fill('new-folder');
  await page.getByRole('button', { name: '创建文件夹', exact: true }).click();
  await expect(page.getByRole('button', { name: 'new-folder', exact: true })).toBeVisible();
  const payload = {
    name: 'uploaded.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Hello 上传测试\nContent must round-trip.'),
  };
  await page.locator('input[type=file]').setInputFiles(payload);
  await expect(page.getByRole('button', { name: 'uploaded.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'uploaded.txt', exact: true }).click();
  await expect(page.locator('.text-preview')).toContainText('Hello 上传测试');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 uploaded.txt', exact: true }).click();
  const download = await downloadEvent;
  const downloaded = await fs.readFile((await download.path())!);
  expect(downloaded.equals(payload.buffer)).toBe(true);
  await page.locator('input[type=file]').setInputFiles(payload);
  await expect(page.getByRole('status')).toContainText('上传任务已处理');
  await page.getByRole('button', { name: /传输中心/ }).click();
  await expect(page.locator('.transfer-status.failed')).toHaveCount(1);
  await expect(page.getByText('同名文件已存在，本次上传未覆盖')).toBeVisible();
});
test('selection, filtering, grid, shortcuts and theme', async ({ page }) => {
  await page.getByRole('checkbox', { name: '选择 README.md', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 design-tokens.json', exact: true }).check();
  await expect(page.getByRole('button', { name: '下载所选', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-bar')).toHaveCount(0);
  await page.getByRole('button', { name: '网格视图' }).click();
  await expect(page.locator('.object-card')).toHaveCount(8);
  await page.getByRole('button', { name: '图片', exact: true }).click();
  await expect(page.locator('.object-card')).toHaveCount(1);
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '查找存储桶' }).fill('public');
  await page
    .locator('.command-results')
    .getByRole('button', { name: /public-resources/ })
    .click();
  await expect(page.getByRole('button', { name: 'hello.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('switch', { name: '紧凑列表' }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.app-shell')).toHaveClass(/compact/);
});
test('connection form provides desktop guidance and errors honestly', async ({ page }) => {
  await page.getByRole('button', { name: '新建存储连接', exact: true }).click();
  await expect(page.getByText(/当前为浏览器演示/)).toBeVisible();
  await page.getByRole('textbox', { name: '连接名称', exact: true }).fill('Test');
  await page.getByRole('textbox', { name: 'AccessKey ID', exact: true }).fill('test-key');
  await page.getByLabel('AccessKey Secret', { exact: true }).fill('test-secret');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('真实 OSS 连接需要桌面客户端');
});
test('visual workspace at desktop and narrow widths', async ({ page }) => {
  await expect(page.locator('.image-preview img')).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '新建存储连接', exact: true }).click();
  await page.screenshot({ path: 'test-results/connection-dialog.png', fullPage: true });
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.setViewportSize({ width: 1100, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/workspace-compact.png', fullPage: true });
});
