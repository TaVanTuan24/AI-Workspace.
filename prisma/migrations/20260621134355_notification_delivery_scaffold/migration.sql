-- CreateTable
CREATE TABLE "notification_delivery_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_delivery_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_delivery_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "notification_event_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "attempted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata_json" TEXT,
    CONSTRAINT "notification_delivery_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_delivery_attempts_notification_event_id_fkey" FOREIGN KEY ("notification_event_id") REFERENCES "notification_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "notification_delivery_preferences_user_id_idx" ON "notification_delivery_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_preferences_user_id_channel_key" ON "notification_delivery_preferences"("user_id", "channel");

-- CreateIndex
CREATE INDEX "notification_delivery_attempts_user_id_attempted_at_idx" ON "notification_delivery_attempts"("user_id", "attempted_at");

-- CreateIndex
CREATE INDEX "notification_delivery_attempts_notification_event_id_idx" ON "notification_delivery_attempts"("notification_event_id");

-- CreateIndex
CREATE INDEX "notification_delivery_attempts_user_id_channel_idx" ON "notification_delivery_attempts"("user_id", "channel");
