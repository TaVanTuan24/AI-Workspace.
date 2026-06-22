-- CreateTable
CREATE TABLE "internal_api_key_model_scopes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "internal_api_key_model_scopes_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "internal_api_keys" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "internal_api_key_model_scopes_api_key_id_idx" ON "internal_api_key_model_scopes"("api_key_id");

-- CreateIndex
CREATE INDEX "internal_api_key_model_scopes_model_id_idx" ON "internal_api_key_model_scopes"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX "internal_api_key_model_scopes_api_key_id_model_id_key" ON "internal_api_key_model_scopes"("api_key_id", "model_id");
