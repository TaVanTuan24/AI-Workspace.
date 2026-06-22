-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "provider" TEXT,
    "model_id" TEXT,
    "fingerprint" TEXT NOT NULL,
    "action_label" TEXT,
    "action_href" TEXT,
    "metadata_json" TEXT,
    "read_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "notification_events_user_id_read_at_idx" ON "notification_events"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notification_events_user_id_created_at_idx" ON "notification_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_events_user_id_kind_idx" ON "notification_events"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_user_id_fingerprint_key" ON "notification_events"("user_id", "fingerprint");
