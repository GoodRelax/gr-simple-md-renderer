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
- [x] その場編集（SC-22〜24）を `feature/inplace-edit` で実装した。リリース前の実機テスト（試験仕様のセクション U / V / W と、既存の A〜T のやり直し）が残る

### 純粋関数への切り出し（その場編集の実装中に見つけた、編集機能の範囲外の指摘）
- [ ] F-B1 `DiagramZoomController.zoom`：次の倍率の上限・下限を決める規則が、レイアウトを読みスタイルを書く状態付きのメソッドの中で計算されている。規則を純粋関数に切り出す（R7.2）
- [ ] F-B2 `DiagramCopyController.inlineSvgStyles` / `convertForeignObjects`：複製を組み立てるループの中で `getComputedStyle` を読んでいる（R7.4）。`convertForeignObjects` は文字の配置の計算（R7.2）と DOM の生成も混ざっている。読み取りと計算と生成を分ける
- [ ] F-B3 `SmoothScrollEngine._loop`：速度と摩擦の物理計算が `scrollBy` と `requestAnimationFrame` と混ざっている。計算を純粋関数に切り出す（R7.2）

### 表示の既存の不具合（その場編集の手動テストで見つかった、main と同じもの）
- [x] KaTeX の文字の大きさが 1.5em にならず 1.21em になる：ビルドの CSS で KaTeX の `.katex{font:1.21em ...}` が、アプリの `.katex{font-size:1.5em}` より後ろに来る（CSS の順序）。試験仕様 PRT-M04。→ 2026-10-23 に解決（アプリの規則を `#preview .katex` にして詳細度で勝つ。1.5em に戻る）
- [x] ダーク表示で本文のリンクの色が既定の青（rgb(0,0,238)）のままで、暗い背景で読みにくい（`.dark a` の規則が無い）。→ 単位 G（GitHub の配色）で解決（`.dark #preview a` を `#4493f8`）
- [x] `<meta name="viewport">` が無い：幅 768px 未満の端末では 980px のレイアウトになる（スマートフォンでの表示）。→ 追加しない（決定。仕様書の「`<meta name="viewport">` は追加しない」のとおり、追加すると iPhone の既存のレイアウトが崩れる）。既知の制約として扱う

### 構造の整理（その場編集のコードレビューで受容した指摘）
- [ ] `UIController` の責務が多い（約 1,740 行。2026-10-23）。UI の配線に加え、文書の作り直し（`_session` / `_location` の置き換え）・保存の状態機械・未保存の判定・パレットの機能の振り分けを持つ。「文書のライフサイクル」（セッション・保存先・保存の状態）を別のクラスへ分ける（R2.2 / R2.10）
- [ ] `SaveDocument` が内部で `SaveDocumentAs` を作り、その `outcome` / `failureMessage` を借りている（UIController も例外の経路で使う）。両方の use case が使う純粋な関数（例：`saveOutcome.js`）に出し、`SaveDocument` には `SaveDocumentAs` を注入する（R2.7 / R2.2）
- [ ] メンバの並び：`BlockEditController` の non-pure の `dispatch` が semi-pure-b のクエリより前にある。`UIController.js` の先頭の純粋関数（`classifyDroppedFile` / `hasNullByte` / `renderRouteFor`）を別ファイル（例：`dropClassification.js`）へ移す（R7.7 / R7.9）
