# GRSMD — A Privacy-First Markdown Renderer That Runs in Your Browser

**GRSMD (GoodRelax Simple Markdown Renderer)** is a privacy-first Markdown renderer that runs entirely in the browser.

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
- Mermaid diagram support
- PlantUML support with explicit consent prompt
- Syntax highlighting for code blocks
- Dark / Light theme rendering
- Scroll position preservation during re-rendering
- Designed for extensibility (renderer-based architecture)

---

## Demo

You can run this tool locally by simply opening `index.html` in your browser.

🔗 **Live Demo:** https://goodrelax.github.io/gr-simple-md-renderer/

---

## Usage

1. Open the application in your browser
2. Paste Markdown text into the editor in the top-left
3. Click **Render Light** or **Render Dark**
4. If PlantUML is detected, you will be asked for permission before rendering

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
# GR Simple MD Renderer

Mermaid・PlantUML・シンタックスハイライトに対応した、  
軽量でプライバシー重視の Markdown レンダラーです。  
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
- Mermaid 図のサポート
- 明示的な許可確認付き PlantUML レンダリング
- コードブロックのシンタックスハイライト対応
- ダーク / ライトテーマ対応
- 再レンダリング時のスクロール位置保持
- 拡張を前提とした renderer ベース設計

---

## デモ

`index.html` をブラウザで開くだけで、そのまま利用できます。

🔗 **Live Demo:** https://goodrelax.github.io/gr-simple-md-renderer/

---

## 使い方

1. ブラウザでアプリケーションを開く
2. エディタに Markdown を貼り付ける
3. **Render Light** または **Render Dark** をクリック
4. PlantUML が検出された場合、レンダリング前に許可確認が表示されます

---

## 設計メモ

- Markdown は専用の `MarkdownRenderer` で処理
- 図表レンダリングは Mermaid / PlantUML で分離
- 中央のオーケストレーターが描画とスクロール安定性を制御
- プライバシーと UX を最重要設計要素として扱っています

---

## ライセンス

MIT License
