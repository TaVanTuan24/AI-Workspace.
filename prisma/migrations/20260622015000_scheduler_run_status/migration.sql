-- CreateTable
CREATE TABLE "scheduler_run_statuses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "last_started_at" DATETIME,
    "last_finished_at" DATETIME,
    "last_status" TEXT,
    "last_error" TEXT,
    "last_lock_acquired" BOOLEAN,
    "last_summary" TEXT,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_run_statuses_name_key" ON "scheduler_run_statuses"("name");
