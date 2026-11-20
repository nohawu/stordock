import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
const executablePath = process.argv[2] || path.resolve('release/win-unpacked/StorDock.exe');
const env = { ...process.env, OSS_DESK_SMOKE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OSS_DESK_DEV_URL;
delete env.OSS_DESK_TEST_DATA;
const app = await electron.launch({ executablePath, env, timeout: 60000 });
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
  console.log(
    'Packaged Windows executable passed: ASAR resources, app protocol, preload bridge, demo file list and image preview.',
  );
} finally {
  await app.close();
}
