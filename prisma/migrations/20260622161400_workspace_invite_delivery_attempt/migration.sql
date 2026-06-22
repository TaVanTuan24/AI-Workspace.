-- CreateTable
CREATE TABLE "workspace_invite_delivery_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "invite_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipient_email_redacted" TEXT,
    "reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_invite_delivery_attempts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_invite_delivery_attempts_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "workspace_invites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "workspace_invite_delivery_attempts_workspace_id_created_at_idx" ON "workspace_invite_delivery_attempts"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_invite_delivery_attempts_invite_id_idx" ON "workspace_invite_delivery_attempts"("invite_id");
