# Upgrade Guide: Unified AI Workspace 0.2.0

## Before Upgrading

- Back up the application database.
- Back up encrypted conversation backups and any external backup storage.
- Record current environment variable names and deployment settings. Do not copy secrets into tickets, logs, or release notes.
- Ensure Redis is available for queues, webhook retry, rate limits, and distributed scheduler locks.
- Ensure `SESSION_MASTER_KEY`, `SESSION_MASTER_KEY_ID`, `API_KEY_HASH_SECRET`, `INTERNAL_API_KEY`, and `NOTIFICATION_SECRET_ENCRYPTION_KEY` remain stable where those features are enabled.
- Confirm no live provider login, CAPTCHA, 2FA, or prompt-submission smoke tests are part of CI.

## Upgrade Steps

```bash
corepack pnpm install
corepack pnpm prisma migrate deploy
corepack pnpm prisma generate
corepack pnpm typecheck
corepack pnpm test
corepack pnpm security:scan
```

Deployment:

1. Rebuild API, worker, and web images.
2. Restart API, worker, and web services.
3. Check `/ready`.
4. Check `/health/details`.
5. Check `/version`.

## Staging Deployment Smoke

Run one staging deployment from the generated release package before tagging `v0.2.0`.

```bash
corepack pnpm release:staging:env --out .env.staging
# inspect .env.staging locally if needed; never paste or commit it
corepack pnpm release:verify --dir dist-release/unified-ai-workspace-0.2.0 --require-sbom
corepack pnpm release:staging:local --preflight-only --env-file .env.staging
corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0 --base-url http://localhost:4000 --down
corepack pnpm release:tag:dry-run --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0
```

Use an internal API key only when you intend to verify `/v1/models`:

```bash
corepack pnpm release:staging:verify --base-url http://localhost:<port> --expected-version 0.2.0 --api-key-env UAIW_STAGING_API_KEY
```

Use settings safe checks only with an explicit local user id:

```bash
corepack pnpm release:staging:verify --base-url http://localhost:<port> --expected-version 0.2.0 --local-user-id local-user
```

Staging safety rules:

- `.env.staging` must not be committed.
- Generated `.env.staging` secrets must not be pasted into logs, tickets, or release notes.
- Use staging database and Redis instances.
- Back up the staging database before migrations when it contains useful state.
- Do not use production provider sessions in staging.
- Do not run live provider login tests unless a human operator explicitly chooses a manual live smoke.
- Do not submit prompts to providers as part of staging release validation.
- Keep signing, Docker image push, and release tag creation as separate opt-in actions.

Docker preflight troubleshooting:

```bash
docker info
corepack pnpm release:staging:local --preflight-only --env-file .env.staging
corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0 --base-url http://localhost:4000 --down
corepack pnpm release:tag:dry-run --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0
```

If `release:staging:local --preflight-only` reports the Docker daemon as unavailable, start Docker Desktop, switch to Linux containers/engine on Windows, wait until `docker info` succeeds, and resume the staging smoke. Do not paste `.env.staging`, Docker env output, provider sessions, or generated secrets into release notes or tickets.

## New Environment Variables

| Name | Default | Required | Description |
| --- | --- | --- | --- |
| `NOTIFICATION_EVENT_RETENTION_DAYS` | `90` | No | Retention window for notification event cleanup. |
| `NOTIFICATION_WEBHOOK_TIMEOUT_MS` | `5000` | No | Per-webhook delivery timeout. |
| `NOTIFICATION_WEBHOOK_ALLOW_LOCALHOST` | `false` | No | Allows localhost/private webhook URLs for local testing only. Keep false in production. |
| `NOTIFICATION_SECRET_ENCRYPTION_KEY` | empty | Production when webhook secrets are used | 32-byte key for notification webhook secret encryption. Falls back to session key only when appropriate. |
| `NOTIFICATION_WEBHOOK_RETRY_ENABLED` | `true` | No | Enables webhook retry queue scheduling. |
| `NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS` | `5` | No | Maximum webhook delivery attempts. |
| `NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS` | `30000` | No | Base retry delay for exponential backoff. |
| `NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS` | `900000` | No | Maximum retry delay. Must be at least the base delay. |
| `PROVIDER_HEALTH_SCHEDULER_ENABLED` | `false` | No | Enables provider health scheduler. Keep disabled in tests/CI. |
| `PROVIDER_HEALTH_SCHEDULER_INTERVAL_SECONDS` | `900` | No | Provider health scheduler interval. |
| `PROVIDER_HEALTH_SCHEDULER_JITTER_SECONDS` | `60` | No | Jitter added to provider health scheduler runs. |
| `PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS` | `840` | No | Redis lock TTL for provider health scheduler. Clamped to interval if too high. |
| `PROVIDER_HEALTH_SCHEDULER_MAX_USERS_PER_RUN` | `50` | No | Maximum user batch size for provider health scheduler. |
| `PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED` | `false` locally, `true` in production if unset | No | Enables scheduled expiry cleanup for duration-bound recovery overrides. |
| `PROVIDER_RECOVERY_OVERRIDE_EXPIRY_INTERVAL_SECONDS` | `300` | No | Recovery override expiry scheduler interval. |
| `PROVIDER_RECOVERY_OVERRIDE_EXPIRY_LOCK_TTL_SECONDS` | `120` | No | Redis lock TTL for recovery override expiry scheduler. |
| `PROVIDER_RECOVERY_OVERRIDE_EXPIRY_MAX_PER_RUN` | `500` | No | Maximum overrides to expire per run. |
| `PROVIDER_HEALTH_INCIDENT_RETENTION_DAYS` | `180` | No | Cleanup tool retention for resolved provider health incidents. |
| `PROVIDER_DIAGNOSTICS_RETENTION_DAYS` | `90` | No | Cleanup tool retention for diagnostics runs. |
| `PROVIDER_DIAGNOSTICS_BASELINE_RETENTION_DAYS` | `365` | No | Cleanup tool retention for inactive diagnostics baselines. |
| `PROVIDER_DIAGNOSTICS_DRIFT_ALERT_RETENTION_DAYS` | `180` | No | Cleanup tool retention for resolved drift alerts. |
| `APP_VERSION` | package version | No | Runtime/release version override used by `/version` and release tooling. |
| `GIT_SHA` | empty/unknown | No | Build metadata for `/version`. |
| `BUILD_TIME` | empty/unknown | No | Build metadata for `/version`. |
| `BUILD_SOURCE` | `local` or `ci` | No | Build source metadata for `/version`. |

Supply-chain workflow inputs:

| Name | Default | Required | Description |
| --- | --- | --- | --- |
| `generate_sbom` | `true` | No | Generates CycloneDX SBOM in the manual supply-chain workflow. |
| `security_scan` | `true` | No | Runs vulnerability/license scan in the manual supply-chain workflow. |
| `strict_security` | `false` | No | Fails on stricter vulnerability/license review settings. |
| `sign_artifacts` | `false` | No | Opt-in Cosign/Sigstore signing for release checksums. |
| `sign_images` | `false` | No | Opt-in image signing scaffold. |
| `push` | `false` | No | Opt-in Docker image publishing in `publish-images.yml`. |

Release package workflow input:

| Name | Default | Required | Description |
| --- | --- | --- | --- |
| `staging_verified` | `false` | Yes | Manual confirmation that `release:staging:verify` has passed before packaging release artifacts. |

## New CLI Commands

| Command | Purpose |
| --- | --- |
| `corepack pnpm release:check` | Validates release metadata and required packaging files. |
| `corepack pnpm release:sbom` | Generates `sbom.cyclonedx.json` for a release package. |
| `corepack pnpm release:package` | Creates the source release package and checksums. |
| `corepack pnpm release:verify` | Verifies manifest hashes, forbidden files, checksums, and SBOM presence. |
| `corepack pnpm release:staging:env` | Generates a gitignored local `.env.staging` with strong local-only secrets from `.env.staging.example`. |
| `corepack pnpm release:staging:verify` | Runs safe staging HTTP checks for health, readiness, version, optional `/v1/models`, and optional settings endpoints. |
| `corepack pnpm release:staging:local` | Runs Docker preflight, local Docker Compose staging smoke, waits for `/ready`, runs the staging verifier, and writes a safe staging marker. |
| `corepack pnpm release:operator:status` | Summarizes release handoff readiness, blockers, Docker preflight status, cosign status, and next operator action without printing secrets. |
| `corepack pnpm release:tag:dry-run` | Checks release tag readiness and prints manual tag/push commands without executing them. |
| `corepack pnpm release:sign --dry-run` | Validates signing scaffold without signing. |
| `corepack pnpm security:audit` | Runs vulnerability audit. |
| `corepack pnpm security:licenses` | Runs license policy scan. |
| `corepack pnpm security:scan` | Runs the combined security scan. |
| `corepack pnpm test:isolation` | Runs static test DB/raw SQL guardrails. |
| `corepack pnpm notification-events:cleanup` | Cleans old notification events. |
| `corepack pnpm provider-health-incidents:cleanup` | Cleans old resolved provider health incidents. |
| `corepack pnpm provider-diagnostics:cleanup` | Cleans old diagnostics runs. |
| `corepack pnpm provider-diagnostics-drift:cleanup` | Cleans old diagnostics baselines/drift alerts. |
| `corepack pnpm provider-recovery-overrides:expire` | Expires past-due active recovery overrides safely. |
| `corepack pnpm api-usage:cleanup` | Cleans old internal API usage logs. |

## Migration Notes

Run all Prisma migrations before starting 0.2.0. New or expanded tables include:

- Internal API keys, API key model scopes, usage logs, and usage metadata.
- Provider model preferences and provider sub-model cache.
- Notification events, preferences, delivery attempts, webhook retry metadata, and webhook destinations.
- Provider recovery policies and recovery policy runs.
- Duration-bound recovery overrides.
- Scheduler run statuses.

Existing legacy webhook config can be backfilled or superseded by destination-based webhook settings. Provider sessions, encrypted storage state, API keys, and webhook secrets are not exported or transformed by release packaging.

## Rollback Notes

- Database migrations may not be automatically reversible.
- If a schema rollback is required, restore the database backup taken before upgrade.
- App binaries can be rolled back only if the older build tolerates the upgraded schema, otherwise restore the DB backup too.
- Temporary recovery overrides can be rolled back in the UI.
- Recovery policies and webhook destinations can be disabled without deleting data.

## Post-Upgrade Validation Checklist

- [ ] `/ready` reports healthy dependencies.
- [ ] `/health/details` loads without exposing secrets.
- [ ] `/version` reports `0.2.0` or the configured `APP_VERSION`.
- [ ] Settings Provider Health page loads.
- [ ] Provider Recovery page loads, including scheduler status.
- [ ] Notifications page loads.
- [ ] `/v1/models` returns models and safe recovery metadata.
- [ ] One safe health check action works.
- [ ] `corepack pnpm release:staging:verify --base-url <staging-url> --expected-version 0.2.0` passes.
- [ ] No live provider login tests run in CI.
- [ ] `corepack pnpm release:verify --dir dist-release/unified-ai-workspace-0.2.0 --require-sbom` passes.
