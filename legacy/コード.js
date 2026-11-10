/**
 * @OnlyCurrentDoc
 */
const CONFIG = {
  model: 'claude-haiku-5-5',
  maxTokens: 4000,
  apiKeyProperty: 'CLAUDE_API_KEY',
  headerRow: 1
};

const SAMPLE_ARTICLE = `
「勤怠管理はエクセルで十分」は本当か？担当者が見落としがちな3つの落とし穴

「うちはまだ社員数もそこまで多くないし、勤怠管理はエクセルで回せている」——そう考えている労務・総務担当の方は少なくありません。確かにエクセルは手軽で、追加費用もかからない魅力的な方法です。ただ、会社の成長や働き方の変化に合わせて、いつのまにか「見えないコスト」が膨らんでいることも事実です。この記事では、エクセル勤怠を続けるうえで担当者が見落としがちな3つの落とし穴を、現場目線で整理します。

落とし穴①：集計ミスは「気づけないまま」積み上がる
エクセル勤怠で最も多いトラブルが、関数のズレやコピペミスによる集計誤りです。1人分の残業時間が数分ずれるだけなら気づきにくいですが、それが数十人・十数か月分積み重なると、未払い残業として後から大きな金額で表面化することがあります。しかもエクセルは「誰がいつ何を変更したか」の履歴が残らないため、原因の特定にも時間がかかります。月末のたびに担当者が電卓で検算している——そんな状態は、すでにエクセルの限界サインかもしれません。

落とし穴②：法改正への対応が、どうしても後手に回る
働き方関連の法改正は、ここ数年だけでも「有給休暇の年5日取得義務」「36協定の残業上限規制」「割増賃金率の引き上げ」など立て続けに行われています。エクセル運用の場合、こうした改正のたびに数式やシートを自前で組み直す必要があり、対応が遅れるほど労務リスクが高まります。特に有給5日の取得状況や、残業の上限超過は「うっかり見落としました」では済まされない領域です。

落とし穴③：テレワークや多様な働き方に追いつけない
オフィス出社が前提だった頃は、タイムカードやエクセルでも十分でした。しかしテレワーク・時差出勤・中抜けといった柔軟な働き方が広がると、「いつ・どこで・どれだけ働いたか」を正確に記録すること自体が難しくなります。自己申告ベースのエクセルでは、打刻漏れや申告忘れが増え、結果として正確な労働時間の把握ができなくなる——これは従業員にとっても会社にとっても不幸な状態です。

まとめ：エクセルが悪いのではなく、「フェーズ」の問題
ここまで3つの落とし穴を挙げましたが、エクセルそのものが悪いわけではありません。大切なのは、自社の人数・働き方が「エクセルで回せるフェーズ」を超えていないかを定期的に見直すことです。月末の勤怠集計に毎月どれくらいの工数がかかっているかを可視化してみてください。その時間が「本来やるべき仕事」を圧迫しているなら、それがシステム化を検討するベストなタイミングです。
`;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('記事生成')
    .addItem('選択行の記事を生成', 'generateSelectedArticle')
    .addToUi();
}

function generateSelectedArticle() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const range = sheet.getActiveRange();
  const row = range ? range.getRow() : 0;

  if (row <= CONFIG.headerRow) {
    SpreadsheetApp.getUi().alert('記事を作る行を選択してください。');
    return;
  }

  const apiKey = PropertiesService.getScriptProperties()
    .getProperty(CONFIG.apiKeyProperty);

  if (!apiKey) {
    SpreadsheetApp.getUi().alert(
      'APIキーが未設定です。先にScript Propertiesへ設定してください。'
    );
    return;
  }

  const [keyword, subKeyword] = sheet.getRange(row, 1, 1, 2).getValues()[0];
  if (!keyword) {
    SpreadsheetApp.getUi().alert('A列にメインキーワードを入力してください。');
    return;
  }

  sheet.getRange(row, 3).setValue('生成中');
  SpreadsheetApp.flush();

  try {
    const result = requestArticle_(apiKey, keyword, subKeyword || '');
    const articleLength = result.article.length;
    const metaLength = result.metaDescription.length;

    sheet.getRange(row, 4, 1, 4).setValues([[
      result.title,
      '',
      result.article,
      result.metaDescription
    ]]);

    let status = '生成済み';
    if (articleLength < 2000 || articleLength > 3000 || metaLength > 120) {
      status = '要確認';
    }
    sheet.getRange(row, 3).setValue(status);

    SpreadsheetApp.getUi().alert(
      `記事を生成しました。\n本文：${articleLength}字／メタディスクリプション：${metaLength}字\nステータス：${status}`
    );
  } catch (error) {
    sheet.getRange(row, 3).setValue('エラー');
   SpreadsheetApp.getUi().alert('生成に失敗しました。\n' + error.message);
  }
}

function requestArticle_(apiKey, keyword, subKeyword) {
  const prompt = `
あなたは中小企業向けBtoB SaaSのマーケティングライターです。
読者は中小企業の経営者・IT担当者です。
以下のサンプル記事のトーンを参考にしてください。カジュアルですが、専門的で、現場目線の説明にします。

【サンプル記事】
${SAMPLE_ARTICLE}

【今回の記事条件】
メインキーワード：${keyword}
サブキーワード：${subKeyword || '指定なし'}
記事本文：日本語で2,000〜3,000字
構成：導入文 → H2見出し3つ → まとめ
メインキーワードとサブキーワードは不自然にならない範囲で含めてください。
根拠のない統計、法律情報、具体的な数字を作らないでください。
本文にはタイトルを含めず、見出しは「## 」で始めてください。
画像は不要です。

次のJSONだけを返してください。前後に説明やコードブロックを付けないでください。
{"title":"記事タイトル","article":"記事本文","metaDescription":"120字以内の説明文"}
`;

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: CONFIG.model,
      max_tokens: CONFIG.maxTokens,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Claude APIエラー（HTTP ${statusCode}）：${responseText.slice(0, 500)}`);
  }

  const data = JSON.parse(responseText);
  const text = (data.content || [])
    .filter(item => item.type === 'text')
    .map(item => item.text)
    .join('\n')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  const jsonText = text.match(/\{[\s\S]*\}/);
     if (!jsonText) throw new Error('AIの返答からJSONを読み取れませんでした。返答冒頭: ' + text.slice(0, 200));
     
  const result = JSON.parse(jsonText[0]);
  if (!result.title || !result.article || !result.metaDescription) {
    throw new Error('AIの返答に必要な項目がありません。');
  }

  return {
    title: String(result.title).trim(),
    article: String(result.article).trim(),
    metaDescription: String(result.metaDescription).trim()
  };
}
