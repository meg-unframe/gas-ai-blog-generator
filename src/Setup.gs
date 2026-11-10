/**
 * 設定（APIキー・単価・対象シート名）と接続テスト。
 * 値はすべてスクリプトプロパティに保存する。コード・シート・Git には保存しない。
 */

function getScriptProps_() {
  return PropertiesService.getScriptProperties();
}

function showAlert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    console.log(message); // UI がない実行コンテキスト用
  }
}

function promptForValue_(title, message) {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(title, message, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  return res.getResponseText().trim();
}

function loadPrices_(props) {
  const P = CONFIG.PROP;
  return {
    input: parsePrice(props[P.PRICE_INPUT]),
    output: parsePrice(props[P.PRICE_OUTPUT]),
    cacheWrite: parsePrice(props[P.PRICE_CACHE_WRITE]),
    cacheRead: parsePrice(props[P.PRICE_CACHE_READ]),
  };
}

/** 記事生成に必要な設定を読み込む。不足があれば例外（処理を中止）。 */
function loadSettings() {
  const P = CONFIG.PROP;
  const props = getScriptProps_().getProperties();
  const apiKey = String(props[P.API_KEY] || '').trim();
  const dataSheetName = String(props[P.DATA_SHEET_NAME] || '').trim();
  const prices = loadPrices_(props);

  const missing = [];
  if (!apiKey) missing.push('APIキー');
  if (!dataSheetName) missing.push('対象シート名');
  if (prices.input === null) missing.push('入力単価');
  if (prices.output === null) missing.push('出力単価');
  if (missing.length) {
    throw new Error('次の設定が未登録です: ' + missing.join('、') + '。メニュー「記事生成」から設定してください。');
  }
  return { apiKey: apiKey, dataSheetName: dataSheetName, prices: prices };
}

function setApiKey() {
  const v = promptForValue_(
    'APIキーを設定',
    'Anthropic の APIキーを入力してください。\n入力値はスクリプトプロパティに保存され、シートやログには記録されません。'
  );
  if (v === null) return;
  if (!v) {
    showAlert_('空欄のため保存しませんでした。');
    return;
  }
  getScriptProps_().setProperty(CONFIG.PROP.API_KEY, v);
  showAlert_('APIキーを保存しました。');
}

function setPrices() {
  const P = CONFIG.PROP;
  const props = getScriptProps_();
  const fields = [
    { key: P.PRICE_INPUT, label: '入力（input）', required: true },
    { key: P.PRICE_OUTPUT, label: '出力（output）', required: true },
    { key: P.PRICE_CACHE_WRITE, label: 'キャッシュ書き込み（任意）', required: false },
    { key: P.PRICE_CACHE_READ, label: 'キャッシュ読み込み（任意）', required: false },
  ];
  const updates = {};
  const deletes = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const current = props.getProperty(f.key);
    const v = promptForValue_(
      '単価を設定 (' + (i + 1) + '/' + fields.length + ')',
      CONFIG.MODEL + ' の「' + f.label + '」単価を、公式の料金ページで確認して入力してください。\n' +
        '単位: 100万トークンあたりの米ドル（例: 1.5）\n' +
        '現在値: ' + (current === null ? '未設定' : current) + '\n' +
        '空欄でOK → 現在値を維持' + (f.required ? '' : ' / 「-」→ 削除')
    );
    if (v === null) {
      showAlert_('キャンセルしました。単価は変更していません。');
      return;
    }
    if (v === '') continue;
    if (!f.required && v === '-') {
      deletes.push(f.key);
      continue;
    }
    try {
      parsePrice(v);
    } catch (e) {
      showAlert_(e.message + '\n単価は変更していません。');
      return;
    }
    updates[f.key] = v;
  }
  props.setProperties(updates);
  deletes.forEach(function (k) {
    props.deleteProperty(k);
  });
  showAlert_('単価を保存しました。');
}

function setDataSheetName() {
  const names = SpreadsheetApp.getActiveSpreadsheet()
    .getSheets()
    .map(function (s) {
      return s.getName();
    })
    .filter(function (n) {
      return n !== CONFIG.LOG_SHEET_NAME;
    });
  const current = getScriptProps_().getProperty(CONFIG.PROP.DATA_SHEET_NAME);
  const v = promptForValue_(
    '対象シート名を設定',
    '記事データ（A〜G列）があるシート名を入力してください。\n候補: ' + names.join(' / ') + '\n現在値: ' + (current || '未設定')
  );
  if (v === null || v === '') return;
  if (names.indexOf(v) === -1) {
    showAlert_('シート「' + v + '」が見つかりません。保存しませんでした。');
    return;
  }
  getScriptProps_().setProperty(CONFIG.PROP.DATA_SHEET_NAME, v);
  showAlert_('対象シートを「' + v + '」に設定しました。');
}

function showSettingsStatus() {
  const P = CONFIG.PROP;
  const props = getScriptProps_().getProperties();
  const show = function (k) {
    return props[k] ? props[k] : '未設定';
  };
  showAlert_(
    [
      'APIキー: ' + (props[P.API_KEY] ? '設定済み' : '未設定'),
      '対象シート: ' + show(P.DATA_SHEET_NAME),
      'モデル: ' + CONFIG.MODEL + '（effort: ' + CONFIG.EFFORT + '）',
      '単価（$/100万トークン）',
      '  入力: ' + show(P.PRICE_INPUT),
      '  出力: ' + show(P.PRICE_OUTPUT),
      '  キャッシュ書き込み: ' + show(P.PRICE_CACHE_WRITE),
      '  キャッシュ読み込み: ' + show(P.PRICE_CACHE_READ),
    ].join('\n')
  );
}

/** 短いリクエストを1回送り、疎通・モデル名・トークン数・費用記録を確認する。 */
function runConnectionTest() {
  const runId = newRunId_();
  try {
    const props = getScriptProps_().getProperties();
    const apiKey = String(props[CONFIG.PROP.API_KEY] || '').trim();
    if (!apiKey) throw new Error('APIキーが未設定です。');
    const prices = loadPrices_(props);
    const payload = {
      model: CONFIG.MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: '接続テストです。「OK」とだけ返答してください。' }],
      output_config: { effort: 'low' },
    };
    const res = callClaudeApi(apiKey, payload, Date.now() + 60 * 1000);
    const cost = calculateCost(res.body.usage, prices);
    appendLog({
      runId: runId, kind: '接続テスト', result: 'OK', model: res.body.model, stopReason: res.body.stop_reason,
      tokens: cost.tokens, prices: prices, costUsd: cost.costUsd, requestId: res.requestId,
      message: cost.warnings.join(' '),
    });
    showAlert_(
      '接続テスト成功\n' +
        '応答モデル: ' + res.body.model + '\n' +
        '入力 ' + cost.tokens.input + ' / 出力 ' + cost.tokens.output + ' トークン\n' +
        '費用: ' + formatUsd(cost.costUsd)
    );
  } catch (e) {
    appendLog({ runId: runId, kind: '接続テスト', result: 'エラー', requestId: e.requestId, message: e.message });
    showAlert_('接続テスト失敗\n' + e.message);
  }
}
