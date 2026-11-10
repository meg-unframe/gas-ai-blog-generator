/**
 * メニューと記事生成のメイン処理（1回の実行で「未処理」1行のみ）
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('記事生成')
    .addItem('未処理を1件生成', 'generateOneArticle')
    .addSeparator()
    .addItem('設定状況を確認', 'showSettingsStatus')
    .addItem('APIキーを設定', 'setApiKey')
    .addItem('単価を設定', 'setPrices')
    .addItem('対象シート名を設定', 'setDataSheetName')
    .addItem('接続テスト', 'runConnectionTest')
    .addToUi();
}

function newRunId_() {
  return Utilities.getUuid().slice(0, 8);
}

function formatSkipped_(skipped) {
  return skipped
    .map(function (s) {
      return s.row + '行目（' + s.reason + '）';
    })
    .join(' / ');
}

function generateOneArticle() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) {
    showAlert_('別の生成処理が実行中です。終了してから再度実行してください。');
    return;
  }
  const deadlineMs = Date.now() + CONFIG.TIME_BUDGET_MS;
  const ctx = { runId: newRunId_(), row: null, calls: [] };
  let sheet = null;
  let inProgress = false;

  try {
    const settings = loadSettings();
    sheet = getDataSheet(settings.dataSheetName);

    const found = findTargetRow(sheet);
    let skipNote = '';
    if (found.skipped.length) {
      const skippedText = formatSkipped_(found.skipped);
      appendLog({ runId: ctx.runId, kind: 'スキップ', result: 'スキップ', message: skippedText });
      skipNote = '\n\nスキップした「未処理」行（既存データ保護）:\n' + skippedText;
    }
    if (!found.target) {
      showAlert_('処理対象の「未処理」行はありません。' + skipNote);
      return;
    }

    const target = found.target;
    ctx.row = target.row;

    const missing = [];
    if (!target.keyword) missing.push('A列（キーワード）');
    if (!target.title) missing.push('D列（タイトル）');
    if (missing.length) {
      markErrorIfPending(sheet, target.row);
      const msg = missing.join('・') + 'が空のため生成できません。';
      appendLog({ runId: ctx.runId, row: target.row, kind: '入力チェック', result: 'エラー', message: msg });
      showAlert_(target.row + '行目: ' + msg + '\nステータスを「' + CONFIG.STATUS.ERROR + '」にしました。' + skipNote);
      return;
    }

    markInProgress(sheet, target.row);
    inProgress = true;

    const article = generateArticleWithRetries_(settings, target, ctx, deadlineMs);
    writeArticleResult(sheet, target.row, article.body, article.meta);
    inProgress = false;

    const total = sumCallTotals(ctx.calls);
    appendLog({
      runId: ctx.runId, row: target.row, kind: '記事合計', result: CONFIG.STATUS.DONE,
      tokens: total.tokens, prices: settings.prices, articleTotalUsd: total.costUsd,
      bodyChars: article.bodyChars, metaChars: article.metaChars,
      message: 'API呼び出し ' + total.count + ' 回',
    });
    showAlert_(
      target.row + '行目の記事を生成しました。\n' +
        '本文: ' + article.bodyChars + ' 字 / メタ: ' + article.metaChars + ' 字\n' +
        'API呼び出し: ' + total.count + ' 回\n' +
        '入力 ' + total.tokens.input + ' / 出力 ' + total.tokens.output + ' トークン\n' +
        '推定費用: ' + formatUsd(total.costUsd) + skipNote
    );
  } catch (e) {
    if (inProgress && sheet && ctx.row) markErrorIfInProgress(sheet, ctx.row);
    const total = sumCallTotals(ctx.calls);
    appendLog({
      runId: ctx.runId, row: ctx.row, kind: ctx.calls.length ? '記事合計' : 'エラー', result: 'エラー',
      tokens: ctx.calls.length ? total.tokens : null,
      articleTotalUsd: ctx.calls.length ? total.costUsd : null,
      message: e.message,
    });
    showAlert_(
      'エラーが発生しました' + (ctx.row ? '（' + ctx.row + '行目）' : '') + '。\n' + e.message +
        '\n\n既存の本文・メタディスクリプションは削除していません。詳細は「' + CONFIG.LOG_SHEET_NAME + '」シートを確認してください。' +
        (ctx.calls.length ? '\nこの記事の推定費用: ' + formatUsd(total.costUsd) : '')
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * 記事を生成し、条件未達なら最大 (MAX_GENERATION_ATTEMPTS - 1) 回再生成する。
 * API 呼び出しごとに生成ログへ1行記録し、ctx.calls に費用を積み上げる。
 */
function generateArticleWithRetries_(settings, target, ctx, deadlineMs) {
  let feedback = null;
  let lastErrors = [];
  for (let attempt = 1; attempt <= CONFIG.MAX_GENERATION_ATTEMPTS; attempt++) {
    if (Date.now() >= deadlineMs) throw new Error('実行時間の上限に近づいたため中止しました。');
    const kind = attempt === 1 ? '生成' : '再生成';

    let res;
    try {
      res = callClaudeApi(settings.apiKey, buildArticlePayload(target, feedback), deadlineMs);
    } catch (e) {
      appendLog({ runId: ctx.runId, row: target.row, kind: kind, result: 'APIエラー', requestId: e.requestId, message: e.message });
      throw e;
    }

    const body = res.body;
    const cost = calculateCost(body.usage, settings.prices);
    ctx.calls.push(cost);
    const notes = cost.warnings.slice();
    if (body.model && body.model !== CONFIG.MODEL) notes.push('応答モデルが設定（' + CONFIG.MODEL + '）と異なります: ' + body.model);
    if (res.httpRetries) notes.push('HTTP再試行 ' + res.httpRetries + ' 回');
    const baseLog = {
      runId: ctx.runId, row: target.row, kind: kind, model: body.model, stopReason: body.stop_reason,
      tokens: cost.tokens, prices: settings.prices, costUsd: cost.costUsd, requestId: res.requestId,
    };

    let extracted;
    try {
      extracted = extractArticleFromResponse(body);
    } catch (e) {
      appendLog(Object.assign({}, baseLog, { result: 'NG', message: [e.message].concat(notes).join(' ') }));
      if (!e.retryable) throw e;
      lastErrors = [e.message];
      feedback = e.feedback || [e.message];
      continue;
    }

    const v = validateArticle(extracted);
    appendLog(Object.assign({}, baseLog, {
      result: v.ok ? 'OK' : 'NG', bodyChars: v.bodyChars, metaChars: v.metaChars,
      message: v.errors.concat(notes).join(' '),
    }));
    if (v.ok) return { body: v.body, meta: v.meta, bodyChars: v.bodyChars, metaChars: v.metaChars };
    lastErrors = v.errors;
    feedback = v.errors;
  }
  throw new Error(CONFIG.MAX_GENERATION_ATTEMPTS + '回生成しても条件を満たしませんでした: ' + lastErrors.join(' '));
}
