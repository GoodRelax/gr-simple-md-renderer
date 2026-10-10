# TODO

## 次回対応リスト

### Vega-Lite 対応
- [ ] npm 依存として追加し、バンドルに含める（2026-07-16 以降、CDN は使わない方針）
  - 旧メモでは CDN 版 3 本で合計約 800KB（`vega` 500KB、`vega-lite` 246KB、`vega-embed` 59KB）。バンドル時の増分は未計測
- [ ] ` ```vegalite ` コードブロックを認識して vega-embed で描画する
- [ ] 用途：数学関数のグラフ描画（ガウス曲線、散布図など）
- [ ] 参考：https://vega.github.io/editor/ で動作確認できる
- [ ] CSP（`connect-src` は PlantUML サーバーのみ）の中で、外部データの URL 読み込みをどう扱うか決める

### 初回表示の速さ
- [ ] 現状：全ライブラリを 1 本のモジュールにバンドルしており（約 4.33MB、gzip 約 1.37MB）、読み込みと解析が終わるまでペーストやドロップが効かない
- [ ] まず、実機で初回表示までの時間を計測する
- [ ] 対応案：Mermaid・KaTeX などの初期化を、使う時まで遅らせる。UI（ペースト・ドロップ）を先に有効化し、読み込み中はスピナー等を表示する
- [ ] 注意：vite-plugin-singlefile は動的 `import()` も 1 ファイルに入れるため、ダウンロード量自体は減らない

### 依存ライブラリ
- [ ] mermaid 12：2026-10-10 に評価して見送り。ELK レイアウトエンジンの同梱で約 +0.5MB（gzip）、flowchart・state・class・requirement 図の配置が変わる。必要になったら再評価（`layout: "dagre"`、`look: "classic"` で旧配置に戻せる）
- [ ] jsdom 30：Node 24.15 以上が必要（開発環境は 24.12.0）。Node を上げたら更新する（jsdom 30.1.2 でのテストは通過済み）
- [ ] `npm audit --omit=dev` の low 2 件：mermaid が内部に持つ katex 0.16.47（GHSA-238p-pmpm-9mq7）。修正版の 0.16.x か、範囲を広げた mermaid が出たら解消する
- [ ] `npm audit` の high 3 件（開発時のみ）：braces <- micromatch <- vite-plugin-singlefile。修正版が出たら更新する

### Markdown 編集機能
- [ ] GRSMD 上で Markdown を編集する機能の仕様を検討中（実装は当分しない）。検討レポートが出たら方針を決める
