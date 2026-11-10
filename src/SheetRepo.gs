/**
 * データシートの読み書き。
 * 書き込むのは C（ステータス）・F（本文）・G（メタディスクリプション）のみ。
 * 「生成済み」「生成中」「エラー」の行、および F/G に既存データがある行には書き込まない。
 */

function isBlank_(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function getDataSheet(sheetName) {
  if (sheetName === CONFIG.LOG_SHEET_NAME) {
    throw new Error('対象シートに「' + CONFIG.LOG_SHEET_NAME + '」は指定できません。');
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('対象シート「' + sheetName + '」が見つかりません。メニュー「記事生成 > 対象シート名を設定」で設定してください。');
  }
  return sheet;
}

/**
 * 上から順に「未処理」の行を探し、最初の処理対象を返す。
 * F列またはG列に既存データがある「未処理」行はスキップ（ステータスも変更しない）。
 */
function findTargetRow(sheet) {
  const C = CONFIG.COL;
  const firstRow = CONFIG.HEADER_ROWS + 1;
  const lastRow = sheet.getLastRow();
  const result = { target: null, skipped: [] };
  if (lastRow < firstRow) return result;

  const values = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, CONFIG.NUM_COLUMNS).getValues();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const row = firstRow + i;
    if (String(v[C.STATUS - 1]).trim() !== CONFIG.STATUS.PENDING) continue;
    if (!isBlank_(v[C.BODY - 1])) {
      result.skipped.push({ row: row, reason: 'F列（本文）に既存データあり' });
      continue;
    }
    if (!isBlank_(v[C.META - 1])) {
      result.skipped.push({ row: row, reason: 'G列（メタディスクリプション）に既存データあり' });
      continue;
    }
    result.target = {
      row: row,
      keyword: String(v[C.KEYWORD - 1]).trim(),
      subKeyword: String(v[C.SUB_KEYWORD - 1]).trim(),
      title: String(v[C.TITLE - 1]).trim(),
    };
    break;
  }
  return result;
}

function readRowState_(sheet, row) {
  const C = CONFIG.COL;
  const v = sheet.getRange(row, 1, 1, CONFIG.NUM_COLUMNS).getValues()[0];
  return { status: String(v[C.STATUS - 1]).trim(), body: v[C.BODY - 1], meta: v[C.META - 1] };
}

/** 未処理 → 生成中。状態が変わっていたら中止する。 */
function markInProgress(sheet, row) {
  const s = readRowState_(sheet, row);
  if (s.status !== CONFIG.STATUS.PENDING || !isBlank_(s.body) || !isBlank_(s.meta)) {
    throw new Error(row + '行目の状態が変わったため処理を中止しました。');
  }
  sheet.getRange(row, CONFIG.COL.STATUS).setValue(CONFIG.STATUS.IN_PROGRESS);
  SpreadsheetApp.flush();
}

/** 書き込み直前に再確認してから F・G を書き、C を「生成済み」にする。 */
function writeArticleResult(sheet, row, body, meta) {
  const s = readRowState_(sheet, row);
  if (s.status !== CONFIG.STATUS.IN_PROGRESS) {
    throw new Error('書き込み前の確認で ' + row + '行目のステータスが「' + s.status + '」に変わっていたため、書き込みを中止しました。');
  }
  if (!isBlank_(s.body) || !isBlank_(s.meta)) {
    throw new Error('書き込み前の確認で ' + row + '行目のF列またはG列に値が入っていたため、上書きせず中止しました。');
  }
  sheet.getRange(row, CONFIG.COL.BODY).setValue(body);
  sheet.getRange(row, CONFIG.COL.META).setValue(meta);
  sheet.getRange(row, CONFIG.COL.STATUS).setValue(CONFIG.STATUS.DONE);
  SpreadsheetApp.flush();
}

/** 生成中 → エラー（ステータスが「生成中」のときだけ。F・G には触れない）。 */
function markErrorIfInProgress(sheet, row) {
  try {
    if (readRowState_(sheet, row).status === CONFIG.STATUS.IN_PROGRESS) {
      sheet.getRange(row, CONFIG.COL.STATUS).setValue(CONFIG.STATUS.ERROR);
      SpreadsheetApp.flush();
    }
  } catch (e) {
    console.error('ステータスをエラーに更新できませんでした: ' + e.message);
  }
}

/** 未処理 → エラー（入力不備のとき。ステータスが「未処理」のときだけ）。 */
function markErrorIfPending(sheet, row) {
  if (readRowState_(sheet, row).status === CONFIG.STATUS.PENDING) {
    sheet.getRange(row, CONFIG.COL.STATUS).setValue(CONFIG.STATUS.ERROR);
    SpreadsheetApp.flush();
  }
}
