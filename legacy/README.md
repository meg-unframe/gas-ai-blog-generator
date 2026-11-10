# legacy（置き換え前の既存コードのバックアップ）

新しい実装（`src/`）に置き換える前に、スプレッドシートに紐づく Apps Script に入っていたコードを、取得したまま無改変で保存しています。

| 項目 | 内容 |
|---|---|
| スクリプトID | 1GORmppGwb2GIGa0Mlg12iAWOTGlLsKauHoxS5Xf68eAO-4PvIKSti1RR |
| 取得日時 | 2026-11-10 23:31 (Asia/Tokyo) |
| 取得方法 | clasp 3.4.1 の `clone`（リモートは読み取りのみ） |
| `コード.js` | Apps Script 上の「コード.gs」 |
| `appsscript.json` | 置き換え前のマニフェスト |

- このフォルダは `clasp push` の対象外です（`.clasp.json` の `rootDir` が `src` のため、`src/` 以外は送信されません）。
- APIキーなどの秘密情報は含まれていません（既存コードはキーをスクリプトプロパティ `CLAUDE_API_KEY` から読む作りでした）。
- 整合性確認: `shasum -a 256 -c SHA256SUMS.txt`

## 復元方法

新しい実装をやめて元に戻す場合は、`src/` の内容を退避したうえで、このフォルダの `コード.js` と `appsscript.json` を `rootDir` に置いて `clasp push` します（`.js` は Apps Script 上で `.gs` として扱われます）。
