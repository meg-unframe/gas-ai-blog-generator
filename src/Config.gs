/**
 * 設定値。
 * 秘密情報（APIキー）や料金単価はここに書かない。スクリプトプロパティに保存する（Setup.gs 参照）。
 */
const CONFIG = Object.freeze({
  // ---- Claude API ----
  API_URL: 'https://api.anthropic.com/v1/messages',
  ANTHROPIC_VERSION: '2026-10-21',
  MODEL: 'claude-sonnet-5-5',
  EFFORT: 'medium',
  MAX_TOKENS: 16000,

  // ---- シート ----
  HEADER_ROWS: 1, // 1行目は見出し、2行目以降がデータ
  NUM_COLUMNS: 7, // A〜G
  COL: Object.freeze({
    KEYWORD: 1, // A: キーワード
    SUB_KEYWORD: 2, // B: サブキーワード
    STATUS: 3, // C: ステータス
    TITLE: 4, // D: タイトル（入力済みのものを使う。書き換えない）
    WP_URL: 5, // E: WordPress URL（手入力。触らない）
    BODY: 6, // F: 記事本文（HTML）
    META: 7, // G: メタディスクリプション
  }),
  STATUS: Object.freeze({
    PENDING: '未処理',
    IN_PROGRESS: '生成中',
    DONE: '生成済み',
    ERROR: 'エラー',
  }),
  LOG_SHEET_NAME: '生成ログ',

  // ---- 記事の条件 ----
  BODY_MIN_CHARS: 2000,
  BODY_MAX_CHARS: 3000,
  META_MAX_CHARS: 120,
  ALLOWED_TAGS: Object.freeze(['h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong']),
  SUMMARY_HEADING_KEYWORD: 'まとめ',

  // ---- 再試行・時間 ----
  MAX_GENERATION_ATTEMPTS: 2, // 初回 + 条件未達時の再生成1回
  HTTP_MAX_RETRIES: 3, // 429 / 5xx / 529 のときの再試行回数
  RETRYABLE_HTTP_STATUS: Object.freeze([429, 500, 502, 503, 504, 529]),
  HTTP_BACKOFF_BASE_MS: 2000,
  HTTP_BACKOFF_MAX_MS: 30000,
  TIME_BUDGET_MS: 5 * 60 * 1000, // GAS の実行上限（6分）に対して余裕を持たせる

  // ---- スクリプトプロパティのキー名 ----
  PROP: Object.freeze({
    API_KEY: 'ANTHROPIC_API_KEY',
    DATA_SHEET_NAME: 'DATA_SHEET_NAME',
    PRICE_INPUT: 'PRICE_INPUT_PER_MTOK',
    PRICE_OUTPUT: 'PRICE_OUTPUT_PER_MTOK',
    PRICE_CACHE_WRITE: 'PRICE_CACHE_WRITE_PER_MTOK',
    PRICE_CACHE_READ: 'PRICE_CACHE_READ_PER_MTOK',
  }),
});
