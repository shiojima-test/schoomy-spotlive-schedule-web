/**
 * shorten_latte.gs
 *
 * 「番組統合表」シートの「ラテ欄用記事仮文」(長め)を、
 * カタログカード(横47mm × 高さ ~22mm)に収まる ~60-65字に短縮し、
 * 「ラテ短」列に書き出す。
 *
 * 仕様:
 *  - 第1文(。まで)を優先で残す
 *  - 残りバジェットを第2文の途中(、区切り)まで採用、末尾は 。 で終える
 *  - 「…」(三点リーダ) は使わない(v7.3 と同じ完結体に揃えるため)
 *  - 元の「ラテ欄用記事仮文」は変更しない(別列に出力)
 *
 * 使い方:
 *  1. スプレッドシートを開く
 *  2. 拡張機能 > Apps Script でこのファイルを貼り付け or onOpen をマージ
 *  3. メニュー「📝 ラテ欄」> 「カタログ用に短縮」を実行
 *
 * メニュー併用について:
 *  既に build_integrated_table.gs で onOpen() を定義している場合は、
 *  既存 onOpen の最後に  addShortenLatteMenu_(SpreadsheetApp.getUi())
 *  の1行を追記してください(下の onOpen はバックアップ)。
 */

const SHEET_NAME_INTEGRATED = '番組統合表';
const COL_LATTE_SOURCE = 'ラテ欄用記事仮文';
const COL_LATTE_SHORT = 'ラテ短';
const TARGET_CHARS = 56; // 1カードに3行で収まる目安(60超で4行になり次セクションがあふれる)

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  addShortenLatteMenu_(ui);
}

function addShortenLatteMenu_(ui) {
  ui.createMenu('📝 ラテ欄')
    .addItem('カタログ用に短縮(ラテ短列を生成)', 'shortenLatteForCatalog')
    .addItem('ラテ短列をクリア', 'clearLatteShort')
    .addToUi();
}

function shortenLatteForCatalog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_INTEGRATED);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`シート「${SHEET_NAME_INTEGRATED}」が見つかりません。`);
    return;
  }

  const data = sheet.getDataRange().getValues();
  // 番組統合表のヘッダー行を探す(「ジャンル」「コマID」「ラテ欄用記事仮文」が含まれる行)
  let headerRow = -1;
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (r.indexOf('ジャンル') !== -1 && r.indexOf('コマID') !== -1 && r.indexOf(COL_LATTE_SOURCE) !== -1) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    SpreadsheetApp.getUi().alert(`ヘッダー行(「${COL_LATTE_SOURCE}」列を含む)が見つかりません。`);
    return;
  }

  const header = data[headerRow];
  const colSrc = header.indexOf(COL_LATTE_SOURCE);
  let colDst = header.indexOf(COL_LATTE_SHORT);

  // 「ラテ短」列が無ければ末尾に追加
  if (colDst === -1) {
    colDst = header.length;
    sheet.getRange(headerRow + 1, colDst + 1).setValue(COL_LATTE_SHORT);
    sheet.getRange(headerRow + 1, colDst + 1).setFontWeight('bold');
  }

  let updated = 0;
  let skipped = 0;
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    const src = String(row[colSrc] || '').trim();
    if (!src) { skipped++; continue; }
    const shortened = smartShorten_(src, TARGET_CHARS);
    sheet.getRange(i + 1, colDst + 1).setValue(shortened);
    updated++;
  }

  SpreadsheetApp.getUi().alert(
    `ラテ短列を更新しました。\n更新: ${updated} 行 / スキップ(空セル): ${skipped} 行\n\n` +
    `次の手順:\n` +
    `1. file > Publish to web で「ウェブに公開」を更新(自動更新ONなら不要)\n` +
    `2. ブラウザで Pages を再読み込みすると反映されます`
  );
}

function clearLatteShort() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_INTEGRATED);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    const colDst = data[i].indexOf(COL_LATTE_SHORT);
    if (colDst !== -1) {
      sheet.getRange(i + 2, colDst + 1, sheet.getLastRow() - i, 1).clearContent();
      SpreadsheetApp.getUi().alert(`ラテ短列の中身をクリアしました。`);
      return;
    }
  }
}

/**
 * 1文目を優先で残し、2文目の途中(、)まで採用して 。 で終える。
 * 「…」は使わず常に 。 で完結させる。
 */
function smartShorten_(s, target) {
  s = String(s || '').replace(/\r?\n/g, '').trim();
  if (!s) return '';
  if (s.length <= target) return endsWithJaPeriod_(s) ? s : s + '。';

  // 第1文(。まで)を取り出す
  const idx1 = s.indexOf('。');
  if (idx1 === -1) {
    // 句点が無い場合は 、で切る、それも無ければ素直にカット
    const lastComma = s.lastIndexOf('、', target);
    if (lastComma > target * 0.5) return s.slice(0, lastComma) + '。';
    return s.slice(0, target) + '。';
  }
  const sent1 = s.slice(0, idx1 + 1); // 「。」込み

  // 第1文だけで十分な長さなら、それを返す
  if (sent1.length >= target * 0.85) return sent1;

  const remaining = s.slice(idx1 + 1);
  const budget = target - sent1.length;

  if (remaining.length <= budget) {
    return endsWithJaPeriod_(sent1 + remaining) ? sent1 + remaining : sent1 + remaining + '。';
  }

  // 残り = 第2文を、句点 or 読点でクリーンに切る
  // まず budget 内に第2文の 。があればそこまで
  const idx2 = remaining.indexOf('。');
  if (idx2 !== -1 && idx2 + 1 <= budget * 1.05) {
    return sent1 + remaining.slice(0, idx2 + 1);
  }

  // 次に budget 内の最後の 、で切る(後半 60% 以降の 、 を採用)
  const partial = remaining.slice(0, budget);
  const lastComma = partial.lastIndexOf('、');
  if (lastComma > budget * 0.5) {
    return sent1 + remaining.slice(0, lastComma) + '。';
  }

  // どこにも切れ目がない場合: 文字数で切って 。を付ける
  return sent1 + remaining.slice(0, budget - 1) + '。';
}

function endsWithJaPeriod_(s) {
  return /[。！？]$/.test(s);
}
