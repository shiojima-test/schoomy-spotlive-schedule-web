import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8000/index.html?month=2026-05', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

// Tap into the catalog data via fetched CSV directly
const csvText = await page.evaluate(async () => {
  const r = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vT5qcYlVWjKjBkMGcBvuLIH-JXuP6STOWx1j2ZjtjiAtk4mnHQhOfMYfVnuh8tYVmkhnYVg2CYsugge/pub?output=csv&gid=1588173790');
  return await r.text();
});

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuote) {
      if (c === '"' && next === '"') { cell += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cell += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') {}
      else cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const rows = parseCSV(csvText);
const headerIdx = rows.findIndex(r => r.includes('ジャンル') && r.includes('コマID'));
const header = rows[headerIdx];
const idx = (n) => header.indexOf(n);
const COL = {
  id: idx('コマID'), titleJa: idx('講座タイトル(日本語)'),
  sub: idx('サブタイトル/カテゴリ'), content: idx('内容(本文)'),
  goal: idx('目標'), latte: idx('ラテ欄用記事仮文'),
};
console.log('Field lengths for first 6 entries:');
console.log('id | title | sub | content | goal | latte');
for (let i = headerIdx + 1; i < Math.min(headerIdx + 7, rows.length); i++) {
  const r = rows[i];
  if (!r[COL.id]?.trim()) continue;
  console.log(`${r[COL.id]} | t=${(r[COL.titleJa]||'').length} | sub=${(r[COL.sub]||'').length} | content=${(r[COL.content]||'').length} | goal=${(r[COL.goal]||'').length} | latte=${(r[COL.latte]||'').length}`);
  console.log(`  latte: "${(r[COL.latte]||'').slice(0, 80)}"`);
  console.log(`  goal:  "${r[COL.goal]||''}"`);
  console.log(`  sub:   "${r[COL.sub]||''}"`);
}
await browser.close();
