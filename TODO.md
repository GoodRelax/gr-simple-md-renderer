# TODO

## 次回対応リスト

### Vega-Lite 対応
- [ ] CDN追加（3本、合計約800KB）
  - `vega.min.js`（500KB）
  - `vega-lite.min.js`（246KB）
  - `vega-embed.min.js`（59KB）
- [ ] ` ```vegalite ` コードブロックを認識して vega-embed で描画する
- [ ] 用途：数学関数のグラフ描画（ガウス曲線、散布図など）
- [ ] 参考：https://vega.github.io/editor/ で動作確認できる

### CDNライブラリの非同期読み込み
- [ ] 現状：ESM `import` が全CDN読み込み完了までブロックする（特にMermaid 3MB）
- [ ] 初回アクセス時、ファイルドロップやペーストがCDN取得完了まで効かない
- [ ] 対応案：CDNライブラリを動的 `import()` に変更し、UI（ペースト・ドロップ・ファイル読み込み）を先に有効化する
- [ ] レンダリングはCDN読み込み完了後に実行すればよい（読み込み中はスピナー等を表示）
