-- CreateTable
CREATE TABLE "provider_recovery_policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger_types" TEXT NOT NULL,
    "providers" TEXT,
    "severities" TEXT,
    "statuses" TEXT,
    "actions" TEXT NOT NULL,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "last_triggered_at" DATETIME,
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_recovery_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "provider_recovery_policy_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "trigger_ref_id" TEXT,
    "provider" TEXT,
    "severity" TEXT,
    "status" TEXT NOT NULL,
    "actions_attempted" TEXT,
    "actions_succeeded" TEXT,
    "actions_failed" TEXT,
    "skipped_reason" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    "metadata" TEXT,
    CONSTRAINT "provider_recovery_policy_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_recovery_policy_runs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "provider_recovery_policies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "provider_recovery_policies_user_id_enabled_idx" ON "provider_recovery_policies"("user_id", "enabled");

-- CreateIndex
CREATE INDEX "provider_recovery_policy_runs_user_id_policy_id_started_at_idx" ON "provider_recovery_policy_runs"("user_id", "policy_id", "started_at");

-- CreateIndex
CREATE INDEX "provider_recovery_policy_runs_user_id_status_idx" ON "provider_recovery_policy_runs"("user_id", "status");
