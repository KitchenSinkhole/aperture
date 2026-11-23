#!/usr/bin/env node
/** Short panel tab drag clip → build2c/panel-dnd.webm (requires NODE_PATH playwright). */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.env.HARNESS_PLAYWRIGHT_PATH ?? process.env.NODE_PATH?.split(':')[0];
const { chromium } = require(join(root, 'playwright'));

const storagePath = process.argv[2] ?? '/tmp/ap-harness.json';
const out = process.argv[3] ?? '/opt/cursor/artifacts/real-ui/build2c/panel-dnd.webm';
const base = process.env.HARNESS_BASE_URL ?? 'http://127.0.0.1:3005';

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: storagePath,
  recordVideo: { dir: '/tmp', size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(`${base}/map/12`, { waitUntil: 'networkidle', timeout: 120_000 });
const handle = await page.locator('[data-panel-id="inspector"] button').first().boundingBox();
if (handle) {
  await page.mouse.move(handle.x + 20, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 200, handle.y + 120, { steps: 20 });
  await page.mouse.up();
}
await page.waitForTimeout(800);
const video = page.video();
await context.close();
await browser.close();
if (video) await video.saveAs(out);
console.log(`Saved ${out}`);
