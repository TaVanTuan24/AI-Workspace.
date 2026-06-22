CREATE TABLE "provider_recovery_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "policy_run_id" TEXT,
    "action_type" TEXT NOT NULL,
    "provider" TEXT,
    "model_id" TEXT,
    "sub_model_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reason" TEXT,
    "safe_summary" TEXT,
    "previous_state" TEXT,
    "override_state" TEXT,
    "starts_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "resolved_at" DATETIME,
    "resolution" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_recovery_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "provider_recovery_overrides_user_id_status_idx" ON "provider_recovery_overrides"("user_id", "status");
CREATE INDEX "provider_recovery_overrides_user_id_provider_idx" ON "provider_recovery_overrides"("user_id", "provider");
CREATE INDEX "provider_recovery_overrides_user_id_expires_at_idx" ON "provider_recovery_overrides"("user_id", "expires_at");
CREATE INDEX "provider_recovery_overrides_user_id_policy_run_id_idx" ON "provider_recovery_overrides"("user_id", "policy_run_id");
