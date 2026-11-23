import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
const executablePath = process.argv[2] || path.resolve('release/win-unpacked/StorDock.exe');
const testRoot = path.resolve('test-results');
await fs.mkdir(testRoot, { recursive: true });
const profile = await fs.mkdtemp(path.join(testRoot, 'package-session-'));
const env = { ...process.env, OSS_DESK_SMOKE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OSS_DESK_DEV_URL;
delete env.OSS_DESK_TEST_DATA;
const app = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${profile}`],
  env,
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await expect(
    page.getByRole('button', { name: 'cover-landscape.svg', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'cover-landscape.svg', exact: true }).dblclick();
  await expect(page.locator('.image-preview img')).toBeVisible();
  const state = await app.evaluate(({ app }) => ({ packaged: app.isPackaged }));
  if (!state.packaged) throw new Error('Expected a packaged application');
  if (!(await page.evaluate(() => !!window.ossDesk)))
    throw new Error('Preload bridge did not initialize');
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
  if (
    !(await app.evaluate(
      async ({ clipboard }) => (await clipboard.readText()) === 'cover-landscape.svg',
    ))
  )
    throw new Error('Packaged native clipboard copy failed');
  console.log(
    'Packaged Windows executable passed: ASAR resources, app protocol, preload bridge, demo file list and image preview.',
  );
} finally {
  await app.close();
  if (path.dirname(profile) === testRoot && path.basename(profile).startsWith('package-session-'))
    await fs.rm(profile, { recursive: true, force: true });
}
