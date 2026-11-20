import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'cover-landscape.svg', exact: true }),
  ).toBeVisible();
});
test('file rename, folder copy, move and typed delete confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: '新名称' }).fill('readme-renamed.md');
  await page.getByRole('button', { name: '统计操作范围', exact: true }).click();
  await expect(page.locator('.operation-summary')).toContainText('重命名 1 个对象');
  await page.getByRole('button', { name: '确认重命名', exact: true }).click();
  await expect(page.getByRole('button', { name: 'readme-renamed.md', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'images', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '复制到…', exact: true }).click();
  await page.getByRole('textbox', { name: '目标目录', exact: true }).fill('archive/');
  await page.getByRole('button', { name: '统计操作范围', exact: true }).click();
  await expect(page.locator('.operation-summary')).toContainText('复制 3 个对象');
  await page.screenshot({ path: 'test-results/object-operation.png', animations: 'disabled' });
  await page.getByRole('button', { name: '确认复制', exact: true }).click();
  await expect(page.getByRole('button', { name: 'archive', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'readme-renamed.md', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移动到…', exact: true }).click();
  await page.getByRole('textbox', { name: '目标目录', exact: true }).fill('archive/');
  await page.getByRole('button', { name: '统计操作范围', exact: true }).click();
  await page.getByRole('button', { name: '确认移动', exact: true }).click();
  await expect(page.getByRole('button', { name: 'readme-renamed.md', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'archive', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'readme-renamed.md', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一级', exact: true }).click();
  await page.getByRole('button', { name: 'archive', exact: true }).click();
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: '统计操作范围', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认删除', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '删除确认', exact: true }).fill('删除');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('button', { name: 'archive', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'images', exact: true })).toBeVisible();
});
test('upload conflict policies require explicit overwrite confirmation', async ({ page }) => {
  const input = page.locator('input[type=file]:not([webkitdirectory])');
  const payload = {
    name: 'README.md',
    mimeType: 'text/plain',
    buffer: Buffer.from('replacement text'),
  };
  await input.setInputFiles(payload);
  await page.getByRole('combobox', { name: '同名文件处理' }).selectOption('skip');
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 个跳过');
  await input.setInputFiles(payload);
  await page.getByRole('combobox', { name: '同名文件处理' }).selectOption('rename');
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByRole('button', { name: 'README (1).md', exact: true })).toBeVisible();
  await input.setInputFiles(payload);
  await page.getByRole('combobox', { name: '同名文件处理' }).selectOption('overwrite');
  await expect(page.getByRole('button', { name: '开始上传', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '我确认覆盖目标中的同名文件' }).check();
  await page.screenshot({ path: 'test-results/upload-confirmation.png', animations: 'disabled' });
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 个成功');
  await page.getByRole('button', { name: 'README.md', exact: true }).dblclick();
  await expect(page.locator('.text-preview')).toContainText('replacement text');
});
test('folder input preserves hierarchy and selected folders download their files', async ({
  page,
}) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stordock-ui-'));
  try {
    const root = path.join(dir, 'folder-upload');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub', 'nested.txt'), 'folder round trip');
    await page.locator('input[webkitdirectory]').setInputFiles(root);
    await expect(page.getByRole('dialog')).toContainText('folder-upload/sub/nested.txt');
    await page.getByRole('button', { name: '开始上传', exact: true }).click();
    await expect(page.getByRole('button', { name: 'folder-upload', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'folder-upload', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载所选', exact: true }).click();
    const download = await downloaded;
    expect(await fs.readFile((await download.path())!, 'utf8')).toBe('folder round trip');
  } finally {
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('stordock-ui-')
    )
      throw new Error('Invalid cleanup path');
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('cancel and retry preserve the original task and clear excludes active tasks', async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
      const reader = this;
      setTimeout(() => original.call(reader, blob), 800);
    };
  });
  await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles({
    name: 'cancel-me.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('retry content'),
  });
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await page.getByRole('button', { name: '查看传输任务', exact: true }).click();
  await page.getByRole('button', { name: '取消任务 cancel-me.txt', exact: true }).click();
  await expect(page.locator('.transfer-status.cancelled')).toHaveCount(1);
  await page.getByRole('button', { name: '重试任务 cancel-me.txt', exact: true }).click();
  await expect(page.getByRole('button', { name: '清除已结束', exact: true })).toBeDisabled();
  await expect(page.locator('.transfer-status.completed')).toHaveCount(1);
  await expect(page.locator('.transfer-row')).toHaveCount(1);
  await page.getByRole('button', { name: '文件浏览', exact: true }).click();
  await expect(page.getByRole('button', { name: 'cancel-me.txt', exact: true })).toBeVisible();
});
