/**
 * schoomy-spotlive-schedule-web
 * scripts/build-pdf.js v1.0
 *
 * 環境変数:
 *   MONTH    - YYYY-MM (デフォルト: 当月)
 *   VERSION  - v1.0 など (デフォルト: v1.0)
 *   PAGES_URL - GitHub Pages の URL (デフォルト: https://shiojima-test.github.io/schoomy-spotlive-schedule-web)
 *   LOCAL    - 'true' なら ローカルの index.html を file:// で開く
 *
 * 使い方:
 *   npm install
 *   MONTH=2026-05 VERSION=v1.0 npm run build
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const month = process.env.MONTH || new Date().toISOString().slice(0, 7);
const version = process.env.VERSION || 'v1.0';
const pagesUrl = process.env.PAGES_URL || 'https://shiojima-test.github.io/schoomy-spotlive-schedule-web';
const isLocal = process.env.LOCAL === 'true';

const url = isLocal
  ? 'file://' + path.resolve(__dirname, '../index.html') + `?month=${month}`
  : `${pagesUrl}/?month=${month}`;

const outputDir = path.resolve(__dirname, '../output');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `schoomy-spotlive-schedule_${month}_${version}.pdf`);

(async () => {
  console.log('PDFビルド開始');
  console.log('  URL:', url);
  console.log('  月:', month);
  console.log('  バージョン:', version);
  console.log('  出力:', outputPath);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('[browser error]', err));

  await page.goto(url, { waitUntil: 'networkidle' });

  // データ描画完了を待つ
  await page.waitForFunction(
    () => document.querySelectorAll('#schedule-table .sched-cell').length > 5
       && document.querySelectorAll('#catalog-grid .cat-column').length === 4,
    { timeout: 30000 }
  );

  // フォントロードを待つ
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  await page.pdf({
    path: outputPath,
    width: '210mm',
    height: '257mm',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  });

  await browser.close();
  console.log('完了:', outputPath);
})().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
