-- DropIndex
DROP INDEX "provider_recovery_overrides_workspace_id_idx";

-- DropIndex
DROP INDEX "provider_recovery_overrides_user_id_policy_run_id_idx";

-- DropIndex
DROP INDEX "provider_recovery_overrides_user_id_expires_at_idx";

-- DropIndex
DROP INDEX "provider_recovery_overrides_user_id_provider_idx";

-- DropIndex
DROP INDEX "provider_recovery_overrides_user_id_status_idx";

-- DropIndex
DROP INDEX "provider_recovery_policies_workspace_id_idx";

-- DropIndex
DROP INDEX "provider_recovery_policies_user_id_enabled_idx";

-- DropIndex
DROP INDEX "provider_recovery_policy_runs_workspace_id_idx";

-- DropIndex
DROP INDEX "provider_recovery_policy_runs_user_id_status_idx";

-- DropIndex
DROP INDEX "provider_recovery_policy_runs_user_id_policy_id_started_at_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "provider_recovery_overrides";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "provider_recovery_policies";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "provider_recovery_policy_runs";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workspace_quotas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'local',
    "max_members" INTEGER,
    "max_invites" INTEGER,
    "max_api_keys" INTEGER,
    "max_provider_connections" INTEGER,
    "max_webhook_destinations" INTEGER,
    "max_diagnostics_baselines" INTEGER,
    "max_monthly_api_requests" INTEGER,
    "max_monthly_invite_emails" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "workspace_quotas_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_workspace_quotas" ("created_at", "id", "max_api_keys", "max_diagnostics_baselines", "max_invites", "max_members", "max_monthly_api_requests", "max_monthly_invite_emails", "max_provider_connections", "max_webhook_destinations", "plan", "updated_at", "workspace_id") SELECT "created_at", "id", "max_api_keys", "max_diagnostics_baselines", "max_invites", "max_members", "max_monthly_api_requests", "max_monthly_invite_emails", "max_provider_connections", "max_webhook_destinations", "plan", "updated_at", "workspace_id" FROM "workspace_quotas";
DROP TABLE "workspace_quotas";
ALTER TABLE "new_workspace_quotas" RENAME TO "workspace_quotas";
CREATE UNIQUE INDEX "workspace_quotas_workspace_id_key" ON "workspace_quotas"("workspace_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

