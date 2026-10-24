# GRSMD レビュー基準

**日付:** 2026-10-24

## 0. 位置づけと出典

- この文書は、GRSMD のコードレビューの基準の唯一の正とする。機能のブランチを `develop` に入れる前のレビューは、この文書に従う。
- 観点の本体は上流の基準 [upstream_review_standards_ja.md](upstream_review_standards_ja.md) である。
  - 出典: `GoodRelax/gr-sw-maker` の `process-rules/review-standards-ja.md`、コミット `63e6fdc`。
  - 英語の行の名の出典: 同じリポジトリの `process-rules/review-standards-en.md`、コミット `b723439` (`63e6fdc` の次のコミット。英語版の行の名を日本語版にそろえた。日本語版は `63e6fdc` と同じ)。英語版は写さず、7 節の表に行の名だけを書く。
  - 写しの本文は変えない。
- この文書に書くのは、GRSMD での使い方だけ。上流の文は写さない。
  - 上流の行の扱い (そのまま採る / 読み替える / NA)
  - GRSMD 固有の観点 (G1〜G13)
  - 合格の決まり、試験、報告の形
- **行の呼び方:**
  - 上流の行は、必ず「章 + 観点の名」で呼ぶ (例: 「R3 境界とインデックス」)。番号でも、章だけ (R1〜R8) でも呼ばない (上流は番号をやめた)。仕様やレビューの報告にある裁定の ID (「裁定 R14」など) や、ほかのレビューの指摘の印 (「(R1)」など) は、基準の行とは別のもの。
  - 観点の名は、上流のチェックリストの「観点」の列と同じ文字で書く (7 節の表)。
  - 略してよいのは、括弧の中が英語の正式な名の行 (R2 の 17 行と、R1 要求の記法（EARS: Easy Approach to Requirements Syntax）) だけ。略すときは、括弧の前の部分で呼ぶ (例: 「R2 SRP」「R1 要求の記法」)。SRP（責務文）・SRP（上位の要素）・DRY（1 か所）・DRY（公開面）は略さない。
  - コード・コメント・試験の名前 (英語・ASCII の所。G5) では、上流の英語版のチェックリストの名を使う (例: 「R6 Independence」)。英語の名は 7 節の表にある。
  - GRSMD 固有の行は G1〜G13 で呼ぶ。仕様 1.3 の目標の ID (G-01〜G-10) とは別のもの。
- **問いの向き:** どの行も「はい = 良い」の向きで読む。
- **上流が変わったとき:**
  1. 上流を先に直す。
  2. オーナーが調整役に知らせる。
  3. 調整役が追従の作業を起こす。
  4. 追従では、上流の 2 つの版の差分を行ごとに読み、5 節の扱い (そのまま / 読み替え / NA) を決める。
  5. 次をすべて改める。
     - `upstream_review_standards_ja.md`: 本文を新しい版で丸ごと置き換え、冒頭の注 (出典・取った日) を改める
     - この文書の 0 節の版 (日本語版と英語版のコミット)
     - 5 節 (5.1〜5.3 の行の名と扱い、数)
     - 6 節の行の名
     - 7 節の表 (日本語と英語の行の名、見方)
     - 付録 B
     - 仕様 (`grsmd_gen2_spec_ja.md`) の改訂の行と、基準の行を名で引いている所
     - `TODO.md` と、コード・試験の名前とコメントの中の行の名 (日本語と英語。`R[1-8] ` で検索する)
     - CHANGELOG
- 各レビューの報告の冒頭に、使った基準の版 (この文書を含むコミット) を書く。

---

## 1. 合格の決まり

### 1.1 重大度

重大度は、直す順と報告の並びを決める。合否には関わらない (どの重大度もすべて直す)。

| 重大度 | 目安 |
| --- | --- |
| Critical | プライバシーの原則を破る (同意の無い通信、入力の保存、サニタイズや CSP を緩める)。利用者の文書を壊す・失う |
| High | 主な機能が動かない。合意や裁定に反する動き |
| Medium | ある条件で仕様と違う動き。性能・メモリの数値の目標を外す。試験仕様が書いたとおりに実施できない |
| Low | 文書のずれ、弱い試験、細部の食い違い |

### 1.2 指摘の閉じ方

- **指摘は、Low も含めてすべて直す。** 据置き・受容では閉じない。
- ただし、**意図して既知の制限として仕様に書く**ことは、直したのと同じ扱いで閉じてよい。
  - 仕様には、制限の理由・影響・回避の方法を書く。
  - これには調整役の裁定が要る。
  - 確かめ直しでは、仕様に書かれていることを確かめる。
- **指摘は、必ず基準の 1 行を名指す** (例: 「基準の行: R3 境界とインデックス」「基準の行: G7」)。
  - 名指せないものは指摘にしない。報告の「参考」に書く。参考は合否に関わらない。
- **対象:** 差分と、差分が触れる所を見る。
  - 差分が触れない既存のコードの古い違反は、指摘にしない。`TODO.md` に無ければ参考に書く。
  - 差分が既存の違反を広げる (同じ形を写す・呼び出しを増やす) ときは、指摘にする。

### 1.3 合格の条件

次をすべて満たすとき、合格とする。

1. 指摘が 0 件 (すべて直したか、1.2 の既知の制限として閉じた)。
2. 2 節の試験を、レビュー役が自分で流して、すべて通る。
3. 7 節のチェックリストの全行に Verdict があり、FAIL が無い。

- **SHOULD の行も、外れていれば FAIL とし、指摘にする** (オーナーの裁定、2026-10-24)。
  - 直すか、仕様 5.16 に意図した逸脱 (理由と影響) として書いて閉じる。逸脱として閉じるには、調整役の裁定が要る (1.2 の既知の制限と同じ)。
  - Level (MUST / SHOULD) は、直す順の目安にだけ使う。合否には関わらない。

### 1.4 確かめ直しと、オーナーに伝える時

- 確かめ直しの範囲:
  - 前回のすべての指摘 (直したもの・既知の制限にしたもの)
  - 直しの差分
  - 退行
- 確かめ直しで新しく見つけたものも、指摘にする。
- チェックリストは、直しの差分が触れる行と、新しい指摘を起こした行の Verdict を書き直す。ほかの行は前回のままとする。
- **回数は、レビュー全体で数える。** 初めのレビューを 1 回目とする。
  - 3 回目の判定でも FAIL のときは、調整役がオーナーに伝え、続け方の裁定を受ける。
  - 直しが新しい指摘を生む連鎖も、これで数える。

---

## 2. レビュー役が自分で流すもの

報告に書かれた数を写さない。レビュー役が自分で流して、結果を報告に書く。

| # | 何を | 合格の線 |
| --- | --- | --- |
| T1 | 単体の試験 `npx vitest run` | 失敗 0 |
| T2 | 性能の試験 `GRSMD_PERF=1 npx vitest run` (PowerShell では `$env:GRSMD_PERF = "1"; npx vitest run`) | 失敗 0。AT-PERF の値を報告に書く |
| T3 | e2e `npm run test:e2e` (Chromium と WebKit) | 失敗 0。retry で通ったもの (flaky) は合格とし、数を報告に書く。2 回とも落ちたものは失敗 (オーナーの裁定、2026-10-24) |
| T4 | ビルド `npm run build` | Vite が表示する `index.html` の gzip が 1,450 kB 以下 (上限はオーナーの裁定、2026-10-21)。生の大きさも書く |
| T5 | ビルドの後の片付け | 機能のブランチでは `docs/index.html` を `git checkout -- docs/index.html` で戻す (機能のブランチで再ビルドしない) |
| T6 | 実測 (差分に関わるとき) | 数値の目標 (INV-51 など) を、大きな文書 (1 MB) と端の文書 (参照リンクの定義あり、先頭に空行が多いなど) で測る |

- e2e の flaky と、2 回とも落ちた失敗:
  - `playwright.config.js` は WebKit だけ `retries: 1` にしてある。
  - 2 回とも落ちたものは、同じ条件の develop でも起きるか、症状が同じかを確かめる。
  - develop でも同じ症状なら、製品の問題と分けて報告する。調整役の裁定で参考に回せる (R6 独立性の指摘として `TODO.md` に載せる)。
- Firefox: 既定の e2e の対象ではない。保存・ダウンロードへのフォールバック (PRT-W06) に触れる差分では、`npm run test:e2e:firefox` も流す。それ以外の差分では流さず、流さなかったことを報告に書く。
- 依存が入っていない worktree (`node_modules` が無い・空) では、先に `npm ci --offline` で入れる。ローカルの npm キャッシュだけを使うので、外への通信にならない。キャッシュに無くて失敗したら、調整役に報告して止まる。
- 外への通信は増やさない。PlantUML の送信を試すときは、同意のダイアログが出ることだけを確かめる。

---

## 3. 入力と、照らす正

- レビュー役が受け取るもの:
  - 対象 (worktree、ブランチ、差分の範囲)
  - 合意書
  - 調整役とオーナーの裁定
  - 実装の報告
- **照らす正の順:** 裁定 > 合意書 > 仕様 (`grsmd_gen2_spec_ja.md`) > 試験仕様 (`gen2_prerelease_test_spec_ja.md`) > 実装の報告。
  - 食い違いを見つけたら、指摘にするか、裁定が要ることとして挙げる。
- 合意書から読み取れない細部を実装が決めていたら、その決め方を確かめる。合意や仕様に反するなら指摘にする。

---

## 4. GRSMD 固有の観点 (G1〜G13)

| ID | 観点 | 問い (はい = 良い) |
| --- | --- | --- |
| G1 | 外部への通信は同意だけ | 外部への通信は、同意を得た PlantUML の送信と外部画像の読み込みだけか。同意の流れを省いていないか。クリップボードは書くだけで、読み取りは利用者の操作 (Ctrl+V・許可) のときだけか (CON-12) |
| G2 | サニタイズと CSP | DOM に入れる HTML は DOMPurify を通すか、`escapeHtml` で逃がしているか。DOMPurify の設定と CSP を緩めていないか (INV-19、INV-20) |
| G3 | 利用者の内容を残さない | CON-03・CON-13・INV-04・INV-50 のとおりか。編集内容・ファイル名・メタデータ・パレットの位置・パレットの最小化の状態を、`localStorage` / `sessionStorage` / Cookie / IndexedDB / Origin Private File System / Cache Storage のどれにも書かず、メモリだけに持つか。自動保存をしないか (保存は利用者の明示の操作だけ)。`document.title` にファイル名を入れないか |
| G4 | 単一ファイル・依存・バックエンド無し | 配布物は `docs/index.html` 1 つのままか (CON-05)。実行時に CDN から読まないか (CON-07)。バックエンド (サーバーの処理・API・Node.js のサーバー) を足していないか (CON-11)。新しい依存を足していないか (足すなら事前の相談と仕様の付録 A の更新があるか)。依存の版を変えたなら、動作を確かめ、CHANGELOG と仕様の版の表 (CON-02・付録 A) を改めたか (CON-10) |
| G5 | 英語・ASCII | コード・コメント・文字列・ログ・試験のコード (e2e の検査の文字列を含む) は英語で ASCII か (例外はヘルプの日英の文だけ。CON-06) |
| G6 | 仕様・合意・裁定のとおり、退行なし | 仕様 (INV / CON / FS / 5 章)・試験仕様・合意書の各項目・各裁定のとおりに動くか (コードと試験で 1 つずつ確かめる)。既存の動きを壊していないか (退行)。指定されていない機能を足していないか |
| G7 | 文書のそろい | 仕様・試験仕様 (ケース、対応表、改訂の注)・CHANGELOG・README (英日)・ヘルプ (英日) が、同じ動きを同じように書いているか。古い記述が残っていないか |
| G8 | 原文を壊さない | 読み込み・編集・保存で、改行コード・BOM・ラッパー・末尾の改行・ブロックの間の空行・参照リンクの定義が保たれるか (INV-38、INV-44)。Undo で元の文字列にそっくり戻るか |
| G9 | 状態遷移表と試験 | 新しい出来事・ガード・状態機械が、仕様 3.3 の表と図 (11-c 以降。新しい状態機械は新しい節) と、コードの表 (`stateTable.js` の補助で作るデータ) の両方に入っているか。全交点を試験しているか |
| G10 | 性能とメモリ | 差分に関わる数値の目標を、2 節 T6 で実測して満たしているか。マウスの移動・キー入力のような繰り返しの処理の 1 回の時間が、仕様の数値以下か (仕様に数値が無ければ、1 フレームの 1/4 の 4 ms 以下。e2e の `MOVE_FRAME_BUDGET_MS` と同じ) |
| G11 | 端末と入力 | IME の変換中、タッチ (`any-pointer: coarse`)、Mac のキー (Cmd)、キーボードだけの操作 (タブ順・フォーカス。仕様 5.15.6)、ダーク、印刷、窓の外でボタンを離す場合で、意図どおりに動くか。`aria-label` などの文言が仕様 (5.2) のとおりか |
| G12 | 試験の強さ | 新しい試験は、直す前のコードで落ちることを確かめたか。何もしなくても通る検査が無いか。e2e は待つ形の検査 (`toHaveValue` など) を使っているか |
| G13 | 作りの規約 | JavaScript は ES6+ のクラスで書いているか (CON-09)。1 クラス 1 ファイル (`src/js/classes/`) か。ファイル名に番号の接頭辞 (`01_Foo.js` など) を付けていないか。外部のライブラリ (hljs・DOMPurify・marked・mermaid・KaTeX・plantuml-encoder) は、クラスの中で import せず、`main.js` からコンストラクタで注入しているか (確かめ方: `grep -n '^import' src/js/classes/*.js` で、`./` と `../` 以外から読む import が 0 件。今は 0 件)。クラスどうしの依存の作り方は、仕様 3.2・5.16 のとおりか |

- Level はすべて MUST とする。

---

## 5. 上流の行の扱い

上流のチェックリストは 70 行ある。

| 扱い | 行数 |
| --- | --- |
| そのまま採る | 40 |
| 読み替える | 28 |
| NA | 2 |

- Level (MUST / SHOULD) は上流のまま変えない。Level は直す順の目安にだけ使い、SHOULD の行も外れていれば FAIL とする (1.3)。

### 5.1 そのまま採る (40 行)

上流の本文の基準で、そのまま見る。

| 章 | 行数 | 行 |
| --- | --- | --- |
| R1 | 3 | 曖昧性の排除、仕様の重複・競合の排除、否定形・受動態の排除 |
| R2 | 20 | SRP（Single Responsibility Principle / 単一責任原則）、SRP（責務文）、SRP（上位の要素）、OCP（Open-Closed Principle / 開放閉鎖原則）、LSP（Liskov Substitution Principle / リスコフ置換原則）、ISP（Interface Segregation Principle / インターフェース分離原則）、DIP（Dependency Inversion Principle / 依存性逆転原則）、DRY（Don't Repeat Yourself / 繰り返しを避ける）、KISS（Keep It Simple, Stupid / シンプルに保つ）、YAGNI（You Aren't Gonna Need It / 必要になるまで作らない）、SoC（Separation of Concerns / 関心の分離）、SLAP（Single Level of Abstraction Principle / 単一抽象レベル原則）、LoD（Law of Demeter / デメテルの法則 / 最小知識の原則）、CQS（Command-Query Separation / コマンド・クエリ分離）、POLA（Principle of Least Astonishment / 最小驚き原則）、PIE（Program Intently and Expressively / 意図を明確に表現する）、DRY（1 か所）、DRY（公開面）、OKPN（One Kind Per Name / 1つの名前に1種類の値）、OMPV（One Meaning Per Value / 1つの値に1つの意味） |
| R3 | 2 | 境界とインデックス、Null Trap |
| R5 | 1 | メモリ・リソース |
| R6 | 2 | 独立性、テストの名前 |
| R7 | 10 | 純粋性の分類、計算ロジックの純粋性、外部読取の引き上げ、収集と処理の分離、純粋側クラスの不変性、`@purity` タグ、構造の分離（並び順）、構造の分離（状態と計算）、構造の分離（ファイル）、失敗の表現 |
| R8 | 2 | 秘密情報、依存と OSS |

- R7 の検査は、仕様の CON-15 と 5.16.2 が具体にしている。

### 5.2 読み替える (28 行)

上流は、仕様のひな形の章番号と、サーバー・DB のある製品を前提に書いている。そこを GRSMD の章と作りに置き換える。基準の中身は変えない。

| 行 | 読み替え |
| --- | --- |
| R1 要求構造品質 | `FR-xxx` → GRSMD の ID (INV / CON / SC / FS)。非機能の数値の基準 → INV-51 などの数値の目標 |
| R1 異常系・準正常系の網羅 | 時間切れ → PlantUML サーバーの応答なし。中断 → IME の変換中、窓の外でボタンを離す。同時の操作 → 保存中の Reload、描画のキュー。権限不足 → 同意を断る、ファイルやクリップボードの許可が無い。データ不整合 → 外での変更 (`lastModified`、INV-39)、重複した参照リンクの定義、列の数が合わない表。資源 → 5 MB の上限、1 MB の文書。境界値 → 空の文書、5 MB ちょうど |
| R1 完全性の検証 | 「管理者 / 一般 / 外部システム」→ 端末とブラウザ (PC とタッチ、Chromium と WebKit、ダウンロードへのフォールバックを使う Firefox と iOS Safari (PRT-W06)、Mac のキー) と、外部のシステム (保存した Markdown を読む GitHub などのツール、プロンプトを使う AI、PlantUML サーバー) |
| R1 トレーサビリティ | 目的 = 仕様 1.3。上位の要求 = INV / CON。下位 = FS と 5 章。試験 = AT / PRT。対応表 = 試験仕様の AT の表 |
| R1 要求の記法（EARS: Easy Approach to Requirements Syntax） | 仕様 2 章の日本語の型 (「〜の場合、システムは〜すること」) を正とする。「1 文に shall 1 つ」→「1 つの要求の文に、求める応答 (『〜こと』または『〜してはならない』) が 1 つ」 |
| R2 Naming | 品詞・単位の規則は、新しく付ける名前に当てる。今のクラス名は変えない (オーナーの決定)。層ごとの名の例は、仕様 3.1 の層で読む |
| R2 CA（Clean Architecture / クリーンアーキテクチャ / レイヤードアーキテクチャ） | 上流の 4 層 → 仕様 3.1 の凡例の 4 層 (Entity・Use Case・Adapter・Framework) と、仕様 5.16 の CA の行 (意図した逸脱を含む)。「Ch5.1」→ 仕様 3.1 |
| R2 プロンプト工学 | 製品のプロンプト = MCBSMD のひな形 (`config.js`、FS-11)。その出力 = 6 つのバッククォートのラッパー (FS-12、5.13 の `splitMarkdownWrapper`)。置き場 = `config.js`、入出力の形 = 仕様 5.13、試験 = AT-WRAP、版 = CHANGELOG、崩れた出力への備え = 両端がそろうときだけラッパーを外し、原文を壊さない (5.13)。ひな形を変える差分では、5.13 の前処理と AT-WRAP を一緒に見る。製品は LLM を呼ばない |
| R2 最小構成との比較 | 「Ch5.6 の ADR-000」→ 仕様 5.16.1 |
| R2 コンポーネント境界 | 「Ch5.3 の公開面」→ 仕様 3.2 のクラス図の公開のメソッド。`_` で始まるメソッドを、ほかのクラスから呼ばない |
| R2 キャッシュ方針 | 対象と無効化の契機 → 仕様 3.2 (`cachedBlockHtml`・`markWrittenInPlace`) と 5.14.3・5.14.4 (全体描画で空にする)。採った理由 → 仕様 5.16.1。上流の 4 つの項目 (対象・無効化の契機・許容する陳腐化・同時の失効の挙動) が、仕様の 1 か所にそろって書かれているか |
| R2 ビルドの版 | 仕様 1.7 の規則に照らす。推奨の SemVer は当てはまらない (ほかから依存されるライブラリではない) |
| R3 エラーハンドリング | 外部 I/O = ファイル (File System Access API・FileReader)、ダウンロード (`blob:`)、クリップボード、PlantUML への送信、外部画像の読み込みの失敗。DB と、それ以外の通信は無い |
| R3 エラーメッセージ | 利用者へのメッセージ = トースト・確認・alert。文言は `config.js` に置く (仕様 5.2) |
| R3 防御的プログラミング | 外部からの入力 = ドロップしたファイル、ペースト、Markdown の原文。型アサーション → JS での型の確かめ (`typeof` など) |
| R3 資源の生存期間 | 言語の機構 → JS の `try / finally`。listener・`requestAnimationFrame`・タイマーの解除、`URL.revokeObjectURL`、`MutationObserver` / `ResizeObserver` の `disconnect`、`AbortController`。書き込みの stream の close |
| R3 時刻 | 経過時間は単調時計 (`performance.now`) で測る。版の時刻 (仕様 1.7。`package.json`・タグ・CHANGELOG・README・ヘルプ、開発版の HEAD の時刻) は UTC で書き、ローカル時刻を使わない。日付は暦の API で出す (CHANGELOG の見出しの日付は版の UTC の日。1.7.2)。文書の中の時刻は扱わない |
| R3 ログと観測 | ログ = console だけ。利用者の文書の中身とファイル名を出さない (CON-03) |
| R4 レースコンディション | DB・スレッド → await をまたぐ保存・Reload・描画のキュー |
| R4 グリッチ | 「Spec Ch5.5」→ 仕様 3.3 (11-c〜11-f) |
| R4 状態機械 | 「状態遷移図と状態遷移表を 1 つの原稿から作る」→ 仕様 11-b の既知の制限のとおり (図は表のすべての遷移を載せる。コードの表と仕様の表の一致は、全交点の試験で確かめる)。ほかは上流のとおり (G9 と一緒に見る) |
| R5 アルゴリズム・データ構造 | 「Ch4.2 の NFR」→ INV-51 などの数値の目標 |
| R5 データベース・I/O | DB → DOM と CSS の計算: ループの中で layout の読みと書きを交互にしない。読みをまとめ、書きをまとめる (例: TODO.md の F-B2) |
| R5 ネットワーク・フロントエンド | API の並列化と overfetching は当てはまらない。不要な再描画 (DOM) を見る。遅延ロードとコード分割は、単一ファイルの中での遅延実行として見る |
| R6 網羅 | 「FR-xxx へのトレース」→ INV / FS へのトレース |
| R6 Gherkin | 仕様 4 章の FS に当てる。単体と e2e の試験の名前は Given / When / Then でなくてよい。ただし、確かめる要求の ID (AT-xxx と INV / FS) を持つ |
| R8 入力と注入 | SQL は無い。コマンド → `tools/` と `vite.config.js` の `child_process`: 外の値を `execSync` の文字列につながず、`execFileSync` の引数で渡す。HTML → DOMPurify・`escapeHtml`・CSP (G2 と一緒に見る)。パス → ダウンロードのファイル名 |
| R8 認証と認可 | 認証 → 無い (アカウントが無い)。認可 → ブラウザの許可 (クリップボードの読み取り、File System Access の read / readwrite)。要るときに、要る広さだけ求め (読むだけなら `mode: "read"`)、許可の及ぶ範囲を仕様とヘルプに書く (CON-12) |

### 5.3 NA (2 行)

差分がこの前提を崩したら (例: 独自の保存形式を足す、.md に GRSMD だけが分かる印を書いて読み戻す機能を足す、ロックを使う)、NA を外して見る。

| 行 | 理由 |
| --- | --- |
| R2 互換性と版 | GRSMD は .md に書いてあるとおりに描く。パレットは決めた 3 色のコードを書くだけで、版を持つ自前の形式は無い。3 色のコードを変えても、前の文書は書いてあるとおりの色で出る (ダークの置き換えとパレットの操作が、前のコードに効かなくなるだけ)。原文を保つことは G8 で見る (オーナーの裁定、2026-10-24) |
| R4 デッドロック | 単一スレッドで、ロックも DB も無い |

### 5.4 チェックリストの外で、上流から変えるところ

| 上流の部分 | GRSMD での扱い |
| --- | --- |
| 指摘対応のルール (開発方式ごとの合格線) | 方式は 1 つだけ。1.2 のとおり、すべて直す (既知の制限として閉じるには裁定が要る) |
| 記録 (`project-records/decisions/`) | 使わない (据置き・受容が無い) |
| 再レビューの範囲 | 1.4 |
| ゲートの FAIL で上げる時 | 1.4 (レビュー全体の 3 回目) |
| 役の名前 | review-agent → レビュー役、project-manager → 調整役 |
| 設計原則の索引 | 仕様 5.16 を見る |

---

## 6. 特に見る行 (いつも見る)

次の 7 行は、上流で実際に起きた不具合から足された行である (gr-scheduler で起きた。規則を書いたセッションの答え、2026-10-24)。どのレビューでも頼み文の「特に見る行」に入れ、報告で 1 行ずつ結果を書く。

| 行 | 元の不具合 | GRSMD で見る所の例 | 確かめ方 |
| --- | --- | --- | --- |
| R2 OKPN（One Kind Per Name / 1つの名前に1種類の値） | 色の要素に、明と暗の 2 つの値を 1 つの文字列に詰め、パレットの名も同じ要素に入れた。前の版との互換が切れた | `CONFIG` の値、`data-*` の属性、関数の引数と戻り値。良い形の例: `CONFIG.edit.textColors` は明と暗を `{light, dark}` に分けている | 差分で足した・変えたデータ要素ごとに、1 つの値に区切り文字 (`/`・`,`・`|` など) で 2 つ以上の値を詰めていないか、種類の違う値 (色とパレットの名など) を同じ名に入れていないかを読む |
| R2 OMPV（One Meaning Per Value / 1つの値に1つの意味） | 「色が無い」に見える 2 つの値に、逆の意味を持たせた | 特別な値 (`null`・`symbol`・`0`・空文字) に意味を持たせていないか。例: `baselineLastModified` の `null` と `LAST_MODIFIED_UNKNOWN` | 差分の中の `null`・`undefined`・`0`・空文字・`symbol` との比較を検索し、それぞれの値の意味が、仕様か JSDoc に 1 つだけ書かれているかを見る |
| R3 Null Trap | 同上 (null に「テーマに従う」の意味を持たせた) | 「無い」を null・`undefined`・省略のどれで表すかを、仕様と JSDoc で決めているか | 同上の検索で、省略と null の両方を受ける所が、仕様の決めたとおりに扱っているかを見る |
| R2 DRY（1 か所） | 同じ責務の写しが 136 群あり、うち 49 群は、同じ入力にすでに違う答えを返していた | 同じ判断 (ブロックの種類、範囲の丸め、改行の扱いなど) を 2 か所に書いていないか | 差分で足した関数ごとに、同じ正規表現・同じ定数・同じ名の判断を `src/js` で検索する。目で見るだけで済ませない |
| R2 DRY（公開面） | 公開されていない元を知らずに写していた | 補助関数を書く前に、既存の公開面を探したか | `utils.js`・`textTransforms.js`・`textWidth.js`・`MarkdownTextOps`・`InlineRuns`・`MarkdownTable` の公開面を先に見る。ほかのクラスの `_` で始まる関数と同じ処理を写していないかを検索する |
| R2 SRP（責務文） | 責務の文の「と」の数で判じ、逆の判定が出た | 新しいクラスの責務の文 | 仕様 3.2 の表と 5.16 の SRP の行の責務の文から、手順・範囲・制約の句を除き、句が 1 つ残るかを読む。「と」の数では判じない |
| R4 状態機械 | 状態を複数の真偽で持ち、ありえない組み合わせが生まれた | 編集モード・開いている欄・ブロックの範囲などを、複数の真偽の組で持っていないか (G9 と一緒に見る) | 差分で足した `is…` / `has…` などの真偽のフィールドを検索し、組み合わせて状態を表していないかを見る |

---

## 7. 総合チェックリスト

- レビュー役は、全行の Verdict (PASS / FAIL / NA) を書く。
  - PASS 以外 (FAIL・NA) は、Remark に理由を書く。
  - FAIL には必ず指摘を起こす。
- NA の 2 行は、最初から Verdict と Remark を書いてある。差分が前提を崩したときだけ書き直す。
- 「見方」の列: 「上流」は上流の本文のとおりに見る。「5.2」は 5.2 の読み替えで見る。
- 「英語の名」の列: コード・試験の名前で行を呼ぶときの名 (0 節)。上流の英語版のチェックリストの名と同じ文字。

| 章 | 観点 | 英語の名 | Level | 見方 | Verdict | Remark |
| --- | --- | --- | :---: | --- | :---: | --- |
| G | G1 外部への通信は同意だけ | — | MUST | 4 節 | | |
| G | G2 サニタイズと CSP | — | MUST | 4 節 | | |
| G | G3 利用者の内容を残さない | — | MUST | 4 節 | | |
| G | G4 単一ファイル・依存・バックエンド無し | — | MUST | 4 節 | | |
| G | G5 英語・ASCII | — | MUST | 4 節 | | |
| G | G6 仕様・合意・裁定のとおり、退行なし | — | MUST | 4 節 | | |
| G | G7 文書のそろい | — | MUST | 4 節 | | |
| G | G8 原文を壊さない | — | MUST | 4 節 | | |
| G | G9 状態遷移表と試験 | — | MUST | 4 節 | | |
| G | G10 性能とメモリ | — | MUST | 4 節 | | |
| G | G11 端末と入力 | — | MUST | 4 節 | | |
| G | G12 試験の強さ | — | MUST | 4 節 | | |
| G | G13 作りの規約 | — | MUST | 4 節 | | |
| R1 | 要求構造品質 | Requirements Structural Quality | MUST | 5.2 | | |
| R1 | 曖昧性の排除 | Elimination of ambiguity | MUST | 上流 | | |
| R1 | 仕様の重複・競合の排除 | Elimination of specification duplication and conflicts | MUST | 上流 | | |
| R1 | 異常系・準正常系の網羅 | Coverage of abnormal and semi-normal cases | SHOULD | 5.2 | | |
| R1 | 完全性の検証 | Completeness verification | SHOULD | 5.2 | | |
| R1 | 否定形・受動態の排除 | Elimination of negation and passive voice | SHOULD | 上流 | | |
| R1 | トレーサビリティ | Traceability | MUST | 5.2 | | |
| R1 | 要求の記法（EARS: Easy Approach to Requirements Syntax） | Requirements notation (EARS: Easy Approach to Requirements Syntax) | SHOULD | 5.2 | | |
| R2 | Naming | Naming | MUST | 5.2 | | |
| R2 | SRP（Single Responsibility Principle / 単一責任原則） | SRP (Single Responsibility Principle) | MUST | 上流 | | |
| R2 | SRP（責務文） | SRP (responsibility sentence) | MUST | 上流 (6 節) | | |
| R2 | SRP（上位の要素） | SRP (higher-level element) | MUST | 上流 | | |
| R2 | OCP（Open-Closed Principle / 開放閉鎖原則） | OCP (Open-Closed Principle) | SHOULD | 上流 | | |
| R2 | LSP（Liskov Substitution Principle / リスコフ置換原則） | LSP (Liskov Substitution Principle) | SHOULD | 上流 | | |
| R2 | ISP（Interface Segregation Principle / インターフェース分離原則） | ISP (Interface Segregation Principle) | SHOULD | 上流 | | |
| R2 | DIP（Dependency Inversion Principle / 依存性逆転原則） | DIP (Dependency Inversion Principle) | SHOULD | 上流 | | |
| R2 | DRY（Don't Repeat Yourself / 繰り返しを避ける） | DRY (Don't Repeat Yourself) | SHOULD | 上流 | | |
| R2 | KISS（Keep It Simple, Stupid / シンプルに保つ） | KISS (Keep It Simple, Stupid) | SHOULD | 上流 | | |
| R2 | YAGNI（You Aren't Gonna Need It / 必要になるまで作らない） | YAGNI (You Aren't Gonna Need It) | SHOULD | 上流 | | |
| R2 | SoC（Separation of Concerns / 関心の分離） | SoC (Separation of Concerns) | MUST | 上流 | | |
| R2 | SLAP（Single Level of Abstraction Principle / 単一抽象レベル原則） | SLAP (Single Level of Abstraction Principle) | MUST | 上流 | | |
| R2 | LoD（Law of Demeter / デメテルの法則 / 最小知識の原則） | LoD (Law of Demeter / Principle of Least Knowledge) | SHOULD | 上流 | | |
| R2 | CQS（Command-Query Separation / コマンド・クエリ分離） | CQS (Command-Query Separation) | SHOULD | 上流 | | |
| R2 | POLA（Principle of Least Astonishment / 最小驚き原則） | POLA (Principle of Least Astonishment) | MUST | 上流 | | |
| R2 | PIE（Program Intently and Expressively / 意図を明確に表現する） | PIE (Program Intently and Expressively) | MUST | 上流 | | |
| R2 | CA（Clean Architecture / クリーンアーキテクチャ / レイヤードアーキテクチャ） | CA (Clean Architecture / Layered Architecture) | MUST | 5.2 | | |
| R2 | プロンプト工学 | Prompt Engineering | SHOULD | 5.2 | | |
| R2 | 最小構成との比較 | Comparison with the Minimal Configuration | MUST | 5.2 | | |
| R2 | コンポーネント境界 | Component Boundaries | MUST | 5.2 | | |
| R2 | キャッシュ方針 | Cache Policy | MUST | 5.2 | | |
| R2 | DRY（1 か所） | DRY (one place) | MUST | 上流 (6 節) | | |
| R2 | DRY（公開面） | DRY (public face) | MUST | 上流 (6 節) | | |
| R2 | OKPN（One Kind Per Name / 1つの名前に1種類の値） | OKPN (One Kind Per Name) | MUST | 上流 (6 節) | | |
| R2 | OMPV（One Meaning Per Value / 1つの値に1つの意味） | OMPV (One Meaning Per Value) | MUST | 上流 (6 節) | | |
| R2 | 互換性と版 | Compatibility and Versions | MUST | NA | NA | 5.3: .md に書いてあるとおりに描き、版を持つ自前の形式が無い |
| R2 | ビルドの版 | Build Versions | MUST | 5.2 | | |
| R3 | エラーハンドリング | Error Handling | MUST | 5.2 | | |
| R3 | エラーメッセージ | Error Messages | MUST | 5.2 | | |
| R3 | 防御的プログラミング | Defensive Programming | MUST | 5.2 | | |
| R3 | 境界とインデックス | Boundaries and Indexes | MUST | 上流 | | |
| R3 | 資源の生存期間 | Resource Lifetime | MUST | 5.2 | | |
| R3 | 時刻 | Time | MUST | 5.2 | | |
| R3 | Null Trap | Null Trap | MUST | 上流 (6 節) | | |
| R3 | ログと観測 | Logging and Observability | MUST | 5.2 | | |
| R4 | デッドロック | Deadlock | MUST | NA | NA | 5.3: 単一スレッドで、ロックも DB も無い |
| R4 | レースコンディション | Race Condition | MUST | 5.2 | | |
| R4 | グリッチ | Glitch | MUST | 5.2 | | |
| R4 | 状態機械 | State Machine | MUST | 5.2 (6 節) | | |
| R5 | アルゴリズム・データ構造 | Algorithms and Data Structures | MUST | 5.2 | | |
| R5 | データベース・I/O | Database and I/O | SHOULD | 5.2 | | |
| R5 | メモリ・リソース | Memory and Resources | MUST | 上流 | | |
| R5 | ネットワーク・フロントエンド | Network and Frontend | SHOULD | 5.2 | | |
| R6 | 独立性 | Independence | MUST | 上流 | | |
| R6 | 網羅 | Coverage | MUST | 5.2 | | |
| R6 | テストの名前 | Test Names | MUST | 上流 | | |
| R6 | Gherkin | Gherkin | SHOULD | 5.2 | | |
| R7 | 純粋性の分類 | Purity Classification | MUST | 上流 | | |
| R7 | 計算ロジックの純粋性 | Purity of Calculation Logic | MUST | 上流 | | |
| R7 | 外部読取の引き上げ | Lifting External Reads | SHOULD | 上流 | | |
| R7 | 収集と処理の分離 | Separation of Collection and Processing | MUST | 上流 | | |
| R7 | 純粋側クラスの不変性 | Immutability of Pure-Side Classes | MUST | 上流 | | |
| R7 | `@purity` タグ | `@purity` Tag | MUST | 上流 | | |
| R7 | 構造の分離（並び順） | Structural Separation (order) | SHOULD | 上流 | | |
| R7 | 構造の分離（状態と計算） | Structural Separation (state and computation) | SHOULD | 上流 | | |
| R7 | 構造の分離（ファイル） | Structural Separation (files) | SHOULD | 上流 | | |
| R7 | 失敗の表現 | Failure Representation | SHOULD | 上流 | | |
| R8 | 秘密情報 | Secrets | MUST | 上流 | | |
| R8 | 入力と注入 | Input and Injection | MUST | 5.2 | | |
| R8 | 認証と認可 | Authentication and Authorization | MUST | 5.2 | | |
| R8 | 依存と OSS | Dependencies and OSS | MUST | 上流 | | |

---

## 8. 報告の形

報告は次の順に書く。

1. **対象と基準の版**: worktree・ブランチ・差分の範囲。この文書を含むコミット。何回目のレビューか。
2. **判定**: 合格 / 不合格。重大度ごとの指摘の数。
3. **自分で流した結果**: 2 節の T1〜T6 の表 (数と所要時間)。
4. **特に見る行**: 6 節の行と、頼み文が足した行の結果を 1 行ずつ。
5. **指摘**: 重大度の順に、指摘ごとに次を書く。
   - 基準の行
   - 場所 (ファイルと行)
   - 起きる場面
   - 確かめ方 (再現・実測)
   - 直し方の案と推奨
6. **チェックリスト**: 7 節の表に Verdict と Remark を書いたもの。
7. **確かめて問題が無かったこと**: 主なもの。
8. **参考**: 基準の行を名指せない気づき。
9. **裁定が要ること**: 調整役に聞くこと。案と推奨を付ける。

---

## 付録 A: 頼み文のひな形

調整役がレビューを頼むときの文。`<...>` を埋める。

```text
<機能の名前> のレビューを頼む。基準は spec/grsmd_review_standards_ja.md (以下、基準。版: <基準を含むコミット>) に従う。

- 対象: <worktree> の <ブランチ>。差分は <基点のコミット> から <範囲>。
- 何回目か: レビュー全体の <n> 回目 (初めのレビュー = 1 回目。3 回目でも FAIL なら、調整役がオーナーに伝える)。2 回目以降なら、前回の報告: <場所>。
- 合意: <合意書の場所と項目の範囲>
- 裁定: <裁定の一覧>
- 実装の報告: <場所>
- 特に見る行: 基準の 6 節の 7 行と、次の行。
  - <行の名前>: <この差分で見ること>
- 自分で流すもの: 基準の 2 節の T1〜T6。
- してはいけないこと: ファイルの書き込み (報告のファイル、試験とビルドの出力を除く。ビルドの後の docs/index.html は戻す)、コミット・push・マージ、外部への通信 (同意のダイアログの確かめを除く)。
- 報告の置き場: <場所>。形は基準の 8 節。書いたら、判定と指摘の要点を調整役に送って待つ。
- 裁定が要ることは、オーナーではなく調整役に聞く。
```

---

## 付録 B: 変更履歴

| 日付 | 上流の版 | 変更 |
| --- | --- | --- |
| 2026-10-24 | `aca2204` | 初版。上流の 70 行のうち、41 行をそのまま採り、24 行を読み替え、5 行を NA とした。GRSMD 固有の G1〜G12 を足した。合格の決まり: すべて直す、既知の制限として閉じるには裁定が要る、基準の行を名指す、レビュー全体の 3 回目の FAIL でオーナーに伝える |
| 2026-10-24 | `63e6fdc` | 上流の追従。上流は R2 の略語の観点 17 個を「略語（English full name / 日本語の名）」の形にし、R1 の行を「要求の記法（EARS: Easy Approach to Requirements Syntax）」にした (本文の見出し 17 か所とチェックリストの 18 行。ほかの文は変わらない)。写しを取り直し、この文書の観点の名を上流のチェックリストと同じ文字にそろえた (括弧も全角に)。行の扱い (そのまま 41・読み替え 24・NA 5) は変えない |
| 2026-10-24 | `63e6fdc` | 1 回目のレビュー (High 2・Medium 10・Low 20) の直し (裁定待ちの 4 件を除く)。行の呼び方の決まり (略してよい行、英語の名、章だけで呼ばない、G 行と仕様の G-xx の区別)、追従で改める所の一覧。G3・G4・G5・G6・G10・G11 を広げ、G13 (作りの規約) を足した。R2 プロンプト工学・R5 データベース・I/O・R8 認証と認可を NA から読み替えに移した (そのまま 41・読み替え 27・NA 2)。読み替えの事実の誤りと抜けを直した (R1 の 3 行、R2 CA、R2 キャッシュ方針、R3 の 4 行、R6 Gherkin、R8 入力と注入)。6 節に確かめ方の列、7 節に英語の名の列を足した。付録 A の回数の書き方、基準の版、報告の返し方 |
| 2026-10-24 | `63e6fdc` | オーナーの裁定 3 件を反映した。SHOULD の行も外れていれば FAIL (1.3、5 節)。e2e は retry で通れば合格、2 回とも落ちれば失敗 (2 節 T3)。図と表を 1 つの原稿から作らないことを仕様 11-b に既知の制限として書き、G9 を今の作りに合わせ、R4 状態機械を読み替えに移した (そのまま 40・読み替え 28・NA 2) |
| 2026-10-24 | `63e6fdc` | オーナーの裁定 (Q1): R2 互換性と版は NA のまま、理由の文を正した (.md に書いてあるとおりに描き、版を持つ自前の形式が無い)。NA を外す例に「.md に GRSMD だけが分かる印を書いて読み戻す機能を足す」を足した |
| 2026-10-24 | `63e6fdc` | 2 回目のレビューの直し。G13 の注入を外部のライブラリに限り、クラスどうしの依存は仕様 3.2・5.16 のとおりとした (確かめ方を足した)。追従で改める一覧に TODO.md とコード・試験の中の行の名を足した。英語版の版の説明を正した |
