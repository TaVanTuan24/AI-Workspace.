# Unified AI Workspace 0.3.0 Upgrade Guide

This guide details the steps required to upgrade your Unified AI Workspace deployment to version `0.3.0`.

## 1. Pre-Flight Backup

Before starting the upgrade, create a full backup of your `var/` directory (or wherever your SQLite database and `.env` files are stored). This ensures you can easily rollback if an error occurs.

## 2. Apply Prisma Migrations

> **Migration history was squashed to a single `0_init` baseline.** The previous history could not replay on a fresh shadow database (some tables were created via `db push` and never had a creating migration), which blocked `prisma migrate dev`. It is now one self-consistent baseline reflecting the current schema.
>
> **Existing database created before the squash — run this once, first:**
> ```bash
> pnpm prisma migrate resolve --applied 0_init
> ```
> It records the baseline as already-applied without touching your data. Skipping it makes `migrate deploy` fail with P3005 ("schema is not empty"). Fresh databases skip this step.

After baselining (or on a fresh database), apply migrations:

```bash
pnpm prisma migrate deploy
```

## 3. Environment Variables Configuration

The following optional environment variables control retention cleanup:
- `API_USAGE_RETENTION_DAYS`: Controls when usage analytics are purged (default 30).
- `NOTIFICATION_EVENT_RETENTION_DAYS`: Controls when old notification events are purged (default 90).

## 4. Staging Verification

Start your services. Before allowing traffic, verify the core endpoints load properly:
- Open `/health` and ensure it responds with `ok`.
- Open `/settings/overview` and confirm the dashboard renders.
- Open `/settings/provider-health` and confirm provider readiness data loads.

You are now running version `0.3.0`.

> **Note:** The multi-workspace/org governance layer described in the original 0.3.0 release notes has since been removed; the app is single-user and local-first. See `CHANGELOG.md` (Unreleased) for details.
