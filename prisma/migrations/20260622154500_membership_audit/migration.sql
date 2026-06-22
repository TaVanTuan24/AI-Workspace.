-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_role_audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "target_user_id" TEXT,
    "previous_role" TEXT,
    "next_role" TEXT,
    "invite_id" TEXT,
    "action" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_role_audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_role_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_role_audit_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_user_role_audit_events" ("action", "actor_user_id", "created_at", "id", "next_role", "previous_role", "target_user_id", "workspace_id") SELECT "action", "actor_user_id", "created_at", "id", "next_role", "previous_role", "target_user_id", "workspace_id" FROM "user_role_audit_events";
DROP TABLE "user_role_audit_events";
ALTER TABLE "new_user_role_audit_events" RENAME TO "user_role_audit_events";
CREATE INDEX "user_role_audit_events_workspace_id_created_at_idx" ON "user_role_audit_events"("workspace_id", "created_at");
CREATE INDEX "user_role_audit_events_actor_user_id_created_at_idx" ON "user_role_audit_events"("actor_user_id", "created_at");
CREATE INDEX "user_role_audit_events_target_user_id_created_at_idx" ON "user_role_audit_events"("target_user_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
