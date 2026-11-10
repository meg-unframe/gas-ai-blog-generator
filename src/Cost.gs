/**
 * 費用計算（GAS 固有の機能に依存しない純粋関数）
 *
 * 単価はコードに書かない。ユーザーが公式の料金ページで確認し、
 * スクリプトプロパティに「100万トークンあたりの米ドル単価」として登録した値を使う。
 * トークン数は API 応答の usage の実測値を使う。
 *   費用(USD) = Σ (トークン数 × 対応する単価 / 1,000,000)
 * ※ output_tokens には thinking（内部推論）の分も含まれる。
 */

function getTokenPriceFields() {
  return [
    { key: 'input', usageKey: 'input_tokens', label: '入力' },
    { key: 'output', usageKey: 'output_tokens', label: '出力' },
    { key: 'cacheWrite', usageKey: 'cache_creation_input_tokens', label: 'キャッシュ書き込み' },
    { key: 'cacheRead', usageKey: 'cache_read_input_tokens', label: 'キャッシュ読み込み' },
  ];
}

/** '' / null / undefined → null（未設定）。0以上の数値文字列 → number。それ以外は例外。 */
function parsePrice(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error('単価の形式が不正です: "' + s + '"（0以上の数値で入力してください）');
  }
  return Number(s);
}

function toTokenCount_(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {Object} usage API応答の usage
 * @param {{input: ?number, output: ?number, cacheWrite: ?number, cacheRead: ?number}} prices
 * @return {{tokens: Object, costUsd: ?number, warnings: string[]}} 単価不足で計算できない場合 costUsd は null
 */
function calculateCost(usage, prices) {
  const u = usage || {};
  const tokens = {};
  const warnings = [];
  let total = 0;
  let complete = true;
  getTokenPriceFields().forEach(function (f) {
    const n = toTokenCount_(u[f.usageKey]);
    tokens[f.key] = n;
    if (n === 0) return;
    const price = prices ? prices[f.key] : null;
    if (price === null || price === undefined) {
      complete = false;
      warnings.push(f.label + '単価が未設定のため費用を計算できません（' + n + 'トークン）。');
      return;
    }
    total += (n * price) / 1000000;
  });
  return { tokens: tokens, costUsd: complete ? total : null, warnings: warnings };
}

/** 複数回の API 呼び出し結果（calculateCost の戻り値の配列）を合計する */
function sumCallTotals(calls) {
  const tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let cost = 0;
  let complete = true;
  (calls || []).forEach(function (c) {
    Object.keys(tokens).forEach(function (k) {
      tokens[k] += (c.tokens && c.tokens[k]) || 0;
    });
    if (c.costUsd === null || c.costUsd === undefined) complete = false;
    else cost += c.costUsd;
  });
  return { tokens: tokens, costUsd: complete ? cost : null, count: (calls || []).length };
}

function formatUsd(costUsd) {
  if (costUsd === null || costUsd === undefined) return '計算不可（単価未設定）';
  return '$' + costUsd.toFixed(6);
}
