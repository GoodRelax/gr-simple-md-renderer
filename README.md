# GRSMD — A Privacy-First Markdown Renderer & Viewer That Runs in Your Browser

**GRSMD (GoodRelax Simple Markdown Renderer & Viewer)** is a privacy-first Markdown renderer and viewer that runs entirely in the browser.

- Client-side Markdown, Mermaid, and syntax highlighting
- PlantUML rendering with explicit user consent
- No backend, no data collection
  
---

## Why

Many online Markdown tools send your content to remote servers without making it clear.
This tool was built to provide a **transparent, minimal, and privacy-respecting renderer**.

- Markdown and Mermaid are rendered entirely in your browser
- PlantUML is rendered only after explicit user consent
- No backend, no tracking, no storage

---

## Features

- 100% client-side Markdown rendering
- Auto-render on paste (Ctrl+V / Cmd+V anywhere on the page)
- File drag-and-drop support (.md / .txt)
- Mermaid diagram support
- PlantUML support with explicit consent prompt
- Syntax highlighting for code blocks
- Dark / Light theme rendering
- Diagram zoom (Ctrl+Scroll) and pan (drag) on PC
- Scroll position preservation during re-rendering
- Designed for extensibility (renderer-based architecture)

---

## Demo

You can run this tool locally by simply opening `index.html` in your browser.

🔗 **Live Demo:** https://goodrelax.github.io/gr-simple-md-renderer/

---

## Usage

1. Open the application in your browser
2. Any of the following triggers an automatic preview:
   - Paste text anywhere on the page (Ctrl+V / Cmd+V)
   - Drop a `.md` / `.txt` file anywhere on the page
   - Type or paste directly into the `[Paste Markdown...]` box at the top
3. To switch themes, click **Render Light** or **Render Dark**
4. If your Markdown contains PlantUML blocks, you will be asked for permission before they are sent to the external server

No content is sent to external servers without explicit user consent.

---

## Design Notes

- Markdown rendering is handled by a dedicated `MarkdownRenderer`
- Diagram rendering is separated into Mermaid and PlantUML renderers
- A central orchestrator coordinates rendering and scroll stability
- Privacy and UX are treated as first-class design concerns

---

## License

MIT License


---
---
# GR Simple MD Renderer & Viewer

Mermaid・PlantUML・シンタックスハイライトに対応した、
軽量でプライバシー重視の Markdown レンダラー＆ビューワーです。
基本的にすべてクライアントサイドで動作し、外部通信は明示的な許可がある場合のみ行われます。

---

## なぜ作ったか

多くのオンライン Markdown ツールは、内容を暗黙的にサーバーへ送信します。
本ツールは、**透明性が高く、最小構成で、プライバシーを尊重するレンダラー**を目的として作られました。

- Markdown と Mermaid は完全にブラウザ内でレンダリング
- PlantUML は明示的なユーザー同意がある場合のみ外部通信
- バックエンドなし、トラッキングなし、保存なし

---

## 特徴

- 100% クライアントサイド Markdown レンダリング
- ページ上どこでも貼り付け（Ctrl+V / Cmd+V）→ 自動プレビュー
- `.md` / `.txt` ファイルのドラッグ＆ドロップ → 自動プレビュー
- Mermaid 図のサポート
- 明示的な許可確認付き PlantUML レンダリング
- コードブロックのシンタックスハイライト対応
- ダーク / ライトテーマ対応
- PC: ダイアグラムの Zoom（Ctrl+Scroll）/ Pan（ドラッグ）対応
- 再レンダリング時のスクロール位置保持
- 拡張を前提とした renderer ベース設計

---

## デモ

`index.html` をブラウザで開くだけで、そのまま利用できます。

🔗 **Live Demo:** https://goodrelax.github.io/gr-simple-md-renderer/

---

## 使い方

1. ブラウザでアプリケーションを開く
2. 以下のいずれかで自動プレビューが開始されます:
   - ページ上どこでも貼り付け（Ctrl+V / Cmd+V）
   - `.md` / `.txt` ファイルをページ上にドロップ
   - 画面上部の `[Paste Markdown...]` に直接ペースト
3. テーマを切り替えるには **Render Light** / **Render Dark** をクリック
4. Markdown に PlantUML ブロックが含まれる場合、外部サーバーへ送信する前に許可確認が表示されます

---

## 設計メモ

- Markdown は専用の `MarkdownRenderer` で処理
- 図表レンダリングは Mermaid / PlantUML で分離
- 中央のオーケストレーターが描画とスクロール安定性を制御
- プライバシーと UX を最重要設計要素として扱っています

---

## ライセンス

MIT License
