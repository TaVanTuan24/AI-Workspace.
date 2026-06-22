-- AlterTable
ALTER TABLE "user_model_preferences" ADD COLUMN "selected_sub_model_id" TEXT DEFAULT 'current';
ALTER TABLE "user_model_preferences" ADD COLUMN "selected_sub_model_label" TEXT;
