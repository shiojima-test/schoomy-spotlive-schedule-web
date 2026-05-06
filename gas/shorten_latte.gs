/**
 * shorten_latte.gs (3列対応版)
 *
 * 「番組統合表」シートに次の3つの「短縮版」列を埋めるための GAS。
 *   1. ラテ短(カタログ用説明文 / 52-58字)
 *   2. タイトル短(講座タイトルの短縮 / 13字以内)
 *   3. 目標短(スケジュール表セルの短い説明 / 18-22字)
 *
 * いずれも Claude が生成した TSV(コマID + TAB + 短縮版) を、
 * 専用ダイアログにペースト→「適用」で自動書き込みする。
 *
 * メニュー:
 *   📝 ラテ欄
 *     ├ Claude短縮TSVを貼り付け(ラテ短)
 *     ├ Claude短縮TSVを貼り付け(タイトル短)
 *     ├ Claude短縮TSVを貼り付け(目標短)
 *     ├ ─────────
 *     ├ 自動短縮(ラテ欄→ラテ短、アルゴリズム)
 *     ├ ─────────
 *     ├ ラテ短列をクリア
 *     ├ タイトル短列をクリア
 *     └ 目標短列をクリア
 */

const SHEET_NAME_INTEGRATED = '番組統合表';
const COL_ID = 'コマID';
const COL_LATTE_SOURCE = 'ラテ欄用記事仮文';
const COL_LATTE_SHORT = 'ラテ短';
const COL_TITLE_SHORT = 'タイトル短';
const COL_GOAL_SHORT = '目標短';
const TARGET_CHARS = 56;

function onOpen() {
  addShortenLatteMenu_(SpreadsheetApp.getUi());
}

function addShortenLatteMenu_(ui) {
  ui.createMenu('📝 ラテ欄')
    .addItem('Claude短縮TSVを貼り付け(ラテ短)', 'openApplyTsvLatte')
    .addItem('Claude短縮TSVを貼り付け(タイトル短)', 'openApplyTsvTitle')
    .addItem('Claude短縮TSVを貼り付け(目標短)', 'openApplyTsvGoal')
    .addSeparator()
    .addItem('自動短縮(ラテ欄→ラテ短)', 'shortenLatteForCatalog')
    .addSeparator()
    .addItem('ラテ短列をクリア', 'clearLatteShort')
    .addItem('タイトル短列をクリア', 'clearTitleShort')
    .addItem('目標短列をクリア', 'clearGoalShort')
    .addToUi();
}

// ===== ダイアログ起動 =====

function openApplyTsvLatte() { openApplyTsvDialog_(COL_LATTE_SHORT); }
function openApplyTsvTitle() { openApplyTsvDialog_(COL_TITLE_SHORT); }
function openApplyTsvGoal()  { openApplyTsvDialog_(COL_GOAL_SHORT); }

function openApplyTsvDialog_(targetCol) {
  PropertiesService.getScriptProperties().setProperty('TARGET_COL', targetCol);
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: -apple-system, "Hiragino Sans", sans-serif; padding: 12px; margin: 0; }
      h3 { margin: 0 0 8px; font-size: 14px; color: #1F3A8A; }
      p { margin: 0 0 8px; font-size: 12px; color: #555; }
      textarea { width: 100%; height: 360px; box-sizing: border-box; font-family: monospace; font-size: 12px; padding: 6px; }
      .row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
      button { font-size: 13px; padding: 6px 14px; cursor: pointer; }
      .primary { background: #1F3A8A; color: #fff; border: none; border-radius: 4px; }
      .ghost { background: #fff; color: #333; border: 1px solid #ccc; border-radius: 4px; }
      #status { font-size: 12px; color: #1F3A8A; white-space: pre-line; }
    </style>
    <h3>「${targetCol}」列に Claude TSV を適用</h3>
    <p>形式: <code>コマID&lt;TAB&gt;短縮版</code> を1行ずつ。ヘッダー行は不要。</p>
    <textarea id="tsv" placeholder="課題①\\t〜\\n課題②\\t〜"></textarea>
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
  SpreadsheetApp.getUi().showModalDialog(html, `${targetCol} に貼り付け`);
}

/** Dialog から呼ばれる。直前にセットされた TARGET_COL の列に書く。 */
function applyClaudeTsv(tsv) {
  const targetCol = PropertiesService.getScriptProperties().getProperty('TARGET_COL') || COL_LATTE_SHORT;
  const ctx = openIntegratedSheet_();
  const { sheet, header, headerRow, data } = ctx;
  const colId = header.indexOf(COL_ID);
  if (colId === -1) throw new Error(`「${COL_ID}」列が見つかりません`);
  const colDst = ensureColumn_(sheet, header, headerRow, targetCol);

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

  return `「${targetCol}」列を更新しました ✅\n  更新: ${updated} 行\n  TSVに無かった: ${missing} 行\n  TSVのパース失敗: ${parseSkip} 行\n\nブラウザで Pages を再読み込みしてください。`;
}

// ===== 自動短縮(ラテ短のみ、バックアップ) =====

function shortenLatteForCatalog() {
  const ctx = openIntegratedSheet_();
  const { sheet, header, headerRow, data } = ctx;
  const colSrc = header.indexOf(COL_LATTE_SOURCE);
  if (colSrc === -1) throw new Error(`「${COL_LATTE_SOURCE}」列が見つかりません`);
  const colDst = ensureColumn_(sheet, header, headerRow, COL_LATTE_SHORT);
  let updated = 0, skipped = 0;
  for (let i = headerRow + 1; i < data.length; i++) {
    const src = String(data[i][colSrc] || '').trim();
    if (!src) { skipped++; continue; }
    sheet.getRange(i + 1, colDst + 1).setValue(smartShorten_(src, TARGET_CHARS));
    updated++;
  }
  SpreadsheetApp.getUi().alert(`ラテ短を自動短縮しました。\n更新: ${updated} / スキップ: ${skipped}`);
}

// ===== クリア系 =====

function clearLatteShort() { clearColumn_(COL_LATTE_SHORT); }
function clearTitleShort() { clearColumn_(COL_TITLE_SHORT); }
function clearGoalShort()  { clearColumn_(COL_GOAL_SHORT); }

function clearColumn_(colName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_INTEGRATED);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    const col = data[i].indexOf(colName);
    if (col !== -1) {
      sheet.getRange(i + 2, col + 1, lastRow - i, 1).clearContent();
      SpreadsheetApp.getUi().alert(`「${colName}」列をクリアしました。`);
      return;
    }
  }
  SpreadsheetApp.getUi().alert(`「${colName}」列は存在しません。`);
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

function ensureColumn_(sheet, header, headerRow, colName) {
  let col = header.indexOf(colName);
  if (col !== -1) return col;
  col = header.length;
  sheet.getRange(headerRow + 1, col + 1).setValue(colName).setFontWeight('bold');
  // header[] 配列は参照渡しなので push して以降の判定で使えるようにする
  header.push(colName);
  return col;
}

function smartShorten_(s, target) {
  s = String(s || '').replace(/\r?\n/g, '').trim();
  if (!s) return '';
  if (s.length <= target) return /[。！？]$/.test(s) ? s : s + '。';
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
    return /[。！？]$/.test(sent1 + remaining) ? sent1 + remaining : sent1 + remaining + '。';
  }
  const idx2 = remaining.indexOf('。');
  if (idx2 !== -1 && idx2 + 1 <= budget * 1.05) return sent1 + remaining.slice(0, idx2 + 1);
  const lastComma = remaining.slice(0, budget).lastIndexOf('、');
  if (lastComma > budget * 0.5) return sent1 + remaining.slice(0, lastComma) + '。';
  return sent1 + remaining.slice(0, budget - 1) + '。';
}
