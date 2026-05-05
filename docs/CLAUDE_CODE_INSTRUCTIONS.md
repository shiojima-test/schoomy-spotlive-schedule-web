# Claude Code への実装指示書

このリポジトリ `schoomy-spotlive-schedule-web` を以下の手順で完成させてください。

## 前提情報

### データソース
- スプレッドシート fileId: `1492Z27DEgbQkVsga5ZCpr19QCoGfwS2Zb5eT0eM-FJs`
- 公開 CSV URL のテンプレート(各タブ用):
  - スケジュール: `https://docs.google.com/spreadsheets/d/{FILE_ID}/export?format=csv&gid={SCHEDULE_GID}`
  - 番組統合表: `https://docs.google.com/spreadsheets/d/{FILE_ID}/export?format=csv&gid={CATALOG_GID}`
- スケジュールマトリクスの gid: `1588173790`
- 番組統合表の gid は GAS 実行で生成される(初回 GAS 実行が必要)

**注意**: GitHub Pages から CORS 制約で直接 fetch できない場合は、`pub?output=csv` 形式の publish URL を使う。または GitHub Actions で事前に CSV を取得して同梱する方式も可。

### HTML デザイン参照
- `pattern1_v7.3.html`(別途提供される v7.3 ファイル): これがそのまま `index.html` + `src/style.css` の元になる
- バナーは「パターン C(ストリップ型)」を使用
  - メインタイトル: `スクーミースポットライブ放送スケジュール`
  - 月表示: `5月号` のように後ろに配置(月は動的に変化)
  - 注意ストリップ: `参加方法` ラベル + ① 視聴にはライセンスが必要 + ② 3日前までにご予約

## Phase 1: 静的ファイル分離 & 動的化

### Step 1-1: HTML/CSS/JS の分離

`pattern1_v7.3.html` を以下に分離:
- `index.html` ← `<head>` の link で `src/style.css` を読み込み、末尾で `src/data-fetcher.js`、`src/render.js` を defer で読み込み
- `src/style.css` ← `<style>` の中身全部
- 番組カタログ部分・スケジュール表部分の HTML は `<div id="catalog-grid"></div>` `<div id="schedule-table"></div>` のような空コンテナにする

### Step 1-2: データフェッチャー

`src/data-fetcher.js`:

```javascript
const SHEET_ID = '1492Z27DEgbQkVsga5ZCpr19QCoGfwS2Zb5eT0eM-FJs';
const GID_SCHEDULE = '1588173790';
const GID_CATALOG = '___GAS生成後に取得___'; // 実装時に確認

export async function fetchCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV取得失敗: ${res.status}`);
  return await res.text();
}

export function parseCSV(text) {
  // RFC 4180 準拠の最小実装。改行入りセル、ダブルクォート対応。
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
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
```

### Step 1-3: 番組統合表の構造

GAS で生成される `番組統合表` タブのカラム(13列):

```
ジャンル | コマ番号 | コマID | 講座タイトル(日本語) | 講座タイトル(英語/原文) | サブタイトル/カテゴリ | 製品/GEARタイトル | 内容(本文) | 目標 | 時間 | 教材URL | 担当 | ラテ欄用記事仮文
```

例:
```
コネクター活用 | 5 | コネ⑤ | スピーカー｜タンクの貯水量の変化を音で知らせる |  | スピーカー | タンクの貯水量の変化を音で知らせる | 農業の問題を解決するためのモノづくり ... | メロディや不協和音や... | 30分 | https://fox.schoomy.com/me?rp=c4vha79j | カズ | モノづくり。スクーミーボードのスピーカーを使い...
```

### Step 1-4: スケジュールマトリクスの構造

`スケジュールマトリクス` タブ(4月〜翌3月):

```
月 | 日 | 曜日 | 週番号 | 祝日 | 10:20-10:50 | (担当2列目) | 10:50-11:20 | ... | 15:50-16:20
```

各セルは `担当(カズ/コウキ/マット) + 番組ID(課題① / コネ⑤ / 情報③ / Pro⑤)` の形式。
3コマ連続(10:20-11:50, 13:20-14:50, 14:50-16:20)で同じ番組が放送される。

### Step 1-5: render.js の責務

```javascript
import { fetchCSV, parseCSV } from './data-fetcher.js';

const PARTS_PER_DAY = 3; // 1コマ=30分×3で1番組(=90分)
const SLOTS = ['10:20', '13:20', '14:50']; // 3スロットの開始時刻

async function init() {
  const month = getMonthFromQuery() || getCurrentMonth(); // YYYY-MM

  // 1. 統合表を取得
  const catalogRows = parseCSV(await fetchCSV(GID_CATALOG));
  const catalog = parseCatalogRows(catalogRows); // {コネ①: {...}, 課題⑤: {...}, ...}

  // 2. スケジュールを取得 → 対象月だけ抽出
  const scheduleRows = parseCSV(await fetchCSV(GID_SCHEDULE));
  const monthSchedule = extractMonth(scheduleRows, month);

  // 3. その月で「初回放送される番組ID」を集める → 16本(またはそれ以下)
  const newProgramsThisMonth = collectFirstAirPrograms(monthSchedule);

  // 4. ヘッダー描画(月表示を更新、注意ストリップは固定)
  renderHeader(month);

  // 5. カタログ描画(4列×4本)
  renderCatalog(newProgramsThisMonth, catalog);

  // 6. スケジュール表描画(4週×5曜日)
  renderSchedule(monthSchedule, catalog);
}

init().catch(e => {
  document.getElementById('error').textContent = 'データ取得エラー: ' + e.message;
});
```

#### renderCatalog の中身

- 4ジャンル(課題解決/コネクター活用/データサイエンス/物理シミュレーション)それぞれのカラムを生成
- 各ジャンル4本のカードをタイトル + 説明文(=ラテ欄用記事仮文 を切り詰めたもの)で表示
- タイトルは1行に収まるよう短縮(必要に応じて `白space: nowrap; overflow: hidden;`)

#### renderSchedule の中身

- マトリクスは月の月曜〜金曜のみ表示(4週)
- 1セルの中に時間スロット3つ + 番組名 + 簡潔な説明
- 「月初回放送日」のセルは背景を `--accent-pale` (薄紺)で塗る
- 祝日セルは "5/4 みどりの日" のように表示

## Phase 2: 月切り替え

URL `?month=2026-05` で月を変更。
セレクトボックスで切り替え可能にしてもよい(任意)。

## Phase 3: PDF 生成スクリプト

`scripts/build-pdf.js` (Playwright):

```javascript
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const month = process.env.MONTH || new Date().toISOString().slice(0, 7); // YYYY-MM
const version = process.env.VERSION || 'v1.0';
const url = `https://shiojima-test.github.io/schoomy-spotlive-schedule-web/?month=${month}`;

const outputPath = path.join('output', `schoomy-spotlive-schedule_${month}_${version}.pdf`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  // データ描画完了を待つ
  await page.waitForSelector('#schedule-table .sched-cell', { timeout: 30000 });
  await page.pdf({
    path: outputPath,
    width: '210mm',
    height: '257mm',
    printBackground: true,
    pageRanges: '1',
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  });
  await browser.close();
  console.log('PDF生成:', outputPath);
})();
```

`scripts/package.json`:

```json
{
  "name": "schoomy-spotlive-schedule-pdf-builder",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "node build-pdf.js",
    "postinstall": "playwright install chromium"
  },
  "dependencies": {
    "playwright": "^1.48.0"
  }
}
```

## Phase 4: GitHub Actions ワークフロー

`.github/workflows/build-pdf.yml`:

```yaml
name: Build PDF

on:
  workflow_dispatch:
    inputs:
      month:
        description: 'YYYY-MM (例: 2026-05)'
        required: true
      version:
        description: 'バージョン (例: v1.0)'
        required: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install deps
        working-directory: scripts
        run: npm install
      - name: Build PDF
        working-directory: scripts
        env:
          MONTH: ${{ inputs.month }}
          VERSION: ${{ inputs.version }}
        run: npm run build
      - name: Upload to Releases
        uses: softprops/action-gh-release@v2
        with:
          tag_name: schedule-${{ inputs.month }}-${{ inputs.version }}
          name: スポットライブスケジュール ${{ inputs.month }} ${{ inputs.version }}
          files: scripts/output/*.pdf
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Phase 5: GAS

`gas/update-version.gs`:

```javascript
// スプレッドシート上のボタン用
// configシートに「month」「version」「lastUpdate」のセルを用意

const GITHUB_OWNER = 'shiojima-test';
const GITHUB_REPO = 'schoomy-spotlive-schedule-web';
const WORKFLOW_FILE = 'build-pdf.yml';

function buildPDF() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = ss.getSheetByName('config');
  if (!config) {
    SpreadsheetApp.getUi().alert('config シートがありません');
    return;
  }

  // 現在値を取得
  const month = config.getRange('B1').getValue();    // 例: 2026-05
  let version = config.getRange('B2').getValue();    // 例: v1.0
  // インクリメント
  const m = String(version).match(/v(\d+)\.(\d+)/);
  if (m) version = `v${m[1]}.${parseInt(m[2]) + 1}`;
  else version = 'v1.0';
  config.getRange('B2').setValue(version);
  config.getRange('B3').setValue(new Date());

  // GitHub Actions を起動
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    SpreadsheetApp.getUi().alert('GITHUB_TOKEN が未設定です。スクリプトプロパティに設定してください。');
    return;
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' },
    payload: JSON.stringify({
      ref: 'main',
      inputs: { month: String(month), version: String(version) }
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() === 204) {
    SpreadsheetApp.getUi().alert(`PDFビルド開始: ${month} ${version}\n\nGitHub Releases に数分後にアップされます。`);
  } else {
    SpreadsheetApp.getUi().alert(`エラー: ${res.getResponseCode()}\n${res.getContentText()}`);
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📄 PDF ビルド')
    .addItem('PDF をビルド(version+1)', 'buildPDF')
    .addToUi();
}
```

## デザイン規約(必ず守る)

- フォント: M PLUS 1
- 配色:
  - `--accent: #1F3A8A` (紺メイン)
  - `--ink: #15203A` (本文)
  - `--cat-a/b/c/d` は v7.3 と同一
- レイアウト: 210×257mm AB判
- カードタイトルは1行で収まるよう CSS で `white-space: nowrap; overflow: hidden;`
- 月初回放送セルは `--accent-pale` (薄紺)
- フッター: 「© 株式会社スクーミー SchooMy, Inc. / fox.schoomy.com」のみ(94 や バージョン情報は表示しない)
- ヘッダー: パターンC のストリップ型(注意事項を紺色帯で表示)

## バージョン管理

- 全 Web ファイルでバージョン番号を必ずインクリメント
- index.html の `<title>` タグと画面下部のクレジットに `v{N.M}` を含める
- 同じバージョン番号の使い回し禁止

## 完了条件

1. `index.html` が GitHub Pages で公開され、URL パラメータで月切り替え可能
2. ローカルで `cd scripts && npm install && MONTH=2026-05 VERSION=v1.0 npm run build` で PDF 生成可能
3. GitHub Actions の workflow_dispatch で PDF が Releases にアップされる
4. GAS のボタンから上記が起動できる
5. 公開 URL の数値・テキストが、Google Sheets の更新を反映する
