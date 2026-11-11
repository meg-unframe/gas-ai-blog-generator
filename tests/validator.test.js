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

test('Markdown 検出: 本文に混在するとNG（4行目で見つかったパターンを含む）', () => {
  const pad = 'あ'.repeat(2300);
  const check = (html) => ctx.validateArticle({ body_html: html, meta_description: okMeta });
  const ng = {
    'タグの間の ## 行': `<p>${pad}</p>\n## 見出しA\n<p>本文</p>\n<h2>まとめ</h2><p>x</p>`,
    '<p>内の ##': `<p>${pad}</p><p>## 見出しA</p><h2>まとめ</h2>`,
    '<h2>内の ##': `<p>${pad}</p><h2>## 見出しA</h2><h2>まとめ</h2>`,
    '### 小見出し': `<p>${pad}</p><p>### 小見出し</p><h2>まとめ</h2>`,
    '全角＃': `<p>${pad}</p><p>＃＃ 見出し</p><h2>まとめ</h2>`,
    '文字参照で書かれた ##': `<p>${pad}</p><p>&#35;&#35; 見出し</p><h2>まとめ</h2>`,
    '**太字**': `<p>${pad} **強調**</p><h2>まとめ</h2>`,
    '__太字__': `<p>${pad} __強調__</p><h2>まとめ</h2>`,
    '- 箇条書き': `<p>${pad}</p><p>- 項目1\n- 項目2</p><h2>まとめ</h2>`,
    '* 箇条書き': `<p>${pad}</p><p>* 項目</p><h2>まとめ</h2>`,
    '1. 番号付き': `<p>${pad}</p><p>1. 手順</p><h2>まとめ</h2>`,
    'コードブロック': `<p>${pad}</p><p>\`\`\`js</p><h2>まとめ</h2>`,
    'インラインコード': `<p>${pad} \`code\`</p><h2>まとめ</h2>`,
    'リンク': `<p>${pad} [公式](https://example.com)</p><h2>まとめ</h2>`,
  };
  for (const [name, html] of Object.entries(ng)) {
    const r = check(html);
    assert.equal(r.ok, false, name);
    // 文字数など別の理由ではなく、Markdown の検出だけでNGになっていること
    assert.equal(r.errors.length, 1, name + ': ' + r.errors.join(' '));
    assert.match(r.errors[0], /Markdown|「\*\*」|箇条書き|番号付き|コード記法|リンク/, name);
  }
});

test('Markdown 検出: 誤検出しない（正しいHTML・C#・ハッシュタグなど）', () => {
  const pad = 'あ'.repeat(2300);
  const check = (html) => ctx.validateArticle({ body_html: html, meta_description: okMeta });
  const ok = {
    '正しいHTML': `<p>${pad}</p><h2>見出し</h2><h3>小見出し</h3><ul><li>項目</li></ul><ol><li>手順</li></ol><p><strong>強調</strong></p><h2>まとめ</h2><p>要点</p>`,
    'C#': `<p>${pad} C#とJavaの比較</p><h2>まとめ</h2>`,
    'ハッシュタグ': `<p>${pad}</p><p>#SEO対策 のタグ</p><h2>まとめ</h2>`,
    '行の途中の - ': `<p>${pad}</p><p><strong>注意</strong>- 補足です</p><h2>まとめ</h2>`,
    '計算式の *': `<p>${pad} 5*3=15、2 * 4 = 8</p><h2>まとめ</h2>`,
    '行の途中の 1. ': `<p>${pad} バージョン1. 2の違い</p><h2>まとめ</h2>`,
    '全角の・箇条': `<p>${pad}</p><p>・項目A</p><h2>まとめ</h2>`,
  };
  for (const [name, html] of Object.entries(ok)) {
    const r = check(html);
    assert.equal(r.ok, true, name + ': ' + r.errors.join(' '));
  }
});

test('Markdown 検出: 再生成に渡すメッセージに具体例と直し方が入る', () => {
  const r = ctx.validateArticle({ body_html: `<p>${'あ'.repeat(2300)}</p><p>## 見出しA</p><h2>まとめ</h2>`, meta_description: okMeta });
  const msg = r.errors.find((e) => e.includes('見出し記法'));
  assert.ok(msg, r.errors.join(' '));
  assert.ok(msg.includes('## 見出しA'));
  assert.ok(msg.includes('<h2> / <h3>'));
  assert.equal(r.errors.filter((e) => e.includes('見出し記法')).length, 1); // 同じ種類は1件にまとめる
});

test('Markdown 検出: メタディスクリプション', () => {
  const body = makeBody(2500);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: '**勤怠管理**のポイントを解説' }).ok, false);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: '# 勤怠管理のポイント' }).ok, false);
  assert.equal(ctx.validateArticle({ body_html: body, meta_description: 'C#入門者向けに #SEO の基本を解説します。' }).ok, true);
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
