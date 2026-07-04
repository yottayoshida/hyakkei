# Hyakkei（百景）

> One hundred views of your data.

Hyakkei is an open-source dashboard builder built on the [Japan Digital Agency Design System](https://design.digital.go.jp/). Load a CSV or Excel file and build a polished, guideline-compliant dashboard in minutes — entirely in your browser. No server, no account, no data leaving your machine.

Just as ukiyo-e prints brought art to everyone in Edo-period Japan, Hyakkei aims to bring quality data visualization to everyone.

## Status

Early design phase. Nothing to run yet.

## Vision

- **File-first** — CSV, Excel, and spreadsheet URLs as first-class data sources. Your data lives in files; your dashboard tool should too.
- **Browser-complete** — Powered by DuckDB-WASM. Deployable as static files: GitHub Pages, object storage, a file server, or a local folder.
- **Design-system native** — Digital Agency design tokens, the dashboard guidebook's color palettes, grid system, and Do's & Don'ts are built into the UI, so following the guidelines is the default, not homework.

## Roadmap

- **v0.1 (MVP)** — An individual can turn a spreadsheet into a Digital Agency-quality dashboard in five minutes and share it as static files.
- **v0.x** — Template gallery, embed tags, print layouts — growing while staying browser-complete.
- **v1.0** — Teams can operate dashboards connected to live data sources (databases, APIs, scheduled refresh) behind their own identity provider. Authentication stays outside the app (IAP, oauth2-proxy, etc.).

## Disclaimer

Hyakkei is a community project. It is not affiliated with or endorsed by the Digital Agency of Japan.

## License

[MIT](LICENSE)
