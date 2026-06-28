-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "auto_select_first_usable" BOOLEAN NOT NULL DEFAULT true,
    "onboarding_completed_at" DATETIME,
    "onboarding_skipped_at" DATETIME,
    "onboarding_last_step" TEXT,
    "notify_provider_session_issues" BOOLEAN NOT NULL DEFAULT true,
    "notify_no_usable_models" BOOLEAN NOT NULL DEFAULT true,
    "notify_provider_limit_spikes" BOOLEAN NOT NULL DEFAULT true,
    "provider_limit_spike_threshold_24h" INTEGER NOT NULL DEFAULT 10,
    CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_settings" ("auto_select_first_usable", "notify_no_usable_models", "notify_provider_limit_spikes", "notify_provider_session_issues", "onboarding_completed_at", "onboarding_last_step", "onboarding_skipped_at", "provider_limit_spike_threshold_24h", "user_id") SELECT "auto_select_first_usable", "notify_no_usable_models", "notify_provider_limit_spikes", "notify_provider_session_issues", "onboarding_completed_at", "onboarding_last_step", "onboarding_skipped_at", "provider_limit_spike_threshold_24h", "user_id" FROM "user_settings";
DROP TABLE "user_settings";
ALTER TABLE "new_user_settings" RENAME TO "user_settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

