/**
 * schoomy-spotlive-schedule-web
 * gas/update-version.gs v1.0
 *
 * スプレッドシートに「config」シートを作り、
 *   B1: month   (例: 2026-05)
 *   B2: version (例: v1.0)
 *   B3: lastUpdate
 * を配置。
 *
 * メニュー「📄 PDF ビルド → PDFをビルド(version+1)」を押すと、
 *   1. version をインクリメント
 *   2. lastUpdate を現在時刻に更新
 *   3. GitHub Actions の workflow_dispatch を叩いてPDFビルドを起動
 *
 * 事前準備:
 *   スクリプトプロパティに `GITHUB_TOKEN` を設定
 *   (GitHubのPersonal Access Token、Actions: write 権限が必要)
 */

const GITHUB_OWNER = 'shiojima-test';
const GITHUB_REPO = 'schoomy-spotlive-schedule-web';
const WORKFLOW_FILE = 'build-pdf.yml';
const CONFIG_SHEET_NAME = 'config';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📄 PDF ビルド')
    .addItem('PDFをビルド(version+1)', 'buildPDF')
    .addItem('configシートを初期化', 'initConfigSheet')
    .addToUi();
}

function initConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let config = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!config) {
    config = ss.insertSheet(CONFIG_SHEET_NAME);
  }
  const rows = [
    ['month', '2026-05'],
    ['version', 'v1.0'],
    ['lastUpdate', new Date()],
  ];
  config.getRange(1, 1, rows.length, 2).setValues(rows);
  config.getRange(1, 1, 3, 1).setFontWeight('bold');
  config.setColumnWidth(1, 120);
  config.setColumnWidth(2, 200);
  SpreadsheetApp.getUi().alert('configシートを初期化しました。\n\n' +
    'B1=month, B2=version, B3=lastUpdate\n\n' +
    'スクリプトプロパティに GITHUB_TOKEN を設定してください。');
}

function buildPDF() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = ss.getSheetByName(CONFIG_SHEET_NAME);

  if (!config) {
    ui.alert('configシートがありません。「configシートを初期化」を先に実行してください。');
    return;
  }

  const month = String(config.getRange('B1').getValue() || '').trim();
  let version = String(config.getRange('B2').getValue() || '').trim();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    ui.alert(`monthの形式が不正です: ${month}\n例: 2026-05`);
    return;
  }

  // バージョンインクリメント (v1.0 → v1.1)
  const m = version.match(/v(\d+)\.(\d+)/);
  if (m) {
    version = `v${m[1]}.${parseInt(m[2]) + 1}`;
  } else {
    version = 'v1.0';
  }
  config.getRange('B2').setValue(version);
  config.getRange('B3').setValue(new Date());

  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    ui.alert('GITHUB_TOKEN が未設定です。\n\n' +
      'スクリプトエディタ → プロジェクトの設定 → スクリプトプロパティで設定してください。');
    return;
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify({
      ref: 'main',
      inputs: { month, version }
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() === 204) {
    ui.alert(
      `PDFビルド開始\n\n` +
      `月: ${month}\n` +
      `バージョン: ${version}\n\n` +
      `数分後にGitHub Releasesにアップロードされます:\n` +
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
    );
  } else {
    ui.alert(
      `エラー: ${res.getResponseCode()}\n\n${res.getContentText()}`
    );
  }
}
