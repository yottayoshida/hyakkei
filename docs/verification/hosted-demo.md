# Hosted demo 検証記録

このファイルは、`packages/app/dist` を GitHub Pages に公開した後に、同じ成果物を
実ブラウザで確認するための記録様式です。PR中は `e2e/hosted-demo.spec.ts` がローカルで
同じ検査を行いますが、実Pages URLの証跡と置き換えてはいけません。

## 実施情報

- Pages URL: `未実施 — main merge後に記録`
- GitHub Actions deploy run: `未実施 — main merge後に記録`
- main commit SHA: `未実施 — main merge後に記録`
- 実施日時（JST）: `未実施`
- Browser / OS: `未実施（Chromium / Firefox / WebKit を各1回）`

## 確認項目

- [ ] `/index.html` がrepository subpathから読み込める
- [ ] 公開ギャラリーの3カード（applications / budget / regional）が表示される
- [ ] 各カードの「サンプルを見る」が `gallery/*.html` を開く
- [ ] e-Statの表番号と出典リンクが表示される
- [ ] footerの「デジタル庁の公式製品ではない」disclaimerが表示される
- [ ] DevTools Networkで第三者originへのrequestが0件
- [ ] DuckDB worker / WASM / parquet extensionが同一originのsubpathから解決される

## 判定

人手によるPages確認が終わるまでは「合格」と記録しない。第三者request、root-anchored
asset、gallery欠落のいずれかが1件でもあれば公開を止め、原因を独立issueへ分割する。
