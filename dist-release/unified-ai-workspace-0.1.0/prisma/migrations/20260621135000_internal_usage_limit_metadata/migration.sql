ALTER TABLE "internal_api_usage_logs" ADD COLUMN "source" TEXT;
ALTER TABLE "internal_api_usage_logs" ADD COLUMN "limit_type" TEXT;
ALTER TABLE "internal_api_usage_logs" ADD COLUMN "limit_per_minute" INTEGER;
