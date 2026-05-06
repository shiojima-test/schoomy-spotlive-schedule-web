import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8000/index.html?month=2026-05', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
const result = await page.evaluate(() => {
  const mm = px => +(px / (96/25.4)).toFixed(2);
  const els = ['.page', '.header', '.notice-strip', '.legend', '.catalog', '.catalog .section-title', '.catalog-grid', '.schedule', '.schedule .section-title', '.sched-table', '.footer'];
  const out = {};
  for (const sel of els) {
    const e = document.querySelector(sel);
    if (e) out[sel] = mm(e.getBoundingClientRect().height);
  }
  return out;
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
