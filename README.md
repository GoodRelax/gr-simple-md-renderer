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
- PlantUML diagrams, with a consent prompt every time before data is sent
- Syntax highlighting for code blocks
- Code View: drop any text file (.py, .js, .c, ...) to view it with syntax highlighting and line numbers
- Auto-render on paste (Ctrl+V / Cmd+V anywhere on the page) or file drop
- Reload the current file from disk (browsers with the File System Access API)
- Edit the preview block by block and save to a file (no autosave; Save as / download where writing files is not supported)
- Edit table cells as they are shown, and double-click (double-tap) the preview to start editing what you clicked
- Text color (red, blue, green), and links: paste a URL onto selected text, or remove a link
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
   - Type or paste directly into the `[Paste Markdown...]` box at the top
3. Buttons and keys:

   | Button | Key | Action |
   |---|---|---|
   | Render Light | `L` | Render / switch to the light theme |
   | Render Dark | `D` | Render / switch to the dark theme |
   | Reload | `R` | Reload the current file from disk |
   | New Tab | `N` | Open GRSMD in a new tab |
   | Edit | `E` | Show / hide the edit palette; click a block to edit its Markdown in place |
   | Clear | `C` | Clear and reset |
   | ? | | Show help (long press: a prompt template for AI-generated Markdown) |
   | | `Ctrl+S` / `Ctrl+Shift+S` | Save / Save as while a Markdown document is shown |
   | | `Esc` | Apply the open block or cell and close it; with nothing open, hide the edit palette |
   | | `Ctrl+Z` | Undo while the edit palette is shown, up to 30 changes (in a block you have changed, the browser undoes your typing) |
   | | `Ctrl+Y` / `Ctrl+Shift+Z` | Redo while the edit palette is shown, up to 30 changes (in an open block, the browser redoes your typing) |
   | | `Ctrl+B` / `Ctrl+I` | Bold / Italic while editing |

   On a Mac, use `Cmd` instead of `Ctrl` (Redo is `Cmd+Shift+Z`).

   In edit mode, a dashed line with `+` shows between two blocks, above the first one and below the last one; click it (on a phone, tap the gap, then the line) to add a new block there.

4. If your Markdown contains PlantUML blocks or external images, you will be asked for permission before anything is sent to an external server

---

## Privacy & Security

- **Nothing is sent without consent.** The only external requests are:
  - PlantUML: the diagram source is sent to the official PlantUML server, after a confirmation dialog, every time it renders.
  - External images (`![](https://...)`): shown as placeholders until you click one and confirm. The consent lasts until `[Clear]` or a new file drop.
- **Nothing is stored.** Your content is never written to localStorage, sessionStorage, or cookies.
- **Edits are not stored in the browser either.** They live only in the open page until you save them to a file.
- **Clipboard.** The "Paste copied link" button reads the clipboard only when you press it, so the browser may ask you to allow it. In Chrome and Edge, once you allow it, other pages on goodrelax.github.io can also read your clipboard without asking. To withdraw it, open the site settings for goodrelax.github.io (the icon at the left of the address bar) and set Clipboard to Ask or Block. Pasting a URL onto selected text with Ctrl+V / Cmd+V makes a link without any permission. Nothing read from the clipboard is sent anywhere.
- **HTML in Markdown is sanitized** with DOMPurify. Scripts and event handlers are removed. Other remote references (video, audio, CSS `url()`, `<style>`) are removed.
- **Content-Security-Policy:** the built file only runs its own script, and network access is limited to the PlantUML server.

---

## Development

The source lives in `src/` (multiple files). Vite and vite-plugin-singlefile build it into one file, `docs/index.html`, which GitHub Pages serves.

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
- Code View is handled by `SourceFileRenderer`
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
- PlantUML 図のサポート（送信前に毎回、許可を確認）
- コードブロックのシンタックスハイライト
- コードビュー: テキスト系ファイル（.py、.js、.c など）をドロップすると、ハイライトと行番号付きで表示
- ページ上どこでも貼り付け（Ctrl+V / Cmd+V）またはファイルのドロップで自動プレビュー
- 表示中のファイルをディスクからリロード（File System Access API 対応ブラウザ）
- プレビュー上でのブロック単位の編集と、ファイルへの保存（自動保存はしない。ファイルを書き込めないブラウザではダウンロード）
- 表のセルを見たままの形で編集。プレビューのダブルクリック（ダブルタップ）で、押した所の編集を始める
- 文字色（赤・青・緑）と、リンク（選んだ文字に URL を貼る、リンクを外す）
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
3. ボタンとキー:

   | ボタン | キー | 動作 |
   |---|---|---|
   | Render Light | `L` | レンダリング / ライトテーマに切替 |
   | Render Dark | `D` | レンダリング / ダークテーマに切替 |
   | Reload | `R` | 表示中のファイルをディスクからリロード |
   | New Tab | `N` | 新しいタブで GRSMD を開く |
   | Edit | `E` | 編集パレットの表示 / 非表示。ブロックをクリックすると、その場で Markdown を編集 |
   | Clear | `C` | 初期化 |
   | ? | | ヘルプを表示（長押し: AI に Markdown を書かせるためのプロンプト） |
   | | `Ctrl+S` / `Ctrl+Shift+S` | Markdown の文書を表示している間、保存 / 名前を付けて保存 |
   | | `Esc` | 開いているブロックやセルを反映して閉じる。何も開いていなければ編集パレットを隠す |
   | | `Ctrl+Z` | 編集パレットを表示している間、元に戻す（30 回まで。変更したブロックの中では、ブラウザが入力を元に戻す） |
   | | `Ctrl+Y` / `Ctrl+Shift+Z` | 編集パレットを表示している間、やり直す（30 回まで。開いているブロックの中では、ブラウザが入力をやり直す） |
   | | `Ctrl+B` / `Ctrl+I` | 編集中に太字 / 斜体 |

   Mac では `Ctrl` の代わりに `Cmd` を使います（やり直しは `Cmd+Shift+Z`）。

   編集モードでは、ブロックとブロックのすき間、最初のブロックの上、最後のブロックの下に、点線と `+` が出ます。押すと（スマートフォンでは、すき間をタップしてから点線をタップ）、そこに新しいブロックを入れます。

4. Markdown に PlantUML ブロックや外部画像が含まれる場合、外部サーバーへ送信する前に許可確認が表示されます

---

## プライバシーとセキュリティ

- **同意なしには何も送信しません。** 外部への通信は次の 2 つだけです。
  - PlantUML: 確認ダイアログの後に、図のソースを公式 PlantUML サーバーへ送信します（描画のたびに確認）。
  - 外部画像（`![](https://...)`）: クリックして確認するまでプレースホルダーを表示します。同意は `[Clear]` または新しいファイルのドロップまで有効です。
- **何も保存しません。** 入力内容を localStorage・sessionStorage・Cookie に書き込みません。
- **編集内容もブラウザに保存しません。** ファイルに保存するまでは、開いているページの中にだけあります。
- **クリップボード。** 「リンクを貼る」（Paste copied link）のボタンは、押したときだけクリップボードを読むので、ブラウザが許可を求めることがあります。Chrome と Edge では、一度許可すると、goodrelax.github.io の他のページも確認なしにクリップボードを読めるようになります。取り消すには、アドレスバーの左のアイコンからサイトの設定を開き、「クリップボード」を「確認する」か「ブロック」にします。選んだ文字に URL を Ctrl+V / Cmd+V で貼ってリンクにする方法には、許可が要りません。クリップボードから読んだものは、どこにも送りません。
- **Markdown 内の HTML は DOMPurify でサニタイズ**します。スクリプトとイベント属性を除去し、その他の外部参照（動画・音声・CSS の `url()`・`<style>`）も除去します。
- **Content-Security-Policy:** ビルド成果物は自身のスクリプトしか実行せず、通信先も PlantUML サーバーだけに制限しています。

---

## 開発

ソースは `src/`（複数ファイル）にあります。Vite と vite-plugin-singlefile で 1 ファイルの `docs/index.html` にビルドし、GitHub Pages で配信します。

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
- コードビューは `SourceFileRenderer` で処理
- 中央のオーケストレーターが描画とスクロール安定性を制御
- プライバシーと UX を最重要設計要素として扱っています

---

## ライセンス

MIT License

GRSMD は、オープンソースのソフトウェアを同梱しています。その著作権とライセンスの表記は、ビルドした
`docs/index.html`（とリリースの `GRSMD.html`）の最後のコメントにあり、ヘルプの「ライセンス」の章に一覧があります。
ビルドが `node_modules` から集めます（`tools/notices.mjs`、`tools/third-party-extras.mjs`）。パッケージが入っていないコードの文は、
`tools/third-party-licenses/` から取ります。
