# schoomy-spotlive-schedule-web

スクーミースポットライブの月刊放送スケジュールを、Google Sheets を source of truth として動的に生成・PDF 化するシステム。

## 概要

- **データソース**: Google Sheets `1492Z27DEgbQkVsga5ZCpr19QCoGfwS2Zb5eT0eM-FJs`
  - `スケジュールマトリクス` タブ: 4月〜翌3月までの日次配信スケジュール
  - `番組統合表` タブ: 全番組の詳細(タイトル / 内容 / ラテ欄用記事仮文 / 担当 / 教材URL 等)
- **HTML テンプレート**: `index.html` がCSV を fetch して描画(GitHub Pages で公開)
- **PDF 生成**: Playwright で `index.html` を AB判 (210×257mm) PDF に変換
- **GAS ボタン**: スプレッドシートからバージョン番号と最終更新日時をインクリメントして PDF を再生成
- **PDF 公開**: GitHub Releases にアップロード

## 構成図

```
Google Sheets (config + data)
        ↓ publish CSV
  ┌─────┴─────┐
  ↓           ↓
GitHub Pages  GitHub Actions (Playwright)
(HTML 動的)    ↓
              PDF を Releases に push
```

## ディレクトリ

```
schoomy-spotlive-schedule-web/
├── README.md              ← このファイル
├── index.html             ← メインの HTML(GitHub Pages で公開、CSV を fetch して描画)
├── src/
│   ├── style.css          ← v7.3 デザイン CSS
│   ├── render.js          ← CSV パース & DOM 描画ロジック
│   └── data-fetcher.js    ← Google Sheets CSV 取得
├── scripts/
│   ├── build-pdf.js       ← Playwright で HTML → PDF
│   └── package.json       ← npm 依存関係
├── assets/
│   └── (画像・フォントがあれば)
├── gas/
│   └── update-version.gs  ← スプレッドシート上のボタン GAS
├── docs/
│   └── design-spec.md     ← デザイン仕様書(色・フォント・レイアウト)
├── output/                ← ローカル生成 PDF の保存先(.gitignore)
├── .github/
│   └── workflows/
│       └── build-pdf.yml  ← PDF 自動生成ワークフロー
└── .gitignore
```

## 開発フロー(Claude Code 用)

### Phase 1: 静的 HTML(現状の v7.3)を CSV データで動的化

1. `pattern1_v7.3.html` の構造とスタイルをそのまま `index.html` + `src/style.css` に分離
2. `src/data-fetcher.js` で Google Sheets の `番組統合表` タブを CSV として取得
3. `src/render.js` で取得データを HTML テンプレートに流し込む
   - 上半分: 番組カタログ(4列 × 4本 = 16本のうち、対象月の番組のみ)
   - 下半分: 4週 × 5曜日のマトリクス表

### Phase 2: 月切り替え

URL パラメータ `?month=2026-05` で対象月を切り替え。デフォルトは現在月。

### Phase 3: GitHub Pages デプロイ

`gh-pages` ブランチ or `main/docs` から公開。

### Phase 4: PDF 生成

`scripts/build-pdf.js` で Playwright を起動し、`https://shiojima-test.github.io/schoomy-spotlive-schedule-web/?month=YYYY-MM` を AB判 PDF として保存。

### Phase 5: GAS 連携

スプレッドシートにボタンを設置:
- ボタン押下 → version番号 + lastUpdate を更新 → GitHub Actions の workflow_dispatch を叩く → PDF が Releases にアップロードされる

## 命名・バージョン規約

- HTML/CSS/JS のファイル内 title・footer・コメントに必ずバージョンを入れる(例: `v1.0`)
- 更新ごとに必ずインクリメント(再利用禁止)
- 公開 PDF は `schoomy-spotlive-schedule_YYYY-MM_v{N.M}.pdf` 形式

## ブランド規約

- 表記: `スクーミー`(日本語) / `SchooMy`(英語)
  - 禁止: `Schoomy`, `schoomy`, `schooMy`
- 部品: `ブルーボード`(ESP32 と書かない) / `スクーミーIDE`(Arduino IDE と書かない)
- フォント: 画面・PDF とも `M PLUS 1`(Google Fonts CDN)
- 配色:
  - `--accent: #1F3A8A` (紺/メインアクセント)
  - `--ink: #15203A` (本文紺)
  - `--cat-d: #C7561F` (物理シミュ用テラコッタ)

## 関連リポジトリ

- `shiojima-test/schoomy-festa-schedule-web` ← 同じ思想で作られたフェスタスケジュール版

---

© 株式会社スクーミー SchooMy, Inc. / fox.schoomy.com
