ALTER TABLE "user_settings" ADD COLUMN "notify_provider_session_issues" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN "notify_no_usable_models" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN "notify_provider_limit_spikes" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_settings" ADD COLUMN "provider_limit_spike_threshold_24h" INTEGER NOT NULL DEFAULT 10;
