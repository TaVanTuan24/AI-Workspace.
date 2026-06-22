-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN "onboarding_completed_at" DATETIME;
ALTER TABLE "user_settings" ADD COLUMN "onboarding_last_step" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "onboarding_skipped_at" DATETIME;
