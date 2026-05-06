import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8000/index.html?month=2026-05', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
const result = await page.evaluate(() => {
  const mm = px => +(px / (96/25.4)).toFixed(2);
  const cells = document.querySelectorAll('.sched-cell.sched-content, .sched-cell.holiday');
  return Array.from(cells).map(c => {
    const h = mm(c.getBoundingClientRect().height);
    const blocks = c.querySelectorAll('.slot-block');
    return {
      h,
      slots: Array.from(blocks).map(b => {
        const desc = b.querySelector('.slot-desc');
        const descRect = desc ? desc.getBoundingClientRect() : null;
        return {
          name: b.querySelector('.name')?.textContent || '',
          desc: desc?.textContent || '',
          descLen: desc?.textContent?.length || 0,
          descH: descRect ? mm(descRect.height) : 0,
        };
      }),
    };
  });
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
