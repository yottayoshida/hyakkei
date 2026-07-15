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
      // #63 audit-round-2 follow-up research: declaring these lets
      // `no-eval`'s global-object walk (`reportAccessingEvalViaGlobalObject`,
      // which resolves `window`/`global`/`globalThis` via
      // `getVariableByName` against whatever this `globals` map declares)
      // catch `window.eval(...)`, `window["eval"](...)`, and
      // `` window[`eval`](...) `` for free -- empirically verified: with no
      // globals declared, `no-eval` alone leaves all three of those forms
      // unflagged. Note this does NOT extend to `self`: `no-eval`'s
      // internal `candidatesOfGlobalObject` list is hardcoded to
      // `["global", "window", "globalThis"]` and omits `self` regardless of
      // what is declared here (verified by reading the rule source and by
      // probing `self.eval(x)` with `self` declared -- still unflagged by
      // `no-eval`); the custom `self.eval(...)` selector below remains
      // load-bearing for that one receiver name. `self` is still declared
      // here because it is a legitimate browser global in its own right
      // (used elsewhere as a plain identifier), not because `no-eval` reads
      // it. `no-new-func` has no analogous global-object-walking logic at
      // all, so this declaration does not extend its coverage either; the
      // `window/globalThis/self.Function(...)` custom selectors below
      // remain fully load-bearing regardless of this globals list.
      globals: {
        window: "readonly",
        self: "readonly",
        global: "readonly",
        globalThis: "readonly",
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
      // #63 audit-round-2 follow-up research: additive defense-in-depth via
      // scope analysis rather than AST-pattern enumeration. Empirically
      // verified zero false positives across the full codebase (`npx eslint
      // .` with both rules added produced no findings attributable to
      // either -- only the DOM-sink `no-restricted-syntax` cluster below has
      // any history of false positives, and these two rules are unrelated to
      // it). Default options (no `allowIndirect`), so indirect forms are
      // checked: `no-eval` additionally catches `const y = eval; y(x)`,
      // `(0, eval)(x)`, `eval.call(...)`, `eval.apply(...)`, and
      // `Reflect.apply(eval, ...)`; `no-new-func` additionally catches
      // `Function.call/apply/bind(...)` and `new (Function.bind(...))()`.
      // None of the hand-written eval/Function selectors below ever covered
      // these reference-reassignment/indirection forms -- pattern-matching a
      // literal `eval(...)`/`Function(...)` call shape structurally cannot
      // see them. This closes that whole class via the language's scope
      // model instead of enumerating more patterns. See the residual-gap
      // comments on the surviving custom eval/Function selectors below for
      // exactly what these two core rules still do NOT reach.
      //
      // Asymmetric residual gap (Security Review, audit-round-2 follow-up):
      // `no-eval` reports *every* reference to `eval`, including a bare
      // variable holding it (`const y = eval; y(x)` fires, confirmed above).
      // `no-new-func` only reports `Function` at a callee position or a
      // `.call/.apply/.bind` receiver (source: node_modules/eslint/lib/rules/
      // no-new-func.js) -- a bare reassignment (`const F = Function; new
      // F(x)` or `F(x)`) sits at a VariableDeclarator init position, which
      // the rule never visits, so it is NOT flagged (confirmed empirically).
      // This is the same class of accepted residual gap as the aliased-
      // receiver and dynamic-key gaps documented elsewhere in this file --
      // it requires a deliberately obfuscated call site, not an accidental
      // one, and is a defense-in-depth trip-wire, not the primary XSS
      // boundary (which is the renderer's textContent/createElement-only
      // construction). Documented here instead of "fixed" per Security's own
      // recommendation, since `no-new-func`'s source has no equivalent to
      // `no-eval`'s reference-walking logic to hook into.
      "no-eval": "error",
      "no-new-func": "error",
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
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      // Follow-up review (post-#78 merge, re-review round): the plugin's
      // own `flat.recommended` preset ships `exhaustive-deps` at `"warn"`,
      // and this repo's `lint` script (`eslint .`, no `--max-warnings`)
      // does not fail on warnings -- so CI's lint step could not have
      // caught issue #55's ref-read-in-cleanup bug even after this rule
      // was enabled (empirically verified: a probe component with a
      // missing dependency produced exit code 0). That was the commit's
      // own stated motivation for enabling react-hooks in the first
      // place, so it must actually gate CI. Promoted to `"error"`.
      "react-hooks/exhaustive-deps": "error",
    },
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
    // Follow-up review (post-#78 merge, re-review round): the glob below
    // used to be `packages/*/src/**/*.{ts,tsx}` only, which contradicted
    // this very comment -- it silently excluded `e2e/**/*.ts` (real
    // Playwright spec/config files) and package-root config files like
    // `packages/app/vite.config.ts`/`playwright.config.ts` (empirically
    // verified: a DOM-sink snippet placed in `e2e/foo.spec.ts` produced
    // zero findings before this widening). Extended to cover both so the
    // comment's claim and the glob's actual behavior match.
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
    // residual gap of this approach (plan §Out of scope) -- this comment is
    // the authoritative statement of that gap so a future reader does not
    // mistake this rule for exhaustive coverage.
    files: ["packages/*/src/**/*.{ts,tsx}", "e2e/**/*.ts", "*.config.ts", "packages/*/*.config.ts"],
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
          // Follow-up review (post-#78 merge, re-review round): unlike every
          // other sink in this file, DOMParser never received the
          // window/globalThis/self-receiver or computed-property forms --
          // `new window['DOMParser']()` and `new self.DOMParser()` both
          // bypassed the bare-identifier selector above (empirically
          // verified). Dot-form receiver-qualified sibling.
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='DOMParser'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "DOMParser().parseFromString(untrustedHtml, ...) is an XSS sink. (window/globalThis/self.DOMParser() form detected.)",
        },
        {
          // Computed/bracket sibling (`new window['DOMParser']()`).
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='DOMParser'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "DOMParser().parseFromString(untrustedHtml, ...) is an XSS sink. (window/globalThis/self['DOMParser'](...) computed-property form detected.)",
        },
        {
          // No-substitution template-literal computed sibling
          // (`` new window[`DOMParser`]() ``).
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='DOMParser'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "DOMParser().parseFromString(untrustedHtml, ...) is an XSS sink. (window/globalThis/self[`DOMParser`](...) computed-property form detected.)",
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
          // Technical note (#63 audit-round-2 follow-up research; follow-up
          // review post-#78 merge added `outerHTML` to this note): only
          // `srcdoc` is a genuine XSS sink here -- it is a real HTML content
          // attribute that the browser reflects onto the iframe and parses
          // as markup. `innerHTML`/`outerHTML` are DOM *properties* only;
          // neither has content-attribute reflection, so
          // `setAttribute('innerHTML'|'outerHTML', x)` just creates an
          // inert, meaningless custom attribute on the element and does
          // nothing dangerous. This selector still flags
          // `setAttribute('innerHTML'|'outerHTML', ...)` on purpose
          // (deliberately over-broad): writing either call is a strong
          // signal the author actually meant the `.innerHTML`/`.outerHTML`
          // property setter and reached for the wrong API, so it is worth
          // catching as a likely bug even though neither is itself
          // exploitable. `outerHTML` was originally omitted from this
          // selector's argument-value filter -- an inconsistency with every
          // other sink family in this file (AssignmentExpression,
          // Reflect.set, Object.assign, Object.defineProperty/defineProperties
          // all already treated innerHTML/outerHTML/srcdoc as one group) --
          // found and closed in a follow-up review. If a legitimate reason
          // to set a custom "innerHTML"/"outerHTML" attribute ever comes up,
          // use `eslint-disable-next-line` with a reason comment rather than
          // relaxing this selector.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc', ...) is an XSS sink: srcdoc is a real HTML content attribute reflected into the iframe and parsed as markup. setAttribute('innerHTML'|'outerHTML', ...) is NOT an XSS sink (neither has content-attribute reflection; this just creates an inert custom attribute) -- flagged anyway because it is very likely a mistaken attempt at the `.innerHTML`/`.outerHTML` property setter.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='setAttribute'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc', ...) is an XSS sink: srcdoc is a real HTML content attribute reflected into the iframe and parsed as markup. setAttribute('innerHTML'|'outerHTML', ...) is NOT an XSS sink (neither has content-attribute reflection) -- flagged anyway as a likely mistaken `.innerHTML`/`.outerHTML` property setter. Template-literal argument form detected (setAttribute(`srcdoc`, ...)).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc', ...) is an XSS sink: srcdoc is a real HTML content attribute reflected into the iframe and parsed as markup. setAttribute('innerHTML'|'outerHTML', ...) is NOT an XSS sink (neither has content-attribute reflection) -- flagged anyway as a likely mistaken `.innerHTML`/`.outerHTML` property setter. Computed-property call form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='setAttribute'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc', ...) is an XSS sink: srcdoc is a real HTML content attribute reflected into the iframe and parsed as markup. setAttribute('innerHTML'|'outerHTML', ...) is NOT an XSS sink (neither has content-attribute reflection) -- flagged anyway as a likely mistaken `.innerHTML`/`.outerHTML` property setter. Computed-property call form detected with template-literal argument.",
        },
        {
          // Codex round-2 review (post-P1-2 fix verification): every other
          // sink above received all three computed-callee forms
          // (`.name` / `.value` / `.type='TemplateLiteral'`), but
          // `setAttribute`'s callee only received the first two --
          // `el[\`setAttribute\`]('srcdoc', ...)` slipped through. This entry
          // is the missing third form.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc', ...) is an XSS sink: srcdoc is a real HTML content attribute reflected into the iframe and parsed as markup. setAttribute('innerHTML'|'outerHTML', ...) is NOT an XSS sink (neither has content-attribute reflection) -- flagged anyway as a likely mistaken `.innerHTML`/`.outerHTML` property setter. Computed-property call form detected (el[`setAttribute`](...)).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='setAttribute'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc', ...) is an XSS sink: srcdoc is a real HTML content attribute reflected into the iframe and parsed as markup. setAttribute('innerHTML'|'outerHTML', ...) is NOT an XSS sink (neither has content-attribute reflection) -- flagged anyway as a likely mistaken `.innerHTML`/`.outerHTML` property setter. Computed-property call form detected with template-literal callee and argument (el[`setAttribute`](`srcdoc`, ...)).",
        },
        {
          // Codex round-2 review P1-3 originally added a direct
          // `CallExpression[callee.name='eval']` selector here, plus a
          // sibling for the `window.`/`globalThis.`/`self.eval(...)`
          // receiver forms. #63 audit-round-2 follow-up research: the direct
          // form, and the `window`/`global`/`globalThis` receiver forms, are
          // now redundant and have been removed -- the core `no-eval` rule
          // (added above, with `window`/`self`/`global`/`globalThis`
          // declared in `languageOptions.globals`) catches the direct form
          // AND those three declared-global receiver forms, PLUS indirection
          // forms (`const y = eval; y(x)`, `(0, eval)(x)`, `eval.call(...)`,
          // `eval.apply(...)`, `Reflect.apply(eval, ...)`) that no
          // hand-written selector here ever covered.
          //
          // `self.eval(...)` (non-cast form) is NOT covered by `no-eval` and
          // is NOT redundant -- verified by reading the rule source
          // (`node_modules/eslint/lib/rules/no-eval.js`):
          // `candidatesOfGlobalObject = ["global", "window", "globalThis"]`
          // is a hardcoded list that omits `self` entirely, so no amount of
          // `languageOptions.globals` configuration makes `no-eval` walk a
          // `self.eval(...)` receiver (confirmed empirically: declaring
          // `self` as a global does not make `no-eval` flag `self.eval(x)`,
          // while `window.eval(x)`/`globalThis.eval(x)` are flagged). This
          // selector is the sole remaining guard for that one receiver name.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='eval'][callee.object.name='self']",
          message:
            "eval() executes arbitrary strings as code; it is never a legitimate rendering primitive in this codebase. (self.eval(...) form detected -- no-eval's global-object detection does not cover `self`, only window/global/globalThis.)",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: the dot-form
          // `self.eval(...)` selector immediately above does not extend to
          // a computed/bracket receiver (`self['eval'](...)`). Unlike
          // `window`/`global`/`globalThis`, `no-eval`'s hardcoded
          // `candidatesOfGlobalObject` list never walks `self` in ANY form
          // (dot or bracket), so this is exclusively custom-selector
          // territory for `self`, same as the dot-form case.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='eval'][callee.object.name='self']",
          message:
            "eval() executes arbitrary strings as code. (self['eval'](...) computed-property form detected -- no-eval's global-object detection does not cover `self` in any form.)",
        },
        {
          // Same as above for a no-substitution template-literal computed
          // property (`` self[`eval`](...) ``).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='eval'][callee.object.name='self']",
          message:
            "eval() executes arbitrary strings as code. (self[`eval`](...) computed-property form detected -- no-eval's global-object detection does not cover `self` in any form.)",
        },
        {
          // Security Review (audit round 2, Low finding): idiomatic
          // TypeScript global access via `(window as SomeType).eval(...)`
          // wraps the receiver in a TSAsExpression, so `no-eval`'s
          // one-level-up parent walk never reaches the enclosing
          // MemberExpression -- exactly the class of gap plan §Phase 8 M1
          // warns against (a comment asserting coverage that a common TS
          // idiom quietly defeats). Scoped to this cast form only;
          // angle-bracket casts and non-null assertions on
          // window/globalThis/self are a further, accepted residual gap
          // (same class as the fully-dynamic computed-property gap
          // documented above).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='eval'][callee.object.type='TSAsExpression'][callee.object.expression.name=/^(window|globalThis|self)$/]",
          message:
            "eval() executes arbitrary strings as code. ((window as T).eval(...) cast form detected.)",
        },
        {
          // Follow-up review (post-#78 merge, re-review round): the cast
          // selector above requires `callee.computed=false` (dot access
          // after the cast). `(window as T)['eval'](...)` -- bracket access
          // on the exact same cast receiver -- bypassed it entirely
          // (empirically verified: 0 findings before this selector was
          // added). Computed/bracket sibling of the dot-form cast selector.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='eval'][callee.object.type='TSAsExpression'][callee.object.expression.name=/^(window|globalThis|self)$/]",
          message:
            "eval() executes arbitrary strings as code. ((window as T)['eval'](...) cast + computed-property form detected.)",
        },
        {
          // Follow-up review: the cast selectors above require
          // `callee.object.expression` to be a plain Identifier -- i.e. only
          // a single-hop cast (`window as T`). TypeScript itself forces a
          // double cast (`window as unknown as T`) whenever the target type
          // doesn't structurally overlap the source, which is the MORE
          // common real-world form for this exact idiom, not an edge case --
          // and it produces a nested TSAsExpression as `callee.object.
          // expression` instead of a bare Identifier, so the selectors above
          // never match it (empirically verified: 0 findings before this
          // selector was added). Dot-access sibling for the double-cast
          // shape.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='eval'][callee.object.type='TSAsExpression'][callee.object.expression.type='TSAsExpression'][callee.object.expression.expression.name=/^(window|globalThis|self)$/]",
          message:
            "eval() executes arbitrary strings as code. ((window as unknown as T).eval(...) double-cast form detected.)",
        },
        {
          // Computed/bracket sibling of the double-cast selector above
          // (`(window as unknown as T)['eval'](...)`).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='eval'][callee.object.type='TSAsExpression'][callee.object.expression.type='TSAsExpression'][callee.object.expression.expression.name=/^(window|globalThis|self)$/]",
          message:
            "eval() executes arbitrary strings as code. ((window as unknown as T)['eval'](...) double-cast + computed-property form detected.)",
        },
        {
          // Follow-up review: `self` has zero .call/.apply/.bind/
          // Reflect.apply indirection coverage even though the file
          // implements that exact indirection sweep for setAttribute/
          // insertAdjacentHTML/createContextualFragment/document.write.
          // `self.eval.call(null, code)` and `Reflect.apply(self.eval, self,
          // [code])` both bypassed every selector above (empirically
          // verified). `window`/`globalThis.eval` indirection forms are
          // already covered by core `no-eval`'s own indirection support
          // (verified: `window.eval.call(null, x)` is caught natively), so
          // this sweep is scoped to `self` only, consistent with every other
          // `self`-only selector in this file.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.object.name='self'][callee.object.property.name='eval']",
          message:
            "eval() executes arbitrary strings as code. (self.eval.call/.apply(...) -indirected invocation detected.)",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.object.name='self'][callee.object.property.value='eval']",
          message:
            "eval() executes arbitrary strings as code. (self['eval'].call/.apply(...) -indirected invocation detected. Computed-property sink-target form.)",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=false][callee.callee.object.object.name='self'][callee.callee.object.property.name='eval']",
          message:
            "eval() executes arbitrary strings as code. (self.eval.bind(...)(...) -indirected invocation detected.)",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.object.name='self'][arguments.0.property.name='eval']",
          message:
            "eval() executes arbitrary strings as code. (Reflect.apply(self.eval, ...) -indirected invocation detected.)",
        },
        {
          // #63 audit-round-2 follow-up research: direct `new Function(...)`
          // and direct `Function(...)` (no `new`) selectors formerly lived
          // here and have been removed -- the core `no-new-func` rule (added
          // above) catches both forms natively, PLUS the `.call`/`.apply`/
          // `.bind` indirection forms (`Function.call(null, x)`,
          // `Function.apply(null, [x])`, `new (Function.bind(null, x))()`)
          // that no hand-written selector here ever covered. `Function(code)`
          // (no `new`) still constructs and returns a callable function from
          // a string body -- identical code-execution risk to
          // `new Function(...)`, just invoked without the `new` keyword
          // (valid per spec: `Function` behaves the same called with or
          // without `new`), which is exactly why `no-new-func` treats both
          // the same way.
          //
          // What survives below is NOT redundant: `no-new-func` resolves
          // only the bare `Function` identifier via global-scope lookup and
          // has no analogous logic to `no-eval`'s global-object walk, so it
          // categorically cannot reach ANY `window/self/globalThis.Function`
          // form -- confirmed both with and without `window`/`self`/
          // `global`/`globalThis` declared in `languageOptions.globals`
          // (identical negative result either way, unlike `no-eval`).
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
          // Follow-up review (post-#78 merge, re-review round): computed/
          // bracket sibling of the cast selector above (`new (window as T)
          // ['Function'](...)`), same gap class already fixed for eval().
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='Function'][callee.object.type='TSAsExpression'][callee.object.expression.name=/^(window|globalThis|self)$/]",
          message:
            "new Function(...) executes arbitrary strings as code. ((window as T)['Function'](...) cast + computed-property form detected.)",
        },
        {
          // Double-cast (`window as unknown as T`) sibling of the cast
          // selector above, same gap class already fixed for eval().
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='Function'][callee.object.type='TSAsExpression'][callee.object.expression.type='TSAsExpression'][callee.object.expression.expression.name=/^(window|globalThis|self)$/]",
          message:
            "new Function(...) executes arbitrary strings as code. ((window as unknown as T).Function(...) double-cast form detected.)",
        },
        {
          // Computed/bracket sibling of the double-cast selector above.
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='Function'][callee.object.type='TSAsExpression'][callee.object.expression.type='TSAsExpression'][callee.object.expression.expression.name=/^(window|globalThis|self)$/]",
          message:
            "new Function(...) executes arbitrary strings as code. ((window as unknown as T)['Function'](...) double-cast + computed-property form detected.)",
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
        {
          // Computed/bracket sibling, called without `new`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='Function'][callee.object.type='TSAsExpression'][callee.object.expression.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. ((window as T)['Function'](...) cast + computed-property form detected, called without `new`.)",
        },
        {
          // Double-cast sibling, called without `new`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='Function'][callee.object.type='TSAsExpression'][callee.object.expression.type='TSAsExpression'][callee.object.expression.expression.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. ((window as unknown as T).Function(...) double-cast form detected, called without `new`.)",
        },
        {
          // Double-cast + computed/bracket sibling, called without `new`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='Function'][callee.object.type='TSAsExpression'][callee.object.expression.type='TSAsExpression'][callee.object.expression.expression.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. ((window as unknown as T)['Function'](...) double-cast + computed-property form detected, called without `new`.)",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: `no-new-func` has
          // no global-object-walking logic at all (unlike `no-eval`), so
          // unlike the `self.eval(...)` gap above -- which is `self`-only --
          // the `window/globalThis/self.Function(...)` dot-form selectors
          // above are the SOLE guard for every one of those three
          // receivers, and none of them extend to a computed/bracket
          // receiver property (`window['Function'](...)`). Covers
          // `new window['Function'](...)`.
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='Function'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "new Function(...) executes arbitrary strings as code, same class of risk as eval(). (window/globalThis/self['Function'](...) computed-property form detected.)",
        },
        {
          // Same as above, called without `new` (`window['Function'](...)`
          // returns a callable function, same risk as `new`).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='Function'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code, same class of risk as eval(). (window/globalThis/self['Function'](...) computed-property form detected, called without `new`.)",
        },
        {
          // Same as above for a no-substitution template-literal computed
          // property (`` new window[`Function`](...) ``).
          selector:
            "NewExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='Function'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "new Function(...) executes arbitrary strings as code. (window/globalThis/self[`Function`](...) computed-property form detected.)",
        },
        {
          // Same as above, called without `new`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='Function'][callee.object.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. (window/globalThis/self[`Function`](...) computed-property form detected, called without `new`.)",
        },
        {
          // Codex round-1 review, Thesis-aligned finding:
          // `Reflect.construct(Function, [code])()` is functionally
          // equivalent to `new Function(code)` -- `Reflect.construct`
          // invokes its first argument as a constructor with the argument
          // list from its second argument -- but is a plain CallExpression
          // to `Reflect.construct`, not a `NewExpression` with callee
          // `Function`, so neither `no-new-func` nor any selector above
          // (which all key on `Function` appearing as a callee/property
          // name being invoked, not as a *value* passed to another
          // function) can see it. Flags the `Reflect.construct(Function,
          // ...)` call itself, regardless of whether its result is
          // immediately invoked -- constructing the Function object from a
          // string body is already the dangerous step.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='construct'][arguments.0.name='Function']",
          message:
            "Reflect.construct(Function, [code]) constructs a callable function from a string body, same class of risk as `new Function(...)`/eval().",
        },
        {
          // Follow-up review (post-#78 merge, re-review round): unlike bare
          // `Function`, whose `.call`/`.apply`/`.bind`/`Reflect.apply`
          // indirection forms core `no-new-func` already catches natively,
          // `window/globalThis/self.Function` has NO indirection coverage at
          // all -- `no-new-func` has no global-object-walking logic (per the
          // comment above), so `window.Function.call(null, code)` bypassed
          // every selector in this file (empirically verified). Dot-form
          // sink-target sibling of the direct `window/globalThis/self.
          // Function(...)` selectors above.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='Function'][callee.object.object.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. (window/globalThis/self.Function.call/.apply(...) -indirected invocation detected.)",
        },
        {
          // Computed sink-target sibling (`window['Function'].call(...)`).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.value='Function'][callee.object.object.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. (window/globalThis/self['Function'].call/.apply(...) -indirected invocation detected. Computed-property sink-target form.)",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=false][callee.callee.object.property.name='Function'][callee.callee.object.object.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. (window/globalThis/self.Function.bind(...)(...) -indirected invocation detected.)",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.property.name='Function'][arguments.0.object.name=/^(window|globalThis|self)$/]",
          message:
            "Function(...) executes arbitrary strings as code. (Reflect.apply(window/globalThis/self.Function, ...) -indirected invocation detected.)",
        },
        // ---------------------------------------------------------------
        // #63 audit-round-2 follow-up research: CallExpression-argument
        // bypasses of the innerHTML/outerHTML/srcdoc property-write sinks.
        // `Reflect.set`, `Object.assign`, and `Object.defineProperty` all
        // perform the exact same [[Set]]/[[DefineOwnProperty]] write as
        // `el.innerHTML = x`, but the property name arrives as a string (or
        // object-literal key) *argument value* inside a CallExpression, not
        // as `left.property`/`callee.property` of an Assignment/Call, which
        // is the only shape every selector above matches on. This is why
        // `no-restricted-properties` was evaluated and rejected for this
        // whole cluster (see the scope-comment at the top of this rule
        // block): it only visits MemberExpression/ObjectPattern nodes, never
        // CallExpression arguments or ObjectExpression literal keys, so it
        // cannot see any of these three forms either. No core ESLint rule
        // covers this gap; it is exclusively custom-selector territory.
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='set'][arguments.1.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Reflect.set(el, 'innerHTML'|'outerHTML'|'srcdoc', ...) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write (innerHTML/outerHTML, flagged as a probable bug per the setAttribute rationale above).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='set'][arguments.1.type='TemplateLiteral'][arguments.1.expressions.length=0][arguments.1.quasis.0.value.cooked=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Reflect.set(el, 'innerHTML'|'outerHTML'|'srcdoc', ...) is an XSS sink / likely mistaken property write. Template-literal property-name argument form detected (Reflect.set(el, `innerHTML`, ...)).",
        },
        {
          // Codex round-1 review (post-batch): `Reflect['set'](...)` --
          // computed access to the *method name itself* -- bypassed the two
          // selectors above because they hardcode
          // `callee.property.name='set'` (non-computed only). Sibling
          // computed-property form of the callee, still requiring the
          // object identifier to be the literal name `Reflect` (a fully
          // dynamic `obj['set'](...)` where `obj` is not statically known
          // to be `Reflect` is the same permanent residual gap documented
          // at the top of this rule block).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='Reflect'][callee.property.value='set'][arguments.1.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Reflect['set'](el, 'innerHTML'|'outerHTML'|'srcdoc', ...) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed-property callee form detected.",
        },
        {
          // Follow-up review (post-#78 merge, re-review round): the
          // computed-callee sibling above only got the `.value` (bracket-
          // string) form -- `` Reflect[`set`](...) `` (template-literal
          // callee, no interpolation) bypassed it (empirically verified).
          // Every other CallExpression-based sink in this file (eval,
          // Function, insertAdjacentHTML, setAttribute) already received
          // this exact third computed-callee form; it was never propagated
          // to this Reflect/Object cluster.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='Reflect'][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='set'][arguments.1.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Reflect[`set`](el, 'innerHTML'|'outerHTML'|'srcdoc', ...) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed-property callee form detected (template-literal key).",
        },
        {
          // `Object.assign(el, { innerHTML: x })` merges an object
          // literal's own enumerable properties onto `el` via [[Set]] --
          // same write as a direct assignment, but the property name is an
          // ObjectExpression `Property` key nested inside a CallExpression
          // argument. `no-restricted-properties`'s ObjectPattern-only
          // visitor never sees this (it visits destructuring patterns, not
          // object *literals*). The `> ObjectExpression.arguments >
          // Property.properties` field-selector chain matches any property
          // position within a matched object literal (not just index 0/1),
          // so `Object.assign(el, { a: 1, innerHTML: x })` is caught too.
          //
          // Codex round-1 review (post-batch), Bug-fact finding: the
          // ObjectExpression.arguments segment previously had no position
          // restriction at all, so it also matched the FIRST argument --
          // the assignment *target*, not a merge source. That made
          // `Object.assign({ innerHTML: html }, defaults)` (plain object
          // construction passed as the target, not a DOM sink) a false
          // positive. `Object.assign`'s first argument is always the
          // mutation target and every subsequent argument is a merge
          // source (https://tc39.es/ecma262/#sec-object.assign) that gets
          // read from, not written to, at the key level -- an `innerHTML`
          // key in `arguments[0]` cannot cause the write this rule guards
          // against. `:not(:first-child)` restricts the object-literal
          // match to argument position >= 1 (merge sources only); esquery
          // (the selector engine ESLint's `no-restricted-syntax` uses) does
          // not support `:nth-child(n+2)`-style formulas, so `:not
          // (:first-child)` is the supported equivalent for "index >= 1".
          // This entry covers a bare identifier key (`{ innerHTML: x }`).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='assign'] > ObjectExpression.arguments:not(:first-child) > Property.properties[computed=false][key.name=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.assign(el, { innerHTML|outerHTML|srcdoc: ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write.",
        },
        {
          // Same as above, for a quoted string key (`{ 'innerHTML': x }`)
          // instead of a bare identifier key. Same `:not(:first-child)`
          // target-vs-source fix applied.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='assign'] > ObjectExpression.arguments:not(:first-child) > Property.properties[computed=false][key.type='Literal'][key.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.assign(el, { 'innerHTML'|'outerHTML'|'srcdoc': ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: a statically-known
          // *computed* object-literal key (`{ ['innerHTML']: x }`) has the
          // same `Property.computed=true` shape as a fully-dynamic key
          // (`{ [varName]: x }`) except that `key` is a `Literal` rather
          // than an arbitrary expression -- exactly the same
          // computed-vs-dynamic split already applied to every other sink
          // in this file. `:not(:first-child)` target-vs-source fix applies
          // here too.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='assign'] > ObjectExpression.arguments:not(:first-child) > Property.properties[computed=true][key.type='Literal'][key.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.assign(el, { ['innerHTML'|'outerHTML'|'srcdoc']: ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed object-literal key form detected.",
        },
        {
          // Same as above for a no-substitution template-literal computed
          // key (`{ [`innerHTML`]: x }`).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='assign'] > ObjectExpression.arguments:not(:first-child) > Property.properties[computed=true][key.type='TemplateLiteral'][key.expressions.length=0][key.quasis.0.value.cooked=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.assign(el, { [`innerHTML`|`outerHTML`|`srcdoc`]: ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed object-literal key form detected (template-literal key).",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: `Object['assign']
          // (...)` -- computed access to the method name -- sibling of the
          // `Reflect['set']` fix above. Reuses the same `:not(:first-child)`
          // target-vs-source restriction and covers both key forms (bare
          // identifier and quoted-string) via the `key.name`/`key.value`
          // alternation already used elsewhere in this file is not
          // available in a single selector, so this covers the bare
          // identifier key form; the quoted-string key form under a
          // computed `Object['assign']` callee is the compounding of two
          // independent bypasses (computed callee AND quoted key) and is
          // treated as the same class of acknowledged residual gap as the
          // fully-dynamic-key case documented at the top of this block.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='Object'][callee.property.value='assign'] > ObjectExpression.arguments:not(:first-child) > Property.properties[computed=false][key.name=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object['assign'](el, { innerHTML|outerHTML|srcdoc: ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed-property callee form detected.",
        },
        {
          // Follow-up review (post-#78 merge, re-review round): sibling of
          // the computed-callee selector above using a template-literal
          // callee (`` Object[`assign`](...) ``) instead of a bracket-string
          // callee -- same gap already fixed for `Reflect.set` above.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='Object'][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='assign'] > ObjectExpression.arguments:not(:first-child) > Property.properties[computed=false][key.name=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object[`assign`](el, { innerHTML|outerHTML|srcdoc: ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed-property callee form detected (template-literal key).",
        },
        {
          // `Object.defineProperty(el, 'innerHTML', { value: x })` (or a
          // getter/setter descriptor) also performs the same property
          // definition as a direct assignment. Property name is
          // `arguments[1]`, a Literal/TemplateLiteral -- same
          // argument-position gap as `Reflect.set` above.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='defineProperty'][arguments.1.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.defineProperty(el, 'innerHTML'|'outerHTML'|'srcdoc', ...) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='defineProperty'][arguments.1.type='TemplateLiteral'][arguments.1.expressions.length=0][arguments.1.quasis.0.value.cooked=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.defineProperty(el, 'innerHTML'|'outerHTML'|'srcdoc', ...) is an XSS sink / likely mistaken property write. Template-literal property-name argument form detected.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: `Object
          // ['defineProperty'](...)` computed-callee sibling.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='Object'][callee.property.value='defineProperty'][arguments.1.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object['defineProperty'](el, 'innerHTML'|'outerHTML'|'srcdoc', ...) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed-property callee form detected.",
        },
        {
          // Follow-up review (post-#78 merge, re-review round): template-
          // literal-callee sibling (`` Object[`defineProperty`](...) ``),
          // same gap already fixed for `Reflect.set`/`Object.assign` above.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='Object'][callee.property.type='TemplateLiteral'][callee.property.expressions.length=0][callee.property.quasis.0.value.cooked='defineProperty'][arguments.1.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object[`defineProperty`](el, 'innerHTML'|'outerHTML'|'srcdoc', ...) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed-property callee form detected (template-literal key).",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: `Object
          // .defineProperties(el, { innerHTML: { value: x }, ... })` is the
          // plural, batched-descriptor-map sibling of `defineProperty` --
          // same [[DefineOwnProperty]] write, but the property name is a
          // `Property` key inside the descriptor-map ObjectExpression
          // (`arguments[1]`), not a string argument value. `:nth-child(2)`
          // (esquery's 1-indexed sibling-position pseudo-class) restricts
          // the match to exactly the second argument -- the descriptor map
          // -- so this cannot false-positive the way the unrestricted
          // `Object.assign` selector originally did.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='defineProperties'] > ObjectExpression.arguments:nth-child(2) > Property.properties[computed=false][key.name=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.defineProperties(el, { innerHTML|outerHTML|srcdoc: {...}, ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write.",
        },
        {
          // Same as above for a quoted-string descriptor-map key.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='defineProperties'] > ObjectExpression.arguments:nth-child(2) > Property.properties[computed=false][key.type='Literal'][key.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.defineProperties(el, { 'innerHTML'|'outerHTML'|'srcdoc': {...}, ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write.",
        },
        {
          // Follow-up review (post-#78 merge, re-review round):
          // `Object.defineProperties` only received the identifier-key and
          // quoted-string-key forms above -- it never received the
          // computed-callee (`Object['defineProperties'](...)`) or
          // computed-key (`{ ['innerHTML']: {...} }`) forms that its
          // near-twin `Object.assign` has (both empirically verified to
          // bypass before this selector was added). Computed-callee,
          // identifier-key sibling.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.object.name='Object'][callee.property.value='defineProperties'] > ObjectExpression.arguments:nth-child(2) > Property.properties[computed=false][key.name=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object['defineProperties'](el, { innerHTML|outerHTML|srcdoc: {...}, ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed-property callee form detected.",
        },
        {
          // Dot-callee, computed descriptor-map key (`{ ['innerHTML']:
          // {...} }`) sibling, mirroring Object.assign's equivalent form.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='defineProperties'] > ObjectExpression.arguments:nth-child(2) > Property.properties[computed=true][key.type='Literal'][key.value=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.defineProperties(el, { ['innerHTML'|'outerHTML'|'srcdoc']: {...}, ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed descriptor-map key form detected.",
        },
        {
          // Dot-callee, no-substitution template-literal descriptor-map key
          // (`{ [\`innerHTML\`]: {...} }`) sibling.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Object'][callee.property.name='defineProperties'] > ObjectExpression.arguments:nth-child(2) > Property.properties[computed=true][key.type='TemplateLiteral'][key.expressions.length=0][key.quasis.0.value.cooked=/^(innerHTML|outerHTML|srcdoc)$/]",
          message:
            "Object.defineProperties(el, { [`innerHTML`|`outerHTML`|`srcdoc`]: {...}, ... }) performs the same property write as a direct assignment and is an XSS sink (srcdoc) or a likely mistaken `.innerHTML`/`.outerHTML` property write. Computed descriptor-map key form detected (template-literal key).",
        },
        // ---------------------------------------------------------------
        // #63 audit-round-2 follow-up research, design principle: the
        // `.call`/`.apply`/`.bind`-indirected invocation hole found on
        // `setAttribute` (Codex round-2 P1-3 precedent, addressed above via
        // the eval/Function selectors) is structurally identical for every
        // OTHER CallExpression-form sink in this file --
        // `insertAdjacentHTML`, `createContextualFragment`, and
        // `document.write`/`writeln` -- because all four are plain method
        // calls, and `el.method(...)`, `el.method.call(thisArg, ...)`,
        // `el.method.apply(thisArg, [...])`, `el.method.bind(thisArg)(...)`,
        // and `Reflect.apply(el.method, thisArg, [...])` are five different
        // syntactic routes to invoking the exact same function. Addressed
        // here consistently for all four, not just setAttribute, so the
        // same gap cannot resurface piecemeal one sink at a time (the
        // pattern that produced Codex round-1/round-2 findings on this file
        // previously). `insertAdjacentHTML`/`createContextualFragment`/
        // `document.write`/`writeln` are unconditional sinks (no argument
        // value determines danger, unlike setAttribute), so their
        // indirection selectors need no argument-value filter; only
        // `setAttribute`'s indirection selectors reproduce the existing
        // srcdoc/innerHTML argument-value filter, per the design note in
        // the task list this batch was scoped from (a bare
        // `no-restricted-properties`-style blanket block on `setAttribute`
        // would also flag every legitimate `setAttribute('role', ...)`/
        // `setAttribute('scope', ...)` call in this codebase).
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; .call/.apply-indirected invocation (el.insertAdjacentHTML.call(...)/.apply(...)) is not a legitimate rendering primitive.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: the dot-form
          // `.call/.apply`-indirection selector above requires
          // `callee.object.property.name` (non-computed target), so a
          // statically-known computed/bracket sink target
          // (`el['insertAdjacentHTML'].call(...)`) bypassed it. Sibling
          // computed-property form of the *indirected member's* target.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.value='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; .call/.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (el['insertAdjacentHTML'].call/.apply(...)).",
        },
        {
          // Same as above for a no-substitution template-literal computed
          // sink target (`` el[`insertAdjacentHTML`].call(...) ``).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.type='TemplateLiteral'][callee.object.property.expressions.length=0][callee.object.property.quasis.0.value.cooked='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; .call/.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=false][callee.callee.object.property.name='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: computed sink
          // target sibling of the `.bind(...)(...)` selector above.
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=true][callee.callee.object.property.value='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=true][callee.callee.object.property.type='TemplateLiteral'][callee.callee.object.property.expressions.length=0][callee.callee.object.property.quasis.0.value.cooked='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.property.name='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: computed sink
          // target sibling of the `Reflect.apply(...)` selector above --
          // `Reflect.apply(el['insertAdjacentHTML'], ...)`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=true][arguments.0.property.value='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=true][arguments.0.property.type='TemplateLiteral'][arguments.0.property.expressions.length=0][arguments.0.property.quasis.0.value.cooked='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; .call/.apply-indirected invocation is not a legitimate rendering primitive.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.value='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; .call/.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.type='TemplateLiteral'][callee.object.property.expressions.length=0][callee.object.property.quasis.0.value.cooked='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; .call/.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=false][callee.callee.object.property.name='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive.",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=true][callee.callee.object.property.value='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=true][callee.callee.object.property.type='TemplateLiteral'][callee.callee.object.property.expressions.length=0][callee.callee.object.property.quasis.0.value.cooked='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.property.name='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=true][arguments.0.property.value='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=true][arguments.0.property.type='TemplateLiteral'][arguments.0.property.expressions.length=0][arguments.0.property.quasis.0.value.cooked='createContextualFragment']",
          message:
            "Range.createContextualFragment is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.object.name='document'][callee.object.property.name=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; .call/.apply-indirected invocation is not a legitimate rendering primitive.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: computed
          // `document['write']`/`document['writeln']` sink-target sibling.
          // `document` itself (the outer object) staying a plain identifier
          // is an accepted scope limit consistent with every other selector
          // in this file -- a further-aliased/computed `document` receiver
          // is the same class of fully-dynamic-receiver residual gap
          // documented at the top of this rule block.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.object.name='document'][callee.object.property.value=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; .call/.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (document['write'/'writeln'].call/.apply(...)).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(call|apply)$/][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.object.name='document'][callee.object.property.type='TemplateLiteral'][callee.object.property.expressions.length=0][callee.object.property.quasis.0.value.cooked=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; .call/.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=false][callee.callee.object.object.name='document'][callee.callee.object.property.name=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive.",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=true][callee.callee.object.object.name='document'][callee.callee.object.property.value=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=true][callee.callee.object.object.name='document'][callee.callee.object.property.type='TemplateLiteral'][callee.callee.object.property.expressions.length=0][callee.callee.object.property.quasis.0.value.cooked=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; .bind(...)(...) -indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.object.name='document'][arguments.0.property.name=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=true][arguments.0.object.name='document'][arguments.0.property.value=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=true][arguments.0.object.name='document'][arguments.0.property.type='TemplateLiteral'][arguments.0.property.expressions.length=0][arguments.0.property.quasis.0.value.cooked=/^(write|writeln)$/]",
          message:
            "document.write/writeln is an XSS sink; Reflect.apply-indirected invocation is not a legitimate rendering primitive. Computed-property sink-target form detected (template-literal key).",
        },
        {
          // setAttribute's indirection forms, unlike the three above,
          // reproduce the existing srcdoc/innerHTML argument-value filter
          // (see the technical note on the direct setAttribute selectors
          // above for why innerHTML is flagged as a likely-mistake, not a
          // genuine sink). `.call(thisArg, name, value)` shifts the
          // original arguments right by one, so the attribute name is
          // `arguments[1]` here (not `arguments[0]` as in the direct-call
          // selectors above).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='call'][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='setAttribute'][arguments.1.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).call(...)-indirected invocation is the same sink/likely-mistake as a direct setAttribute call; .call indirection does not evade this rule.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: computed
          // `el['setAttribute'].call(...)` sink-target sibling.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='call'][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.value='setAttribute'][arguments.1.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).call(...)-indirected invocation is the same sink/likely-mistake as a direct setAttribute call; .call indirection does not evade this rule. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='call'][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.type='TemplateLiteral'][callee.object.property.expressions.length=0][callee.object.property.quasis.0.value.cooked='setAttribute'][arguments.1.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).call(...)-indirected invocation is the same sink/likely-mistake as a direct setAttribute call; .call indirection does not evade this rule. Computed-property sink-target form detected (template-literal key).",
        },
        {
          // `.apply(thisArg, [name, value])` passes the original arguments
          // as an array literal, so the attribute name lives at
          // `arguments[1].elements[0]`, not `arguments[1]` directly.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='apply'][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='setAttribute'][arguments.1.type='ArrayExpression'][arguments.1.elements.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).apply(...)-indirected invocation is the same sink/likely-mistake as a direct setAttribute call; .apply indirection does not evade this rule.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: computed
          // `el['setAttribute'].apply(...)` sink-target sibling.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='apply'][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.value='setAttribute'][arguments.1.type='ArrayExpression'][arguments.1.elements.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).apply(...)-indirected invocation is the same sink/likely-mistake as a direct setAttribute call; .apply indirection does not evade this rule. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='apply'][callee.object.type='MemberExpression'][callee.object.computed=true][callee.object.property.type='TemplateLiteral'][callee.object.property.expressions.length=0][callee.object.property.quasis.0.value.cooked='setAttribute'][arguments.1.type='ArrayExpression'][arguments.1.elements.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).apply(...)-indirected invocation is the same sink/likely-mistake as a direct setAttribute call; .apply indirection does not evade this rule. Computed-property sink-target form detected (template-literal key).",
        },
        {
          // `el.setAttribute.bind(thisArg)(name, value)` is two nested
          // CallExpressions: the outer call's `callee` is itself the
          // `.bind(thisArg)` CallExpression, and the outer call's own
          // `arguments` are the real setAttribute args, so the attribute
          // name is back at `arguments[0]` (not shifted, unlike .call/.apply
          // above, because .bind's own arguments are the pre-bound ones,
          // not the eventually-supplied ones). This selector covers the
          // case where the attribute name is supplied at the OUTER
          // (eventually-invoked) call, i.e. `.bind(el)('srcdoc', html)`.
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=false][callee.callee.object.property.name='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).bind(...)(...) -indirected invocation is the same sink/likely-mistake as a direct setAttribute call; .bind indirection does not evade this rule.",
        },
        {
          // Codex round-1 review, Bug-fact finding: the selector above only
          // checks `arguments.0` of the OUTER (eventually-invoked) call.
          // `.bind(thisArg, name, value)` PRE-binds the name (and even the
          // value) as arguments to `.bind` itself, at which point the outer
          // call's own `arguments` array is empty (or shifted) and the
          // attribute name never appears at the outer call's
          // `arguments[0]` at all --
          // `el.setAttribute.bind(el, 'srcdoc', html)()` bypassed the
          // selector above entirely (verified: 0 matches with only that
          // selector present). `.bind`'s own call arguments are
          // `[thisArg, ...preBoundArgs]`, so a pre-bound attribute name
          // lives at `callee.arguments[1]` (index 0 is `thisArg`). This
          // selector is the sole guard for that pre-bound form; the two
          // forms are not mutually exclusive with the one above and do not
          // double-report on the same call site (verified: an
          // outer-supplied name never also appears at `callee.arguments[1]`
          // and vice versa).
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=false][callee.callee.object.property.name='setAttribute'][callee.arguments.1.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).bind(...)(...) -indirected invocation is the same sink/likely-mistake as a direct setAttribute call; pre-binding the attribute name as a .bind(...) argument (rather than supplying it at the eventual call) does not evade this rule.",
        },
        {
          // Template-literal form of the pre-bound-name case immediately
          // above (`el.setAttribute.bind(el, `srcdoc`, html)()`).
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=false][callee.callee.object.property.name='setAttribute'][callee.arguments.1.type='TemplateLiteral'][callee.arguments.1.expressions.length=0][callee.arguments.1.quasis.0.value.cooked=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).bind(...)(...) -indirected invocation is the same sink/likely-mistake as a direct setAttribute call; pre-binding the attribute name as a .bind(...) argument does not evade this rule. Template-literal argument form detected.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: computed
          // `el['setAttribute'].bind(...)(...)` sink-target sibling of the
          // two outer-arguments/pre-bound-arguments selectors above,
          // combined -- covers both where the name is supplied at the
          // outer call and where it is pre-bound, for a computed sink
          // target. (A computed target combined with a pre-bound
          // template-literal name is the compounding of three independent
          // dimensions and is treated as the same class of acknowledged
          // residual gap as the fully-dynamic-key case documented at the
          // top of this block.)
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=true][callee.callee.object.property.value='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).bind(...)(...) -indirected invocation is the same sink/likely-mistake as a direct setAttribute call; .bind indirection does not evade this rule. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='CallExpression'][callee.callee.type='MemberExpression'][callee.callee.computed=false][callee.callee.property.name='bind'][callee.callee.object.type='MemberExpression'][callee.callee.object.computed=true][callee.callee.object.property.value='setAttribute'][callee.arguments.1.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...).bind(...)(...) -indirected invocation is the same sink/likely-mistake as a direct setAttribute call; pre-binding the attribute name does not evade this rule. Computed-property sink-target form detected.",
        },
        {
          // `Reflect.apply(el.setAttribute, el, [name, value])`: the target
          // function is `arguments[0]` (the `el.setAttribute`
          // MemberExpression), and the real setAttribute args are the array
          // literal at `arguments[2]`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.property.name='setAttribute'][arguments.2.type='ArrayExpression'][arguments.2.elements.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...) via Reflect.apply is the same sink/likely-mistake as a direct setAttribute call; Reflect.apply indirection does not evade this rule.",
        },
        {
          // Codex round-1 review, Thesis-aligned finding: computed
          // `Reflect.apply(el['setAttribute'], ...)` sink-target sibling.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=true][arguments.0.property.value='setAttribute'][arguments.2.type='ArrayExpression'][arguments.2.elements.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...) via Reflect.apply is the same sink/likely-mistake as a direct setAttribute call; Reflect.apply indirection does not evade this rule. Computed-property sink-target form detected.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=true][arguments.0.property.type='TemplateLiteral'][arguments.0.property.expressions.length=0][arguments.0.property.quasis.0.value.cooked='setAttribute'][arguments.2.type='ArrayExpression'][arguments.2.elements.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...) via Reflect.apply is the same sink/likely-mistake as a direct setAttribute call; Reflect.apply indirection does not evade this rule. Computed-property sink-target form detected (template-literal key).",
        },
        // ---------------------------------------------------------------
        // Codex round-1 review, remaining Thesis-aligned findings: two
        // further, narrower indirection classes than the `.call`/`.apply`/
        // `.bind`/`Reflect.apply` sweep above -- static spread-argument
        // unpacking, and one level of meta-indirection via
        // `Function.prototype.call`/`.apply` itself used as the *outer*
        // invoker. Both are scoped to the exact shapes flagged in review
        // rather than swept combinatorially across every sink/indirection
        // pairing above: the four unconditional sinks
        // (insertAdjacentHTML/createContextualFragment/document.write/
        // writeln) have no argument-value filter to begin with, so a
        // spread argument changes nothing about whether they match --
        // only `setAttribute`'s value-filtered selectors are actually
        // defeated by a spread argument replacing a literal at the
        // matched argument position. Deeper/compounded meta-indirection
        // (e.g. `Function.prototype.call.apply(...)`, spread arguments
        // INSIDE a `.call`/`.apply`/`.bind`/`Reflect.apply`-indirected
        // call, or meta-indirection layered on the other three sinks) is
        // the same class of unbounded-combinatorial-depth residual gap as
        // the fully-dynamic-key case documented at the top of this rule
        // block -- accepted and not chased further here.
        {
          // `el.setAttribute(...['srcdoc', html])`: the attribute name is
          // no longer `arguments[0]` directly but the first element of a
          // statically-known array literal spread into the call.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='setAttribute'][arguments.0.type='SpreadElement'][arguments.0.argument.type='ArrayExpression'][arguments.0.argument.elements.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...) via a spread array argument (el.setAttribute(...['srcdoc', ...])) is the same sink/likely-mistake as a direct setAttribute call; spread-argument indirection does not evade this rule.",
        },
        {
          // `Reflect.apply(el.setAttribute, el, [...['srcdoc', html]])`:
          // same spread-array indirection, nested one level deeper inside
          // the Reflect.apply args array (`arguments[2].elements[0]` is
          // itself the SpreadElement, rather than the attribute name
          // directly).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='Reflect'][callee.property.name='apply'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.property.name='setAttribute'][arguments.2.type='ArrayExpression'][arguments.2.elements.0.type='SpreadElement'][arguments.2.elements.0.argument.type='ArrayExpression'][arguments.2.elements.0.argument.elements.0.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...) via Reflect.apply with a spread array argument is the same sink/likely-mistake as a direct setAttribute call; spread-argument indirection does not evade this rule.",
        },
        {
          // `Function.prototype.call.call(el.setAttribute, el, 'srcdoc',
          // html)`: `Function.prototype.call` (itself a function) is
          // invoked via `.call`, with `el.setAttribute` as the `this`
          // receiver -- equivalent to `el.setAttribute.call(el, 'srcdoc',
          // html)`. Target function is `arguments[0]`; because the outer
          // `.call` supplies `[target, thisArg, ...args]`, the attribute
          // name is shifted to `arguments[2]` (one further than the direct
          // `.call` case above, which is `el.setAttribute.call(el, name,
          // value)` with name at `arguments[1]`).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='call'][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='call'][callee.object.object.type='MemberExpression'][callee.object.object.computed=false][callee.object.object.property.name='prototype'][callee.object.object.object.name='Function'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.property.name='setAttribute'][arguments.2.value=/^(srcdoc|innerHTML|outerHTML)$/]",
          message:
            "setAttribute('srcdoc'|'innerHTML'|'outerHTML', ...) via Function.prototype.call.call(...) meta-indirection is the same sink/likely-mistake as a direct setAttribute call.",
        },
        {
          // `Function.prototype.apply.call(el.insertAdjacentHTML, el,
          // ['beforeend', html])`: same meta-indirection pattern as above,
          // applied to the unconditional `insertAdjacentHTML` sink (no
          // argument-value filter needed).
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='call'][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='apply'][callee.object.object.type='MemberExpression'][callee.object.object.computed=false][callee.object.object.property.name='prototype'][callee.object.object.object.name='Function'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.property.name='insertAdjacentHTML']",
          message:
            "insertAdjacentHTML via Function.prototype.apply.call(...) meta-indirection is an XSS sink; not a legitimate rendering primitive.",
        },
        {
          // Same meta-indirection pattern, `createContextualFragment`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='call'][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='apply'][callee.object.object.type='MemberExpression'][callee.object.object.computed=false][callee.object.object.property.name='prototype'][callee.object.object.object.name='Function'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.property.name='createContextualFragment']",
          message:
            "Range.createContextualFragment via Function.prototype.apply.call(...) meta-indirection is an XSS sink; not a legitimate rendering primitive.",
        },
        {
          // Same meta-indirection pattern, `document.write`/`writeln`.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='call'][callee.object.type='MemberExpression'][callee.object.computed=false][callee.object.property.name='apply'][callee.object.object.type='MemberExpression'][callee.object.object.computed=false][callee.object.object.property.name='prototype'][callee.object.object.object.name='Function'][arguments.0.type='MemberExpression'][arguments.0.computed=false][arguments.0.object.name='document'][arguments.0.property.name=/^(write|writeln)$/]",
          message:
            "document.write/writeln via Function.prototype.apply.call(...) meta-indirection is an XSS sink; not a legitimate rendering primitive.",
        },
      ],
    },
  },
  {
    // Node build scripts (`packages/*/scripts/**/*.mjs`): executed directly
    // by Node, never bundled/shipped — `js.configs.recommended`'s `no-undef`
    // otherwise flags Node 18+'s built-in global `fetch` (first needed by
    // PR-A2's `copy-duckdb-extension.mjs`, which fetches the pinned parquet
    // extension binary at build time). The `.ts/.tsx` block above already
    // turns `no-undef` off entirely (tsc's own type-checking supersedes it);
    // this file type has no such compiler pass, so only the specific global
    // actually used is declared, not a blanket env switch.
    files: ["**/scripts/**/*.mjs"],
    languageOptions: {
      globals: { fetch: "readonly" },
    },
  },
  {
    // packages/app/public/vendor/: PR-A1.5's copy-duckdb-vendor.mjs-populated,
    // gitignored DuckDB-WASM Worker/wasm binaries (minified third-party
    // code, not this project's source — same reasoning as spikes/** below).
    // packages/schema/src/generated/: Ajv standalone-codegen'd validators
    // (PR-A1.5 prerequisite), also gitignored, also not hand-written source.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "spikes/**",
      "packages/app/public/vendor/**",
      "packages/schema/src/generated/*.js",
    ],
  },
];
