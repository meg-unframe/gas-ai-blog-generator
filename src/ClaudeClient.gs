/**
 * Claude Messages API の呼び出し（UrlFetchApp）。
 * APIキーやリクエストヘッダーはログ・エラーメッセージに含めない。
 */

function createApiError_(message, props) {
  const e = new Error(message);
  Object.keys(props || {}).forEach(function (k) {
    e[k] = props[k];
  });
  return e;
}

function lowerCaseKeys_(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(function (k) {
    out[String(k).toLowerCase()] = obj[k];
  });
  return out;
}

function extractApiErrorMessage_(text) {
  try {
    const body = JSON.parse(text);
    if (body && body.error) return (body.error.type || 'error') + ': ' + (body.error.message || '');
  } catch (e) {
    // JSON でない応答はそのまま一部を返す
  }
  return String(text || '').slice(0, 200);
}

function computeRetryWaitMs_(retryAfterHeader, retryIndex) {
  const sec = Number(retryAfterHeader);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, CONFIG.HTTP_BACKOFF_MAX_MS);
  const backoff = CONFIG.HTTP_BACKOFF_BASE_MS * Math.pow(2, retryIndex);
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(backoff + jitter, CONFIG.HTTP_BACKOFF_MAX_MS);
}

/**
 * Messages API を呼ぶ。429 / 5xx / 529 は時間予算内で再試行する。
 * 通信エラー（タイムアウト等）は送信済み・課金済みの可能性があるため自動再試行しない。
 * @return {{body: Object, requestId: string, httpRetries: number}}
 */
function callClaudeApi(apiKey, payload, deadlineMs) {
  let retries = 0;
  for (;;) {
    let response;
    try {
      response = UrlFetchApp.fetch(CONFIG.API_URL, {
        method: 'post',
        contentType: 'application/json; charset=utf-8',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': CONFIG.ANTHROPIC_VERSION,
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
    } catch (e) {
      throw createApiError_('Claude API への通信に失敗しました: ' + e.message, { retryable: false });
    }

    const status = response.getResponseCode();
    const headers = lowerCaseKeys_(response.getHeaders());
    const requestId = headers['request-id'] || '';
    const text = response.getContentText('UTF-8');

    if (status === 200) {
      try {
        return { body: JSON.parse(text), requestId: requestId, httpRetries: retries };
      } catch (e) {
        throw createApiError_('API応答のJSONを解析できませんでした。', { status: status, requestId: requestId, retryable: false });
      }
    }

    if (CONFIG.RETRYABLE_HTTP_STATUS.indexOf(status) !== -1 && retries < CONFIG.HTTP_MAX_RETRIES) {
      const waitMs = computeRetryWaitMs_(headers['retry-after'], retries);
      if (Date.now() + waitMs < deadlineMs) {
        retries++;
        Utilities.sleep(waitMs);
        continue;
      }
    }
    throw createApiError_('Claude API エラー (HTTP ' + status + '): ' + extractApiErrorMessage_(text), {
      status: status,
      requestId: requestId,
      retryable: false,
    });
  }
}

/**
 * 応答から記事 JSON を取り出す。
 * retryable=true のエラーは「内容の問題」として再生成の対象になる。
 * @return {{body_html: string, meta_description: string}}
 */
function extractArticleFromResponse(body) {
  const stop = body && body.stop_reason;
  if (stop === 'refusal') {
    throw createApiError_('モデルが応答を拒否しました（stop_reason: refusal）。', { retryable: false });
  }
  if (stop === 'max_tokens') {
    throw createApiError_('出力が上限トークン数で途中終了しました（stop_reason: max_tokens）。', {
      retryable: true,
      feedback: ['出力が長すぎて途中で終了しました。本文は ' + CONFIG.BODY_MAX_CHARS + ' 字以内に収めてください。'],
    });
  }
  if (stop !== 'end_turn') {
    throw createApiError_('想定外の stop_reason です: ' + stop, { retryable: false });
  }

  const text = (body.content || [])
    .filter(function (b) {
      return b && b.type === 'text';
    })
    .map(function (b) {
      return b.text;
    })
    .join('');
  if (!text) throw createApiError_('応答にテキストが含まれていません。', { retryable: true });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw createApiError_('応答をJSONとして解析できませんでした。', {
      retryable: true,
      feedback: ['指定のJSON形式（body_html と meta_description）だけを出力してください。'],
    });
  }
  if (!parsed || typeof parsed.body_html !== 'string' || typeof parsed.meta_description !== 'string') {
    throw createApiError_('応答JSONに body_html / meta_description がありません。', { retryable: true });
  }
  return { body_html: parsed.body_html, meta_description: parsed.meta_description };
}
