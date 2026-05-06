/**
 * gas/update-version.gs v2.0
 *
 * スプレッドシートのボタン1つで:
 *   1. バージョンをインクリメント
 *   2. GitHub Actions の workflow_dispatch を発火
 *   3. ビルド完了をポーリング(最大5分)
 *   4. 完成 PDF を GitHub Release から取得
 *   5. Google Drive の指定フォルダに自動アップロード
 *
 * 事前準備:
 *   1. メニュー「📄 PDF ビルド > configシートを初期化」を実行
 *   2. configシートを編集:
 *        B1 month         (例: 2026-05)
 *        B2 version       (例: v1.0)
 *        B3 lastUpdate    (自動)
 *        B4 driveFolderId (Driveの保存先フォルダID。空ならルート)
 *   3. プロジェクトの設定 > スクリプトプロパティ で
 *        GITHUB_TOKEN = (GitHub PAT, scopes: repo + workflow)
 *
 * メニュー併用について:
 *   既に build_integrated_table.gs / shorten_latte.gs で onOpen() を
 *   定義している場合は、各ファイルの onOpen を1つに統合し、
 *      addBuildPdfMenu_(SpreadsheetApp.getUi());
 *   を呼んでください。
 */

const GH_OWNER = 'shiojima-test';
const GH_REPO = 'schoomy-spotlive-schedule-web';
const WORKFLOW_FILE = 'build-pdf.yml';
const CONFIG_SHEET_NAME = 'config';
const POLL_INTERVAL_SEC = 10;
const POLL_MAX_TRIES = 30; // 30 × 10s = 5min

function onOpen() {
  addBuildPdfMenu_(SpreadsheetApp.getUi());
}

function addBuildPdfMenu_(ui) {
  ui.createMenu('📄 PDF ビルド')
    .addItem('PDFをビルド & Driveに保存(version+1)', 'buildPdfAndSaveToDrive')
    .addItem('既存PDFをDriveに同期(再保存)', 'syncLatestPdfToDrive')
    .addSeparator()
    .addItem('configシートを初期化', 'initConfigSheet')
    .addToUi();
}

function initConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let config = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!config) config = ss.insertSheet(CONFIG_SHEET_NAME);
  const rows = [
    ['month', '2026-05'],
    ['version', 'v1.0'],
    ['lastUpdate', new Date()],
    ['driveFolderId', ''],
  ];
  config.getRange(1, 1, rows.length, 2).setValues(rows);
  config.getRange(1, 1, rows.length, 1).setFontWeight('bold');
  config.setColumnWidth(1, 140);
  config.setColumnWidth(2, 320);
  SpreadsheetApp.getUi().alert(
    'configシートを初期化しました。\n\n' +
    '次にやること:\n' +
    '1. B1=month, B2=version, B4=driveFolderId を埋める\n' +
    '   (driveFolderId: Drive で保存したいフォルダを開いた時のURL末尾の文字列)\n' +
    '2. プロジェクトの設定 > スクリプトプロパティ で\n' +
    '   GITHUB_TOKEN = GitHubのPersonal Access Token を設定\n' +
    '   (scopes: repo + workflow)'
  );
}

// =============== メイン ===============

function buildPdfAndSaveToDrive() {
  const ui = SpreadsheetApp.getUi();
  const cfg = readConfig_();
  if (!cfg) return;

  const token = getGithubToken_();
  if (!token) return;

  // versionをインクリメント (v1.0 → v1.1)
  const newVersion = bumpVersion_(cfg.version);
  setConfig_('version', newVersion);
  setConfig_('lastUpdate', new Date());

  ui.alert(
    `ビルド開始\n` +
    `  月: ${cfg.month}\n` +
    `  バージョン: ${newVersion}\n\n` +
    `GitHub Actions が走り、完成 PDF が Drive にアップロードされます。\n` +
    `(処理に2〜5分かかります。終了時にメッセージが出ます)`
  );

  // workflow_dispatch
  const runId = dispatchWorkflow_(token, cfg.month, newVersion);
  if (!runId) {
    ui.alert('Workflow 起動に失敗しました。詳細はログを確認してください。');
    return;
  }

  // 完了待ち
  const conclusion = pollWorkflow_(token, runId);
  if (conclusion !== 'success') {
    ui.alert(`ビルドが ${conclusion} で終了しました。\nGitHub Actions ログを確認してください。\n\nhttps://github.com/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`);
    return;
  }

  // Releaseから取得 → Drive保存
  const result = downloadAndSaveToDrive_(token, cfg.month, newVersion, cfg.driveFolderId);
  if (!result) {
    ui.alert('Drive保存に失敗しました。');
    return;
  }

  ui.alert(
    `🎉 完了しました！\n\n` +
    `Drive: ${result.driveUrl}\n` +
    `Releases: https://github.com/${GH_OWNER}/${GH_REPO}/releases/tag/schedule-${cfg.month}-${newVersion}`
  );
}

function syncLatestPdfToDrive() {
  const ui = SpreadsheetApp.getUi();
  const cfg = readConfig_();
  if (!cfg) return;
  const token = getGithubToken_();
  if (!token) return;

  const result = downloadAndSaveToDrive_(token, cfg.month, cfg.version, cfg.driveFolderId);
  if (!result) {
    ui.alert('Drive保存に失敗しました。Releaseがまだ存在しないかもしれません。');
    return;
  }
  ui.alert(`Drive保存しました ✅\n${result.driveUrl}`);
}

// =============== GitHub API ===============

function dispatchWorkflow_(token, month, version) {
  const before = new Date().getTime() - 1000;

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: ghHeaders_(token),
    payload: JSON.stringify({ ref: 'main', inputs: { month, version } }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 204) {
    Logger.log('dispatch failed: ' + res.getContentText());
    return null;
  }

  // 直近の run を取って ID を返す(数秒待ってから)
  Utilities.sleep(4000);
  for (let i = 0; i < 5; i++) {
    const list = UrlFetchApp.fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`,
      { headers: ghHeaders_(token), muteHttpExceptions: true }
    );
    const runs = JSON.parse(list.getContentText()).workflow_runs || [];
    const recent = runs.find(r => new Date(r.created_at).getTime() >= before);
    if (recent) return recent.id;
    Utilities.sleep(3000);
  }
  return null;
}

function pollWorkflow_(token, runId) {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    const res = UrlFetchApp.fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`,
      { headers: ghHeaders_(token), muteHttpExceptions: true }
    );
    const run = JSON.parse(res.getContentText());
    if (run.status === 'completed') return run.conclusion; // success / failure / cancelled
    Utilities.sleep(POLL_INTERVAL_SEC * 1000);
  }
  return 'timeout';
}

function downloadAndSaveToDrive_(token, month, version, folderId) {
  const tag = `schedule-${month}-${version}`;
  const relRes = UrlFetchApp.fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/tags/${tag}`,
    { headers: ghHeaders_(token), muteHttpExceptions: true }
  );
  if (relRes.getResponseCode() !== 200) {
    Logger.log('release fetch failed: ' + relRes.getContentText());
    return null;
  }
  const release = JSON.parse(relRes.getContentText());

  // 一番新しい(タイムスタンプが最後の) PDF を選ぶ
  const pdfs = (release.assets || [])
    .filter(a => a.name.endsWith('.pdf') && !a.name.includes('latest'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!pdfs.length) {
    Logger.log('no pdf assets in release');
    return null;
  }
  const asset = pdfs[pdfs.length - 1];

  const blobRes = UrlFetchApp.fetch(asset.url, {
    headers: { ...ghHeaders_(token), 'Accept': 'application/octet-stream' },
    muteHttpExceptions: true,
    followRedirects: true,
  });
  if (blobRes.getResponseCode() !== 200) {
    Logger.log('asset download failed: ' + blobRes.getResponseCode());
    return null;
  }

  const blob = blobRes.getBlob().setName(asset.name).setContentType('application/pdf');
  let folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();

  // 同名ファイルが既にあれば上書きせず履歴として保存する(タイムスタンプで一意)
  const file = folder.createFile(blob);
  return { driveUrl: file.getUrl(), fileName: asset.name };
}

// =============== ヘルパー ===============

function ghHeaders_(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function getGithubToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!t) {
    SpreadsheetApp.getUi().alert(
      'GITHUB_TOKEN が未設定です。\n\n' +
      'プロジェクトの設定 > スクリプトプロパティで\n' +
      'GITHUB_TOKEN = GitHub PAT(repo + workflow scope) を追加してください。'
    );
  }
  return t;
}

function readConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('configシートがありません。「configシートを初期化」を先に実行してください。');
    return null;
  }
  const month = String(sheet.getRange('B1').getValue() || '').trim();
  const version = String(sheet.getRange('B2').getValue() || '').trim();
  const driveFolderId = String(sheet.getRange('B4').getValue() || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    SpreadsheetApp.getUi().alert(`monthの形式が不正: ${month}\n例: 2026-05`);
    return null;
  }
  return { month, version, driveFolderId };
}

function setConfig_(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  const map = { month: 'B1', version: 'B2', lastUpdate: 'B3', driveFolderId: 'B4' };
  if (!map[key]) return;
  sheet.getRange(map[key]).setValue(value);
}

function bumpVersion_(v) {
  const m = String(v || '').match(/v(\d+)\.(\d+)/);
  if (m) return `v${m[1]}.${parseInt(m[2]) + 1}`;
  return 'v1.0';
}
