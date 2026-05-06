import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8000/index.html?month=2026-05', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
const result = await page.evaluate(() => {
  const mm = px => +(px / (96/25.4)).toFixed(3);
  const cells = document.querySelectorAll('.sched-cell.sched-content');
  return Array.from(cells).map((c, i) => {
    const blocks = c.querySelectorAll('.slot-block');
    return {
      i,
      h: mm(c.getBoundingClientRect().height),
      slotsH: Array.from(blocks).map(b => mm(b.getBoundingClientRect().height)),
      slotsLine1H: Array.from(blocks).map(b => mm(b.querySelector('.slot-line1').getBoundingClientRect().height)),
      slotsDescH: Array.from(blocks).map(b => mm(b.querySelector('.slot-desc').getBoundingClientRect().height)),
      slotsDesc: Array.from(blocks).map(b => b.querySelector('.slot-desc').textContent),
    };
  });
});
for (const r of result) {
  console.log(`#${r.i} h=${r.h}`);
  for (let j = 0; j < r.slotsH.length; j++) {
    console.log(`  slot[${j}] block=${r.slotsH[j]} line1=${r.slotsLine1H[j]} desc=${r.slotsDescH[j]} text="${r.slotsDesc[j]}"`);
  }
}
await browser.close();
