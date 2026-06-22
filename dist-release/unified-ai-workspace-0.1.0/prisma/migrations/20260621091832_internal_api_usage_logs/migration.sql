-- CreateTable
CREATE TABLE "internal_api_usage_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "api_key_prefix" TEXT,
    "api_key_last4" TEXT,
    "api_key_name" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "job_id" TEXT,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "error_type" TEXT,
    "stream" BOOLEAN NOT NULL,
    "message_count" INTEGER NOT NULL,
    "input_char_count" INTEGER NOT NULL,
    "output_char_count" INTEGER,
    "duration_ms" INTEGER,
    "queued_ms" INTEGER,
    "worker_duration_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "internal_api_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_api_usage_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "internal_api_keys" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_user_id_created_at_idx" ON "internal_api_usage_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_api_key_id_created_at_idx" ON "internal_api_usage_logs"("api_key_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_model_created_at_idx" ON "internal_api_usage_logs"("model", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_provider_created_at_idx" ON "internal_api_usage_logs"("provider", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_status_created_at_idx" ON "internal_api_usage_logs"("status", "created_at");
