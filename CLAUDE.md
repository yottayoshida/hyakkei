# hyakkei プロジェクト固有ルール

## push前チェック（必須、3回連続の再発を受けて追加）

`tsc --noEmit`/`vitest run` が green でも、CI は追加で `eslint .` と `prettier --check .` を独立した hard gate として実行する。ローカルでこの2つを走らせずに push すると高確率で CI が red になる（PR #100/#103/#105 で3回連続発生した実績あり）。

**push 前に必ず両方を実行する**:

```bash
pnpm run lint          # eslint .
pnpm run format        # prettier --check .（違反があれば `pnpm run format:write` で自動修正してから再確認）
```

`pnpm run typecheck`/`vitest run` だけでは検出できない。
