import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'cover-landscape.svg', exact: true }),
  ).toBeVisible();
});

test('workspace restores open tabs and paths, and bookmarks navigate after reload', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'images', exact: true }).dblclick();
  await page.getByRole('button', { name: '收藏当前路径', exact: true }).click();
  await page.getByRole('button', { name: 'project-backups', exact: true }).click();
  await page.getByRole('button', { name: '2026', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'manifest.json', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'manifest.json', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-tab')).toHaveCount(2);
  await page.locator('.bookmarks').getByRole('button', { name: 'images', exact: true }).click();
  await expect(page.getByRole('button', { name: 'morning-hills.svg', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除收藏 images', exact: true }).click();
  await page.reload();
  await expect(page.locator('.bookmarks')).toHaveCount(0);
});

test('directory tree expands lazily, navigates nested folders and refreshes after creation', async ({
  page,
}) => {
  const sidebar = page.locator('.connection-tree');
  await expect(sidebar.getByRole('button', { name: '打开目录 images/', exact: true })).toHaveCount(
    0,
  );
  await sidebar.getByRole('button', { name: '展开目录 studio-assets', exact: true }).click();
  await sidebar.getByRole('button', { name: '打开目录 images/', exact: true }).click();
  await expect(page.getByRole('button', { name: 'morning-hills.svg', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '文件夹名称' }).fill('nested');
  await page.getByRole('button', { name: '创建文件夹', exact: true }).click();
  await expect(
    sidebar.getByRole('button', { name: '打开目录 images/nested/', exact: true }),
  ).toBeVisible();
  await sidebar.getByRole('button', { name: '打开目录 images/nested/', exact: true }).click();
  await expect(page.locator('.breadcrumbs')).toContainText('nested');
  await expect(
    sidebar.getByRole('button', { name: '打开目录 images/nested/', exact: true }).locator('..'),
  ).toHaveClass(/active/);
  await sidebar.getByRole('button', { name: '收起目录 studio-assets', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: '打开目录 images/', exact: true })).toHaveCount(
    0,
  );
  await sidebar.getByRole('button', { name: '展开目录 studio-assets', exact: true }).click();
  await expect(
    sidebar.getByRole('button', { name: '打开目录 images/nested/', exact: true }),
  ).toBeVisible();
  await expect(sidebar.locator('.spin')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/directory-tree.png', animations: 'disabled' });
});
test('browse folders, back, recursive search, text preview and tabs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'cover-landscape.svg', exact: true }).click();
  await expect(page.locator('.image-preview img')).toBeVisible();
  await page.getByRole('button', { name: 'images', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'morning-hills.svg', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '搜索范围' }).selectOption('recursive');
  await page.getByRole('textbox', { name: '搜索文件' }).fill('guidelines');
  await page.getByRole('textbox', { name: '搜索文件' }).press('Enter');
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
  await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles(payload);
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByRole('button', { name: 'uploaded.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'uploaded.txt', exact: true }).click();
  await expect(page.locator('.text-preview')).toContainText('Hello 上传测试');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 uploaded.txt', exact: true }).click();
  const download = await downloadEvent;
  const downloaded = await fs.readFile((await download.path())!);
  expect(downloaded.equals(payload.buffer)).toBe(true);
  await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles(payload);
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('0 个成功，1 个失败');
  await page.getByRole('button', { name: /传输中心/ }).click();
  await expect(page.locator('.transfer-status.failed')).toHaveCount(1);
  await expect(page.getByText('同名文件已存在，本次上传未覆盖')).toBeVisible();
  await page.getByRole('button', { name: '失败', exact: true }).click();
  await expect(page.locator('.transfer-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '查看传输任务' })).toContainText('1 个失败');
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
  await expect(page.getByRole('alert')).toContainText('真实存储连接需要桌面客户端');
});
test('visual workspace at desktop and narrow widths', async ({ page }) => {
  await page.getByRole('button', { name: 'cover-landscape.svg', exact: true }).click();
  await expect(page.locator('.image-preview img')).toBeVisible();
  await page.screenshot({
    path: 'test-results/workspace-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '新建存储连接', exact: true }).click();
  await page.screenshot({
    path: 'test-results/connection-dialog.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '切换深色主题', exact: true }).click();
  await page.screenshot({
    path: 'test-results/workspace-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '新建存储连接', exact: true }).click();
  await page.screenshot({
    path: 'test-results/connection-dialog-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '切换浅色主题', exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: 'test-results/workspace-compact.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.getByRole('button', { name: '关闭预览' }).click();
  for (const selector of ['.path-toolbar', '.file-toolbar']) {
    expect(await page.locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  }
});

test('custom S3 connection fields, HTTP opt-in and settings submission', async ({ page }) => {
  page.setDefaultTimeout(10000);
  await page.getByRole('button', { name: '新建存储连接', exact: true }).click();
  await page.getByRole('button', { name: 'S3 兼容', exact: true }).click();
  await expect(page.getByLabel('Region', { exact: true })).toHaveValue('us-east-1');
  await expect(page.getByRole('combobox', { name: '访问方式' })).toHaveValue('path');
  await page.getByRole('textbox', { name: '连接名称', exact: true }).fill('S3 自建服务');
  await page.getByRole('textbox', { name: 'Endpoint', exact: true }).fill('http://127.0.0.1:9000');
  await page.getByRole('textbox', { name: 'Access Key ID', exact: true }).fill('example-key');
  await page.getByLabel('Secret Access Key', { exact: true }).fill('example-secret');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('显式勾选');
  await page.getByRole('checkbox', { name: /允许 HTTP 连接/ }).check();
  await page.getByRole('combobox', { name: '访问方式' }).selectOption('virtual');
  await page.getByRole('button', { name: '高级配置', exact: true }).click();
  await page.getByRole('textbox', { name: /Session Token/ }).fill('example-session-token');
  await page.evaluate(() => {
    window.ossDesk = {
      platform: 'test',
      async testConnection(input: unknown) {
        (window as any).__s3Input = input;
        return { buckets: [{ name: 'media.bucket', region: 'us-east-1' }] };
      },
    } as unknown as NonNullable<Window['ossDesk']>;
  });
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接成功，可访问 1 个存储桶');
  expect(await page.evaluate(() => (window as any).__s3Input)).toMatchObject({
    provider: 's3',
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    forcePathStyle: false,
    allowInsecure: true,
    stsToken: 'example-session-token',
  });
  // Return to a representative Path-style setup for the configuration preview.
  await page.getByRole('combobox', { name: '访问方式' }).selectOption('path');
  await page.getByRole('button', { name: '收起高级配置', exact: true }).click();
  await page.screenshot({
    path: 'test-results/s3-connection.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('single click selects, double click opens and inspector preference persists', async ({
  page,
}) => {
  const folder = page.getByRole('button', { name: 'images', exact: true });
  await folder.click();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '选择 images', exact: true })).toBeChecked();
  await folder.dblclick();
  await expect(page.getByRole('button', { name: 'morning-hills.svg', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭预览' }).click();
  await page.getByRole('button', { name: 'morning-hills.svg', exact: true }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.getByRole('button', { name: 'morning-hills.svg', exact: true }).dblclick();
  await expect(page.locator('.image-preview img')).toBeVisible();
});

test('range selection, partial select-all, context menu and grid use one selection', async ({
  page,
}) => {
  const row = (key: string) => page.locator(`[data-object-key="${key}"]`);
  await row('design-tokens.json').click();
  await row('release-notes.md').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-object-key][aria-selected="true"]')).toHaveCount(3);
  await expect(page.getByRole('checkbox', { name: '选择筛选后已加载的所有项目' })).toBeChecked({
    indeterminate: true,
  });
  const toolbarHeight = await page
    .locator('.file-toolbar')
    .evaluate((el) => el.getBoundingClientRect().height);
  await row('README.md').click({ button: 'right' });
  await expect(page.locator('[data-object-key][aria-selected="true"]')).toHaveCount(3);
  await expect(page.getByRole('menuitem', { name: '下载所选', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '预览文件' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: '网格视图' }).click();
  await expect(page.locator('.object-card.selected')).toHaveCount(3);
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.getByRole('checkbox', { name: '选择筛选后已加载的所有项目' })).toBeChecked({
    indeterminate: true,
  });
  await row('cover-landscape.svg').click({ button: 'right' });
  await expect(page.locator('[data-object-key][aria-selected="true"]')).toHaveCount(1);
  await page.getByRole('menuitem', { name: /预览文件/ }).click();
  await expect(page.locator('.image-preview img')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(
    await page.locator('.file-toolbar').evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(toolbarHeight);
  await page.locator('.file-list-area').click({ position: { x: 50, y: 500 }, button: 'right' });
  await expect(page.getByRole('menuitem', { name: '新建文件夹', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: '刷新', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
});

test('keyboard navigation and editable paths leave text editing intact', async ({ page }) => {
  await page.locator('.file-list-area').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('checkbox', { name: '选择 brand', exact: true })).toBeChecked();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(3);
  await page.keyboard.press('Control+a');
  await expect(page.locator('[data-object-key][aria-selected="true"]')).toHaveCount(8);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+l');
  await page.getByRole('textbox', { name: '目录路径', exact: true }).fill('images');
  await page.getByRole('textbox', { name: '目录路径', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'morning-hills.svg', exact: true })).toBeVisible();
  await page.locator('.file-list-area').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('button', { name: 'morning-hills.svg', exact: true })).toBeVisible();
  await page.keyboard.press('Control+l');
  await page.getByRole('textbox', { name: '目录路径', exact: true }).fill('cancelled');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: '目录路径', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'morning-hills.svg', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索文件', exact: true }).fill('morning');
  await page.keyboard.press('Control+a');
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '搜索文件' })).toHaveValue('morning');
});

test('local filtering and submitted recursive search have explicit scopes', async ({ page }) => {
  const search = page.getByRole('textbox', { name: '搜索文件' });
  await search.fill('guidelines');
  await expect(page.locator('[data-object-key]')).toHaveCount(0);
  await expect(page.locator('.search-summary')).toContainText('当前已加载列表');
  await page.getByRole('combobox', { name: '搜索范围' }).selectOption('recursive');
  await expect(page.getByRole('button', { name: 'brand/guidelines.md', exact: true })).toHaveCount(
    0,
  );
  await search.press('Enter');
  await expect(
    page.getByRole('button', { name: 'brand/guidelines.md', exact: true }),
  ).toBeVisible();
  await search.fill('not-submitted');
  await expect(
    page.getByRole('button', { name: 'brand/guidelines.md', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.search-summary')).toContainText('关键词已修改');
  await search.press('Enter');
  await expect(page.locator('.large-empty')).toContainText('没有找到匹配文件');
  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
});

test('tabs preserve selection, filters, sorting and scroll independently', async ({ page }) => {
  await page.getByRole('button', { name: '文件夹', exact: true }).click();
  await page.getByRole('button', { name: '文件名称', exact: true }).click();
  await page.getByRole('button', { name: 'images', exact: true }).click();
  await page.getByRole('button', { name: 'project-backups', exact: true }).click();
  await page.locator('.workspace-tab .tab-main').filter({ hasText: 'studio-assets' }).click();
  await expect(page.getByRole('checkbox', { name: '选择 images', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '取消选择' }).click();
  await expect(page.locator('.filter-tabs button.active')).toHaveText('文件夹');
  await expect(page.locator('[data-object-key]').first()).toHaveAttribute(
    'data-object-key',
    'images/',
  );
  await page.getByRole('button', { name: '全部文件', exact: false }).click();
  await page.evaluate(async () => {
    const modulePath = '/src/lib/demo.ts';
    const { demo } = await import(/* @vite-ignore */ modulePath);
    const original = demo.list;
    demo.list = async (request: { bucket: string }) =>
      request.bucket !== 'studio-assets'
        ? original(request)
        : {
            objects: Array.from({ length: 120 }, (_, index) => ({
              key: `file-${index.toString().padStart(3, '0')}.txt`,
              name: `file-${index.toString().padStart(3, '0')}.txt`,
              kind: 'file',
              size: 10,
              lastModified: '2026-11-20T00:00:00Z',
              storageClass: 'Standard',
            })),
          };
  });
  await page.getByRole('button', { name: '刷新文件', exact: true }).click();
  await expect(page.locator('[data-object-key]')).toHaveCount(120);
  await page.locator('.file-list-area').evaluate((el) => {
    el.scrollTop = 900;
  });
  await expect.poll(() => page.locator('.file-list-area').evaluate((el) => el.scrollTop)).toBe(900);
  await page.locator('.workspace-tab .tab-main').filter({ hasText: 'project-backups' }).click();
  await page.locator('.workspace-tab .tab-main').filter({ hasText: 'studio-assets' }).click();
  await expect(page.locator('[data-object-key]')).toHaveCount(120);
  await expect.poll(() => page.locator('.file-list-area').evaluate((el) => el.scrollTop)).toBe(900);
  await page.getByRole('button', { name: '查看传输任务', exact: true }).click();
  await page.getByRole('button', { name: '文件浏览', exact: true }).click();
  await expect.poll(() => page.locator('.file-list-area').evaluate((el) => el.scrollTop)).toBe(900);
});

test('preview can retry and clipboard failures are visible', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async (value: string) => {
        (window as any).__copiedPath = value;
      },
      configurable: true,
    });
  });
  await page.getByRole('button', { name: '复制当前路径', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copiedPath)).toBe('studio-assets/');
  await page.evaluate(async () => {
    const modulePath = '/src/lib/demo.ts';
    const { demo } = await import(/* @vite-ignore */ modulePath);
    const original = demo.preview;
    let attempts = 0;
    demo.preview = (...args: unknown[]) => {
      if (++attempts === 1) return Promise.reject(new Error('预览暂时失败'));
      return original(...args);
    };
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: () => Promise.reject(new Error('denied')),
      configurable: true,
    });
  });
  await page.getByRole('button', { name: 'README.md', exact: true }).dblclick();
  await expect(page.locator('.preview-placeholder')).toContainText('预览暂时失败');
  await page.getByRole('button', { name: '重新预览', exact: true }).click();
  await expect(page.locator('.text-preview')).toContainText('StorDock');
  await page.getByRole('button', { name: '复制对象路径', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('复制失败');
});

test('object details expose copyable keys, exact sizes and content type with independent retry', async ({
  page,
}) => {
  await page.evaluate(async () => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (value: string) => {
        (window as any).__copiedInfo = value;
      },
    });
    const modulePath = '/src/lib/demo.ts';
    const { demo } = await import(/* @vite-ignore */ modulePath);
    const original = demo.objectInfo;
    let attempts = 0;
    demo.objectInfo = (...args: unknown[]) =>
      ++attempts === 1 ? Promise.reject(new Error('属性暂时不可用')) : original(...args);
  });
  await page.getByRole('button', { name: 'README.md', exact: true }).dblclick();
  await page.getByRole('button', { name: '对象信息', exact: true }).click();
  await expect(page.locator('.metadata')).toContainText('Region');
  await expect(page.locator('.metadata')).toContainText('字节');
  await expect(page.locator('.metadata')).toContainText('属性暂时不可用');
  await page.getByRole('button', { name: '复制对象路径', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copiedInfo)).toBe('README.md');
  await page.getByRole('button', { name: '重新读取属性', exact: true }).click();
  await expect(page.locator('.metadata')).toContainText('text/plain');
  await page.getByRole('button', { name: '复制完整对象路径', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copiedInfo)).toBe('studio-assets/README.md');
  await expect(page.locator('.metadata')).toContainText('本地演示空间，不提供真实 HTTP 访问地址');
});

test('empty recursive results can continue scanning and same query can refresh', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const modulePath = '/src/lib/demo.ts';
    const { demo } = await import(/* @vite-ignore */ modulePath);
    const original = demo.list;
    demo.list = async (request: { query?: string; cursor?: string }) => {
      if (!request.query) return original(request);
      if (!request.cursor) return { objects: [], scanned: 1000, cursor: 'next-page' };
      return {
        objects: [
          {
            key: 'nested/match.txt',
            name: 'nested/match.txt',
            kind: 'file',
            size: 10,
            lastModified: '2026-11-20T00:00:00Z',
            storageClass: 'Standard',
          },
        ],
        scanned: 50,
      };
    };
  });
  await page.getByRole('combobox', { name: '搜索范围' }).selectOption('recursive');
  await page.getByRole('textbox', { name: '搜索文件' }).fill('match');
  await page.getByRole('textbox', { name: '搜索文件' }).press('Enter');
  await expect(page.locator('.search-summary')).toContainText('已扫描 1000 个对象');
  await expect(page.locator('[data-object-key]')).toHaveCount(0);
  await page.getByRole('button', { name: '继续扫描更多对象', exact: true }).click();
  await expect(page.getByRole('button', { name: 'nested/match.txt', exact: true })).toBeVisible();
  await expect(page.locator('.search-summary')).toContainText('已扫描 1050 个对象，扫描完成');
  await page.getByRole('textbox', { name: '搜索文件' }).fill('other');
  await page.getByRole('textbox', { name: '搜索文件' }).press('Enter');
  await expect(page.locator('.search-summary')).toContainText('已扫描 1000 个对象');
  await page.getByRole('textbox', { name: '搜索文件' }).fill('match');
  await page.getByRole('textbox', { name: '搜索文件' }).press('Enter');
  await expect(page.getByRole('button', { name: '继续扫描更多对象', exact: true })).toBeVisible();
  await expect(page.locator('[data-object-key]')).toHaveCount(0);
  await page.getByRole('button', { name: '继续扫描更多对象', exact: true }).click();
  await expect(page.getByRole('button', { name: 'nested/match.txt', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索文件' }).press('Enter');
  await expect(page.getByRole('button', { name: '继续扫描更多对象', exact: true })).toBeVisible();
  await expect(page.locator('[data-object-key]')).toHaveCount(0);
});
