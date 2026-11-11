/**
 * 生成結果の検証（GAS 固有の機能に依存しない純粋関数。Node の単体テストでも実行する）
 *
 * 【文字数の数え方（承認済みの定義）】
 *  本文:
 *   (1) HTMLタグ（とコメント）を除去する
 *   (2) 文字参照（&amp; &lt; &gt; &quot; &apos; &nbsp; &#数字; &#x16進;）を1文字に戻す
 *   (3) 改行（\r \n）とタブを除去する
 *   (4) Array.from(text).length で数える（絵文字などのサロゲートペアも1文字）
 *   ※ スペース（半角・全角）は数える
 *  メタディスクリプション:
 *   プレーンテキストとして (3)(4) で数える。HTMLタグ・文字参照は使用不可（検出したらNG）。
 *
 * 【Markdown 記法】本文・メタディスクリプションとも使用不可（findMarkdownProblems で検出したらNG → 再生成の対象）。
 */

function stripHtmlTags(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '');
}

function decodeHtmlEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(text).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (match, ref) {
    if (ref.charAt(0) === '#') {
      const isHex = ref.charAt(1) === 'x' || ref.charAt(1) === 'X';
      const codePoint = parseInt(ref.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!(codePoint >= 0 && codePoint <= 0x10ffff)) return match;
      return String.fromCodePoint(codePoint);
    }
    return Object.prototype.hasOwnProperty.call(named, ref) ? named[ref] : match;
  });
}

function countChars(text) {
  return Array.from(String(text).replace(/[\r\n\t]/g, '')).length;
}

function countBodyChars(html) {
  return countChars(decodeHtmlEntities(stripHtmlTags(html)));
}

function countMetaChars(meta) {
  return countChars(meta);
}

/** h2 / h3 などの見出しテキストを順番に取り出す */
function extractHeadingTexts(html, tagName) {
  const pattern = new RegExp('<' + tagName + '\\s*>([\\s\\S]*?)<\\/' + tagName + '\\s*>', 'gi');
  const texts = [];
  let m;
  while ((m = pattern.exec(html)) !== null) {
    texts.push(decodeHtmlEntities(stripHtmlTags(m[1])).trim());
  }
  return texts;
}

/** 使用できないタグ・属性・特殊構文を検出する */
function findHtmlProblems(html) {
  const problems = [];
  const add = function (msg) {
    if (problems.indexOf(msg) === -1) problems.push(msg);
  };
  if (/<!/.test(html)) add('HTMLコメントや <!DOCTYPE> などの特殊構文は使えません。');

  const tagPattern = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = tagPattern.exec(html)) !== null) {
    const isClosing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = m[3].replace(/\/\s*$/, '').trim();
    if (CONFIG.ALLOWED_TAGS.indexOf(name) === -1) {
      add('使用できないタグ <' + name + '> が含まれています（使用可: ' + CONFIG.ALLOWED_TAGS.join(', ') + '）。');
    } else if (!isClosing && attrs) {
      add('<' + name + '> に属性は付けられません。');
    }
  }
  return problems;
}

/**
 * Markdown 記法を検出する。
 * ブロック要素（p, h1〜h6, ul, ol, li, div, br）の境界で「行」に分け、
 * それ以外のタグ（strong など）は取り除いてから、文字参照を戻して判定する。
 * 誤検出を避けるため、見出しは「行頭の # の直後が空白か行末」のときだけ検出する
 * （「C#」やハッシュタグ「#SEO」は対象外）。
 * @return {{type: string, example: string}[]} 種類ごとに最初の1件
 */
function findMarkdownProblems(html) {
  const text = decodeHtmlEntities(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?(?:p|h[1-6]|ul|ol|li|div|br)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  );
  const found = [];
  const seen = {};
  const add = function (type, example) {
    if (seen[type]) return;
    seen[type] = true;
    found.push({ type: type, example: String(example).trim().slice(0, 30) });
  };

  text.split(/\r?\n/).forEach(function (rawLine) {
    const line = rawLine.replace(/^[ \t　 ]+/, '');
    if (/^[#＃]{1,6}(?:[ \t　 ]|$)/.test(line)) add('heading', line);
    if (/^[-*+][ \t　 ]/.test(line)) add('list', line);
    if (/^\d+[.)][ \t　 ]/.test(line)) add('ordered_list', line);
  });

  let m;
  if ((m = text.match(/\*\*[^*\n]+\*\*|__[^_\n]+__/))) add('bold', m[0]);
  if ((m = text.match(/```/))) add('code', m[0]);
  else if ((m = text.match(/`[^`\n]+`/))) add('code', m[0]);
  if ((m = text.match(/\[[^\]\n]+\]\([^)\s]+\)/))) add('link', m[0]);
  return found;
}

function describeBodyMarkdownProblem_(p) {
  const ex = '（例:「' + p.example + '」）';
  switch (p.type) {
    case 'heading':
      return 'Markdown の見出し記法' + ex + 'が含まれています。見出しは <h2> / <h3> タグで書き、「#」は付けないでください。';
    case 'list':
      return '行頭の「- 」「* 」による箇条書き' + ex + 'が含まれています。<ul><li> を使ってください。';
    case 'ordered_list':
      return '行頭の「1. 」による番号付きリスト' + ex + 'が含まれています。<ol><li> を使ってください。';
    case 'bold':
      return '「**」「__」による強調' + ex + 'が含まれています。<strong> を使ってください。';
    case 'code':
      return 'コード記法（``` や `）' + ex + 'が含まれています。使わないでください。';
    case 'link':
      return '[文字](URL) 形式のリンク' + ex + 'が含まれています。リンクは書かないでください。';
    default:
      return 'Markdown 記法' + ex + 'が含まれています。HTMLタグで書いてください。';
  }
}

/**
 * 記事（{ body_html, meta_description }）を検証する。
 * @return {{ok: boolean, errors: string[], body: string, meta: string, bodyChars: number, metaChars: number}}
 */
function validateArticle(article) {
  const errors = [];
  const body = article && typeof article.body_html === 'string' ? article.body_html.trim() : '';
  const meta = article && typeof article.meta_description === 'string' ? article.meta_description.trim() : '';

  let bodyChars = 0;
  if (!body) {
    errors.push('本文（body_html）が空です。');
  } else {
    if (body.charAt(0) !== '<') errors.push('本文はHTMLタグ（<p> または <h2>）で始めてください。');
    findHtmlProblems(body).forEach(function (p) {
      errors.push(p);
    });
    findMarkdownProblems(body).forEach(function (p) {
      errors.push(describeBodyMarkdownProblem_(p));
    });
    const h2s = extractHeadingTexts(body, 'h2');
    if (h2s.length === 0) {
      errors.push('<h2> 見出しがありません。');
    } else if (h2s[h2s.length - 1].indexOf(CONFIG.SUMMARY_HEADING_KEYWORD) === -1) {
      errors.push('最後の <h2> 見出しを「' + CONFIG.SUMMARY_HEADING_KEYWORD + '」にしてください。');
    }
    bodyChars = countBodyChars(body);
    if (bodyChars < CONFIG.BODY_MIN_CHARS || bodyChars > CONFIG.BODY_MAX_CHARS) {
      errors.push(
        '本文の文字数（HTMLタグ除く）が ' + bodyChars + ' 字です。' +
          CONFIG.BODY_MIN_CHARS + '〜' + CONFIG.BODY_MAX_CHARS + ' 字にしてください。'
      );
    }
  }

  let metaChars = 0;
  if (!meta) {
    errors.push('メタディスクリプションが空です。');
  } else {
    if (/<[^>]*>/.test(meta)) errors.push('メタディスクリプションにHTMLタグは使えません。');
    if (/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/.test(meta)) {
      errors.push('メタディスクリプションに文字参照（&amp; など）は使えません。');
    }
    if (/^[=+\-@]/.test(meta)) errors.push('メタディスクリプションの先頭に「= + - @」は使えません。');
    const metaMarkdown = findMarkdownProblems(meta);
    if (metaMarkdown.length) {
      errors.push('メタディスクリプションに Markdown 記法（例:「' + metaMarkdown[0].example + '」）は使えません。プレーンテキストで書いてください。');
    }
    metaChars = countMetaChars(meta);
    if (metaChars > CONFIG.META_MAX_CHARS) {
      errors.push('メタディスクリプションが ' + metaChars + ' 字です。' + CONFIG.META_MAX_CHARS + ' 字以内にしてください。');
    }
  }

  return { ok: errors.length === 0, errors: errors, body: body, meta: meta, bodyChars: bodyChars, metaChars: metaChars };
}
