import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript's own compiler (with "lib": ["DOM", ...]) already catches
      // undefined globals with full type information; no-undef is redundant
      // and produces false positives on DOM globals in .tsx files.
      "no-undef": "off",
      // Same rationale: the base rule doesn't understand TS declaration
      // merging and false-positives on the `export const Foo = ...; export
      // type Foo = Static<typeof Foo>` pattern (TypeBox et al.) — a real
      // duplicate identifier is already a tsc build error.
      "no-redeclare": "off",
      // `_`-prefixed names mark a deliberately-discarded destructured field
      // (e.g. `const { query: _query, ...rest } = chart` to omit `query`
      // from a spread) -- distinct from an actually-forgotten variable.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // PR-B (issue #8) §設計方針 6, React layer: `dangerouslySetInnerHTML`
    // in a future .tsx editor/preview component.
    files: ["**/*.tsx"],
    plugins: { react },
    rules: {
      "react/no-danger": "error",
    },
  },
  {
    // PR-B (issue #8) §設計方針 6, plain-DOM layer: `react/no-danger` only
    // matches the JSX `dangerouslySetInnerHTML` prop, so it has zero reach
    // over `packages/core/src/renderer/dom/*.ts`/`accessible-table.ts` --
    // plain `.ts` files that build DOM via `document.createElement` calls,
    // not JSX (Security Review Phase 8 M1: an earlier version of this file
    // claimed `react/no-danger` was already "a machine-enforced backstop"
    // for exactly these files, which was not true -- a `.tsx`-only rule
    // cannot enforce anything in a `.ts` file). This rule is that backstop
    // for the files that actually need it.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/], CallExpression[callee.property.name='insertAdjacentHTML']",
          message:
            "Renderer DOM construction must use textContent/createElement only (plan §設計方針 6).",
        },
      ],
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "spikes/**"],
  },
];
