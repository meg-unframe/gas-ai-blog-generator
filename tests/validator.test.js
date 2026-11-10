// Validator / Cost / Prompt / 応答解析の単体テスト（API は呼ばない・費用なし）
// 実行: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
for (const f of ['Config.gs', 'Validator.gs', 'Cost.gs', 'Prompt.gs', 'ClaudeClient.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f });
}

// タグ除外後ちょうど n 文字になる本文（見出し「見出し」3字 +「まとめ」3字 + 本文）
function makeBody(n) {
  return `<p>${'あ'.repeat(n - 6)}</p>\n<h2>見出し</h2>\n<h2>まとめ</h2>`;
}
const okMeta = 'い'.repeat(100);

test('タグ除去・文字参照の復元・改行タブ除外・スペースは数える', () => {
  assert.equal(ctx.countBodyChars('<p>A&amp;B&nbsp;C</p>'), 5);
  assert.equal(ctx.countBodyChars('<p>&amp;lt;</p>'), 4); // 二重デコードしない
  assert.equal(ctx.countBodyChars('<p>&#x41;&#66;</p>'), 2);
  assert.equal(ctx.countBodyChars('<p>a\nb\tc\r\n</p>'), 3);
  assert.equal(ctx.countBodyChars('<p>a b　c</p>'), 5);
  assert.equal(ctx.countBodyChars('<p>😀</p>'), 1);
  assert.equal(ctx.countBodyChars('<p>a</p><!-- コメント -->'), 1);
});

test('本文の文字数境界（2,000〜3,000字）', () => {
  assert.equal(ctx.validateArticle({ body_html: makeBody(1999), meta_description: okMeta }).ok, false);
  assert.equal(ctx.validateArticle({ body_html: makeBody(2000), meta_description: okMeta }).ok, true);
  assert.equal(ctx.validateArticle({ body_html: makeBody(3000), meta_description: okMeta }).ok, true);
  const over = ctx.validateArticle({ body_html: makeBody(3001), meta_description: okMeta });
  assert.equal(over.ok, false);
  assert.equal(over.bodyChars, 3001);
});

test('メタディスクリプションの境界と禁止事項', () => {
  const body = makeBody(2500);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: 'い'.repeat(120) }).ok, true);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: 'い'.repeat(121) }).ok, false);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: '<b>説明</b>' }).ok, false);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: 'A&amp;B' }).ok, false);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: '=SUM(A1)' }).ok, false);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: '' }).ok, false);
});

test('使用できないタグ・属性・構成の検出', () => {
  const pad = 'あ'.repeat(2400);
  const check = (html) => ctx.validateArticle({ body_html: html, meta_description: okMeta });
  assert.equal(check(`<p>${pad}</p><script>x</script><h2>まとめ</h2>`).ok, false);
  assert.equal(check(`<h1>題</h1><p>${pad}</p><h2>まとめ</h2>`).ok, false);
  assert.equal(check(`<p class="x">${pad}</p><h2>まとめ</h2>`).ok, false);
  assert.equal(check(`<p onclick="x">${pad}</p><h2>まとめ</h2>`).ok, false);
  assert.equal(check(`<p>${pad}</p><h2>まとめ</h2><h2>おわりに</h2>`).ok, false); // 最後のh2がまとめでない
  assert.equal(check(`<p>${pad}</p>`).ok, false); // h2なし
  assert.equal(check(`${pad}<h2>まとめ</h2>`).ok, false); // タグで始まらない
  assert.equal(check(`<p>${pad}</p><h2>見出し</h2><h3>小見出し</h3><ul><li><strong>a</strong></li></ul><ol><li>b</li></ol><h2>まとめ</h2>`).ok, true);
});

test('費用計算: トークン数 × 登録単価', () => {
  // 単価はテスト用の任意の値（実際の料金ではない）
  const r = ctx.calculateCost({ input_tokens: 1000, output_tokens: 2000 }, { input: 2, output: 10, cacheWrite: null, cacheRead: null });
  assert.ok(Math.abs(r.costUsd - 0.022) < 1e-12);
  assert.equal(r.warnings.length, 0);
});

test('費用計算: 単価未設定のトークンがあれば計算不可（null）', () => {
  const r = ctx.calculateCost({ input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 5 }, { input: 1, output: 1, cacheWrite: null, cacheRead: null });
  assert.equal(r.costUsd, null);
  assert.equal(r.warnings.length, 1);
  const total = ctx.sumCallTotals([r, ctx.calculateCost({ input_tokens: 1 }, { input: 1, output: 1 })]);
  assert.equal(total.costUsd, null);
  assert.equal(total.tokens.input, 11);
  assert.equal(total.count, 2);
});

test('単価の入力値チェック', () => {
  assert.equal(ctx.parsePrice(''), null);
  assert.equal(ctx.parsePrice(undefined), null);
  assert.equal(ctx.parsePrice(' 3.5 '), 3.5);
  assert.equal(ctx.parsePrice('0'), 0);
  assert.throws(() => ctx.parsePrice('-1'));
  assert.throws(() => ctx.parsePrice('abc'));
  assert.throws(() => ctx.parsePrice('$3'));
});

test('プロンプト: 題材データの < > を無害化し、再生成時は不備を伝える', () => {
  const p = ctx.buildUserPrompt({ title: '<b>題</b>', keyword: 'kw', subKeyword: '' }, ['本文が短い']);
  assert.ok(p.includes('＜b＞題＜/b＞'));
  assert.ok(p.includes('<sub_keywords>（なし）</sub_keywords>'));
  assert.ok(p.includes('- 本文が短い'));
  const payload = ctx.buildArticlePayload({ title: 't', keyword: 'k', subKeyword: 's' }, null);
  assert.equal(payload.model, 'claude-sonnet-5-5');
  assert.equal(payload.output_config.effort, 'medium');
  assert.equal(payload.output_config.format.type, 'json_schema');
  assert.equal('fallbacks' in payload, false);
});

test('応答解析: stop_reason と JSON の扱い', () => {
  const ok = ctx.extractArticleFromResponse({
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"body_html":"<p>a</p>","meta_description":"m"}' }],
  });
  assert.equal(ok.body_html, '<p>a</p>');
  assert.throws(() => ctx.extractArticleFromResponse({ stop_reason: 'refusal', content: [] }), (e) => e.retryable === false);
  assert.throws(() => ctx.extractArticleFromResponse({ stop_reason: 'max_tokens', content: [] }), (e) => e.retryable === true);
  assert.throws(() => ctx.extractArticleFromResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }), (e) => e.retryable === true);
});
