# Spike: how a 1.22 MiB single-file dashboard reaches its recipient (MCP transport gate)

**Status**: RESOLVED — **two channels, not one.** In-conversation preview is MCP Apps (`ui://` + sandboxed iframe); distribution is a written file. `tool result` direct return is structurally impossible and is the only candidate actually eliminated. MCP Apps has a host-side rendering bug open in Claude Desktop / claude.ai / Claude Code for Web as of this date, but that is a wait-and-retest condition on the host, not a reason to build a different shape — and there is now a debug host that separates host bugs from your own.
**Date**: 2026-07-27
**Amended**: 2026-08-02 — MCP published protocol revision `2026-07-28`, replacing the core protocol wholesale. The two-channel conclusion survives untouched; two statements in this document do not. Read the amendment before the body.
**Scope**: Gate for issue #26's v1.0 re-scoping (see `docs/adr/` for the v1.0 redefinition ADR). Three independent Phase 2 investigations (ux, market-researcher, qa-specialist) converged on the same unknown — "can a 1.22 MiB self-contained HTML be returned as an MCP tool result?" — and all three flagged it as **unmeasured**. The plan made this gate blocking: if no transport works, the CONDITIONAL GO reverts to NO-GO.

The artifact in question is the one `docs/spikes/single-file-viewer.md` produced: **1,283,005 bytes** (1.22 MiB raw / 398 KiB gzip), ECharts-dominated, with the baked data at ~0.1% of the total.

## Amendment (2026-08-02): the core protocol was replaced, the conclusion was not

MCP published protocol revision [`2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28/changelog). It is a wholesale replacement of the core: protocol-level sessions and the `initialize` handshake are gone, every request carries its own protocol version and client capabilities in `_meta`, servers **MUST** implement a new `server/discover` RPC, `ping` / `logging/setLevel` / SSE resumability are removed, and tasks moved out of the core into an extension.

**None of that changes a verdict in this spike.** MCP Apps runs on its own track — its specification is still the 2026-01-26 revision, and the [extensions framework](https://modelcontextprotocol.io/docs/extensions/overview) the new core introduces is precisely the mechanism that lets it evolve independently. `ui://` resources, `_meta.ui.resourceUri`, the sandboxed iframe and the `postMessage` dialect are unchanged. Candidates 1 and 4 stay rejected for reasons — context arithmetic, the zero-network-request property — that never touched the wire protocol.

Hyakkei has written no MCP code and carries no MCP dependency, so this is not a migration. It changes what the first line will be written against.

### What the first implementation must now do

| Item | Note |
| --- | --- |
| `server/discover` | **MUST** implement. Advertises supported versions, capabilities and identity; also serves as the backward-compatibility probe on stdio |
| Extension negotiation | There is no `initialize` to negotiate in. Clients declare support per-request in `_meta["io.modelcontextprotocol/clientCapabilities"].extensions`; servers declare it in the `server/discover` result's `capabilities.extensions`. The negotiation example in the extensions overview names the MCP Apps identifier `io.modelcontextprotocol/ui` |
| `resultType` | Required on every result — `"complete"` for ordinary ones, `"input_required"` only for the new multi-round-trip pattern |
| `ttlMs` + `cacheScope` | Required on `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` **and `resources/read`** — that last one is the call that serves the `ui://` bundle |
| Logging | `logging/setLevel` is removed and the Logging feature is deprecated. Log to `stderr` |
| Roots / Sampling | Deprecated. Hyakkei needs neither |

Statelessness is a tailwind rather than a cost here: ADR-0017's shape is a CLI core with the MCP server as a thin adapter, and a thin adapter holds no cross-call state to lose.

### SDK: v2 is the target, and the MCP Apps SDK has not caught up

The TypeScript SDK split at v2 (2026-07-27) into `@modelcontextprotocol/core`, `server`, `client`, `express`, `fastify`, plus a `codemod` for the v1 upgrade. **Only v2 supports `2026-07-28`**; the single-package `@modelcontextprotocol/sdk@1.30.0` does not.

`@modelcontextprotocol/ext-apps@1.7.5` (2026-07-23) still declares `peerDependencies: { "@modelcontextprotocol/sdk": "^1.29.0" }` — it has not moved to the v2 package names. The SDK side has already made room: the `@modelcontextprotocol/server@2.0.0` release note for PR #2501 restores the v1 `Protocol` / `mergeCapabilities` root exports explicitly "for consumers that subclass `Protocol` (e.g. the MCP Apps SDK)". Read that as work in progress, not as a settled compatibility story — **re-check the peer range before writing the first import**. If it still has not landed, the escape hatch is documented: the `App` class is "a convenience wrapper, not a requirement," and the postMessage protocol can be implemented directly.

### Two statements below no longer hold

**1. The re-test trigger names a tracker that will not resolve it.** "Consequences for v1.0" says to wait for `ext-apps#671` to close. On 2026-07-31 the thread's most active investigator stated the opposite — "this repo is the spec and SDK, so triage for a host rendering bug won't happen here" — and moved the writeup to [`anthropics/claude-ai-mcp#165`](https://github.com/anthropics/claude-ai-mcp/issues/165). `#671` is still OPEN at 13 comments and may stay open indefinitely. **Track `claude-ai-mcp#165` instead.**

**2. "No server-side or content-side change can fix it" is now too broad.** It was drawn from the static-no-JS-marker test and remains true of the failure that test probed. But a 36-render measurement on claude.ai web (2026-07-31, `_meta.ui.domain` as the only variable between arms) found a second failure with the same visible symptom that is entirely server-side:

| `_meta.ui.domain` | iframe mounted | sandbox origin |
| --- | --- | --- |
| computed `sha256(endpoint)[:32] + ".claudemcpcontent.com"` | 10/10 | one stable origin every render |
| absent | 10/10 | a different origin per conversation |
| **present but wrong** | **0/8** | never created |

Omitting the field does not stop the iframe mounting — it only unpins the sandbox origin, which is what an API server needs in order to allowlist anything. Setting it *wrong* (a trailing slash, a missing `/mcp`, the wrong scheme in the hashed string) is reliably fatal, and raises the same "Unable to reach" error as a stale cached `ui://` URI after a rebuild. One symptom, three causes: get the hashed endpoint spelling exactly right, or omit the field.

`mcp-app-debug` is at 0.3.0 (2026-07-31) and now names a mismatched domain rather than leaving it to be guessed. The invocation in §3 is still current — the `--stdio -- <server command>` form and a bare URL form both work.

## Candidates evaluated

| # | Transport | Serves | Verdict |
| --- | --- | --- | --- |
| 1 | Return the HTML as the tool result | — | **Rejected** — the only candidate actually eliminated |
| 2 | Write to disk, return the path | Distribution (mail, intranet, shared drive) | **Adopted — available today** |
| 3 | MCP Apps (`ui://` resource + sandboxed iframe, SEP-1865) | In-conversation preview | **Adopted as the target — blocked on a host-side bug**, buildable and verifiable now |
| 4 | Load ECharts from a CDN to shrink the artifact | — | **Excluded by construction** |

2 and 3 are **complementary, not alternatives**. Seeing a dashboard while iterating with the model and handing a file to someone who does not have Claude are different jobs; neither substitutes for the other. The earlier framing of this spike treated them as competing candidates and concluded "MCP Apps is unusable" — that was wrong, and the correction is the substance of §3.

## 1. Tool result direct return — rejected on two independent grounds

### Ground A: it does not fit in the caller's context (arithmetic, no measurement needed)

A tool result enters the calling model's context window. 1,283,005 bytes of minified JS — short identifiers, almost no whitespace — runs roughly 3-4 characters per token, so about **370k tokens**. That is a third of a 1M-context model in a single tool call and does not fit at all in a 200k one. This is not a host limit to be measured; it is what the payload costs.

### What was actually run

| Host | Version | Transport | Payload | Result mode | Path returned? |
| --- | --- | --- | --- | --- | --- |
| Claude Code (CLI) | not recorded | Bash tool stdout | 1,283,005 B | Spilled to file, 2 KB preview returned | Yes — but into the session's own scratch directory, not anywhere the user chose |
| Claude Desktop | — | — | — | **not run** | — |
| claude.ai | — | — | — | **not run** | — |

One host, and its version was not captured. That is thinner than a decision of this weight would normally warrant, and it is stated plainly rather than dressed up: **Ground A below makes the host-specific number irrelevant**, since ~370k tokens does not fit in a caller's context regardless of who is hosting. A second host would refine *where* the threshold sits, not *whether* the approach works. If that ever needs settling, the row template above is what to fill in.

MCP Apps was not measured at all here — §3 explains why (the host-side rendering bug blocks the question from being asked) and what to run when it unblocks.

### Ground B: measured — the host truncates it, and the overflow lands somewhere the user cannot reach

Emitting exactly 1,283,005 bytes to stdout from a Bash tool call in Claude Code (2026-07-27):

```
Output too large (1.2MB). Full output saved to:
  <session-dir>/tool-results/<id>.txt

Preview (first 2KB):
...
```

So the host already implements "spill oversized results to a file and hand back a preview." Two consequences:

- **The model never sees the artifact.** It gets 2 KB of preview. Anything the model would need to reason about (the guideline verdicts, the applied fixes) has to travel outside the HTML anyway.
- **The user never receives the artifact.** The spill file lands in Claude Code's own session directory, not anywhere the user asked for. The generated dashboard's whole purpose is to be handed to someone; a path inside the agent's scratch space does not accomplish that.

The honest framing is not "the result is too large to return" but **"it can be returned and nobody receives it."** Note this measurement is Claude Code's behaviour specifically; another host may truncate at a different threshold or not at all. It does not matter — Ground A holds regardless of host.

## 2. Write-to-disk + path return — the standard

Technically unremarkable, which is the point. The constraint that matters is not feasibility but containment: the write path is a new attack surface that did not exist while hyakkei was browser-only (the security review scored it DREAD 8.2 — an LLM-supplied `outputPath` of `../../.claude/settings.json` rewrites the agent's own configuration). The mitigations belong in the implementation plan, not here.

Preferred shape, in order:

1. **The MCP server does not write at all** — it returns the HTML string to the host, and the host's own file-writing tool (which prompts the user) puts it on disk. This keeps the write surface out of hyakkei entirely. Blocked today by Ground A above: the string cannot travel through the tool result.
2. **The server writes, but accepts no path from the caller** — output directory resolved server-side, filename derived from the dashboard title through the existing sanitizer, `O_EXCL` so an existing file is never overwritten and a symlink is never followed.

## 3. MCP Apps — the target shape, blocked on the host, buildable now

MCP Apps (SEP-1865) is how a dashboard renders *inside the conversation*: the server registers the HTML as a `ui://` resource, the tool definition points at it via `_meta.ui.resourceUri`, and the host fetches it and renders it in a sandboxed iframe, communicating over JSON-RPC via `postMessage`. Data rides in the tool result (1.4 KB), not the bundle — sidestepping Ground A entirely. The spec reached Final on 2026-01-26; Claude, Claude Desktop, VS Code Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam, and Archestra.AI are on the published support list. Anthropic ships an official `build-mcp-app` Claude Code skill for authoring them.

**This is the shape hyakkei should build.** What follows is a host-availability constraint on *when the preview lights up*, not a reason to build something else.

### The open bug is host-side, and provably not ours to fix

[`modelcontextprotocol/ext-apps#671`](https://github.com/modelcontextprotocol/ext-apps/issues/671) has been **open since 2026-05-27**, nine comments, multiple independent reproductions:

- Capability negotiation succeeds, the resource is fetched, Claude announces that an interactive widget was rendered — **no iframe appears**, and the reply is narrated from `structuredContent` instead.
- One reporter embedded a **static, no-JS marker** — a plain coloured block visible with zero script execution — directly in the resource body. It never appeared either. That single test eliminates script errors, bootstrapping failures, host-API/data-bridge problems, and CSP blocking of sub-resources at once, and establishes that **no server-side or content-side change can fix it**.
- A variant: the iframe *does* render, but `app.ontoolresult` never fires and the view sits on its loading state forever. **The same server and view work every time in Cowork.**
- Reported in Claude Desktop (Windows), claude.ai, and **Claude Code for Web** ("implementation on the MCP Server seems fine, but nothing renders").

A related report, [`anthropics/claude-ai-mcp#236`](https://github.com/anthropics/claude-ai-mcp/issues/236), describes iframes not rendering under a specific Cowork deployment mode despite identical protocol negotiation.

The failure is **host-specific, not spec-specific**: same server, different host, correct rendering.

### Not every "doesn't render" report is the same bug

Thread comment 6 documents a genuinely server-side failure with the same visible symptom: importing the App SDK from a CDN (`https://esm.sh/@modelcontextprotocol/ext-apps@1.7.4/app-with-deps`) crashes the sandboxed harness with `Uncaught TypeError: t.custom is not a function` before `app.connect` is reached. Self-bundling the SDK avoids it. So "the widget doesn't render" covers at least two distinct causes — one ours, one the host's — and they must be separated before drawing conclusions.

### There is a tool that separates them

[`Booyaka101/mcp-app-debug`](https://github.com/Booyaka101/mcp-app-debug) (MIT) is a local debug host that renders a server's app through the **same App Bridge + double-iframe sandbox path a spec-conformant client uses**, logs every `postMessage` frame, and runs five automated PASS/FAIL checks: `ui://` resource resolves, CSP permits embedding and assets, `ui/initialize` handshake, `ui/notifications/initialized`, and an app-initiated `tools/call` round trip. It reports all green against the official `@modelcontextprotocol/server-basic-react` example, and `--mode strict` reproduces restrictive-host behaviour (empty `hostCapabilities`, app-initiated `tools/call` rejected with `-32601`).

```bash
npx mcp-app-debug --stdio -- npx -y @hyakkei/mcp
```

This is what makes building against MCP Apps reasonable while the host bug is open: **conformance is verifiable without a working host**. A green run is evidence hyakkei's side is correct; a red chip names exactly which step never happened.

**Still unmeasured**: whether a sandboxed iframe accepts a 1.28 MB inlined renderer bundle. `mcp-app-debug` should be able to answer this without waiting on the host fix — it is the first thing to run once a prototype exists. The reference implementation worth studying is [`KyuRish/mcp-dashboards`](https://github.com/KyuRish/mcp-dashboards) (React + Elastic Charts, single self-contained HTML, MCP Apps).

## 4. CDN-loaded ECharts — excluded by construction

Shrinking the artifact by fetching ECharts from a CDN would break the property the single-file viewer spike was run to establish: `file://` double-click with **zero network requests** across all three engines. That property is what makes the artifact work on a shared drive, in a restricted government network, and five years from now. Trading it for file size inverts the reason the artifact exists.

## Consequences for v1.0

- **Build the MCP App.** It is the shape that delivers the in-conversation experience, the spec is Final, Anthropic ships an authoring skill for it, and conformance is verifiable today via `mcp-app-debug` even though the primary hosts do not render yet.
- **Ship the file output alongside it, not instead of it.** A written file is the only channel that reaches someone who does not have Claude at all — mail, intranet, shared drive, `file://` double-click. That is the audience the whole browser-complete thesis exists for, and it needs no host cooperation.
- **Do not gate v1.0's definition on the host bug.** What the bug determines is whether the preview is lit on release day, not whether the product is the right shape. A v1.0 that ships with the App implemented, conformance-verified, and the preview dark pending `ext-apps#671` is coherent; a v1.0 redesigned around the bug is not.
- The file-output half lands naturally on the CLI-core shape the v1.0 redefinition adopted — a CLI writes files as a matter of course, and the MCP adapter inherits the same output contract rather than inventing a second one.
- **Re-test trigger**: `ext-apps#671` closed **and** an independent report of a `ui://` resource rendering in a Claude chat surface. Until then, run `mcp-app-debug` in CI so a regression on hyakkei's side is caught separately from the host's.

## What this spike did not measure

1. **Claude Desktop's tool-result size handling.** Ground B was measured in Claude Code. Ground A makes the host-specific number irrelevant, so this was not pursued.
2. **Whether a sandboxed iframe accepts a 1.28 MB inlined bundle.** `mcp-app-debug` can answer this without a working host; it is the first thing to run once a prototype exists.
3. **The exact threshold at which Claude Code spills a tool result to a file.** Only that 1.2 MB is over it. The threshold does not change any decision here.

## Correction history

The first version of this spike concluded that MCP Apps was "not usable today" and that `write-to-disk + path return` was "the only viable transport." That was wrong in two ways, both caught by yotta: it treated a **host-side** rendering bug as if it disqualified the shape hyakkei should build, and it collapsed two complementary channels (in-conversation preview vs. distribution to someone without Claude) into a single either/or. The ux investigation had already stated the correct framing — "会話内プレビュー = MCP Apps、配布 = ファイル書き出しの二段構え" — and the first draft dropped it.
