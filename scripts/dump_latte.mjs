const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5qcYlVWjKjBkMGcBvuLIH-JXuP6STOWx1j2ZjtjiAtk4mnHQhOfMYfVnuh8tYVmkhnYVg2CYsugge/pub?output=csv&gid=1588173790';
const csvText = await (await fetch(url)).text();
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
const I = (n) => header.indexOf(n);
const COL = { id: I('コマID'), title: I('講座タイトル(日本語)'), latte: I('ラテ欄用記事仮文') };
for (let i = headerIdx + 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r[COL.id]?.trim()) continue;
  console.log(`${r[COL.id]}\t${r[COL.title]}\t${r[COL.latte]}`);
}
