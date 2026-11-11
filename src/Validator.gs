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
 * 【壊れたHTML】本文はHTML形式（<p> で始まるのは正常）。記号表記のタグ・入れ子や閉じ忘れなどの
 *   構造の誤りは findHtmlStructureProblems で検出したらNG → 再生成の対象。
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
 * 壊れたHTMLを検出する（本文はHTML形式なので、正しいタグ自体は問題ない）。
 *  - escaped_tag     : &lt;p&gt; のように記号表記で書かれたタグ（WordPress で「<p>」が文字として見える）
 *  - stray_bracket   : タグになっていない「<」「>」（書きかけのタグ「<p本文」など）
 *  - nested          : <p><p>、<p> の中の見出し・リストなどの入れ子
 *  - heading_not_top : 見出しがほかの要素の中にある
 *  - list_child / li_outside_list / text_in_list : リスト構造の誤り
 *  - text_outside    : どのタグにも囲まれていない文章
 *  - unmatched_close / mismatched / unclosed : 開始タグと終了タグの対応の誤り
 * 許可していないタグ（findHtmlProblems で別途NG）は構造チェックの対象外。
 * @return {{type: string, example: string}[]} 種類ごとに最初の1件
 */
function findHtmlStructureProblems(html) {
  const found = [];
  const seen = {};
  const add = function (type, example) {
    if (seen[type]) return;
    seen[type] = true;
    found.push({ type: type, example: String(example).replace(/\s+/g, ' ').trim().slice(0, 30) });
  };
  const src = String(html).replace(/<!--[\s\S]*?-->/g, '');

  const escaped = src.match(
    /(?:&(?:amp;)?lt;|&#0*60;|&#x0*3c;)\/?[a-zA-Z][a-zA-Z0-9]*[^<>]*?(?:&(?:amp;)?gt;|&#0*62;|&#x0*3e;)/i
  );
  if (escaped) add('escaped_tag', escaped[0]);

  const stack = [];
  const top = function () {
    return stack.length ? stack[stack.length - 1] : null;
  };
  const checkText = function (text) {
    if (!decodeHtmlEntities(text).replace(/[\s　 ]+/g, '')) return;
    if (/[<>]/.test(text)) add('stray_bracket', text);
    const t = top();
    if (t === null) add('text_outside', text);
    else if (t === 'ul' || t === 'ol') add('text_in_list', text);
  };

  const tagPattern = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)[^<>]*>/g;
  let last = 0;
  let m;
  while ((m = tagPattern.exec(src)) !== null) {
    checkText(src.slice(last, m.index));
    last = tagPattern.lastIndex;
    const isClosing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (CONFIG.ALLOWED_TAGS.indexOf(name) === -1) continue;
    const t = top();

    if (isClosing) {
      if (t === name) {
        stack.pop();
      } else if (stack.indexOf(name) === -1) {
        add('unmatched_close', m[0]);
      } else {
        add('mismatched', '<' + t + '>…' + m[0]);
        while (stack.length && stack.pop() !== name) {
          // 対応する開始タグまで戻す
        }
      }
      continue;
    }

    if (t === 'ul' || t === 'ol') {
      if (name !== 'li') add('list_child', '<' + t + '>' + m[0]);
    } else if (name === 'li') {
      add('li_outside_list', m[0]);
    } else if (name !== 'strong' && (t === 'p' || t === 'h2' || t === 'h3' || t === 'strong')) {
      add('nested', '<' + t + '>' + m[0]);
    } else if ((name === 'h2' || name === 'h3') && t !== null) {
      add('heading_not_top', '<' + t + '>' + m[0]);
    } else if (name === 'strong' && t === null) {
      add('text_outside', m[0]);
    }
    stack.push(name);
  }
  checkText(src.slice(last));
  if (stack.length) add('unclosed', '<' + stack.join('><') + '>');
  return found;
}

function describeHtmlStructureProblem_(p) {
  const ex = '（例:「' + p.example + '」）';
  switch (p.type) {
    case 'escaped_tag':
      return 'タグが記号表記' + ex + 'で書かれており、WordPress では「<p>」のような文字として表示されます。タグは < > で直接書いてください。';
    case 'stray_bracket':
      return 'タグになっていない「<」「>」' + ex + 'があります。本文中で「<」「>」を文字として使わず、タグは <p>…</p> の形で正しく書いてください。';
    case 'nested':
      return '段落・見出しの中に、段落・見出し・リストが入っています' + ex + '。<p><p> のような二重タグや入れ子にしないでください。';
    case 'heading_not_top':
      return '見出しがほかのタグの中にあります' + ex + '。<h2> / <h3> は単独で書いてください。';
    case 'list_child':
      return '<ul> / <ol> の直下に <li> 以外のタグがあります' + ex + '。';
    case 'li_outside_list':
      return '<li> が <ul> / <ol> の外にあります' + ex + '。';
    case 'text_in_list':
      return '<ul> / <ol> の直下に文章があります' + ex + '。項目は <li>…</li> で囲んでください。';
    case 'text_outside':
      return 'どのタグにも囲まれていない文章があります' + ex + '。文章は <p>…</p> などで囲んでください。';
    case 'unmatched_close':
      return '対応する開始タグのない終了タグがあります' + ex + '。';
    case 'mismatched':
      return '開始タグと終了タグの対応が崩れています' + ex + '。';
    case 'unclosed':
      return '閉じられていないタグがあります' + ex + '。開始タグには必ず終了タグを付けてください。';
    default:
      return 'HTMLの構造に誤りがあります' + ex + '。';
  }
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
    findHtmlStructureProblems(body).forEach(function (p) {
      errors.push(describeHtmlStructureProblem_(p));
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
