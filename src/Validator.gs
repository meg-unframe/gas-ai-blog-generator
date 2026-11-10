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
    metaChars = countMetaChars(meta);
    if (metaChars > CONFIG.META_MAX_CHARS) {
      errors.push('メタディスクリプションが ' + metaChars + ' 字です。' + CONFIG.META_MAX_CHARS + ' 字以内にしてください。');
    }
  }

  return { ok: errors.length === 0, errors: errors, body: body, meta: meta, bodyChars: bodyChars, metaChars: metaChars };
}
