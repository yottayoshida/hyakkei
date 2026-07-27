# ADR-0003: Authentication lives outside the app — permanently

- **Status**: Accepted (2026-07-04)
- **Deciders**: yotta

> **Read-forward note (2026-07-27, ADR-0017)**: every "v1.0" below now means **v2.0**. This ADR is written against the server tier ("v1.0 adds a server for live data connections, which raises access control"), and that tier was renumbered when v1.0 was redefined as agent-generated dashboards.
>
> **The decision itself is version-independent and unchanged**: "Hyakkei never implements authentication, sessions, or user accounts — **in any version**." The new v1.0 does not weaken it. It does run an MCP server process, but not a *serving* tier: stdio transport, no network listener, no perimeter, no request that anyone could be authenticated for. Deployment recipes (IAP / ALB+Cognito / oauth2-proxy) remain deliverables of the server tier, now v2.0.
>
> Original text below is unedited; it records what was decided on 2026-07-04.

## Context

v1.0 adds a server for live data connections, which raises access control. Building login/user management into an OSS tool is where maintenance cost explodes: session handling, password reset, SSO integrations, and an unending security-patch obligation — all duplicating what deployment platforms already provide. Meanwhile, the organizations Hyakkei targets already have identity providers (Google Workspace, Microsoft Entra, 自治体 directories) and want new tools behind them, not beside them.

## Decision

Hyakkei never implements authentication, sessions, or user accounts — in any version. The v1.0 server assumes an authenticated perimeter provided by the platform:

- Cloud Run → native IAP
- AWS → ALB + Cognito
- On-prem / anywhere → oauth2-proxy or equivalent reverse proxy

Deployment recipes for these are v1.0 deliverables with the same status as code. The server may *read* proxy-provided identity headers for audit logging, but makes no authorization decisions on them in v1.0 (per-user data authorization is parking-lot and would get its own ADR).

## Alternatives considered

1. **Built-in username/password + sessions** — rejected: permanent security-maintenance tax, and duplicates the IdP every target org already has.
2. **Built-in OIDC client** — rejected for v1.0: better than passwords but still session handling, token refresh, and per-IdP quirks inside our codebase. oauth2-proxy does exactly this as its whole job.
3. **Static-signed dashboard links (signed URLs)** — deferred: possibly useful for share-with-external-party later; orthogonal to core auth.

## Consequences

- (+) The OSS stays thin; our security surface is the data proxy, not identity. Security review scope shrinks dramatically.
- (+) Enterprises/governments get their own IdP, MFA policies, and audit trails for free — an easier security-review story than any homegrown login.
- (−) "Docker run and it has a login page" is not a thing; the quickstart requires one platform step. Mitigation: copy-paste recipes per platform, treated as first-class docs.
- (−) Fully anonymous internet-facing deployments of the server are intentionally unsupported.
