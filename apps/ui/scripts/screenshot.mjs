import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../../docs/ui/screenshots/m2-combat.png');

const server = await preview({
  root,
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  }
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4173/deckbuilding-roguelite/?seed=BRAVE-EMBER-42', { waitUntil: 'networkidle' });
  await mkdir(dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage: false });
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.httpServer.close(resolveClose));
}
