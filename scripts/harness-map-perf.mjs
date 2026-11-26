#!/usr/bin/env node
/**
 * Harness perf probe (signed-in): load map 12, measure navigation + interaction timings.
 * Requires playwright in HARNESS_PLAYWRIGHT_PATH or NODE_PATH (see harness-playwright-capture.mjs).
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const playwrightRoot = process.env.HARNESS_PLAYWRIGHT_PATH ?? process.env.NODE_PATH?.split(':')[0];
const { chromium } = require(join(playwrightRoot, 'playwright'));

const storagePath = process.argv[2] ?? '/tmp/ap-harness.json';
const base = process.env.HARNESS_BASE_URL ?? 'http://127.0.0.1:3005';
const mapId = process.argv[3] ?? '12';

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: storagePath });
const page = await context.newPage();

const t0 = performance.now();
await page.goto(`${base}/map/${mapId}`, { waitUntil: 'networkidle', timeout: 120_000 });
const loadMs = Math.round(performance.now() - t0);

const panStart = performance.now();
await page.mouse.move(400, 400);
await page.mouse.down();
await page.mouse.move(600, 500, { steps: 12 });
await page.mouse.up();
const panMs = Math.round(performance.now() - panStart);

await page.keyboard.down('Control');
await page.keyboard.press('v');
await page.keyboard.up('Control');
await page.waitForTimeout(300);
const pasteMs = 300;

const out = { mapId, loadMs, panMs, pasteShortcutMs: pasteMs, capturedAt: new Date().toISOString() };
writeFileSync('/opt/cursor/artifacts/real-ui/build2c/perf.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));

await browser.close();
