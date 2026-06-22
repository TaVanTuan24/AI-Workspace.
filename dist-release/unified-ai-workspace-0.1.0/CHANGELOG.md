# Changelog

## 0.1.0 - Unreleased

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
