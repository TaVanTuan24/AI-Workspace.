CREATE TABLE "user_role_audit_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actor_user_id" TEXT NOT NULL,
  "target_user_id" TEXT NOT NULL,
  "previous_role" TEXT NOT NULL,
  "next_role" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_role_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_role_audit_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "user_role_audit_events_actor_user_id_created_at_idx" ON "user_role_audit_events"("actor_user_id", "created_at");
CREATE INDEX "user_role_audit_events_target_user_id_created_at_idx" ON "user_role_audit_events"("target_user_id", "created_at");
