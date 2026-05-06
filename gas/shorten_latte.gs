/**
 * shorten_latte.gs
 *
 * 「番組統合表」シートの「ラテ短」列を、
 *   A) Claude が出力した TSV の貼り付けで一括反映する(推奨)
 *   B) 簡易アルゴリズムで自動短縮する(バックアップ)
 * の2通りで埋められるようにする。
 *
 * 使い方(A: Claude 出力を貼り付け):
 *  1. docs/claude_prompt.md のプロンプトを Claude に渡す
 *  2. Claude が TSV(コマID<TAB>短縮版, 40行)を返す
 *  3. メニュー「📝 ラテ欄」>「Claude短縮TSVを貼り付けて適用」
 *  4. 開いたダイアログに TSV をペースト→「適用」
 *
 * 使い方(B: 自動短縮):
 *  1. メニュー「📝 ラテ欄」>「自動短縮(アルゴリズム)」
 *
 * メニュー併用について:
 *  既に build_integrated_table.gs で onOpen() を定義している場合は、
 *  既存 onOpen の最後に
 *    addShortenLatteMenu_(SpreadsheetApp.getUi())
 *  の1行を追記してください(下の onOpen はバックアップ)。
 */

const SHEET_NAME_INTEGRATED = '番組統合表';
const COL_ID = 'コマID';
const COL_LATTE_SOURCE = 'ラテ欄用記事仮文';
const COL_LATTE_SHORT = 'ラテ短';
const TARGET_CHARS = 56;

function onOpen() {
  addShortenLatteMenu_(SpreadsheetApp.getUi());
}

function addShortenLatteMenu_(ui) {
  ui.createMenu('📝 ラテ欄')
    .addItem('Claude短縮TSVを貼り付けて適用', 'openApplyClaudeTsvDialog')
    .addItem('自動短縮(アルゴリズム)', 'shortenLatteForCatalog')
    .addSeparator()
    .addItem('ラテ短列をクリア', 'clearLatteShort')
    .addToUi();
}

// ===== A) Claude TSV 貼り付け =====

function openApplyClaudeTsvDialog() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: -apple-system, "Hiragino Sans", sans-serif; padding: 12px; margin: 0; }
      h3 { margin: 0 0 8px; font-size: 14px; }
      p { margin: 0 0 8px; font-size: 12px; color: #555; }
      textarea { width: 100%; height: 360px; box-sizing: border-box; font-family: monospace; font-size: 12px; padding: 6px; }
      .row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
      button { font-size: 13px; padding: 6px 14px; cursor: pointer; }
      .primary { background: #1F3A8A; color: #fff; border: none; border-radius: 4px; }
      .ghost { background: #fff; color: #333; border: 1px solid #ccc; border-radius: 4px; }
      #status { font-size: 12px; color: #1F3A8A; }
    </style>
    <h3>Claude が出力した TSV を貼り付け</h3>
    <p>形式: <code>コマID&lt;TAB&gt;短縮版</code> を1行ずつ。ヘッダー行は不要。</p>
    <textarea id="tsv" placeholder="課題①\\tセンサーの導入回。距離・明るさ・磁気...\\n課題②\\t..."></textarea>
    <div class="row">
      <span id="status"></span>
      <div>
        <button class="ghost" onclick="google.script.host.close()">閉じる</button>
        <button class="primary" onclick="apply()">適用</button>
      </div>
    </div>
    <script>
      function apply() {
        const tsv = document.getElementById('tsv').value;
        document.getElementById('status').textContent = '適用中...';
        google.script.run
          .withSuccessHandler(r => { document.getElementById('status').textContent = r; })
          .withFailureHandler(e => { document.getElementById('status').textContent = 'エラー: ' + e.message; })
          .applyClaudeTsv(tsv);
      }
    </script>
  `).setWidth(640).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, 'Claude短縮TSVを適用');
}

/** Dialog から呼ばれる。TSV を解析してラテ短列に書き込み。 */
function applyClaudeTsv(tsv) {
  const ctx = openIntegratedSheet_();
  const { sheet, header, headerRow, data } = ctx;
  const colId = header.indexOf(COL_ID);
  if (colId === -1) throw new Error(`「${COL_ID}」列が見つかりません`);
  let colDst = ensureLatteShortColumn_(sheet, header, headerRow);

  const lines = String(tsv || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('TSV が空です');

  const map = {};
  let parseSkip = 0;
  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab === -1) { parseSkip++; continue; }
    const id = line.slice(0, tab).trim();
    let val = line.slice(tab + 1).trim();
    // Claude が誤って3列(タイトル含む)出力した場合は最後の列を採用
    const lastTab = val.lastIndexOf('\t');
    if (lastTab !== -1) val = val.slice(lastTab + 1).trim();
    if (id && val) map[id] = val;
  }

  let updated = 0, missing = 0;
  for (let i = headerRow + 1; i < data.length; i++) {
    const id = String(data[i][colId] || '').trim();
    if (!id) continue;
    const val = map[id];
    if (val == null) { missing++; continue; }
    sheet.getRange(i + 1, colDst + 1).setValue(val);
    updated++;
  }

  return `適用完了 ✅\n  更新: ${updated} 行\n  TSVに無かった行: ${missing}\n  TSVのパース失敗行: ${parseSkip}\n\nブラウザで Pages を再読み込みしてください。`;
}

// ===== B) アルゴリズム自動短縮 =====

function shortenLatteForCatalog() {
  const ctx = openIntegratedSheet_();
  const { sheet, header, headerRow, data } = ctx;
  const colSrc = header.indexOf(COL_LATTE_SOURCE);
  if (colSrc === -1) throw new Error(`「${COL_LATTE_SOURCE}」列が見つかりません`);
  const colDst = ensureLatteShortColumn_(sheet, header, headerRow);

  let updated = 0, skipped = 0;
  for (let i = headerRow + 1; i < data.length; i++) {
    const src = String(data[i][colSrc] || '').trim();
    if (!src) { skipped++; continue; }
    sheet.getRange(i + 1, colDst + 1).setValue(smartShorten_(src, TARGET_CHARS));
    updated++;
  }
  SpreadsheetApp.getUi().alert(`自動短縮しました。\n更新: ${updated} / スキップ: ${skipped}`);
}

function clearLatteShort() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_INTEGRATED);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    const col = data[i].indexOf(COL_LATTE_SHORT);
    if (col !== -1) {
      sheet.getRange(i + 2, col + 1, lastRow - i, 1).clearContent();
      SpreadsheetApp.getUi().alert('ラテ短列をクリアしました。');
      return;
    }
  }
}

// ===== 共通 =====

function openIntegratedSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_INTEGRATED);
  if (!sheet) throw new Error(`シート「${SHEET_NAME_INTEGRATED}」が見つかりません`);
  const data = sheet.getDataRange().getValues();
  let headerRow = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].indexOf('ジャンル') !== -1 && data[i].indexOf(COL_ID) !== -1) {
      headerRow = i; break;
    }
  }
  if (headerRow === -1) throw new Error('ヘッダー行が見つかりません');
  return { sheet, header: data[headerRow], headerRow, data };
}

function ensureLatteShortColumn_(sheet, header, headerRow) {
  let col = header.indexOf(COL_LATTE_SHORT);
  if (col !== -1) return col;
  col = header.length;
  sheet.getRange(headerRow + 1, col + 1).setValue(COL_LATTE_SHORT).setFontWeight('bold');
  return col;
}

function smartShorten_(s, target) {
  s = String(s || '').replace(/\r?\n/g, '').trim();
  if (!s) return '';
  if (s.length <= target) return endsWithJaPeriod_(s) ? s : s + '。';

  const idx1 = s.indexOf('。');
  if (idx1 === -1) {
    const lastComma = s.lastIndexOf('、', target);
    if (lastComma > target * 0.5) return s.slice(0, lastComma) + '。';
    return s.slice(0, target) + '。';
  }
  const sent1 = s.slice(0, idx1 + 1);
  if (sent1.length >= target * 0.85) return sent1;

  const remaining = s.slice(idx1 + 1);
  const budget = target - sent1.length;
  if (remaining.length <= budget) {
    return endsWithJaPeriod_(sent1 + remaining) ? sent1 + remaining : sent1 + remaining + '。';
  }
  const idx2 = remaining.indexOf('。');
  if (idx2 !== -1 && idx2 + 1 <= budget * 1.05) return sent1 + remaining.slice(0, idx2 + 1);
  const lastComma = remaining.slice(0, budget).lastIndexOf('、');
  if (lastComma > budget * 0.5) return sent1 + remaining.slice(0, lastComma) + '。';
  return sent1 + remaining.slice(0, budget - 1) + '。';
}

function endsWithJaPeriod_(s) {
  return /[。！？]$/.test(s);
}
