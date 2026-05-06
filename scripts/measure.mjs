import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8000/index.html?month=2026-05', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
const result = await page.evaluate(() => {
  const mm = px => +(px / (96/25.4)).toFixed(2);
  const pageEl = document.querySelector('.page');
  const cat = document.querySelector('.catalog');
  const sched = document.querySelector('.schedule');
  const schedTable = document.querySelector('.sched-table');
  const footer = document.querySelector('.footer');
  const cells = document.querySelectorAll('.sched-cell.sched-content, .sched-cell.holiday');
  const cellHs = Array.from(cells).map(c => mm(c.getBoundingClientRect().height));
  const pageH = mm(pageEl.getBoundingClientRect().height);
  const pageScrollH = mm(pageEl.scrollHeight);
  const footerBottom = mm(footer.getBoundingClientRect().bottom - pageEl.getBoundingClientRect().top);
  return {
    pageH, pageScrollH,
    overflow: +(pageScrollH - pageH).toFixed(2),
    catalogH: mm(cat.getBoundingClientRect().height),
    scheduleH: mm(sched.getBoundingClientRect().height),
    schedTableH: mm(schedTable.getBoundingClientRect().height),
    footerBottom,
    gapBelowFooter: +(257 - footerBottom).toFixed(2),
    cellHsMin: Math.min(...cellHs), cellHsMax: Math.max(...cellHs),
    catalogCards: document.querySelectorAll('.show-card').length,
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
