-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_notification_delivery_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "notification_event_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "attempted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata_json" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "next_retry_at" DATETIME,
    "job_id" TEXT,
    CONSTRAINT "notification_delivery_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_delivery_attempts_notification_event_id_fkey" FOREIGN KEY ("notification_event_id") REFERENCES "notification_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_notification_delivery_attempts" ("attempted_at", "channel", "error_code", "id", "metadata_json", "notification_event_id", "status", "user_id") SELECT "attempted_at", "channel", "error_code", "id", "metadata_json", "notification_event_id", "status", "user_id" FROM "notification_delivery_attempts";
DROP TABLE "notification_delivery_attempts";
ALTER TABLE "new_notification_delivery_attempts" RENAME TO "notification_delivery_attempts";
CREATE INDEX "notification_delivery_attempts_user_id_attempted_at_idx" ON "notification_delivery_attempts"("user_id", "attempted_at");
CREATE INDEX "notification_delivery_attempts_notification_event_id_idx" ON "notification_delivery_attempts"("notification_event_id");
CREATE INDEX "notification_delivery_attempts_user_id_channel_idx" ON "notification_delivery_attempts"("user_id", "channel");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
CREATE TABLE "notification_dead_letters" ("id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "notification_event_id" TEXT NOT NULL, "delivery_attempt_id" TEXT, "channel" TEXT NOT NULL, "reason" TEXT NOT NULL, "failure_code" TEXT, "retryable" BOOLEAN NOT NULL DEFAULT true, "first_failed_at" DATETIME NOT NULL, "dead_lettered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "last_retry_at" DATETIME, "resolved_at" DATETIME, "retry_count" INTEGER NOT NULL DEFAULT 0, "metadata_json" TEXT, "status" TEXT NOT NULL DEFAULT 'open', "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME NOT NULL);