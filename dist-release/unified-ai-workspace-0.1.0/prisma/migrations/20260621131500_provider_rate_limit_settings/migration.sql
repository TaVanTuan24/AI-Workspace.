CREATE TABLE "provider_rate_limit_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "requests_per_minute" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "provider_rate_limit_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "provider_rate_limit_settings_user_id_provider_key" ON "provider_rate_limit_settings"("user_id", "provider");
CREATE INDEX "provider_rate_limit_settings_provider_idx" ON "provider_rate_limit_settings"("provider");
