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

  // B1(month), B2(version), B4(driveFolderId) は「日付」として誤解釈されないよう
  // 先に文字列(plain text)書式を固定してから値を書く
  config.getRange('B1').setNumberFormat('@');
  config.getRange('B2').setNumberFormat('@');
  config.getRange('B4').setNumberFormat('@');

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

  showCompletionDialog_(cfg.month, newVersion, result);
}

/** 完了ダイアログ: ダウンロードリンク + ウェブ埋め込み用HTMLスニペットを表示 */
function showCompletionDialog_(month, version, result) {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: -apple-system, "Hiragino Sans", sans-serif; padding: 14px; margin: 0; font-size: 12px; }
      h3 { margin: 0 0 10px; font-size: 14px; color: #1F3A8A; }
      p { margin: 4px 0; }
      .link { color: #1F3A8A; word-break: break-all; }
      .box { background: #F4F6FA; border: 1px solid #DDE3EE; padding: 8px; margin: 8px 0; border-radius: 4px; font-family: monospace; font-size: 11px; max-height: 240px; overflow: auto; white-space: pre-wrap; }
      button { font-size: 12px; padding: 5px 12px; cursor: pointer; background: #1F3A8A; color: #fff; border: none; border-radius: 4px; margin-right: 6px; }
      button.ghost { background: #fff; color: #333; border: 1px solid #ccc; }
    </style>
    <h3>🎉 PDFビルド & Drive保存 完了</h3>
    <p><strong>月:</strong> ${escapeForHtml_(month)} / <strong>バージョン:</strong> ${escapeForHtml_(version)}</p>
    <p><strong>ファイル名:</strong> ${escapeForHtml_(result.fileName)}</p>
    <p><strong>ファイルID:</strong> <span class="link">${escapeForHtml_(result.fileId)}</span></p>
    <p><strong>Drive で開く:</strong> <a class="link" href="${escapeForHtml_(result.driveUrl)}" target="_blank">${escapeForHtml_(result.driveUrl)}</a></p>
    <p><strong>直リンク(ダウンロード):</strong> <a class="link" href="${escapeForHtml_(result.downloadUrl)}" target="_blank">${escapeForHtml_(result.downloadUrl)}</a></p>

    <h3 style="margin-top:14px;">ウェブサイト埋め込み用HTML</h3>
    <p>そのままコピーしてホームページに貼り付けてください。</p>
    <div class="box" id="snippet">${escapeForHtml_(buildEmbedHtml_(result.fileId, month))}</div>
    <button onclick="copySnippet()">HTMLをコピー</button>
    <button class="ghost" onclick="google.script.host.close()">閉じる</button>
    <script>
      function copySnippet() {
        const t = document.getElementById('snippet').innerText;
        navigator.clipboard.writeText(t).then(() => {
          const b = event.target;
          const orig = b.textContent;
          b.textContent = 'コピーしました ✓';
          setTimeout(() => { b.textContent = orig; }, 1500);
        });
      }
    </script>
  `).setWidth(720).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'PDFビルド完了');
}

function buildEmbedHtml_(fileId, month) {
  return `<!-- スクーミースポットライブ放送スケジュール ${month} ダウンロードボタン -->
<style>
.schoomy-spotlive-dl-wrap { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; margin: 24px 0; }
.schoomy-spotlive-dl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  padding: 14px 32px; color: #ffffff !important;
  font-family: 'Noto Sans JP','Hiragino Sans','Meiryo',sans-serif; font-size: 16px; font-weight: 700;
  text-decoration: none !important; border-radius: 8px; transition: all 0.2s ease; box-sizing: border-box;
  background: #1F3A8A; box-shadow: 0 2px 6px rgba(31,58,138,0.3);
}
.schoomy-spotlive-dl-btn:hover {
  background: #14275E; box-shadow: 0 4px 10px rgba(31,58,138,0.5); transform: translateY(-1px);
}
@media (max-width: 768px) {
  .schoomy-spotlive-dl-wrap { gap: 12px; margin: 20px 0; padding: 0 16px; }
  .schoomy-spotlive-dl-btn { width: calc(100% - 32px); max-width: 360px; padding: 13px 20px; font-size: 15px; }
}
</style>
<div class="schoomy-spotlive-dl-wrap">
  <a class="schoomy-spotlive-dl-btn"
     href="https://drive.google.com/uc?export=download&id=${fileId}"
     download>
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>スポットライブ放送スケジュール(${month})をPDFでダウンロード</span>
  </a>
</div>`;
}

function escapeForHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function syncLatestPdfToDrive() {
  const cfg = readConfig_();
  if (!cfg) return;
  const token = getGithubToken_();
  if (!token) return;

  const result = downloadAndSaveToDrive_(token, cfg.month, cfg.version, cfg.driveFolderId);
  if (!result) {
    SpreadsheetApp.getUi().alert('Drive保存に失敗しました。Releaseがまだ存在しないかもしれません。');
    return;
  }
  showCompletionDialog_(cfg.month, cfg.version, result);
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

  // 一番新しい(タイムスタンプが最後の) PDF アセットを選ぶ
  const stampedAssets = (release.assets || [])
    .filter(a => a.name.endsWith('.pdf') && !a.name.includes('latest'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!stampedAssets.length) {
    Logger.log('no pdf assets in release');
    return null;
  }
  const asset = stampedAssets[stampedAssets.length - 1];

  const blobRes = UrlFetchApp.fetch(asset.url, {
    headers: Object.assign({}, ghHeaders_(token), { 'Accept': 'application/octet-stream' }),
    muteHttpExceptions: true,
    followRedirects: true,
  });
  if (blobRes.getResponseCode() !== 200) {
    Logger.log('asset download failed: ' + blobRes.getResponseCode());
    return null;
  }

  const folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();

  // 表示用: 「最新」ファイル(月単位で固定名)
  // 既存があれば trashed にしてから新規作成。IDは毎回変わる(下記アラートに表示)。
  const latestName = `スポットライブ放送スケジュール_${month}.pdf`;
  const it = folder.getFilesByName(latestName);
  while (it.hasNext()) it.next().setTrashed(true);
  const latestBlob = blobRes.getBlob().copyBlob().setName(latestName).setContentType('application/pdf');
  const latestFile = folder.createFile(latestBlob);

  // 履歴用: タイムスタンプ付きの版もそのまま残す(過去ビルドを参照したい時用)
  const historyBlob = blobRes.getBlob().copyBlob().setName(asset.name).setContentType('application/pdf');
  folder.createFile(historyBlob);

  // リンクを知っている人なら閲覧/ダウンロード可(uc?export=download が動くため)
  try {
    latestFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('setSharing failed: ' + e);
  }

  // 最新ファイルIDを ScriptProperties にも保存(他関数からの参照用)
  PropertiesService.getScriptProperties().setProperty('LATEST_PDF_FILE_ID', latestFile.getId());

  return {
    fileId: latestFile.getId(),
    fileName: latestName,
    driveUrl: latestFile.getUrl(),
    downloadUrl: `https://drive.google.com/uc?export=download&id=${latestFile.getId()}`,
    historyName: asset.name,
  };
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
  const month = parseMonth_(sheet.getRange('B1').getValue());
  const version = String(sheet.getRange('B2').getValue() || '').trim();
  const driveFolderId = String(sheet.getRange('B4').getValue() || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    SpreadsheetApp.getUi().alert(
      `month の形式が不正です: ${sheet.getRange('B1').getValue()}\n` +
      `B1 セルを「2026-05」のような文字列にしてください。\n` +
      `(セル書式が「日付」になっている場合は「書式 > 数字 > 書式なしテキスト」に変更後、再入力)`
    );
    return null;
  }
  return { month, version, driveFolderId };
}

/** B1 が「日付型」として保存されていても "YYYY-MM" 文字列として取り出す */
function parseMonth_(v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    return Utilities.formatDate(v, tz, 'yyyy-MM');
  }
  return String(v || '').trim();
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
