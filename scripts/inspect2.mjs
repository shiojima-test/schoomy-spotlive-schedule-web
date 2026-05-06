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
        const name = b.querySelector('.name');
        const desc = b.querySelector('.slot-desc');
        return {
          name: name?.textContent || '',
          nameH: name ? mm(name.getBoundingClientRect().height) : 0,
          descLen: desc?.textContent?.length || 0,
        };
      }),
    };
  });
});
const tall = result.filter(r => r.h > 27);
const short = result.filter(r => r.h > 0 && r.h < 27 && r.slots.length > 0);
console.log('TALL CELL EXAMPLE:', JSON.stringify(tall[0], null, 2));
console.log('SHORT CELL EXAMPLE:', JSON.stringify(short[0], null, 2));
await browser.close();
