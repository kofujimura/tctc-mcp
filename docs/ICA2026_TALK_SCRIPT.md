# IEEE ICA 2026 スピーチ原稿（口頭発表の部分）

状態: 第 1 案（2026-11-16）
スライド: `docs/ica2026-talk/index.html`（ブラウザで開き、矢印キーで進める。`n` キーでこの原稿を画面に出せる）

発表 15 分のうち、口頭で話すのは 9 分です。英語の原稿は約 1,080 語で、1 分あたり 120 語ほどの速さを想定しています。

| 部 | 時間 | スライド | 語数 |
|---|---|---|---|
| 1. 背景 | 2:00 | 1〜3 | 約 240 |
| コンセプト動画 | 5:45 | 4 | — |
| 2. 実験 | 4:00 | 5〜10 | 約 465 |
| 3. 歴史と課題 | 3:00 | 11〜14 | 約 375 |

各スライドの下に、英語の原稿と日本語訳を並べています。数字はすべて論文の本文と照合してあります。

---

## 第 1 部 背景（2 分）

### スライド 1 題名（約 15 秒）

> Thank you. My name is Ko Fujimura, from Otsuma Women's University in Tokyo. Today I will talk about one question: when we hand work to an AI agent, how do we stay in control of what it is allowed to do?

ありがとうございます。大妻女子大学の藤村です。今日お話しするのは一つの問いです。AI エージェントに仕事を任せるとき、何をしてよいかを、私たちはどうやって握り続けるのか。

### スライド 2 ニュースになった出来事（約 50 秒）

> AI agents no longer just answer questions. They act. And over the last two years, the headlines have shown us what that can mean.
>
> A coding agent deletes a production database, in the middle of a code freeze. Another deletes a company's database, and its backups, with a single API call. Another erases most of a user's home directory. Another deletes forty-eight thousand files in about a hundred seconds.
>
> In none of these stories was the agent malicious. In every one of them, the agent held more authority than anyone had in view.

AI エージェントは、もう質問に答えるだけではありません。行動します。そしてこの 2 年、それが何を意味するかを見出しが伝えてきました。

コーディングエージェントが、変更凍結の最中に本番データベースを削除する。別のエージェントは、1 回の API 呼び出しで会社のデータベースとバックアップを消す。利用者のホームフォルダの大半を消したものもあれば、約 100 秒で 4 万 8 千個のファイルを消したものもあります。

どの話でも、エージェントに悪意はありませんでした。どの話でも、エージェントは、誰も把握していなかったほどの権限を持っていました。

出典（報道と利用者の報告にもとづくもので、公式の調査結果ではありません）:

- 2025 年 7 月: [Fortune](https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/)、[eWeek](https://www.eweek.com/news/replit-ai-coding-assistant-failure/)
- 2026 年 4 月: [Tech.co](https://tech.co/news/ai-agent-wipes-company-database-apologizes)、[TechRepublic](https://techrepublic.com/article/ai-agent-deletes-company-database-admits-violating-guardrails)
- 2026 年 7 月: [Eon の集計](https://www.eon.io/rogue-ai-agent-tracker)
- 2026 年 9〜10 月: [TechRadar](https://techradar.com/pro/security/i-broke-something-a-claude-code-ai-agent-deleted-48-000-files-in-just-over-100-seconds-then-apologized-for-doing-so)

### スライド 3 見えない権限（約 55 秒）

> Why is this so hard to manage? Because an agent's authority is not written in one place.
>
> It is an API key in an environment file. An OAuth scope. An allow-list inside each tool. A role inside each service. Every application administers its own.
>
> So for the human who delegated the work, three simple questions have no simple answer. What may this agent do? Until when? And how do I stop it, right now?
>
> We cannot expect people to control what they cannot see. Our proposal is to make that authority a visible object: a token. Let me show you the idea in a six-minute video.

なぜ管理がこれほど難しいのか。エージェントの権限が、一か所に書かれていないからです。

環境ファイルの中の API キー。OAuth のスコープ。ツールごとの許可リスト。サービスごとのロール。アプリケーションがそれぞれ自分の分を管理しています。

そのため、仕事を任せた人間にとって、3 つの単純な問いに単純な答えがありません。このエージェントは何をしてよいのか。いつまでか。そして、今すぐ止めるにはどうするか。

見えないものを人に管理させることはできません。私たちの提案は、その権限を見える「もの」、つまりトークンにすることです。6 分の動画でご覧ください。

### スライド 4 コンセプト動画（5 分 45 秒）

動画を再生します。スライドの画面で `p` キーを押すと再生と一時停止ができます。

---

## 第 2 部 実験（4 分）

### スライド 5 動画で見たものが、測ったもの（約 35 秒）

> That was a concept video, but every door in it is real.
>
> The two MCP servers sit behind a gateway that we built; the servers themselves are unmodified. The web API checks the role on every request. The registry is a smart contract. And the dashboard is a static page, with no server and no key.
>
> We evaluated the system on a local node and on a public test network, with four questions.

いまのはコンセプト動画ですが、出てきた扉はすべて実在します。

2 つの MCP サーバーは、私たちが作ったゲートウェイの後ろにあります。サーバー自体には手を加えていません。Web API は、リクエストのたびにロールを確認します。レジストリはスマートコントラクトです。そしてダッシュボードは静的なページで、サーバーも鍵も持ちません。

このシステムを、ローカルのノードと公開テストネットで、4 つの問いに沿って評価しました。

### スライド 6 問い 1: 一つのトークンは、組織をまたいで使えるか（約 45 秒）

> First: can one token serve different applications, owned by different organizations?
>
> In the video, one card opened four doors. In the experiment, we bound one token type to five enforcement points: a contract action, three MCP servers, and a web route. All five gave the specified verdict at every step, with no application-specific administration code.
>
> Then we gave every organization its own key: two issuers, three targets. No organization wrote to a contract that another one owns. Still, one burn by the issuer was honored by all three targets.

1 つ目。一つのトークンは、別々の組織が持つ別々のアプリケーションで使えるのか。

動画では、1 枚のカードが 4 つの扉を開けました。実験では、1 種類のトークンを 5 つの検査点に結び付けました。コントラクトの操作、3 つの MCP サーバー、Web の経路です。5 つとも、すべての段階で定めたとおりの判定を返しました。アプリケーションごとの管理用コードは書いていません。

次に、組織ごとに別の鍵を持たせました。発行者が 2 つ、対象が 3 つです。どの組織も、他の組織が持つコントラクトには書き込んでいません。それでも、発行者が 1 回燃やすと、3 つの対象すべてがそれに従いました。

### スライド 7 問い 2: 管理の手間（約 35 秒）

> Second: cost. Remember the lists in the video: grant four times, revoke four times.
>
> With sixteen applications and a hundred agents, per-application role lists need three thousand two hundred grant and revoke operations. With tokens: two hundred.
>
> To be fair, inside a single organization a shared registry does just as well. The difference appears across organizations that share no administrator. And that is exactly where agents work.

2 つ目は手間です。動画の名簿を思い出してください。4 回与えて、4 回取り消していました。

アプリケーションが 16、エージェントが 100 の場合、アプリケーションごとの名簿では、付与と取消の操作が 3,200 回必要です。トークンなら 200 回です。

公平に言えば、一つの組織の中であれば、共有のレジストリでも同じ回数で済みます。差が出るのは、管理者を共有しない組織をまたぐときです。そしてエージェントが働くのは、まさにそういう場所です。

### スライド 8 問い 3: どれくらい速いか（約 40 秒）

> Third: speed. The gateway adds one and a half milliseconds per call on a local node, and forty-six milliseconds at the median on a public test network.
>
> In the video you saw a note: "sped up, waiting for Sepolia". That wait is the ledger including the transaction, about twelve seconds. Once the burn was included, the first denial followed within a quarter of a second.
>
> Expiry needs no transaction at all: every expiring grant was denied at the first block past its deadline.

3 つ目は速さです。ゲートウェイが加える時間は、ローカルのノードで 1 回の呼び出しあたり 1.5 ミリ秒、公開テストネットで中央値 46 ミリ秒です。

動画に「早送り、Sepolia を待っています」という注記が出ていました。あの待ち時間は、台帳が取引を取り込むまでの時間で、約 12 秒です。焼却が取り込まれたあと、最初の拒否は 4 分の 1 秒以内に起きました。

期限切れには、取引がまったく要りません。期限付きの付与はすべて、期限を過ぎた最初のブロックで拒否されました。

### スライド 9 問い 4: 壊れたときにどうなるか（約 30 秒）

> Fourth: what happens when things break?
>
> We injected eight faults: an RPC endpoint failing in mid-session, a wrong chain, a revocation racing forty parallel calls. In every case the gateway failed closed: no denied call ever reached the server behind it.
>
> We also mounted eleven attacks with the wrong keys. None had any effect.

4 つ目。何かが壊れたらどうなるか。

8 種類の障害を起こしました。途中で落ちる RPC、違うチェーン、40 本の並行呼び出しと競合する取消、などです。どの場合も、ゲートウェイは閉じる側に倒れました。拒否された呼び出しが背後のサーバーに届いたことは、一度もありません。

また、正しくない鍵で 11 種類の攻撃を試しました。どれも効果がありませんでした。

### スライド 10 実際のエージェントを、作業中に止める（約 50 秒）

> Finally, the scene where Mika burns the token while Kit is working. We ran that for real: a real coding agent, one task across all four kinds of door, seventy-five trials.
>
> With the token, it completed the task every time. When we burned the token in mid-task, or let it expire, it was denied at every remaining step. It did not retry; it reported back, every time.
>
> An instruction planted in a file was followed in none of fifteen trials. Unauthorized effects, across all seventy-five trials: zero.
>
> But notice: the agent's good behavior is a property of the model. The architecture is what makes it not matter.

最後に、Kit が働いている最中に Mika がトークンを燃やす場面です。あれを実際に試しました。本物のコーディングエージェントに、4 種類の扉すべてを通る 1 つの仕事をさせ、75 回試行しました。

トークンがあれば、毎回仕事をやり遂げました。作業中にトークンを燃やすか、期限切れにすると、残りのすべての段階で拒否されました。再試行はせず、毎回、報告を返しました。

ファイルに仕込んだ指示に従った試行は、15 回のうち一つもありません。75 回すべてを通して、権限のない操作が成立した回数はゼロでした。

ただし、ここに注意してください。エージェントの行儀のよさは、モデルの性質です。それがどうであっても安全が変わらないようにしているのが、この仕組みです。

---

## 第 3 部 歴史と今後の課題（3 分）

### スライド 11 Onion モデル: トークンがトークンを制御する（約 55 秒）

> Let me close with where this idea came from, and where it is going.
>
> In the video, Mika could issue a token to Kit because she herself held one: her employee ID. A token controlled the issuing of another token.
>
> We call this the onion model. The applications are the outer layer: they open for Kit's token. Issuing that token is controlled by Mika's employee ID. And issuing the employee ID is controlled by her employer. Tokens controlling tokens, layer by layer, down to a core that a single owner holds.
>
> Each layer is granted, and revoked, on its own.

最後に、この考えがどこから来て、どこへ向かうのかをお話しします。

動画で Mika が Kit にトークンを発行できたのは、彼女自身が社員証というトークンを持っていたからです。トークンが、別のトークンの発行を制御していました。

私たちはこれを Onion モデルと呼んでいます。いちばん外側の層がアプリケーションで、Kit のトークンで開きます。そのトークンの発行は、Mika の社員証が制御します。そして社員証の発行は、雇用主が制御します。トークンがトークンを制御し、層を重ねて、最後は一人の持ち主が握る芯に行き着きます。

どの層も、それぞれ単独で与えられ、取り消せます。

### スライド 12 1999 年の構想が、いま役に立つ（約 65 秒）

> This is not a new idea. We proposed it in 1999, at the USENIX Security Symposium: digital tickets whose circulation is controlled by other digital tickets.
>
> That was ten years before the first blockchain. We had the concept. What we did not have was a ledger that everyone could read.
>
> Smart contracts gave it that ledger, and we are now proposing it as an Ethereum standard: ERC-7303, Token-Controlled Token Circulation.
>
> But for most of those years, it was a solution waiting for its problem. Autonomous agents are that problem. They cross many applications in one task. Their owners are usually absent. And they can be misled.
>
> A plan made twenty-seven years ago has finally become useful.

これは新しい考えではありません。私たちは 1999 年に USENIX Security Symposium でこれを提案しました。デジタルチケットの流通を、別のデジタルチケットで制御するというものです。

最初のブロックチェーンが現れる 10 年前のことです。考え方はありました。なかったのは、誰もが読める台帳でした。

スマートコントラクトがその台帳をもたらし、私たちはいま、これを Ethereum の標準 ERC-7303「Token-Controlled Token Circulation」として提案しています。

しかしその年月の大半、これは問題を待っている解決策でした。自律的なエージェントが、その問題です。エージェントは一つの仕事で多くのアプリケーションをまたぎます。持ち主はたいていその場にいません。そして、だまされることがあります。

27 年前に立てた構想が、ようやく役に立つようになりました。

### スライド 13 残る課題: プライバシー（約 50 秒）

> One problem remains clearly open: privacy.
>
> On a public ledger, a delegation is visible. Anyone can see which account holds which token, and who issued it. For an employee ID, or a licence, that is not always acceptable.
>
> We expect the answer to come from the evolution of blockchains themselves, not from giving up the shared ledger. Designs such as INTMAX, a stateless rollup in which users keep their own data and the chain stores only commitments and proofs, show the direction: a ledger that can confirm a credential is valid without showing it to everyone.
>
> Bringing token-controlled roles to such ledgers is our future work.

はっきり残っている課題が一つあります。プライバシーです。

公開の台帳では、権限の委譲が見えてしまいます。どのアカウントがどのトークンを持ち、誰が発行したのかを、誰でも見ることができます。社員証や資格については、それが常に許されるわけではありません。

私たちは、その答えが、共有の台帳を諦めることからではなく、ブロックチェーン自体の進化から出てくると期待しています。たとえば INTMAX は、利用者が自分のデータを手元に持ち、チェーンには要約と証明だけを置くステートレスなロールアップです。こうした方式が方向を示しています。資格が有効であることを、全員に見せることなく確かめられる台帳です。

トークンで制御するロールを、そうした台帳に載せることが今後の課題です。

出典: [Intmax2 の論文](https://eprint.iacr.org/2023/1082.pdf)、[INTMAX の解説](https://medium.com/intmax/what-is-intmax-and-how-does-it-work-9a15d473480f)、[L2BEAT の記載](https://pr11229-production.previews.l2beat.com/scaling/projects/intmax)。プライバシーについての性質は INTMAX 側の資料と論文の主張にもとづくもので、こちらでは検証していません。INTMAX は支払いのための設計であり、ロールの資格証明に使えるかどうかは未検討です。

### スライド 14 まとめ（約 20 秒）

> Twenty-seven years ago, this was a concept about digital tickets. Today it answers three questions about an AI agent: what may it do, until when, and how do I stop it.
>
> Every answer is a token you can see, issued by someone you can name. Grant once. Revoke everywhere. Thank you.

27 年前、これはデジタルチケットについての考え方でした。今日それは、AI エージェントについての 3 つの問いに答えます。何をしてよいのか、いつまでか、どうやって止めるのか。

答えはどれも、目に見えるトークンであり、名前の分かる誰かが発行したものです。一度与え、あらゆる場所で取り消す。ありがとうございました。

---

## 確認していただきたい点

1. **ニュースの事例。** 4 件とも報道と利用者の報告にもとづくもので、製品名はスライドに出していません。発表前に、出典の記事をご自身でも確認してください。
2. **共著者の表記。** 1999 年の論文は 6 名の共著（Fujimura, Kuno, Terada, Matsuyama, Mizuno, Sekine）です。原稿では "we proposed" としています。
3. **ERC-7303 の状態。** 論文の記述に合わせて「提案中」としています。現在の正式な状態（Draft など）に合わせて言い方を調整してください。
4. **INTMAX の扱い。** 「方向を示している」という言い方にとどめ、TCTC にそのまま使えるとは述べていません。
5. **論文の限界のうち省いたもの。** 論文 6 章にある鮮度（古い台帳の写しを読む問題）、本人確認と隔離は、ご指示に合わせて本編から外しました。質疑で聞かれた場合の材料になります。
