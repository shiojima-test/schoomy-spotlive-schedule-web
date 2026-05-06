/**
 * 番組統合表 GAS
 *
 * 4つの講座シート(タブ)から番組情報を読み取り、
 * 「番組統合表」タブに統一フォーマットで出力する
 *
 * 対象シートタブ:
 *  - 課題解決編
 *  - コネクター活用編
 *  - 情報Ⅱデータサイエンス基本編
 *  - SchooMySpot Live 情報Ⅱ物理シミュレーション基本編
 *
 * 出力先タブ: 番組統合表(なければ作成、あればクリアして再生成)
 *
 * 使い方:
 *  1. スプレッドシート → 拡張機能 → Apps Script でこのスクリプトを貼り付け
 *  2. buildIntegratedTable() を実行
 *  3. メニュー「📺番組統合表」からも実行可能
 */

// ===== 設定 =====
const OUTPUT_SHEET_NAME = '番組統合表';

// 対象の4タブ名(完全一致)
const SOURCE_SHEETS = {
  KADAI: '課題解決編',
  KONE: 'コネクター活用編',
  JOUHOU: '情報Ⅱデータサイエンス基本編',
  PRO: 'SchooMySpot Live 情報Ⅱ物理シミュレーション基本編'
};

// 出力カラム定義(13列)
const HEADERS = [
  'ジャンル',
  'コマ番号',
  'コマID',
  '講座タイトル(日本語)',
  '講座タイトル(英語/原文)',
  'サブタイトル/カテゴリ',
  '製品/GEARタイトル',
  '内容(本文)',
  '目標',
  '時間',
  '教材URL',
  '担当',
  'ラテ欄用記事仮文'
];

// ジャンル順の並び
const GENRE_ORDER = ['課題解決', 'コネクター活用', 'データサイエンス', '物理シミュレーション'];

// ===== カスタムメニュー =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📺番組統合表')
    .addItem('番組統合表を生成', 'buildIntegratedTable')
    .addToUi();
}

// ===== メイン処理 =====
function buildIntegratedTable() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allRows = [];

  try {
    // 1. 4タブからデータ収集
    allRows.push(...readKadai(ss));
    allRows.push(...readKone(ss));
    allRows.push(...readJouhou(ss));
    allRows.push(...readPro(ss));

    if (allRows.length === 0) {
      SpreadsheetApp.getUi().alert('番組情報が取得できませんでした。シート名を確認してください。');
      return;
    }

    // 2. ジャンル順 → コマ番号順でソート
    allRows.sort((a, b) => {
      const ga = GENRE_ORDER.indexOf(a[0]);
      const gb = GENRE_ORDER.indexOf(b[0]);
      if (ga !== gb) return ga - gb;
      return a[1] - b[1];
    });

    // 3. 出力先シートを準備
    let outSheet = ss.getSheetByName(OUTPUT_SHEET_NAME);
    if (outSheet) {
      outSheet.clear();
    } else {
      outSheet = ss.insertSheet(OUTPUT_SHEET_NAME);
    }

    // 4. ヘッダー + データを一括書き込み
    const data = [HEADERS, ...allRows];
    outSheet.getRange(1, 1, data.length, HEADERS.length).setValues(data);

    // 5. 装飾
    decorateSheet_(outSheet, allRows.length);

    SpreadsheetApp.getUi().alert(
      '番組統合表を生成しました\n\n' +
      '出力件数: ' + allRows.length + '件\n' +
      'タブ: ' + OUTPUT_SHEET_NAME
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラーが発生しました:\n' + e.message + '\n\n' + e.stack);
  }
}

// ===== 課題解決編 =====
function readKadai(ss) {
  const sheet = ss.getSheetByName(SOURCE_SHEETS.KADAI);
  if (!sheet) {
    Logger.log('シート "' + SOURCE_SHEETS.KADAI + '" が見つかりません');
    return [];
  }

  const values = sheet.getDataRange().getValues();
  const rows = [];

  // ヘッダー: コマ / 黄色 / 画像 / タイトル / 内容 / 枠内 / 教材メモ
  // ヘッダー行を見つける
  const headerIdx = findHeaderRow_(values, 'コマ');
  if (headerIdx === -1) return [];

  for (let i = headerIdx + 1; i < values.length; i++) {
    const row = values[i];
    const komaCode = String(row[0] || '').trim(); // 例: 課題①
    if (!komaCode || !komaCode.startsWith('課題')) continue;

    const komaNum = extractKomaNumber_(komaCode);
    const subTitle = String(row[1] || '').trim();   // 黄色(カテゴリ) 例: イノベーション
    const url = String(row[2] || '').trim();
    const title = String(row[3] || '').trim();
    const content = String(row[4] || '').trim();
    const frame = String(row[5] || '').trim();      // 枠内
    const memo = String(row[6] || '').trim();       // 教材メモ

    const rateBun = generateLatteText_KADAI(komaNum, title, content, subTitle);

    rows.push([
      '課題解決',
      komaNum,
      komaCode,
      title,
      '',                // 英語タイトルなし
      subTitle,          // サブタイトル(イノベーション 等)
      '',                // GEARなし
      content,
      frame,             // 目標として枠内を使用
      '30分',
      url,
      'カズ',
      rateBun
    ]);
  }
  return rows;
}

// ===== コネクター活用編 =====
function readKone(ss) {
  const sheet = ss.getSheetByName(SOURCE_SHEETS.KONE);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const rows = [];
  const headerIdx = findHeaderRow_(values, 'コマ');
  if (headerIdx === -1) return [];

  for (let i = headerIdx + 1; i < values.length; i++) {
    const row = values[i];
    const komaCode = String(row[0] || '').trim();
    if (!komaCode || !komaCode.startsWith('コネ')) continue;

    const komaNum = extractKomaNumber_(komaCode);
    const partName = String(row[1] || '').trim();   // タイトル(部品名) 例: スピーカー
    const partDesc = String(row[2] || '').trim();   // 説明
    const gearTitle = String(row[3] || '').trim();  // GEARタイトル
    const content = String(row[4] || '').trim();    // 内容
    const foxUrl = String(row[5] || '').trim();     // foxURL

    const rateBun = generateLatteText_KONE(partName, gearTitle, content, partDesc);

    rows.push([
      'コネクター活用',
      komaNum,
      komaCode,
      partName + (gearTitle ? '｜' + gearTitle : ''),  // 講座タイトル(日本語)
      '',
      partName,                                          // サブタイトル=部品名
      gearTitle,                                          // GEARタイトル
      content,
      partDesc,                                           // 目標として「説明」を使用
      '30分',
      foxUrl,
      'カズ',
      rateBun
    ]);
  }
  return rows;
}

// ===== 情報Ⅱ データサイエンス =====
function readJouhou(ss) {
  const sheet = ss.getSheetByName(SOURCE_SHEETS.JOUHOU);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const rows = [];
  const headerIdx = findHeaderRow_(values, 'コマ');
  if (headerIdx === -1) return [];

  for (let i = headerIdx + 1; i < values.length; i++) {
    const row = values[i];
    const komaCode = String(row[0] || '').trim();
    if (!komaCode || !komaCode.startsWith('情報')) continue;

    const komaNum = extractKomaNumber_(komaCode);
    const title = String(row[1] || '').trim();
    const duration = String(row[2] || '').trim();
    const content = String(row[3] || '').trim();
    const goal = String(row[4] || '').trim();

    const rateBun = generateLatteText_JOUHOU(title, content, goal);

    rows.push([
      'データサイエンス',
      komaNum,
      komaCode,
      title,
      '',
      '探究編',
      '',
      content,
      goal,
      duration || '30分',
      '',
      'コウキ',
      rateBun
    ]);
  }
  return rows;
}

// ===== 物理シミュレーション(英語) =====
function readPro(ss) {
  const sheet = ss.getSheetByName(SOURCE_SHEETS.PRO);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const rows = [];
  const headerIdx = findHeaderRow_(values, 'No');
  if (headerIdx === -1) return [];

  for (let i = headerIdx + 1; i < values.length; i++) {
    const row = values[i];
    const komaCode = String(row[0] || '').trim();
    if (!komaCode || !komaCode.startsWith('Pro')) continue;

    const komaNum = extractKomaNumber_(komaCode);
    const enTitle = String(row[1] || '').trim();
    const duration = String(row[2] || '').trim();
    const content = String(row[3] || '').trim();
    const goal = String(row[4] || '').trim();

    const jpTitle = translateProTitle_(komaNum);

    const rateBun = generateLatteText_PRO(komaNum, jpTitle, content, goal);

    rows.push([
      '物理シミュレーション',
      komaNum,
      komaCode,
      jpTitle,
      enTitle,
      '振り子実験(英語講座)',
      '',
      content,
      goal,
      duration || '30分',
      '',
      'マット',
      rateBun
    ]);
  }
  return rows;
}

// ===== ラテ欄記事仮文ジェネレーター =====
//   ※ 各番組単独で読んでも内容が分かる文章を生成
//   ※ 「振り子」「センサー名」「具体的な道具」を必ず明記

// 課題解決
function generateLatteText_KADAI(komaNum, title, content, subTitle) {
  const prefix = '探究学習で開発中のプロトタイプ';
  switch (komaNum) {
    case 5:
      return prefix + 'を完成させる回。これまで習得した知識と技術を総動員し、ユーザーの声と開発目的に立ち返って、本当にニーズに応える仕組みに辿り着くための考え方を学ぶ。';
    case 6:
      return prefix + '開発を前に進めるための役割分担とスケジュール管理を学ぶ。実際の高校生がスクーミーボードで開発したeDIYギアの事例を題材に、リアルな進め方を紹介する。';
    case 7:
      return '完成した' + prefix + 'をユーザーに使ってもらい、得たフィードバックを基にプロトタイプを改善する手法を学ぶ。実践的な改善サイクルを身につける。';
    case 8:
      return '開発した' + prefix + 'の発表回。他の学校や地域でも展開していけるよう、見習って使ってもらえる魅力的なプレゼンの作り方と表現方法を学ぶ。';
    default:
      // ⑤〜⑧以外(①〜④)は教材内容から自動生成
      return summarizeContent_(content, ['探究学習', subTitle].filter(Boolean).join('・'));
  }
}

// コネクター活用
function generateLatteText_KONE(partName, gearTitle, content, partDesc) {
  // contentから「〜のためのモノづくり」を抽出して魅力的に再構成
  const purposeMatch = content.match(/(.+?)のためのモノづくり/);
  const purpose = purposeMatch ? purposeMatch[1] + 'のためのモノづくり' : 'モノづくり';

  // 「スクーミーボードの〇〇センサー」を冒頭に明示
  const sensorPhrase = 'スクーミーボードの' + partName;

  // 仕組みの抽出: 「仕組み」または最後の文を抽出
  let mechanism = content.replace(/.+のためのモノづくり[\s　]*/, '').trim();
  // 句点で切る
  if (mechanism.length > 90) {
    const idx = mechanism.indexOf('。', 50);
    if (idx > 0) mechanism = mechanism.substring(0, idx + 1);
  }

  return purpose + '。' + sensorPhrase + 'を使い、' + mechanism;
}

// データサイエンス
function generateLatteText_JOUHOU(title, content, goal) {
  // contentの先頭文を抽出
  let firstSentence = content.split('。')[0];
  if (firstSentence) firstSentence += '。';

  // 「実習では」以降を抽出
  const labMatch = content.match(/実習では[、,][\s　]*(.+?)(。|$)/);
  const labText = labMatch ? '実習ではスクーミーボードを使い、' + labMatch[1] + '。' : '';

  // PythonとAIを明示
  let intro = firstSentence;
  if (!intro.includes('Python') && !intro.includes('AI')) {
    intro = 'Pythonで' + intro;
  }

  return intro + labText;
}

// 物理シミュレーション(英語講座を日本語要約)
function generateLatteText_PRO(komaNum, jpTitle, content, goal) {
  const base = 'スクーミーボードの加速度センサーで';
  switch (komaNum) {
    case 1:
      return base + '物理現象を測れることを学ぶ導入回。センサーが何を測っているのか、生のセンサー値が動きでどう変化するのかを観察し、物理現象がデジタル信号に変換される仕組みを理解する。英語講座。';
    case 2:
      return base + '取得したデータをJavaScriptとp5.jsで受信・表示・分析する方法を学ぶ。物理運動からセンサー信号、シリアル通信、画面表示までの情報の流れを体感する英語講座。';
    case 3:
      return '振り子の周期の法則を検証するための実験計画を立てる回。測定する変数(振り子の長さ・センサー信号)と理論値の比較方法、実験条件の設定を学ぶ英語講座。';
    case 4:
      return '振り子の実験装置を設計する回。決まった長さの振り子にスクーミーボードを取り付け、加速度のゼロクロス検出や磁気信号のピーク検出など、データ処理方法とp5.js表示レイアウトを設計する英語講座。';
    case 5:
      return base + '振り子の周期を自動計算するJavaScriptプログラムを実装する。ノイズをフィルタリングし、平均周期を理論値と比較。緑/赤の表示で結果の精度を即座にフィードバックする英語講座。';
    case 6:
      return '異なる長さの振り子で実験を行い、周期が長さの平方根に比例する物理法則を検証する。空気抵抗・ピボットの摩擦・測定誤差を、科学的活動の自然な要素として考察する英語講座。';
    case 7:
      return '振り子実験の結果を分析し、ノイズ除去フィルタやしきい値を改善する。任意で加速度データをAIに送り、振り子運動の調和性を確認。データサイエンスと物理モデリングを結ぶ英語講座。';
    case 8:
      return '振り子理論・実験設定・収集データ・理論値との比較結果を英語でプレゼン。誤差や改善点、より大きな振れ角や重力加速度の推定など発展も振り返る、シリーズ最終回の英語講座。';
    default:
      return jpTitle + '。' + summarizeContent_(content, '振り子実験');
  }
}

// 内容文を100文字程度に要約(フォールバック)
function summarizeContent_(content, contextHint) {
  if (!content) return '';
  const sentences = content.split('。').filter(s => s.trim().length > 0);
  let result = '';
  for (const s of sentences) {
    if ((result + s + '。').length > 110) break;
    result += s + '。';
  }
  if (contextHint && !result.includes(contextHint)) {
    result = contextHint + 'の回。' + result;
  }
  return result;
}

// ===== Pro編 日本語タイトル変換 =====
function translateProTitle_(komaNum) {
  const map = {
    1: 'センサーとデバイスを知ろう',
    2: 'プログラミングで動きを測ろう',
    3: '振り子実験を計画しよう',
    4: '振り子実験のシステムを設計しよう',
    5: '振り子の周期を計算しよう',
    6: '振り子の理論を検証しよう',
    7: '振り子モデルを改善しよう',
    8: '振り子実験を英語で発表しよう'
  };
  return map[komaNum] || '';
}

// ===== ユーティリティ =====
function findHeaderRow_(values, keyword) {
  for (let i = 0; i < values.length; i++) {
    if (values[i].some(c => String(c || '').trim() === keyword)) {
      return i;
    }
  }
  return -1;
}

function extractKomaNumber_(komaCode) {
  const map = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10, '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15, '⑯': 16 };
  for (const c of komaCode) {
    if (map[c] !== undefined) return map[c];
  }
  return 0;
}

// ===== 装飾 =====
function decorateSheet_(sheet, dataRowCount) {
  const lastCol = HEADERS.length;
  const lastRow = dataRowCount + 1;

  // ヘッダー行
  const headerRange = sheet.getRange(1, 1, 1, lastCol);
  headerRange.setBackground('#1F3A8A');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');

  // データ行
  if (dataRowCount > 0) {
    const dataRange = sheet.getRange(2, 1, dataRowCount, lastCol);
    dataRange.setVerticalAlignment('top');
    dataRange.setWrap(true);
  }

  // 列幅(各列ピクセル指定)
  const widths = [110, 70, 80, 180, 200, 130, 180, 350, 200, 60, 200, 70, 380];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // 行高さ
  if (dataRowCount > 0) {
    sheet.setRowHeights(2, dataRowCount, 80);
  }
  sheet.setRowHeight(1, 36);

  // フィルター
  if (dataRowCount > 0 && !sheet.getFilter()) {
    sheet.getRange(1, 1, lastRow, lastCol).createFilter();
  }

  // 1列目(ジャンル)で色分け
  if (dataRowCount > 0) {
    const genreCol = sheet.getRange(2, 1, dataRowCount, 1).getValues();
    for (let i = 0; i < genreCol.length; i++) {
      const genre = genreCol[i][0];
      let color = '#F4F6FA';
      if (genre === '課題解決') color = '#E8EEFB';
      else if (genre === 'コネクター活用') color = '#EDEDED';
      else if (genre === 'データサイエンス') color = '#F0F0F2';
      else if (genre === '物理シミュレーション') color = '#FBEDE5';
      sheet.getRange(2 + i, 1, 1, 1).setBackground(color).setFontWeight('bold');
    }
  }

  // 固定行
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
}
