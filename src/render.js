/* ============================================
   schoomy-spotlive-schedule-web
   render.js v1.0
   Google Sheets の CSV を fetch して、HTMLを動的描画する
   ============================================ */

const SHEET_ID = '1492Z27DEgbQkVsga5ZCpr19QCoGfwS2Zb5eT0eM-FJs';
const GID_SCHEDULE = '1588173790';
// 番組統合表のgidは GAS で生成された後に確認して書き換える
// 暫定: `番組統合表` というシート名指定でCSVを取得する代替URL
const GID_CATALOG = '0'; // TODO: GAS実行後に正しいgidに書き換える

// CSV取得URL(publish形式とexport形式の2種類試す)
function csvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

const CATEGORIES = [
  { key: 'a', name: '課題解決',         en: 'PROBLEM  SOLVING',     prefix: '課題' },
  { key: 'b', name: 'コネクター活用',   en: 'CONNECTOR  IN  ACTION', prefix: 'コネ' },
  { key: 'c', name: 'データサイエンス', en: 'DATA  SCIENCE',         prefix: '情報' },
  { key: 'd', name: '物理シミュレーション', en: 'PHYSICS  ／  ENGLISH', prefix: 'Pro' },
];

const DAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];
const DAYS_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// =========== 起動 ===========
init().catch(showError);

async function init() {
  const month = getMonthFromQuery() || getCurrentMonth();
  setHeader(month);

  // 1. CSVを取得
  const [scheduleText, catalogText] = await Promise.all([
    fetchCSV(GID_SCHEDULE),
    fetchCSV(GID_CATALOG),
  ]);

  const scheduleRows = parseCSV(scheduleText);
  const catalogRows = parseCSV(catalogText);

  // 2. 番組カタログをパース → コマIDをキーにしたmap
  const catalog = parseCatalog(catalogRows);

  // 3. その月の日次スケジュールを抽出
  const monthData = parseMonthSchedule(scheduleRows, month);

  // 4. その月で初回放送される番組を集める(各カテゴリ最大4本×4=16本想定)
  const newPrograms = collectFirstAirPrograms(monthData, catalog);

  // 5. 描画
  renderCatalog(newPrograms, catalog);
  renderSchedule(monthData, catalog, month);

  hideLoading();
}

// =========== ユーティリティ ===========

function getMonthFromQuery() {
  const params = new URLSearchParams(location.search);
  const m = params.get('month');
  return m && /^\d{4}-\d{2}$/.test(m) ? m : null;
}

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function setHeader(month) {
  const [y, m] = month.split('-');
  const mm = parseInt(m);
  document.getElementById('month-mark').textContent = `${mm}月号`;
  document.getElementById('issue-text').textContent = `${y}年${mm}月号 ／ ISSUE  No.${mm}`;
  document.title = `スクーミースポットライブ放送スケジュール ${y}年${mm}月号 v1.0`;
}

async function fetchCSV(gid) {
  const url = csvUrl(gid);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV取得失敗(gid=${gid}): ${res.status}`);
  return await res.text();
}

// RFC 4180 準拠の最小CSVパーサ
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
      else if (c === '\r') {} // skip
      else cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

function showError(err) {
  console.error(err);
  hideLoading();
  const el = document.getElementById('error');
  el.style.display = 'flex';
  el.textContent = `データ取得エラー\n\n${err.message}\n\nGoogle Sheetsの公開設定とCORSを確認してください。`;
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.style.display = 'none';
}

// =========== 番組統合表のパース ===========
// 出力スキーマ: { 'コネ⑤': {ジャンル, コマ番号, タイトル, 説明文(=ラテ欄), 教材URL, 担当}, ... }

function parseCatalog(rows) {
  const map = {};
  // ヘッダ行を探す
  const headerIdx = rows.findIndex(r =>
    r.includes('ジャンル') && r.includes('コマID') && r.includes('講座タイトル(日本語)')
  );
  if (headerIdx === -1) return map;
  const header = rows[headerIdx];
  const idx = (name) => header.indexOf(name);
  const COL = {
    genre: idx('ジャンル'),
    no: idx('コマ番号'),
    id: idx('コマID'),
    titleJa: idx('講座タイトル(日本語)'),
    sub: idx('サブタイトル/カテゴリ'),
    gear: idx('製品/GEARタイトル'),
    content: idx('内容(本文)'),
    goal: idx('目標'),
    duration: idx('時間'),
    url: idx('教材URL'),
    person: idx('担当'),
    latte: idx('ラテ欄用記事仮文'),
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
      sub: r[COL.sub] || '',
      gear: r[COL.gear] || '',
      content: r[COL.content] || '',
      goal: r[COL.goal] || '',
      duration: r[COL.duration] || '30分',
      url: r[COL.url] || '',
      person: r[COL.person] || '',
      latte: r[COL.latte] || '',
    };
  }
  return map;
}

// =========== スケジュールマトリクスのパース ===========
// 各行: 月,日,曜日,週番号,祝日,担当,コマID,担当,コマID,...(3コマ×3スロット)
// 出力: [{date: '2026-05-07', dayOfWeek: '木', isHoliday: '...', slots: [{time: '10:20', programId: 'Pro⑤'}, ...]}]

function parseMonthSchedule(rows, month) {
  const [year, monthNum] = month.split('-').map(s => parseInt(s));
  const result = [];
  let currentMonthCol = null;

  // ヘッダー行を探す(「月」「日」「曜日」を含む)
  const headerIdx = rows.findIndex(r => r[0] === '月' && r[1] === '日');
  if (headerIdx === -1) return result;

  // ヘッダーから時間帯のカラムインデックスを取得
  const header = rows[headerIdx];
  // 形式: 月|日|曜日|週番号|祝日|10:20-10:50||10:50-11:20||...|15:50-16:20|
  // スロット開始位置: 10:20=col5, 10:50=col7, ..., 15:50=col21
  // 1スロット=2列(担当, コマID)
  // 3コマ連続で1番組 => 1番組のスロット先頭: 10:20(col5), 13:20(col11), 14:50(col17)
  const programSlotStarts = [
    { time: '10:20-11:50', col: 5 },
    { time: '13:20-14:50', col: 11 },
    { time: '14:50-16:20', col: 17 },
  ];

  let lastMonth = null;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 5) continue;

    const monthCell = r[0]?.trim();
    const dayCell = r[1]?.trim();
    const dowCell = r[2]?.trim();

    if (monthCell) lastMonth = parseInt(monthCell);
    const day = parseInt(dayCell);
    if (!day) continue;

    if (lastMonth !== monthNum) continue; // 対象月のみ

    // 年をまたぐケース(1〜3月)はyearに+1する必要があるが、同年内なのでそのまま
    const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const item = {
      date: dateStr,
      day: day,
      dayOfWeek: dowCell,
      week: r[3]?.trim() || '',
      holiday: r[4]?.trim() || '',
      slots: []
    };

    for (const s of programSlotStarts) {
      const person = (r[s.col] || '').trim();
      const programId = (r[s.col + 1] || '').trim();
      if (programId) {
        item.slots.push({
          time: s.time.split('-')[0], // '10:20'
          person,
          programId,
        });
      }
    }
    result.push(item);
  }
  return result;
}

// =========== その月で初回放送される番組を集める ===========
// 各番組IDの「初回放送日」を計算し、初回がその月内のものをカテゴリ別に最大4本ずつ集める

function collectFirstAirPrograms(monthData, catalog) {
  const seen = new Map(); // programId -> firstAirDate
  for (const day of monthData) {
    for (const slot of day.slots) {
      if (!seen.has(slot.programId)) {
        seen.set(slot.programId, day.date);
      }
    }
  }
  // カテゴリ別にプログラムIDをグループ化
  const result = { a: [], b: [], c: [], d: [] };
  const programIds = Array.from(seen.keys()).sort((a, b) => {
    // コマ番号でソート(prefix除去して数字)
    const numA = extractKomaNumber(a);
    const numB = extractKomaNumber(b);
    return numA - numB;
  });
  for (const id of programIds) {
    const cat = identifyCategory(id);
    if (cat && result[cat]) {
      result[cat].push(id);
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
  const map = { '①':1, '②':2, '③':3, '④':4, '⑤':5, '⑥':6, '⑦':7, '⑧':8,
                '⑨':9, '⑩':10, '⑪':11, '⑫':12, '⑬':13, '⑭':14, '⑮':15, '⑯':16 };
  for (const c of programId) if (map[c]) return map[c];
  return 0;
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
    for (const id of ids) {
      const program = catalog[id];
      if (!program) continue;
      const card = document.createElement('div');
      card.className = 'show-card';
      card.innerHTML = `
        <div class="sc-title">${shortenTitle(program.title, cat.key)}</div>
        <div class="sc-desc">${truncate(program.latte || program.content, 110)}</div>
      `;
      body.appendChild(card);
    }
    col.appendChild(body);
    grid.appendChild(col);
  }
}

function shortenTitle(title, catKey) {
  // 1行に収まるよう、長すぎるパイプ(｜)区切りを短縮
  if (!title) return '';
  // 例: "スピーカー｜タンクの貯水量の変化を音で知らせる" → 後半が長すぎるので省略
  const pipeIdx = title.indexOf('｜');
  if (pipeIdx >= 0) {
    const head = title.slice(0, pipeIdx);
    const tail = title.slice(pipeIdx + 1);
    if ((head + '｜' + tail).length > 14) {
      return head + '｜' + truncate(tail, 13);
    }
  }
  return truncate(title, 14);
}

function truncate(s, n) {
  if (!s) return '';
  s = s.trim();
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

// =========== 描画: スケジュール表 ===========
function renderSchedule(monthData, catalog, month) {
  const table = document.getElementById('schedule-table');
  table.innerHTML = '';

  // 平日(月-金)だけ抽出して、週ごとにグループ化
  const weekDays = monthData.filter(d => ['月','火','水','木','金'].includes(d.dayOfWeek));
  const weeks = groupByWeek(weekDays);

  // 曜日ヘッダー
  table.appendChild(makeCell('col-head', ''));
  for (let i = 0; i < 5; i++) {
    const cell = makeCell('col-head', '');
    cell.innerHTML = `<span class="day-jp">${DAYS_JP[i + 1]}</span><span class="day-en">${DAYS_EN[i + 1]}</span>`;
    table.appendChild(cell);
  }

  // 月初回放送日のセットを作っておく(背景強調用)
  const firstAirDates = new Set();
  const seenForFirst = new Set();
  const sorted = [...monthData].sort((a, b) => a.day - b.day);
  for (const day of sorted) {
    for (const slot of day.slots) {
      if (!seenForFirst.has(slot.programId)) {
        seenForFirst.add(slot.programId);
        firstAirDates.add(day.date + '__' + slot.programId);
      }
    }
  }

  // 各週を行として描画
  weeks.forEach((week, wIdx) => {
    // 行ヘッダー
    const head = makeCell('row-head', '');
    const days = week.map(d => d.day).filter(Boolean);
    const range = days.length ? `${month.split('-')[1]}/${days[0]}-${month.split('-')[1]}/${days[days.length-1]}` : '';
    head.innerHTML = `<span class="w-num">W${wIdx + 1}</span><span class="w-range">${range}</span>`;
    table.appendChild(head);

    // 月-金の各セル
    const dayMap = {};
    for (const d of week) dayMap[d.dayOfWeek] = d;

    for (const dow of ['月','火','水','木','金']) {
      const day = dayMap[dow];
      if (!day) {
        table.appendChild(makeCell('sched-content', ''));
        continue;
      }

      if (day.holiday && day.slots.length === 0) {
        const cell = makeCell('holiday', '');
        cell.innerHTML = `<span class="holiday-text">${month.split('-')[1]}/${day.day} (${day.dayOfWeek})<br>${day.holiday}</span>`;
        table.appendChild(cell);
        continue;
      }

      const hasNew = day.slots.some(s => firstAirDates.has(day.date + '__' + s.programId));
      const cell = makeCell('sched-content' + (hasNew ? ' has-new' : ''), '');

      for (const slot of day.slots) {
        const program = catalog[slot.programId] || {};
        const isNew = firstAirDates.has(day.date + '__' + slot.programId);
        const cat = identifyCategory(slot.programId) || 'a';
        const block = document.createElement('div');
        block.className = 'slot-block';
        block.innerHTML = `
          <div class="slot-line1">
            <span class="time">${slot.time}</span>
            <span class="cat-dot ${cat}"></span>
            <span class="name${isNew ? ' is-new' : ''}">${shortenTitle(program.title || slot.programId, cat)}</span>
          </div>
          <div class="slot-desc">${truncate(program.goal || program.content || '', 32)}</div>
        `;
        cell.appendChild(block);
      }
      table.appendChild(cell);
    }
  });
}

function groupByWeek(weekDays) {
  // 同じ「週番号」で固める。週番号がない時は連続する平日を1週とみなす
  const map = new Map();
  for (const d of weekDays) {
    const key = d.week || `auto-${d.day}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  }
  return Array.from(map.values());
}

function makeCell(className, content) {
  const div = document.createElement('div');
  div.className = `sched-cell ${className}`;
  div.innerHTML = content;
  return div;
}
