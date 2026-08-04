# hyakkei プロジェクト固有ルール

## push前チェック（必須、3回連続の再発を受けて追加）

`tsc --noEmit`/`vitest run` が green でも、CI は追加で `eslint .` と `prettier --check .` を独立した hard gate として実行する。ローカルでこの2つを走らせずに push すると高確率で CI が red になる（PR #100/#103/#105 で3回連続発生した実績あり）。

**push 前に必ず両方を実行する**:

```bash
pnpm run lint          # eslint .
pnpm run format        # prettier --check .（違反があれば `pnpm run format:write` で自動修正してから再確認）
```

`pnpm run typecheck`/`vitest run` だけでは検出できない。

**ゲートをパイプに通さない。** `pnpm run format | tail` は `tail` の exit code を返すので、
落ちたゲートが緑に見え、`&&` チェーンもそのまま先へ進む（PR #132 で format、2026-08-04 に
PR #137 で typecheck——2回目）。exit code は自分で受け取る:

```bash
pnpm run typecheck; echo "typecheck exit=$?"
```

出力を絞りたいならファイルへ落としてから読む。`| tail` を挟んだ時点で、そのコマンドは検査ではない。

削除条件: pre-push hook 等でこの3つが機械的に走るようになり、手元での実行判断が消えたら。
