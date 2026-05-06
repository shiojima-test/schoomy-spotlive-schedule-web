import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8000/index.html?month=2026-05', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
const result = await page.evaluate(() => {
  const mm = px => +(px / (96/25.4)).toFixed(2);
  const cards = document.querySelectorAll('.show-card');
  return Array.from(cards).map(c => ({
    h: mm(c.getBoundingClientRect().height),
    titleH: mm(c.querySelector('.sc-title').getBoundingClientRect().height),
    titleText: c.querySelector('.sc-title').textContent,
    descH: mm(c.querySelector('.sc-desc').getBoundingClientRect().height),
    descText: c.querySelector('.sc-desc').textContent,
  }));
});
result.forEach((r, i) => console.log(`#${i} h=${r.h} title=${r.titleH} ("${r.titleText}") desc=${r.descH} ("${r.descText.slice(0, 30)}...")`));
await browser.close();
