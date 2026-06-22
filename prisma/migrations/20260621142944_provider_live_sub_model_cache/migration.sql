-- CreateTable
CREATE TABLE "provider_live_sub_model_cache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sub_models_json" TEXT NOT NULL,
    "detected_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_live_sub_model_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "provider_live_sub_model_cache_user_id_detected_at_idx" ON "provider_live_sub_model_cache"("user_id", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_live_sub_model_cache_user_id_provider_key" ON "provider_live_sub_model_cache"("user_id", "provider");
