/* ============================================
   schoomy-spotlive-schedule-web
   render.js v1.0
   v7.3デザインに、Google Sheets CSVの内容を流し込む
   (5月号固定で動作)
   ============================================ */

const CSV_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT5qcYlVWjKjBkMGcBvuLIH-JXuP6STOWx1j2ZjtjiAtk4mnHQhOfMYfVnuh8tYVmkhnYVg2CYsugge/pub';

const GID = {
  CATALOG: '1588173790',      // 番組統合表
  SCHEDULE_H1: '552343211',    // 上半期(4-8月)
};

function csvUrl(gid) {
  return `${CSV_BASE}?output=csv&gid=${gid}`;
}

const CATEGORIES = [
  { key: 'a', name: '課題解決',           en: 'PROBLEM  SOLVING',      prefix: '課題' },
  { key: 'b', name: 'コネクター活用',     en: 'CONNECTOR  IN  ACTION', prefix: 'コネ' },
  { key: 'c', name: 'データサイエンス',   en: 'DATA  SCIENCE',         prefix: '情報' },
  { key: 'd', name: '物理シミュレーション', en: 'PHYSICS  ／  ENGLISH',  prefix: 'Pro' },
];

const DAYS_JP = ['月', '火', '水', '木', '金'];
const DAYS_EN = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

// 1コマ=30分×3 で1番組(=90分)。先頭スロットの担当列インデックス(右隣が番組ID)
const SLOT_COLS = [
  { time: '10:20', col: 5 },
  { time: '13:20', col: 11 },
  { time: '14:50', col: 17 },
];

// 5月の有効週(W1-W4)。W="5(1)"等の月跨ぎ行は除外
const VALID_WEEKS = ['1', '2', '3', '4'];

// =========== エントリーポイント ===========
init().catch(err => {
  console.error('[render] error:', err);
  document.title = 'エラー — スクーミースポットライブ放送スケジュール';
});

async function init() {
  const month = '2026-05'; // 5月号固定

  // 1. ヘッダー
  setHeader(month);

  // 2. CSV取得
  const [catalogText, scheduleText] = await Promise.all([
    fetchCSV(GID.CATALOG),
    fetchCSV(GID.SCHEDULE_H1),
  ]);

  const catalog = parseCatalog(parseCSV(catalogText));
  const monthRows = parseMonthSchedule(parseCSV(scheduleText), 5);

  // 3. その月で初回放送される番組を集める(各カテゴリ4本)
  const firstAirByProgram = collectFirstAir(monthRows);
  const newPrograms = groupByCategory(firstAirByProgram);

  // 4. カタログ描画
  renderCatalog(newPrograms, catalog);

  // 5. スケジュール表描画
  renderSchedule(monthRows, catalog, firstAirByProgram, month);
}

// =========== ヘッダー ===========
function setHeader(month) {
  const [y, m] = month.split('-');
  const mNum = parseInt(m, 10);
  document.getElementById('issue-text').textContent = `${y}年${mNum}月号 ／ ISSUE  No.${mNum}`;
  document.getElementById('month-mark').textContent = `${mNum}月号`;
  document.getElementById('subline-desc').textContent = '毎日20分、4ジャンルの授業をライブ配信。今月は新作16タイトルをお届け。';
  document.title = `スクーミースポットライブ放送スケジュール ${y}年${mNum}月号 v1.0`;
}

// =========== CSV取得・パース ===========
async function fetchCSV(gid) {
  const res = await fetch(csvUrl(gid));
  if (!res.ok) throw new Error(`CSV取得失敗 gid=${gid} status=${res.status}`);
  return await res.text();
}

// RFC4180 最小準拠
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

// =========== 番組統合表のパース ===========
// {コマID: {title, latte, genre, ...}}
function parseCatalog(rows) {
  const map = {};
  const headerIdx = rows.findIndex(r =>
    r.includes('ジャンル') && r.includes('コマID') && r.includes('講座タイトル(日本語)')
  );
  if (headerIdx === -1) return map;
  const header = rows[headerIdx];
  const idx = (n) => header.indexOf(n);
  const COL = {
    genre: idx('ジャンル'),
    no: idx('コマ番号'),
    id: idx('コマID'),
    titleJa: idx('講座タイトル(日本語)'),
    titleShort: idx('タイトル短'),
    sub: idx('サブタイトル/カテゴリ'),
    content: idx('内容(本文)'),
    goal: idx('目標'),
    goalShort: idx('目標短'),
    duration: idx('時間'),
    url: idx('教材URL'),
    person: idx('担当'),
    latte: idx('ラテ欄用記事仮文'),
    latteShort: idx('ラテ短'),
  };
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const id = (r[COL.id] || '').trim();
    if (!id) continue;
    map[id] = {
      genre: r[COL.genre],
      no: parseInt(r[COL.no]) || 0,
      id,
      title: r[COL.titleJa] || '',
      titleShort: COL.titleShort >= 0 ? (r[COL.titleShort] || '') : '',
      sub: r[COL.sub] || '',
      content: r[COL.content] || '',
      goal: r[COL.goal] || '',
      goalShort: COL.goalShort >= 0 ? (r[COL.goalShort] || '') : '',
      duration: r[COL.duration] || '30分',
      url: r[COL.url] || '',
      person: r[COL.person] || '',
      latte: r[COL.latte] || '',
      latteShort: COL.latteShort >= 0 ? (r[COL.latteShort] || '') : '',
    };
  }
  return map;
}

// =========== スケジュールのパース ===========
// 対象月の日次行を {date, day, dayOfWeek, week, holiday, slots[]} として抽出
function parseMonthSchedule(rows, targetMonth) {
  const headerIdx = rows.findIndex(r => (r[0] || '').trim() === '月' && (r[1] || '').trim() === '日');
  if (headerIdx === -1) return [];
  const result = [];
  let lastMonth = null;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 5) continue;
    const monthCell = (r[0] || '').trim();
    const dayCell = (r[1] || '').trim();
    const dowCell = (r[2] || '').trim();
    if (monthCell) lastMonth = parseInt(monthCell, 10);
    const day = parseInt(dayCell, 10);
    if (!day) continue;
    if (lastMonth !== targetMonth) continue;

    const week = (r[3] || '').trim();
    const holiday = (r[4] || '').trim();

    const slots = [];
    for (const s of SLOT_COLS) {
      const person = (r[s.col] || '').trim();
      const programId = (r[s.col + 1] || '').trim();
      if (programId) {
        slots.push({ time: s.time, person, programId });
      }
    }

    result.push({
      date: `2026-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day, dayOfWeek: dowCell, week, holiday, slots,
    });
  }
  return result;
}

// =========== 月内の初回放送日を計算 ===========
// 注意: W1-W4 のみ対象(月跨ぎW="5(1)"行は除外)
function collectFirstAir(monthRows) {
  const map = new Map(); // programId -> 'YYYY-MM-DD'
  const sortedDays = [...monthRows].filter(d => VALID_WEEKS.includes(d.week)).sort((a, b) => a.day - b.day);
  for (const d of sortedDays) {
    for (const slot of d.slots) {
      if (!map.has(slot.programId)) map.set(slot.programId, d.date);
    }
  }
  return map;
}

function groupByCategory(firstAirByProgram) {
  const result = { a: [], b: [], c: [], d: [] };
  // first-air 日でソート(同日内はコマ番号順)
  const items = Array.from(firstAirByProgram.entries())
    .map(([id, date]) => ({ id, date, no: extractKomaNumber(id) }))
    .sort((a, b) => a.date === b.date ? a.no - b.no : a.date.localeCompare(b.date));
  for (const it of items) {
    const cat = identifyCategory(it.id);
    if (cat && result[cat] && result[cat].length < 4) {
      result[cat].push(it.id);
    }
  }
  return result;
}

function identifyCategory(programId) {
  if (programId.startsWith('課題')) return 'a';
  if (programId.startsWith('コネ')) return 'b';
  if (programId.startsWith('情報')) return 'c';
  if (programId.startsWith('Pro'))  return 'd';
  return null;
}

function extractKomaNumber(programId) {
  const map = { '①':1,'②':2,'③':3,'④':4,'⑤':5,'⑥':6,'⑦':7,'⑧':8,
                '⑨':9,'⑩':10,'⑪':11,'⑫':12,'⑬':13,'⑭':14,'⑮':15,'⑯':16 };
  for (const c of programId) if (map[c]) return map[c];
  return 0;
}

// =========== タイトル短縮 ===========
function shortenTitle(title, max = 11) {
  if (!title) return '';
  // ：→｜統一、空白trim
  let t = title.replace(/[:：]/g, '｜').trim();
  const idx = t.indexOf('｜');
  if (idx >= 0) {
    let head = t.slice(0, idx);
    let tail = t.slice(idx + 1);
    // センサー suffix 削除("タッチセンサー" → "タッチ")
    head = head.replace(/センサー$/, '');
    const room = max - head.length - 1; // 1 for ｜
    if (tail.length > room && room > 0) {
      tail = tail.slice(0, Math.max(1, room - 1)) + '…';
    }
    return head + '｜' + tail;
  }
  if (t.length > max) return t.slice(0, max - 1) + '…';
  return t;
}

// スロット説明文を最大2行(~28字)に収める
function slotDesc(s) {
  if (!s) return '';
  s = String(s).trim();
  const MAX = 28;
  if (s.length > MAX) return s.slice(0, MAX - 1) + '…';
  return s;
}

// =========== 描画: カタログ ===========
function renderCatalog(newPrograms, catalog) {
  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = '';
  for (const cat of CATEGORIES) {
    const col = document.createElement('div');
    col.className = 'cat-column';

    const head = document.createElement('div');
    head.className = `cat-header ${cat.key}`;
    head.innerHTML = `<span class="cat-name">${cat.name}</span><span class="cat-en">${cat.en}</span>`;
    col.appendChild(head);

    const body = document.createElement('div');
    body.className = 'cat-body';
    const ids = newPrograms[cat.key] || [];
    // 必ず4カード描画(統合表に未登録のIDは「番組情報を準備中」のプレースホルダ)
    for (let i = 0; i < 4; i++) {
      const id = ids[i];
      const p = id ? catalog[id] : null;
      const card = document.createElement('div');
      card.className = 'show-card';
      if (p) {
        card.innerHTML =
          `<div class="sc-title">${escapeHtml(p.titleShort || shortenTitle(p.title, 15))}</div>` +
          `<div class="sc-desc">${escapeHtml(p.latteShort || truncateLatte(p.latte || p.content, 56))}</div>`;
      } else if (id) {
        card.innerHTML =
          `<div class="sc-title">${escapeHtml(id)}</div>` +
          `<div class="sc-desc">番組情報を準備中</div>`;
      } else {
        card.innerHTML = `<div class="sc-title">—</div><div class="sc-desc"></div>`;
      }
      body.appendChild(card);
    }
    col.appendChild(body);
    grid.appendChild(col);
  }
}

// カタログ説明文(目標 ~62字、句点で完結させる)
function truncateLatte(s, n) {
  s = String(s || '').replace(/\r?\n/g, '').trim();
  if (!s) return '';
  if (s.length <= n) return /[。！？]$/.test(s) ? s : s + '。';

  const idx1 = s.indexOf('。');
  if (idx1 === -1) {
    const lastComma = s.lastIndexOf('、', n);
    if (lastComma > n * 0.5) return s.slice(0, lastComma) + '。';
    return s.slice(0, n) + '。';
  }
  const sent1 = s.slice(0, idx1 + 1);
  if (sent1.length >= n * 0.85) return sent1;

  const remaining = s.slice(idx1 + 1);
  const budget = n - sent1.length;
  if (remaining.length <= budget) return sent1 + remaining + (/[。！？]$/.test(remaining) ? '' : '。');

  const idx2 = remaining.indexOf('。');
  if (idx2 !== -1 && idx2 + 1 <= budget * 1.05) {
    return sent1 + remaining.slice(0, idx2 + 1);
  }
  const lastComma = remaining.slice(0, budget).lastIndexOf('、');
  if (lastComma > budget * 0.5) return sent1 + remaining.slice(0, lastComma) + '。';
  return sent1 + remaining.slice(0, budget - 1) + '。';
}

// =========== 描画: スケジュール表 ===========
function renderSchedule(monthRows, catalog, firstAirByProgram, month) {
  const table = document.getElementById('schedule-table');
  table.innerHTML = '';

  // 列ヘッダー
  table.appendChild(makeCell('col-head', ''));
  for (let i = 0; i < 5; i++) {
    const cell = makeCell('col-head', '');
    cell.innerHTML = `<span class="day-jp">${DAYS_JP[i]}</span><span class="day-en">${DAYS_EN[i]}</span>`;
    table.appendChild(cell);
  }

  // 月内行を W1-W4 でグルーピング
  const byWeek = { '1': [], '2': [], '3': [], '4': [] };
  for (const d of monthRows) {
    if (byWeek[d.week]) byWeek[d.week].push(d);
  }

  // 各週を描画
  for (const wKey of VALID_WEEKS) {
    const weekDays = byWeek[wKey];
    if (!weekDays || weekDays.length === 0) continue;

    // 月-金マップ
    const dayMap = {};
    for (const d of weekDays) {
      if (DAYS_JP.includes(d.dayOfWeek)) dayMap[d.dayOfWeek] = d;
    }

    // 行ヘッダー (W番号 + 月/X-月/Y)
    const mons = Object.values(dayMap).map(d => d.day).sort((a, b) => a - b);
    const mNum = parseInt(month.split('-')[1], 10);
    const range = mons.length ? `${mNum}/${mons[0]}-${mNum}/${mons[mons.length - 1]}` : '';
    const rh = makeCell('row-head', '');
    rh.innerHTML = `<span class="w-num">W${wKey}</span><span class="w-range">${range}</span>`;
    table.appendChild(rh);

    // 月-金 5セル
    for (const dow of DAYS_JP) {
      const d = dayMap[dow];
      if (!d) {
        table.appendChild(makeCell('sched-content', ''));
        continue;
      }
      // slotsが空 かつ holiday に祝日らしい文字列がある → holiday cell
      if (d.slots.length === 0 && d.holiday && isRealHoliday(d.holiday)) {
        const cell = makeCell('holiday', '');
        cell.innerHTML = `<span class="holiday-text">${mNum}/${d.day} (${d.dayOfWeek})<br>${escapeHtml(d.holiday)}</span>`;
        table.appendChild(cell);
        continue;
      }
      // 通常セル
      const hasNew = d.slots.some(s => firstAirByProgram.get(s.programId) === d.date);
      const cell = makeCell('sched-content' + (hasNew ? ' has-new' : ''), '');
      for (const slot of d.slots) {
        const p = catalog[slot.programId] || { title: slot.programId, goal: '', content: '' };
        const isNew = firstAirByProgram.get(slot.programId) === d.date;
        const cat = identifyCategory(slot.programId) || 'a';
        const block = document.createElement('div');
        block.className = 'slot-block';
        const nameTxt = p.titleShort || shortenTitle(p.title || slot.programId);
        const descTxt = p.goalShort || slotDesc(p.goal || p.content || p.latte || '');
        block.innerHTML =
          `<div class="slot-line1">` +
            `<span class="time">${slot.time}</span>` +
            `<span class="cat-dot ${cat}"></span>` +
            `<span class="name${isNew ? ' is-new' : ''}">${escapeHtml(nameTxt)}</span>` +
          `</div>` +
          `<div class="slot-desc">${escapeHtml(descTxt)}</div>`;
        cell.appendChild(block);
      }
      table.appendChild(cell);
    }
  }
}

// 「マット不在 ...」のような運営メモは祝日扱いしない
function isRealHoliday(s) {
  if (!s) return false;
  if (/不在|休み|代休|担当/.test(s)) return false;
  // 「みどりの日」「こどもの日」「振替」「母の日」等
  return /日|休|祝/.test(s);
}

function makeCell(className, content) {
  const div = document.createElement('div');
  div.className = `sched-cell ${className}`;
  div.innerHTML = content;
  return div;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
