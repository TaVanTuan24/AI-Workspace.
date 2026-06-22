# Unified AI Workspace v0.2.0

## Highlights

- Provider reliability is now a full workflow: incidents, runbooks, diagnostics history, baselines, drift alerts, recovery policies, temporary overrides, scheduled expiry, and scheduler observability.
- Notification delivery now supports DLQ handling, webhook retry/failover, multiple destinations, routing rules, signed payloads, and payload templates.
- Release readiness now includes SBOM, checksums, forbidden-file verification, optional signing, vulnerability/license scans, and quieter tests.

## Security & Supply Chain

- SBOM generation and release package verification are available through `release:sbom` and `release:verify`.
- Release packages include `release-manifest.json`, `checksums.sha256`, `sbom.cyclonedx.json`, release notes, and upgrade docs.
- `release:sign` remains opt-in and supports dry-run validation without publishing or signing artifacts.
- Security scans block critical vulnerabilities and denied licenses by default.

## Notification Delivery Reliability

- Added notification DLQ dashboard and cleanup flows.
- Added webhook retry/failover with multiple destinations and routing by event kind, severity, and priority.
- Added payload templates: UAIW default, minimal, Slack-compatible, and custom allowlist.
- Added signed per-destination webhook payloads and safe delivery metadata.

## Provider Reliability

- Added provider health incident timeline, recovery runbooks, safe health checks, and safe UI diagnostics.
- Added diagnostics history, baselines, and drift alerts.
- Added provider auto-recovery policies with safe actions only.
- Added duration-bound provider/model recovery overrides, rollback, expiry CLI, scheduled expiry runner, and scheduler status UI/API.

## Settings & UI

- Added provider recovery settings, scheduler status card, recovery override badges, diagnostics history/drift UI, and improved notification/provider health views.
- Added settings hub polish, onboarding, session expiration notifications, provider limit analytics, and provider limit spike alerts.

## Test & CI

- Added test isolation helper and static guardrails against unsafe global DB mutations/raw SQL.
- Cleaned Redis test warning noise and captured expected scheduler simulation logs.
- CI and release checks cover typecheck, tests, security scan, Docker compose config, release packaging, SBOM, and verification.

## Breaking / Behavior Changes

- `/v1/models` may include safe `metadata.recovery` fields.
- `/v1/chat/completions` may return `model_temporarily_disabled` when a duration-bound model override is active.
- New Prisma migrations are required before starting 0.2.0 services.
- New env vars are available for notification webhooks, retention cleanup, provider diagnostics cleanup, provider health scheduling, and recovery override expiry scheduling.
- CI now blocks critical vulnerabilities and denied licenses.

## Migrations

Run `corepack pnpm prisma migrate deploy` before restarting 0.2.0 services. This release adds or depends on migrations for internal API keys, usage logs, model preferences, provider rate limits, notifications, webhook retry/destinations, provider recovery policies, recovery overrides, and scheduler run statuses.

## Docker Images

- API: `unified-ai-workspace-api:0.2.0`
- Worker: `unified-ai-workspace-worker:0.2.0`
- Web: `unified-ai-workspace-web:0.2.0`

## Upgrade Notes

See `docs/UPGRADE-0.2.0.md`.

## Verification

- [ ] `corepack pnpm install`
- [ ] `corepack pnpm prisma migrate deploy`
- [ ] `corepack pnpm prisma generate`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm security:scan`
- [ ] `corepack pnpm release:verify --dir dist-release/unified-ai-workspace-0.2.0 --require-sbom`

## Rollback Notes

- DB migrations are not automatically reversible. Restore from a database backup if schema rollback is required.
- Temporary recovery overrides can be rolled back in the UI, and recovery policies can be disabled.
- Webhook destinations can be disabled independently.
