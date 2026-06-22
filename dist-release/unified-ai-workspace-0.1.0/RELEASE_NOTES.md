# Unified AI Workspace v0.1.0

## Highlights

- 

## Added

- 

## Changed

- 

## Fixed

- 

## Security

- 

## Migrations

- 20260621090849_internal_api_keys
- 20260621091832_internal_api_usage_logs
- 20260621093409_user_model_preferences
- 20260621094401_api_key_model_scopes
- 20260621101549_provider_sub_model_preferences
- 20260621110243_api_key_rate_limit_overrides
- 20260621121003_onboarding_settings

## Docker Images

- API: `unified-ai-workspace-api:0.1.0`
- Worker: `unified-ai-workspace-worker:0.1.0`
- Web: `unified-ai-workspace-web:0.1.0`

## Upgrade Notes

1. Back up your database and provider session data.
2. Review `.env.example` and add any new environment variables.
3. Run Prisma migrations before starting the new API/Worker/Web processes.
4. Restart API, Worker, and Web.
5. Confirm `/health` and `/ready` after startup.

## Verification

- [ ] `corepack pnpm ci:check`
- [ ] `docker compose config`
- [ ] `/health`
- [ ] `/ready`

## Rollback Notes

- 
