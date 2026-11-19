import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const source = await fs.readFile('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const images = await page.evaluate(async (svg) => {
    const image = new Image();
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    await image.decode();
    return [16, 24, 32, 48, 64, 128, 256, 1024].map((size) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return { size, data: canvas.toDataURL('image/png').split(',')[1] };
    });
  }, source);
  await fs.mkdir('build', { recursive: true });
  await fs.writeFile('build/icon.png', Buffer.from(images.at(-1).data, 'base64'));
  const entries = images
    .slice(0, -1)
    .map((i) => ({ size: i.size, bytes: Buffer.from(i.data, 'base64') }));
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((entry, index) => {
    const start = 6 + index * 16;
    header[start] = header[start + 1] = entry.size === 256 ? 0 : entry.size;
    header.writeUInt16LE(1, start + 4);
    header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(entry.bytes.length, start + 8);
    header.writeUInt32LE(offset, start + 12);
    offset += entry.bytes.length;
  });
  await fs.writeFile('build/icon.ico', Buffer.concat([header, ...entries.map((e) => e.bytes)]));
} finally {
  await browser.close();
}
