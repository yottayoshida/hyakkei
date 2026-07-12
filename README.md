# Hyakkei（百景）

![Ukiyo-e style illustration of Edo-period townspeople gathered in a public square, studying charts and dashboards displayed on wooden notice boards, with a bridge and Mount Fuji in the background](./docs/assets/hero.webp)

> One hundred views of your data.

Hyakkei is an open-source dashboard builder built on the [Japan Digital Agency Design System](https://design.digital.go.jp/). Load a CSV or Excel file and build a polished, guideline-compliant dashboard in minutes — entirely in your browser. No server, no account, no data leaving your machine.

Just as ukiyo-e prints brought art to everyone in Edo-period Japan, Hyakkei aims to bring quality data visualization to everyone.

## Status

Early design phase. Nothing to run yet. Design documents — PRD, roadmap, architecture, and decision records — live in [`docs/`](./docs/README.md).

## Vision

- **File-first** — CSV, Excel, and spreadsheet URLs as first-class data sources. Your data lives in files; your dashboard tool should too.
- **Browser-complete** — Powered by DuckDB-WASM. Deployable as static files: GitHub Pages, object storage, a file server, or a local folder.
- **Design-system native** — Digital Agency design tokens, the dashboard guidebook's color palettes, grid system, and Do's & Don'ts are built into the UI, so following the guidelines is the default, not homework.

## Roadmap

- **v0.1 (MVP)** — An individual can turn a spreadsheet into a Digital Agency-quality dashboard in five minutes and share it as static files.
- **v0.x** — Template gallery, embed tags, print layouts — growing while staying browser-complete.
- **v1.0** — Teams can operate dashboards connected to live data sources (databases, APIs, scheduled refresh) behind their own identity provider. Authentication stays outside the app (IAP, oauth2-proxy, etc.).

## Development

```bash
pnpm install
pnpm run build
pnpm run test        # unit tests (schema/core/app)
pnpm run test:e2e    # browser matrix (chromium/firefox/webkit)
```

The renderer's regression suite is golden-based: SVG-snapshot tests (`packages/core/src/renderer/__golden__/`) pin the rendered output of 3 sample dashboards across all 7 chart types, both light/dark appearance, and all 7 guidebook palettes. A Docker-based pixel-diff layer (`pnpm run test:e2e:pixel-golden`) additionally checks 2 representative palettes as a final visual smoke test.

**Updating a golden after an intentional rendering change:**

```bash
pnpm --filter @hyakkei/core test -- -u   # SVG snapshots (packages/core/src/renderer/__golden__/__snapshots__/)
pnpm run test:e2e:pixel-golden -- --update-snapshots   # pixel baselines (e2e/pixel-golden/__screenshots__/)
```

**Never regenerate the pixel baseline outside `pnpm run test:e2e:pixel-golden`.** The comparison (`maxDiffPixelRatio: 0`) tolerates zero already-different pixels — it is not a literal byte-for-byte file comparison, but for a fixed renderer/font environment it behaves just as strictly, so the baseline must come from the same CPU architecture CI runs on (linux/amd64) and the same pinned `mcr.microsoft.com/playwright` image — the script always passes `--platform linux/amd64` to Docker for this reason (a no-op on an amd64 CI runner, real QEMU emulation on e.g. an Apple Silicon dev machine, but either way the exact same instruction path CI uses). A baseline generated any other way (a bare `docker run` without that flag, `vite preview` + a host browser, etc.) can silently commit a PNG that fails CI's comparison.

**Editing a golden sample (`packages/core/src/golden-fixtures/{applications,budget,regional}.json`):** these are canonical `dashboard.json` exemplars, not test-only data — they double as the M4 gallery seed and the reference examples for issue #26's MCP contract. Every sample is a real, load-bearing invariant enforced in CI, not just documentation: `golden-samples.roundtrip.test.ts` requires each one to pass authoring-schema validation with zero reference issues (dangling/duplicate/overlap/out-of-bounds/reserved-word), declare only `file`-kind sources, have every query's SQL `FROM` table match a declared source id, bake into a schema-valid `BakedDashboard` with zero baked-side reference issues, and produce non-empty rows for every configured chart. An edit that breaks any of these fails that test directly, with a message naming the sample and the exact issue — separately from (and usually without touching) the SVG/pixel golden snapshots above.

## Disclaimer

Hyakkei is a community project. It is not affiliated with or endorsed by the Digital Agency of Japan.

## License

[MIT](LICENSE)

The hero illustration is AI-generated artwork created for this project.
