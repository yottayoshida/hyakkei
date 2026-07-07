import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

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
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "spikes/**"],
  },
];
