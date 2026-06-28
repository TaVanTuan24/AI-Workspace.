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

## 3. Run the Workspace Governance Backfill

With the introduction of strict cross-workspace isolation and quota enforcement, existing single-workspace deployments must backfill their default context to missing users.

**First, run a dry-run to see what will change:**
```bash
pnpm workspace:governance:backfill --dry-run
```

**If the output looks correct, apply the changes:**
```bash
pnpm workspace:governance:backfill
```

*This script will ensure every user has a `WorkspaceMembership` and initialize the default `WorkspaceQuota`.*

## 4. Environment Variables Configuration

The following optional environment variables were formalized in 0.3.0:
- `API_USAGE_RETENTION_DAYS`: Controls when usage analytics are purged (default 30).
- `NOTIFICATION_RETENTION_DAYS`: Controls when old notification events are purged (default 30).
- `WORKSPACE_INVITE_EXPIRY_HOURS`: Controls when pending invites expire (default 72).

*SMTP settings (`SMTP_HOST`, `SMTP_USER`, etc.) remain in place but will be ignored unless you explicitly enable Email Delivery via the UI or `ENABLE_SMTP_DELIVERY=true`.*

## 5. Staging Verification

Start your services. Before allowing user traffic, verify the new Admin endpoints load properly:
- Open `/health` and ensure it responds with `ok`.
- Open the UI and navigate to `/settings/workspace-overview`. Verify metrics appear correctly.
- Check `/settings/activity` and `/settings/schedulers` for data stability.

You are now running version `0.3.0`.
