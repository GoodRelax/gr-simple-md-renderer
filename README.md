# GR Simple Markdown (GRSMD) — A Privacy-First Markdown Viewer & Editor That Runs in Your Browser

**GR Simple Markdown (GRSMD)** is a privacy-first Markdown viewer and editor that runs entirely in the browser.
It was called "GR Simple MD Renderer & Viewer" before it could edit documents in place; the short name GRSMD, the repository name and the URL stay the same.

- Client-side Markdown, math (KaTeX), Mermaid, and syntax highlighting
- PlantUML and external images only with explicit user consent
- No backend, no data collection, no storage

---

## Why

Many online Markdown tools send your content to remote servers without making it clear.
This tool was built to provide a **transparent, minimal, and privacy-respecting renderer**.

- Markdown, math, and Mermaid are rendered entirely in your browser
- PlantUML is rendered only after explicit user consent
- External images are loaded only after explicit user consent
- No backend, no tracking, no storage

---

## Features

- 100% client-side Markdown rendering (tables, task lists, fenced code)
- Math (LaTeX) rendering with KaTeX
- Mermaid diagrams
- PlantUML diagrams, with a consent prompt before data is sent (only the diagrams you allow are sent)
- Syntax highlighting for code blocks
- Code View: drop any text file (.py, .js, .c, ...) to view it with syntax highlighting and line numbers; press Edit to edit it and save it back in its own encoding (UTF-8, Shift_JIS, EUC-JP, UTF-16) and line endings
- In Code View: an Index of classes and functions (Python, JavaScript / TypeScript, JSON, YAML, C, C++, C#, Java, Go), and JSON folding one level at a time
- Auto-render on paste (Ctrl+V / Cmd+V anywhere on the start screen) or file drop
- Reload the current file from disk (browsers with the File System Access API)
- Edit the preview block by block and save to a file (no autosave; Save as / download where writing files is not supported)
- Edit table cells as they are shown, and double-click the preview to start editing what you clicked (on a touch screen, press [Edit], then tap a block)
- Text color (red, blue, green), and links: paste a URL onto selected text, or remove a link
- Index of the headings, floating at the right edge: press one to jump to it
- Search the Markdown source (plain text or a regular expression), and replace one or all in edit mode
- GitHub editing (PC only): open a `.md` file from a github.com URL, edit it, and commit it to the same branch with your fine-grained personal access token; a confirmation comes before every request (the help explains it step by step: "How to Edit and Commit Files on GitHub")
- Dark / Light theme rendering
- Keyboard shortcuts and smooth arrow-key scrolling
- Diagram zoom (Ctrl+Scroll), pan (drag), and copy as SVG / PNG on PC
- Scroll position preservation during re-rendering
- A single self-contained HTML file: all libraries are bundled, no CDN, works offline after loading

---

## Demo

🔗 **Live Demo:** https://goodrelax.github.io/gr-simple-md-renderer/

To use it locally, download [`docs/index.html`](docs/index.html) and open it in your browser. No server is needed.

---

## Usage

1. Open the application in your browser
2. Any of the following triggers an automatic preview:
   - Paste text anywhere on the page (Ctrl+V / Cmd+V)
   - Drop a `.md` file anywhere on the page (Markdown preview)
   - Drop any other text file (Code View)
   - Paste directly into the `[Paste Markdown...]` box at the top

   Pasting starts a preview only on the start screen, with the top box empty. While a document is shown, press `[Clear]` first. A dropped file can be up to 5 MB.

3. Buttons and keys:

   | Button | Key | Action |
   |---|---|---|
   | Index | `I` | Show / hide the headings (h1 to h6) at the right edge; press one to bring it to the top of the view. In Code View: the classes and functions of a file in a language listed above |
   | Search | `F` | Find text in the Markdown source (in Code View: the file) (`Aa` match case, `.*` regular expression; `Down` / `Up` in the box: next / previous). In edit mode `Ctrl+F` opens it too, and Replace / All replace (one Undo) |
   | Commands | `P` | In Code View of a JSON file: buttons to fold / unfold one level |
   | Open GitHub | `O` | PC only: open a `.md` file on GitHub by its URL. While it is open, the button becomes [Push to GitHub] and commits your changes to the same branch |
   | Render Light | `L` | Render / switch to the light theme |
   | Render Dark | `D` | Render / switch to the dark theme |
   | Reload | `R` | Reload the current file from disk (a file opened from GitHub: read it again from GitHub, after a confirmation) |
   | New Tab | `N` | Open GRSMD in a new tab |
   | Edit | `E` | Show / hide the edit palette; click (tap) a block to edit its Markdown in place. In Code View: edit the whole file |
   | Clear | `C` | Clear and reset |
   | ? | | Show help (long press: a prompt template for AI-generated Markdown) |
   | | `Ctrl+S` / `Ctrl+Shift+S` | Save / Save as while a Markdown document or a Code View file is shown (a file that is not UTF-8 asks for the encoding to save in; if that encoding cannot hold some characters, it shows their line numbers and asks whether to save in UTF-8) |
   | | `Tab` / `Shift+Tab` | In the Code View editor: indent / outdent the selected lines (`Esc` leaves the editor) |
   | | `Ctrl+Left` / `Ctrl+Right` | In Code View of a JSON file: fold / unfold one level (in the editor: `Ctrl+Shift+[` / `Ctrl+Shift+]`) |
   | | `Esc` | Apply the open block or cell and close it; with blocks selected, clear the selection; with nothing open, hide the edit palette; then Search (in the search box: close it at once); then the Index. In the Code View editor: leave the editor; outside it: the Commands box, then Search, then the Index (edit mode stays) |
   | | `Delete` / `Backspace` | In edit mode, delete the selected blocks, also with `Shift` (one Undo brings them back) |
   | | `Ctrl+X` / `Ctrl+C` | In edit mode with blocks selected, cut / copy their Markdown whole (a menu's Copy copies it too) |
   | | `Ctrl+Z` | Undo while the edit palette is shown, up to 30 changes (in a block you have changed, the browser undoes your typing). Editing in Code View: GRSMD's own Undo, also in the editor (a step ends when you stop typing for 1 s or move the caret) |
   | | `Ctrl+Y` / `Ctrl+Shift+Z` | Redo while the edit palette is shown, up to 30 changes (in an open block, the browser redoes your typing). Editing in Code View: GRSMD's own Redo |
   | | `Ctrl+B` / `Ctrl+I` | Bold / Italic while editing |

   On a Mac, use `Cmd` instead of `Ctrl` (Redo is `Cmd+Shift+Z`); the fold keys are `Option+Left` / `Option+Right` and, in the editor, `Cmd+Option+[` / `Cmd+Option+]`.

   In edit mode, point between two blocks, above the first one or below the last one (on a phone, tap there) to show a dashed line with `+`; click it to add a new block there.

   In an open block, the second row of the edit palette's Text format adds math: Insert inline math puts a formula at the cursor, and Insert math boxes adds three math boxes (Maxwell, Einstein, Schroedinger), each under its name.

   Double-click the edit palette's grip (`::`; on a phone or tablet, double tap it) or press and hold it to shrink the palette to the grip; do it again to bring it back.

   In edit mode, drag over the text of some blocks (on a phone, long press) to select those blocks whole: they get a frame, and a bar [Delete] [Cut] [Copy] shows under the selection. No dialog asks; one Undo brings deleted blocks back. To copy only part of the text you see, leave edit mode first.

4. If your Markdown contains PlantUML blocks or external images, you will be asked for permission before anything is sent to an external server. GitHub editing asks each time before it sends anything to GitHub

---

## Privacy & Security

- **Nothing is sent without consent.** The only external requests are:
  - PlantUML: the diagram source is sent to the official PlantUML server, only after a confirmation dialog when the document renders (a diagram you changed while editing: when you press its [Render] button). Only the diagrams you allowed in the dialog are sent; Copy SVG / PNG of such a diagram fetches it again without asking. While the page is still loading, a diagram shows "Loading diagram..." and the dialog comes when loading is done.
  - External images (`![](https://...)`): shown as placeholders until you click one and confirm. The consent lasts until `[Clear]` or a new file drop.
  - GitHub editing (PC only): requests go only to api.github.com, and only when you press [Open], [Reload] or [Push] in its dialog, every time. Open and Reload send the repository, branch and path, and your fine-grained personal access token. Push sends the full text of the document, the commit message and the token. The token is sent only in a request header, and GRSMD keeps it only while the request runs. After a request succeeds, GRSMD asks the browser to save the token; the browser asks you, and you can delete it in the browser's password settings.
- **Nothing is stored.** Your content is never written to localStorage, sessionStorage, or cookies.
- **Edits are not stored in the browser either.** They live only in the open page until you save them to a file.
- **Clipboard.** The "Paste copied link" button reads the clipboard only when you press it, so the browser may ask you to allow it. When GRSMD is opened from goodrelax.github.io, in Chrome and Edge, once you allow it, other pages on goodrelax.github.io can also read your clipboard without asking. To withdraw it, open the site settings for goodrelax.github.io (the icon at the left of the address bar) and set Clipboard to Ask or Block. Pasting a URL onto selected text with Ctrl+V / Cmd+V makes a link without any permission. Nothing read from the clipboard is sent anywhere.
- **HTML in Markdown is sanitized** with DOMPurify. Scripts and event handlers are removed. Other remote references (video, audio, CSS `url()`, `<style>`) are removed.
- **Content-Security-Policy:** the built file only runs its own scripts (each allowed by its hash, the libraries that run on demand included), and it can fetch data only from the PlantUML server and the GitHub API (api.github.com). Images from other sites are allowed by the policy, but GRSMD loads them only after your consent (above).

---

## Development

The source lives in `src/` (multiple files). Vite and vite-plugin-singlefile build it into one file, `docs/index.html`, which GitHub Pages serves. For a fast start, the file puts the app first; mermaid, highlight.js, KaTeX and the PlantUML encoder are built apart and placed after it, to run on demand (`tools/fastStartup.mjs`, spec 5.17).

```bash
npm ci
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

A beta of the same build, written to `docs/grsmd-beta.html`. The only difference from `docs/index.html` is its robots meta, `noindex` for search engines (no BETA mark, the same help). `docs/index.html` is not touched:

```bash
npm run build:beta
```

Browser tests of the built file (Playwright, Chromium and WebKit). They need a one-time browser download; see [`e2e/README.md`](e2e/README.md).

```bash
npm run test:e2e
```

- `src/index.html`, `src/css/`, `src/js/` — the app (ES6+ classes, one class per file in `src/js/classes/`)
- `src/__tests__/` — unit tests (Vitest + jsdom)
- `e2e/` — browser tests (Playwright)
- `spec/grsmd_gen2_spec_ja.md` — the specification (Japanese)
- `CHANGELOG.md` — notable changes and dependency versions

Version rule: `spec/grsmd_gen2_spec_ja.md` section 1.7.

---

## Design Notes

- Markdown rendering is handled by a dedicated `MarkdownRenderer`
- Diagram rendering is separated into Mermaid and PlantUML renderers
- Code View is handled by `SourceFileRenderer`; editing, encodings and saving of code files by `CodeEditController`
- A central orchestrator coordinates rendering and scroll stability
- Privacy and UX are treated as first-class design concerns

---

## License

MIT License

GRSMD bundles open source software. Their copyright and license notices are
in a comment at the end of the built `docs/index.html` (and of each release's
`GRSMD.html`); the help's **Licenses** section lists them. The build collects
them from `node_modules` (`tools/notices.mjs`, `tools/third-party-extras.mjs`), and from
`tools/third-party-licenses/` for code whose own package is not installed.


---
---
# GR Simple Markdown

Mermaid・PlantUML・数式・シンタックスハイライトに対応した、
軽量でプライバシー重視の Markdown のビューワー兼エディターです。
旧名は「GR Simple MD Renderer & Viewer」です（その場で編集できるようになったため改名しました。略称 GRSMD・リポジトリ名・URL は変わりません）。
すべてクライアントサイドで動作し、外部通信は明示的な許可がある場合のみ行われます。

---

## なぜ作ったか

多くのオンライン Markdown ツールは、内容を暗黙的にサーバーへ送信します。
本ツールは、**透明性が高く、最小構成で、プライバシーを尊重するレンダラー**を目的として作られました。

- Markdown・数式・Mermaid は完全にブラウザ内でレンダリング
- PlantUML は明示的なユーザー同意がある場合のみ外部通信
- 外部画像も明示的なユーザー同意がある場合のみ読み込み
- バックエンドなし、トラッキングなし、保存なし

---

## 特徴

- 100% クライアントサイド Markdown レンダリング（表、タスクリスト、コードブロック）
- KaTeX による数式（LaTeX）表示
- Mermaid 図のサポート
- PlantUML 図のサポート（送信前に許可を確認。許した図だけを送る）
- コードブロックのシンタックスハイライト
- コードビュー: テキスト系ファイル（.py、.js、.c など）をドロップすると、ハイライトと行番号付きで表示。Edit で編集し、元の文字コード（UTF-8、Shift_JIS、EUC-JP、UTF-16）と改行コードのまま保存
- コードビューの目次（Python、JavaScript / TypeScript、JSON、YAML、C、C++、C#、Java、Go のクラスや関数）と、JSON の 1 段ずつの折りたたみ
- 最初の画面ではページ上どこでも貼り付け（Ctrl+V / Cmd+V）、またはファイルのドロップで自動プレビュー
- 表示中のファイルをディスクからリロード（File System Access API 対応ブラウザ）
- プレビュー上でのブロック単位の編集と、ファイルへの保存（自動保存はしない。ファイルを書き込めないブラウザではダウンロード）
- 表のセルを見たままの形で編集。プレビューのダブルクリックで、押した所の編集を始める（タッチ画面では [Edit] を押してからブロックをタップ）
- 文字色（赤・青・緑）と、リンク（選んだ文字に URL を貼る、リンクを外す）
- 見出しの目次（右端に浮かせて出し、押すとその見出しへ飛ぶ）
- Markdown の原文の検索（文字または正規表現）と、編集モードでの置換（1 件ずつ、またはすべて）
- GitHub 連携（PC だけ）: github.com の URL から `.md` を開いて直し、fine-grained personal access token で同じブランチへコミットする。送る前には毎回確かめる（手順はヘルプの「GitHubのファイルを編集しコミットする方法」に絵で書いてある）
- ダーク / ライトテーマ
- キーボードショートカットと矢印キーのスムーズスクロール
- PC: ダイアグラムの Zoom（Ctrl+Scroll）/ Pan（ドラッグ）/ SVG・PNG コピー
- 再レンダリング時のスクロール位置保持
- 単一の自己完結 HTML ファイル: 全ライブラリを同梱、CDN 不使用、読み込み後はオフラインでも動作

---

## デモ

🔗 **Live Demo:** https://goodrelax.github.io/gr-simple-md-renderer/

ローカルで使う場合は、[`docs/index.html`](docs/index.html) をダウンロードしてブラウザで開くだけです。サーバーは不要です。

---

## 使い方

1. ブラウザでアプリケーションを開く
2. 以下のいずれかで自動プレビューが開始されます:
   - ページ上どこでも貼り付け（Ctrl+V / Cmd+V）
   - `.md` ファイルをページ上にドロップ（Markdown プレビュー）
   - その他のテキスト系ファイルをドロップ（コードビュー）
   - 画面上部の `[Paste Markdown...]` に直接ペースト

   ペーストでプレビューが始まるのは、最初の画面で、上部のボックスが空のときだけです。文書を表示しているときは、先に `[Clear]` を押します。ドロップできるファイルは 5 MB までです。

3. ボタンとキー:

   | ボタン | キー | 動作 |
   |---|---|---|
   | Index | `I` | 見出し（h1〜h6）の目次を右端に出す / 消す。押した見出しを見えている範囲の上端へ。コードビューでは、上に挙げた言語のファイルのクラスや関数 |
   | Search | `F` | Markdown の原文（コードビューではファイル）から文字を探す（`Aa` で大文字と小文字を区別、`.*` で正規表現。検索欄の `↓` / `↑` で次 / 前）。編集モードでは `Ctrl+F` でも開け、Replace / All で置き換える（Undo 1 回で戻る） |
   | Commands | `P` | コードビューの JSON のファイルで、1 段畳む / 開くボタンを出す |
   | Open GitHub | `O` | PC だけ: GitHub の `.md` を URL で開く。開いている間、ボタンは [Push to GitHub] になり、直した文書を同じブランチへコミットする |
   | Render Light | `L` | レンダリング / ライトテーマに切替 |
   | Render Dark | `D` | レンダリング / ダークテーマに切替 |
   | Reload | `R` | 表示中のファイルをディスクからリロード（GitHub から開いた文書は、確かめの画面の後に GitHub から読み直す） |
   | New Tab | `N` | 新しいタブで GRSMD を開く |
   | Edit | `E` | 編集パレットの表示 / 非表示。ブロックをクリック（タップ）すると、その場で Markdown を編集。コードビューでは、ファイル全体を編集 |
   | Clear | `C` | 初期化 |
   | ? | | ヘルプを表示（長押し: AI に Markdown を書かせるためのプロンプト） |
   | | `Ctrl+S` / `Ctrl+Shift+S` | Markdown の文書かコードビューのファイルを表示している間、保存 / 名前を付けて保存（UTF-8 以外のファイルは、保存する文字コードを聞く。その文字コードで書けない字があれば、その行を示して UTF-8 で保存するかを聞く） |
   | | `Tab` / `Shift+Tab` | コードビューの編集欄で、選んだ行の字下げを深く / 浅く（`Esc` で編集欄から抜ける） |
   | | `Ctrl+←` / `Ctrl+→` | コードビューの JSON のファイルで、1 段畳む / 開く（編集欄の中では `Ctrl+Shift+[` / `Ctrl+Shift+]`） |
   | | `Esc` | 開いているブロックやセルを反映して閉じる。ブロックを選んでいれば選択を解く。何も開いていなければ編集パレットを隠し、その次は検索を閉じ（検索欄の中ではすぐ閉じる）、その次は目次を消す。コードビューの編集欄の中では編集欄から抜け、外では Commands の箱、検索、目次の順に閉じる（編集は続く） |
   | | `Delete` / `Backspace` | 編集モードで、選んだブロックを削除（`Shift` を押していても同じ。Undo 1 回で戻る） |
   | | `Ctrl+X` / `Ctrl+C` | 編集モードでブロックを選んでいる間、その Markdown を丸ごとカット / コピー（メニューのコピーも同じ） |
   | | `Ctrl+Z` | 編集パレットを表示している間、元に戻す（30 回まで。変更したブロックの中では、ブラウザが入力を元に戻す）。コードビューの編集では、編集欄の中も GRSMD の Undo（打つのを 1 秒止めるか、カーソルを動かすと区切る） |
   | | `Ctrl+Y` / `Ctrl+Shift+Z` | 編集パレットを表示している間、やり直す（30 回まで。開いているブロックの中では、ブラウザが入力をやり直す）。コードビューの編集では、GRSMD のやり直し |
   | | `Ctrl+B` / `Ctrl+I` | 編集中に太字 / 斜体 |

   Mac では `Ctrl` の代わりに `Cmd` を使います（やり直しは `Cmd+Shift+Z`）。折りたたみのキーは `Option+←` / `Option+→`、編集欄の中では `Cmd+Option+[` / `Cmd+Option+]` です。

   編集モードで、ブロックとブロックのすき間、最初のブロックの上、最後のブロックの下にマウスを置く（スマートフォンではタップする）と、点線と `+` が出ます。押すと、そこに新しいブロックを入れます。

   ブロックを開いているとき、編集パレットの Text format の 2 段目で数式を入れられます。Insert inline math は、カーソルの位置に式を入れます。Insert math boxes は、3 つの数式の箱（Maxwell、Einstein、Schroedinger）を、それぞれの名前の下に入れます。

   編集パレットのグリップ（`::`）をダブルクリック（スマートフォンやタブレットではダブルタップ）するか長押しすると、パレットはグリップだけになります。もう一度で元に戻ります。

   編集モードで、ブロックの文字をドラッグで選ぶ（スマートフォンでは長押し）と、選択がかかったブロックが丸ごと選ばれて枠が付き、選択の下に帯 [削除][カット][コピー] が出ます。確認は出ません。消したブロックは Undo 1 回で戻ります。見えている文字の一部だけをコピーするときは、編集モードを抜けてから選びます。

4. Markdown に PlantUML ブロックや外部画像が含まれる場合、外部サーバーへ送信する前に許可確認が表示されます。GitHub 連携は、GitHub へ送る前に毎回確かめます

---

## プライバシーとセキュリティ

- **同意なしには何も送信しません。** 外部への通信は次の 3 つだけです。
  - PlantUML: 文書を描くときに (編集で変えた図は、その [Render] を押したときに) 確認ダイアログを出し、その後にだけ、図のソースを公式 PlantUML サーバーへ送信します。送るのは、ダイアログで許した図だけです。許した図の Copy SVG / PNG は、確認なしにその図をもう一度取りに行きます。ページの読み込みの途中は、図の所に「Loading diagram...」と出し、読み込みが終わってから確認します。
  - 外部画像（`![](https://...)`）: クリックして確認するまでプレースホルダーを表示します。同意は `[Clear]` または新しいファイルのドロップまで有効です。
  - GitHub 連携（PC だけ）: 画面の [Open]・[Reload]・[Push] を押したときだけ、毎回、api.github.com にだけ送ります。Open と Reload は、リポジトリ・ブランチ・パスと、fine-grained personal access token を送ります。Push は、文書の本文の全部・コミットのメッセージ・トークンを送ります。トークンは要求のヘッダーにだけ載せ、GRSMD は送る間だけ持ちます。要求が成功すると、GRSMD はブラウザにトークンの保存を頼みます。保存するかはブラウザが尋ねます。消すときは、ブラウザのパスワードの設定から消します。
- **何も保存しません。** 入力内容を localStorage・sessionStorage・Cookie に書き込みません。
- **編集内容もブラウザに保存しません。** ファイルに保存するまでは、開いているページの中にだけあります。
- **クリップボード。** 「リンクを貼る」（Paste copied link）のボタンは、押したときだけクリップボードを読むので、ブラウザが許可を求めることがあります。goodrelax.github.io で開いているとき、Chrome と Edge では、一度許可すると、goodrelax.github.io の他のページも確認なしにクリップボードを読めるようになります。取り消すには、アドレスバーの左のアイコンからサイトの設定を開き、「クリップボード」を「確認する」か「ブロック」にします。選んだ文字に URL を Ctrl+V / Cmd+V で貼ってリンクにする方法には、許可が要りません。クリップボードから読んだものは、どこにも送りません。
- **Markdown 内の HTML は DOMPurify でサニタイズ**します。スクリプトとイベント属性を除去し、その他の外部参照（動画・音声・CSS の `url()`・`<style>`）も除去します。
- **Content-Security-Policy:** ビルド成果物は自身のスクリプト (要るときに動かすライブラリも含め、それぞれハッシュで許したもの) しか実行せず、データを取りに行ける先は PlantUML サーバーと GitHub の API（api.github.com）だけです。ほかのサイトの画像はポリシーでは許していますが、GRSMD は同意（上記）の後にだけ読み込みます。

---

## 開発

ソースは `src/`（複数ファイル）にあります。Vite と vite-plugin-singlefile で 1 ファイルの `docs/index.html` にビルドし、GitHub Pages で配信します。起動を速くするため、ファイルの先頭にアプリを置き、mermaid・highlight.js・KaTeX・PlantUML のエンコーダーは別にまとめて後ろに置き、要るときに動かします (`tools/fastStartup.mjs`、仕様 5.17)。

```bash
npm ci
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

同じビルドのベータ版を `docs/grsmd-beta.html` に書きます。`docs/index.html` との違いは、検索エンジンに載せない robots の meta（`noindex`）だけです（BETA の印は出さず、ヘルプも同じ）。`docs/index.html` は変えません。

```bash
npm run build:beta
```

ビルドしたファイルのブラウザでの試験（Playwright、Chromium と WebKit）。初めにブラウザのダウンロードが 1 回要ります。[`e2e/README.md`](e2e/README.md) を見てください。

```bash
npm run test:e2e
```

- `src/index.html`、`src/css/`、`src/js/` — アプリ本体（ES6+ クラス。`src/js/classes/` に 1 クラス 1 ファイル）
- `src/__tests__/` — 単体テスト（Vitest + jsdom）
- `e2e/` — ブラウザでの試験（Playwright）
- `spec/grsmd_gen2_spec_ja.md` — 仕様書
- `CHANGELOG.md` — 主な変更点と依存ライブラリのバージョン

版の規則: `spec/grsmd_gen2_spec_ja.md` の 1.7。

---

## 設計メモ

- Markdown は専用の `MarkdownRenderer` で処理
- 図表レンダリングは Mermaid / PlantUML で分離
- コードビューは `SourceFileRenderer` で処理し、コードのファイルの編集・文字コード・保存は `CodeEditController` が受け持つ
- 中央のオーケストレーターが描画とスクロール安定性を制御
- プライバシーと UX を最重要設計要素として扱っています

---

## ライセンス

MIT License

GRSMD は、オープンソースのソフトウェアを同梱しています。その著作権とライセンスの表記は、ビルドした
`docs/index.html`（とリリースの `GRSMD.html`）の最後のコメントにあり、ヘルプの「ライセンス」の章に一覧があります。
ビルドが `node_modules` から集めます（`tools/notices.mjs`、`tools/third-party-extras.mjs`）。パッケージが入っていないコードの文は、
`tools/third-party-licenses/` から取ります。
