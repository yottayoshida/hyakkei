import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

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
    // #63 (audit round 2) §設計方針 1: react-hooks rules only apply where
    // React function components/hooks are actually authored --
    // `packages/app/src/**`. The flat `recommended` preset does not scope
    // itself to any `files` glob (confirmed by inspecting
    // `reactHooks.configs.flat.recommended` at package-install time: it
    // exports only `plugins`/`rules`, no `files` key), so without this
    // explicit `files` restriction it would apply, harmlessly but
    // pointlessly, to every `.ts`/`.tsx` file in the monorepo including
    // non-React packages (core/export/schema) that never call a hook.
    files: ["packages/app/src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
  },
  {
    // #63 (audit round 2) §設計方針 2-3, plain-DOM/XSS-sink layer: this is
    // the backstop for `.ts` (and, per the scope widening below, `.tsx`)
    // files that build DOM via imperative Web APIs rather than JSX.
    //
    // Responsibility split with `react/no-danger` above (Security Review
    // Phase 8 M1 taught us to spell this out rather than assert it):
    //   - `.tsx` `dangerouslySetInnerHTML={{ __html: x }}` is a JSX
    //     attribute (JSXExpressionContainer), not an AssignmentExpression
    //     or CallExpression -- `no-restricted-syntax` below is
    //     structurally incapable of matching it. `react/no-danger` is the
    //     only guard for that pattern.
    //   - Everything below (`innerHTML =`, `document.write(...)`, `new
    //     DOMParser()`, etc.) is a plain AssignmentExpression/
    //     CallExpression/NewExpression that `react/no-danger` cannot see
    //     (it only inspects JSX). This rule is the only guard for those.
    // Both layers are required; neither can substitute for the other.
    //
    // Scope: widened from `packages/core/src/**/*.ts` to
    // `packages/*/src/**/*.{ts,tsx}` (all product packages, both
    // extensions) -- an XSS sink in `packages/app` or `packages/export`
    // is exactly as dangerous as one in `packages/core`, and a sink
    // written inside a `.tsx` file's `useEffect` (imperative DOM code
    // living alongside JSX) is real, plain-JS code, not JSX, so it is not
    // covered by `react/no-danger` and needs this rule too.
    //
    // No directory carve-out (plan §設計方針 4): test files are
    // deliberately IN scope (zero false positives observed as of this
    // PR); only `spikes/**` (vendored ECharts dist bundle, see `ignores`
    // below) is excluded workspace-wide. If a legitimate exception is
    // ever needed, use a line-level `eslint-disable-next-line` with a
    // reason comment, not a directory-level carve-out.
    //
    // Computed-property coverage (Codex round-1 review Major-2, widened by
    // Codex round-2 review P1-2): every selector below is listed in up to
    // three forms -- a `.property.name` form for static member access
    // (`el.innerHTML = x`), a `.property.value` form for computed/bracket
    // access with a string literal key (`el["innerHTML"] = x`,
    // `document["write"](x)`), and a `.property.type='TemplateLiteral'`
    // form for computed/bracket access with a no-substitution template
    // literal key (`el[\`innerHTML\`] = x`, `document[\`write\`](x)`).
    // The template-literal form is restricted to `expressions.length=0`
    // (no `${...}` interpolation) because only then is the key statically
    // known; a template literal WITH interpolation degrades to the same
    // fully-dynamic case as a bare variable key below.
    // Fully dynamic computed access with a *non-literal, non-static-template*
    // key (`el[varName] = html`, `` el[`${varName}`] = html ``) is NOT
    // detectable by static AST selectors and is an acknowledged, permanent
    // residual gap of this approach (plan §やらないこと) -- this comment is
    // the authoritative statement of that gap so a future reader does not
    // mistake this rule for exhaustive coverage.
    files: ["packages/*/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.computed=false][left.property.name=/^(innerHTML|outerHTML)$/]",
          message:
            "Renderer DOM construction must use textContent/createElement only (plan §設計方針 6). Direct innerHTML/outerHTML assignment is an XSS sink.",
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.computed=true][left.property.value=/^(innerHTML|outerHTML)$/]",
          message:
            "Renderer DOM construction must use textContent/createElement only (plan §設計方針 6). Computed-property innerHTML/outerHTML assignment (el['innerHTML']=...) is an XSS sink.",
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.computed=true][left.property.type='TemplateLiteral'][left.property.expressions.length=0][left.property.quasis.0.value.cooked=/^(innerHTML|outerHTML)$/]",
          message:
            "Renderer DOM construction must use textContent/createElement only (plan §設計方針 6). Computed-property innerHTML/outerHTML assignment (el[`innerHTML`]=...) is an XSS sink.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; use textContent/createElement instead (plan §設計方針 6).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; use textContent/createElement instead (plan §設計方針 6). Computed-property call form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; use textContent/createElement instead (plan §設計方針 6). Computed-property call form detected (el[`insertAdjacentHTML`](...)).",
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.computed=false][left.property.name='srcdoc']",
          message:
            "Assigning to `srcdoc` on an iframe is an XSS sink (arbitrary HTML/script execution in the iframe's context).",
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.computed=true][left.property.value='srcdoc']",
          message:
            "Assigning to `srcdoc` on an iframe is an XSS sink. Computed-property assignment form detected.",
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.computed=true][left.property.type='TemplateLiteral'][left.property.expressions.length=0][left.property.quasis.0.value.cooked='srcdoc']",
          message:
            "Assigning to `srcdoc` on an iframe is an XSS sink. Computed-property assignment form detected (el[`srcdoc`]=...).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink and blocks streaming parsing; use DOM APIs instead.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='document'][callee.property.value=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink. Computed-property call form detected (document['write'](...)).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='document'][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink. Computed-property call form detected (document[`write`](...)).",
        },
        {
          selector: "NewExpression[callee.name='DOMParser']",
          message:
            "DOMParser().parseFromString(untrustedHtml, ...) is an XSS sink; parsed nodes must never be inserted into the live document without sanitization.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink (parses and can execute script); use textContent/createElement instead.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink. Computed-property call form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink. Computed-property call form detected (el[`createContextualFragment`](...)).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML', ...) is an XSS sink equivalent to a direct property assignment.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='setAttribute'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=/^(srcdoc|innerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML', ...) is an XSS sink equivalent to a direct property assignment. Template-literal argument form detected (setAttribute(`srcdoc`, ...)).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML', ...) is an XSS sink. Computed-property call form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='setAttribute'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=/^(srcdoc|innerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML', ...) is an XSS sink. Computed-property call form detected with template-literal argument.",
        },
        {
          // Codex round-2 review (post-P1-2 fix verification): every other
          // sink above received all three computed-callee forms
          // (`.name` / `.value` / `.type='TemplateLiteral'`), but
          // `setAttribute`'s callee only received the first two --
          // `el[\`setAttribute\`]('srcdoc', ...)` slipped through. This entry
          // is the missing third form.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML', ...) is an XSS sink. Computed-property call form detected (el[`setAttribute`](...)).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='setAttribute'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=/^(srcdoc|innerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML', ...) is an XSS sink. Computed-property call form detected with template-literal callee and argument (el[`setAttribute`](`srcdoc`, ...)).",
        },
        {
          // Codex round-2 review P1-3: direct eval() plus the statically
          // reachable `window.`/`globalThis.`/`self.` receiver forms --
          // all four resolve to the exact same global `eval` in a browser
          // context. A receiver behind an arbitrary expression
          // (`obj.eval(...)` where obj is neither of these three known
          // globals) is out of scope for the same reason as the
          // fully-dynamic computed-property gap documented above.
          selector: "CallExpression[callee.name='eval']",
          message:
            "eval() executes arbitrary strings as code; it is never a legitimate rendering primitive in this codebase.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='eval'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "eval() executes arbitrary strings as code; it is never a legitimate rendering primitive in this codebase. (window/globalThis/self.eval(...) form detected.)",
        },
        {
          // Security Review (audit round 2, Low finding): idiomatic
          // TypeScript global access via `(window as SomeType).eval(...)`
          // wraps the receiver in a TSAsExpression, so `callee.object.name`
          // above is undefined and the selector doesn't match -- exactly
          // the class of gap plan §Phase 8 M1 warns against (a comment
          // asserting coverage that a common TS idiom quietly defeats).
          // Scoped to this cast form only; angle-bracket casts and
          // non-null assertions on window/globalThis/self are a further,
          // accepted residual gap (same class as the fully-dynamic
          // computed-property gap documented above).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='eval'][callee.object.type='TSAsExpression'][callee.object.expression.name=/^(window|globalThis|self)$/]",
          message:
            "eval() executes arbitrary strings as code. ((window as T).eval(...) cast form detected.)",
        },
        {
          // `Function(code)` (no `new`) still constructs and returns a
          // callable function from a string body -- identical code-execution
          // risk to `new Function(...)`, just invoked without the `new`
          // keyword (valid per spec: `Function` behaves the same called
          // with or without `new`).
          selector: "NewExpression[callee.name='Function']",
          message:
            "new Function(...) executes arbitrary strings as code, same class of risk as eval().",
        },
        {
          selector: "CallExpression[callee.name='Function']",
          message:
            "Function(...) (called without `new`) executes arbitrary strings as code, same class of risk as eval(). `Function` behaves identically called with or without `new`.",
        },
        {
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='Function'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "new Function(...) executes arbitrary strings as code, same class of risk as eval(). (window/globalThis/self.Function(...) form detected.)",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='Function'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code, same class of risk as eval(). (window/globalThis/self.Function(...) form detected, called without `new`.)",
        },
        {
          // Security Review (audit round 2, Low finding): same
          // TSAsExpression cast gap as eval() above, for `new Function`.
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='Function'][callee.object.type='TSAsExpression'][callee.object.expression.name=/^(window|globalThis|self)$/]",
          message:
            "new Function(...) executes arbitrary strings as code. ((window as T).Function(...) cast form detected.)",
        },
        {
          // Security Review (audit round 2, Low finding): same
          // TSAsExpression cast gap as eval() above, for `Function(...)`
          // called without `new`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='Function'][callee.object.type='TSAsExpression'][callee.object.expression.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. ((window as T).Function(...) cast form detected, called without `new`.)",
        },
      ],
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "spikes/**"],
  },
];
