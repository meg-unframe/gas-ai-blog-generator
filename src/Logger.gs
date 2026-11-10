/**
 * 「生成ログ」シートへの記録。
 * APIキー・リクエストヘッダー・本文そのものは記録しない。
 */

function getLogHeaders_() {
  return [
    '日時', '実行ID', '対象行', '種別', '結果', '応答モデル', 'stop_reason',
    '入力トークン', '出力トークン', 'キャッシュ書込トークン', 'キャッシュ読込トークン',
    '入力単価($/MTok)', '出力単価($/MTok)', 'キャッシュ書込単価($/MTok)', 'キャッシュ読込単価($/MTok)',
    '今回費用(USD)', '記事合計費用(USD)', '本文文字数', 'メタ文字数', 'リクエストID', 'メッセージ',
  ];
}

function getOrCreateLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!sheet) {
    const previouslyActive = ss.getActiveSheet();
    sheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME, ss.getNumSheets());
    const headers = getLogHeaders_();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    if (previouslyActive) previouslyActive.activate();
  }
  return sheet;
}

/** 文字列が数式として解釈されないようにする（ログシートのみ） */
function sanitizeLogCell_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function valueOrBlank_(v) {
  return v === null || v === undefined ? '' : v;
}

/**
 * @param {Object} e { runId, row, kind, result, model, stopReason, tokens, prices, costUsd,
 *                    articleTotalUsd, bodyChars, metaChars, requestId, message }
 */
function appendLog(e) {
  try {
    const t = e.tokens || {};
    const p = e.prices || {};
    const row = [
      new Date(), e.runId, e.row, e.kind, e.result, e.model, e.stopReason,
      t.input, t.output, t.cacheWrite, t.cacheRead,
      p.input, p.output, p.cacheWrite, p.cacheRead,
      e.costUsd, e.articleTotalUsd, e.bodyChars, e.metaChars, e.requestId, e.message,
    ].map(function (v) {
      return sanitizeLogCell_(valueOrBlank_(v));
    });
    getOrCreateLogSheet_().appendRow(row);
  } catch (err) {
    console.error('生成ログへの記録に失敗しました: ' + err.message);
  }
}
