-- DropIndex
DROP INDEX "notification_dead_letters_workspace_id_idx";

-- DropIndex
DROP INDEX "notification_dead_letters_user_id_status_idx";

-- DropIndex
DROP INDEX "notification_dead_letters_user_id_notification_event_id_idx";

-- DropIndex
DROP INDEX "notification_dead_letters_user_id_channel_idx";

-- DropIndex
DROP INDEX "notification_dead_letters_user_id_dead_lettered_at_idx";

-- DropIndex
DROP INDEX "notification_delivery_attempts_workspace_id_idx";

-- DropIndex
DROP INDEX "notification_delivery_attempts_user_id_channel_idx";

-- DropIndex
DROP INDEX "notification_delivery_attempts_notification_event_id_idx";

-- DropIndex
DROP INDEX "notification_delivery_attempts_user_id_attempted_at_idx";

-- DropIndex
DROP INDEX "notification_delivery_preferences_user_id_channel_key";

-- DropIndex
DROP INDEX "notification_delivery_preferences_workspace_id_idx";

-- DropIndex
DROP INDEX "notification_delivery_preferences_user_id_idx";

-- DropIndex
DROP INDEX "notification_webhook_destinations_workspace_id_idx";

-- DropIndex
DROP INDEX "notification_webhook_destinations_user_id_priority_idx";

-- DropIndex
DROP INDEX "notification_webhook_destinations_user_id_enabled_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "notification_dead_letters";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "notification_delivery_attempts";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "notification_delivery_preferences";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "notification_webhook_destinations";
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
    "max_diagnostics_baselines" INTEGER,
    "max_monthly_api_requests" INTEGER,
    "max_monthly_invite_emails" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "workspace_quotas_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_workspace_quotas" ("created_at", "id", "max_api_keys", "max_diagnostics_baselines", "max_invites", "max_members", "max_monthly_api_requests", "max_monthly_invite_emails", "max_provider_connections", "plan", "updated_at", "workspace_id") SELECT "created_at", "id", "max_api_keys", "max_diagnostics_baselines", "max_invites", "max_members", "max_monthly_api_requests", "max_monthly_invite_emails", "max_provider_connections", "plan", "updated_at", "workspace_id" FROM "workspace_quotas";
DROP TABLE "workspace_quotas";
ALTER TABLE "new_workspace_quotas" RENAME TO "workspace_quotas";
CREATE UNIQUE INDEX "workspace_quotas_workspace_id_key" ON "workspace_quotas"("workspace_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

