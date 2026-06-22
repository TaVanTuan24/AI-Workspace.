# Changelog

## 0.2.0 - 2026-06-22

### Security & Supply Chain

- Added SBOM generation, release checksums, release manifest verification, and optional Cosign/Sigstore signing scaffold.
- Added vulnerability and license scanning with CI gates for critical vulnerabilities and denied licenses.
- Added release package forbidden-file verification for local `.env`, databases, session data, browser profiles, smoke reports, build output, and `node_modules`.
- Remediated Vite/Vitest security posture through dependency overrides and scan validation.

### Notification Delivery Reliability

- Added notification dead-letter queue support and dashboard flows.
- Added webhook retry/failover, multiple webhook destinations, routing by kind/severity/priority, and destination-level payload signing.
- Added webhook payload templates for UAIW default, minimal, Slack-compatible, and custom allowlist formats.
- Added notification event retention cleanup and safe delivery metadata.

### Provider Reliability

- Added provider health incident timeline, recovery runbooks, safe health-check actions, and safe UI diagnostics actions.
- Added diagnostics history, baselines, and drift alerts.
- Added provider auto-recovery policies with safe actions only.
- Added duration-bound provider/model recovery overrides, manual rollback, scheduled expiry cleanup, and scheduler observability.

### Settings & UI

- Added provider recovery settings, scheduler status card, recovery override badges, diagnostics history/drift views, and improved notification/provider health surfaces.
- Added onboarding, settings hub polish, session expiration notifications, and provider limit analytics/alerts.

### Test & CI

- Added test isolation helpers, DB cleanup guardrails, raw SQL guardrails, Redis test warning cleanup, and scoped expected-log capture for scheduler tests.
- Added readiness smoke, Docker compose config validation, release checks, security scan, and supply-chain workflow scaffolds.

### Breaking / Behavior Changes

- `/v1/models` may now include safe `metadata.recovery` fields for provider/model recovery state.
- `/v1/chat/completions` may reject temporarily disabled models with `model_temporarily_disabled`.
- CI now fails on critical vulnerabilities and denied licenses by default.
- New scheduler, webhook, notification, diagnostics, and supply-chain environment settings are available. Production must keep session, API key, and notification encryption secrets stable.
- New Prisma migrations are required before running 0.2.0 services.

### Migrations

- `20260621090849_internal_api_keys`
- `20260621091832_internal_api_usage_logs`
- `20260621093409_user_model_preferences`
- `20260621094401_api_key_model_scopes`
- `20260621101549_provider_sub_model_preferences`
- `20260621110243_api_key_rate_limit_overrides`
- `20260621121003_onboarding_settings`
- `20260621131500_provider_rate_limit_settings`
- `20260621133158_notification_events`
- `20260621133500_notification_preferences`
- `20260621134355_notification_delivery_scaffold`
- `20260621135000_internal_usage_limit_metadata`
- `20260621141631_notification_webhook_retry`
- `20260621142944_provider_live_sub_model_cache`
- `20260622003000_provider_recovery_policies`
- `20260622013000_provider_recovery_overrides`
- `20260622015000_scheduler_run_status`

## 0.1.0 - Initial MVP

### Added

- Unified AI Workspace MVP for local-first/self-host browser automation.
- Gemini, ChatGPT, and Grok web provider adapters.
- OpenAI-compatible internal endpoint.
- DB-backed API keys, model scopes, and rate limits.
- Usage analytics and retention cleanup tooling.
- Provider health and readiness metadata.
- Encrypted conversation backups.
- Settings Hub and first-run onboarding.
- Session expiration notifications.
- Production deployment hardening.
- CI deployment checks and ephemeral readiness smoke.
- Release packaging and version metadata.

### Security

- Provider sessions are encrypted at rest.
- Logs redact cookies, tokens, storage state, encrypted session blobs, API keys, and backup passphrases.
- Release packages exclude local databases, sessions, browser profiles, `.env`, smoke reports, and `node_modules`.
