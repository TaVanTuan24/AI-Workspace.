-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "local_auth_secret" TEXT,
    "display_name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "workspace_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_connected',
    "encrypted_session_ref" TEXT,
    "encrypted_session_blob" TEXT,
    "encryption_version" INTEGER,
    "browser_profile_id" TEXT,
    "last_connected_at" DATETIME,
    "last_used_at" DATETIME,
    "last_validated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "error_code" TEXT,
    "error_message_safe" TEXT,
    CONSTRAINT "provider_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "provider_diagnostics_baselines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connection_id" TEXT,
    "name" TEXT NOT NULL,
    "source_run_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "detected_capabilities_json" TEXT,
    "missing_capabilities_json" TEXT,
    "selector_hints_json" TEXT,
    "metadata_json" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_diagnostics_baselines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_diagnostics_baselines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "provider_diagnostics_drift_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connection_id" TEXT,
    "baseline_id" TEXT,
    "diagnostics_run_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "drift_score" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "added_detected_capabilities_json" TEXT,
    "removed_detected_capabilities_json" TEXT,
    "added_missing_capabilities_json" TEXT,
    "removed_missing_capabilities_json" TEXT,
    "changed_selector_hints_json" TEXT,
    "metadata_json" TEXT,
    "notification_event_id" TEXT,
    "provider_health_incident_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_diagnostics_drift_alerts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_diagnostics_drift_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "provider_conversations_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "chat_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_quotas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'local',
    "max_members" INTEGER,
    "max_invites" INTEGER,
    "max_api_keys" INTEGER,
    "max_provider_connections" INTEGER,
    "max_diagnostics_baselines" INTEGER,
    "max_monthly_api_requests" INTEGER,
    "max_monthly_invite_emails" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "workspace_quotas_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_quota_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "resource" TEXT NOT NULL,
    "limit" INTEGER,
    "used" INTEGER NOT NULL,
    "attempted_increment" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_quota_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "automation_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "thread_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "input_json" TEXT NOT NULL,
    "output_json" TEXT,
    "error_code" TEXT,
    "error_message_safe" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "automation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "automation_jobs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "provider" TEXT,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "request_id" TEXT,
    "ip_hash" TEXT,
    "metadata_safe_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_role_audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "target_user_id" TEXT,
    "previous_role" TEXT,
    "next_role" TEXT,
    "previous_status" TEXT,
    "next_status" TEXT,
    "invite_id" TEXT,
    "action" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_role_audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_role_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_role_audit_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "internal_api_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_last4" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME,
    "revoked_at" DATETIME,
    "rotated_at" DATETIME,
    "rate_limit_per_minute" INTEGER,
    CONSTRAINT "internal_api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "internal_api_usage_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "api_key_prefix" TEXT,
    "api_key_last4" TEXT,
    "api_key_name" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source" TEXT,
    "endpoint" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "job_id" TEXT,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "error_type" TEXT,
    "limit_type" TEXT,
    "limit_per_minute" INTEGER,
    "stream" BOOLEAN NOT NULL,
    "message_count" INTEGER NOT NULL,
    "input_char_count" INTEGER NOT NULL,
    "output_char_count" INTEGER,
    "duration_ms" INTEGER,
    "queued_ms" INTEGER,
    "worker_duration_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "internal_api_usage_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_api_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_api_usage_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "internal_api_keys" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "auto_select_first_usable" BOOLEAN NOT NULL DEFAULT true,
    "onboarding_completed_at" DATETIME,
    "onboarding_skipped_at" DATETIME,
    "onboarding_last_step" TEXT,
    "notify_provider_session_issues" BOOLEAN NOT NULL DEFAULT true,
    "notify_no_usable_models" BOOLEAN NOT NULL DEFAULT true,
    "notify_provider_limit_spikes" BOOLEAN NOT NULL DEFAULT true,
    "provider_limit_spike_threshold_24h" INTEGER NOT NULL DEFAULT 10,
    "notify_workspace_quota_warnings" BOOLEAN NOT NULL DEFAULT true,
    "notify_workspace_quota_exceeded" BOOLEAN NOT NULL DEFAULT true,
    "workspace_quota_warning_threshold_percent" INTEGER NOT NULL DEFAULT 90,
    CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_model_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "selected_sub_model_id" TEXT DEFAULT 'current',
    "selected_sub_model_label" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_model_preferences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_model_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "provider_rate_limit_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requests_per_minute" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_rate_limit_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_rate_limit_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "internal_api_key_model_scopes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "api_key_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "internal_api_key_model_scopes_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "internal_api_keys" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "provider_health_incidents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connection_id" TEXT,
    "status" TEXT NOT NULL,
    "previous_status" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "reason" TEXT,
    "fingerprint" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "notification_event_id" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_health_incidents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_health_incidents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "provider_diagnostics_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connection_id" TEXT,
    "incident_id" TEXT,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "reason" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "detected_capabilities_json" TEXT,
    "missing_capabilities_json" TEXT,
    "selector_hints_json" TEXT,
    "redaction_stats_json" TEXT,
    "metadata_json" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    "duration_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_diagnostics_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_diagnostics_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_memberships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "workspace_memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" DATETIME NOT NULL,
    "accepted_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    CONSTRAINT "workspace_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_workspace_id_idx" ON "users"("workspace_id");

-- CreateIndex
CREATE INDEX "provider_connections_status_idx" ON "provider_connections"("status");

-- CreateIndex
CREATE INDEX "provider_connections_workspace_id_idx" ON "provider_connections"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_user_id_provider_key" ON "provider_connections"("user_id", "provider");

-- CreateIndex
CREATE INDEX "provider_diagnostics_baselines_user_id_provider_is_active_idx" ON "provider_diagnostics_baselines"("user_id", "provider", "is_active");

-- CreateIndex
CREATE INDEX "provider_diagnostics_baselines_user_id_connection_id_idx" ON "provider_diagnostics_baselines"("user_id", "connection_id");

-- CreateIndex
CREATE INDEX "provider_diagnostics_baselines_workspace_id_idx" ON "provider_diagnostics_baselines"("workspace_id");

-- CreateIndex
CREATE INDEX "provider_diagnostics_drift_alerts_user_id_provider_status_idx" ON "provider_diagnostics_drift_alerts"("user_id", "provider", "status");

-- CreateIndex
CREATE INDEX "provider_diagnostics_drift_alerts_user_id_created_at_idx" ON "provider_diagnostics_drift_alerts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_diagnostics_drift_alerts_user_id_baseline_id_idx" ON "provider_diagnostics_drift_alerts"("user_id", "baseline_id");

-- CreateIndex
CREATE INDEX "provider_diagnostics_drift_alerts_workspace_id_idx" ON "provider_diagnostics_drift_alerts"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_run_statuses_name_key" ON "scheduler_run_statuses"("name");

-- CreateIndex
CREATE INDEX "chat_threads_user_id_updated_at_idx" ON "chat_threads"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_user_id_created_at_idx" ON "messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "message_attachments_user_id_status_created_at_idx" ON "message_attachments"("user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_quotas_workspace_id_key" ON "workspace_quotas"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_quota_events_workspace_id_created_at_idx" ON "workspace_quota_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_quota_events_workspace_id_resource_created_at_idx" ON "workspace_quota_events"("workspace_id", "resource", "created_at");

-- CreateIndex
CREATE INDEX "automation_jobs_user_id_provider_status_idx" ON "automation_jobs"("user_id", "provider", "status");

-- CreateIndex
CREATE INDEX "automation_jobs_thread_id_idx" ON "automation_jobs"("thread_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "user_role_audit_events_workspace_id_created_at_idx" ON "user_role_audit_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "user_role_audit_events_actor_user_id_created_at_idx" ON "user_role_audit_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_role_audit_events_target_user_id_created_at_idx" ON "user_role_audit_events"("target_user_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_keys_user_id_idx" ON "internal_api_keys"("user_id");

-- CreateIndex
CREATE INDEX "internal_api_keys_key_prefix_idx" ON "internal_api_keys"("key_prefix");

-- CreateIndex
CREATE INDEX "internal_api_keys_status_idx" ON "internal_api_keys"("status");

-- CreateIndex
CREATE INDEX "internal_api_keys_workspace_id_idx" ON "internal_api_keys"("workspace_id");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_user_id_created_at_idx" ON "internal_api_usage_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_api_key_id_created_at_idx" ON "internal_api_usage_logs"("api_key_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_model_created_at_idx" ON "internal_api_usage_logs"("model", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_provider_created_at_idx" ON "internal_api_usage_logs"("provider", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_status_created_at_idx" ON "internal_api_usage_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "internal_api_usage_logs_workspace_id_idx" ON "internal_api_usage_logs"("workspace_id");

-- CreateIndex
CREATE INDEX "user_model_preferences_user_id_enabled_idx" ON "user_model_preferences"("user_id", "enabled");

-- CreateIndex
CREATE INDEX "user_model_preferences_user_id_priority_idx" ON "user_model_preferences"("user_id", "priority");

-- CreateIndex
CREATE INDEX "user_model_preferences_workspace_id_idx" ON "user_model_preferences"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_model_preferences_user_id_model_id_key" ON "user_model_preferences"("user_id", "model_id");

-- CreateIndex
CREATE INDEX "provider_rate_limit_settings_provider_idx" ON "provider_rate_limit_settings"("provider");

-- CreateIndex
CREATE INDEX "provider_rate_limit_settings_workspace_id_idx" ON "provider_rate_limit_settings"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_rate_limit_settings_user_id_provider_key" ON "provider_rate_limit_settings"("user_id", "provider");

-- CreateIndex
CREATE INDEX "internal_api_key_model_scopes_api_key_id_idx" ON "internal_api_key_model_scopes"("api_key_id");

-- CreateIndex
CREATE INDEX "internal_api_key_model_scopes_model_id_idx" ON "internal_api_key_model_scopes"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX "internal_api_key_model_scopes_api_key_id_model_id_key" ON "internal_api_key_model_scopes"("api_key_id", "model_id");

-- CreateIndex
CREATE INDEX "notification_events_user_id_read_at_idx" ON "notification_events"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notification_events_user_id_created_at_idx" ON "notification_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_events_user_id_kind_idx" ON "notification_events"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_user_id_fingerprint_key" ON "notification_events"("user_id", "fingerprint");

-- CreateIndex
CREATE INDEX "provider_live_sub_model_cache_user_id_detected_at_idx" ON "provider_live_sub_model_cache"("user_id", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_live_sub_model_cache_user_id_provider_key" ON "provider_live_sub_model_cache"("user_id", "provider");

-- CreateIndex
CREATE INDEX "provider_health_incidents_user_id_provider_started_at_idx" ON "provider_health_incidents"("user_id", "provider", "started_at");

-- CreateIndex
CREATE INDEX "provider_health_incidents_user_id_status_idx" ON "provider_health_incidents"("user_id", "status");

-- CreateIndex
CREATE INDEX "provider_health_incidents_user_id_resolved_at_idx" ON "provider_health_incidents"("user_id", "resolved_at");

-- CreateIndex
CREATE INDEX "provider_health_incidents_workspace_id_idx" ON "provider_health_incidents"("workspace_id");

-- CreateIndex
CREATE INDEX "provider_diagnostics_runs_user_id_provider_started_at_idx" ON "provider_diagnostics_runs"("user_id", "provider", "started_at");

-- CreateIndex
CREATE INDEX "provider_diagnostics_runs_user_id_incident_id_idx" ON "provider_diagnostics_runs"("user_id", "incident_id");

-- CreateIndex
CREATE INDEX "provider_diagnostics_runs_user_id_status_idx" ON "provider_diagnostics_runs"("user_id", "status");

-- CreateIndex
CREATE INDEX "provider_diagnostics_runs_workspace_id_idx" ON "provider_diagnostics_runs"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_memberships_user_id_idx" ON "workspace_memberships"("user_id");

-- CreateIndex
CREATE INDEX "workspace_memberships_workspace_id_idx" ON "workspace_memberships"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_memberships_workspace_id_role_idx" ON "workspace_memberships"("workspace_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_memberships_workspace_id_user_id_key" ON "workspace_memberships"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "workspace_invites_workspace_id_status_idx" ON "workspace_invites"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "workspace_invites_email_idx" ON "workspace_invites"("email");

-- CreateIndex
CREATE INDEX "workspace_invites_token_hash_idx" ON "workspace_invites"("token_hash");

-- CreateIndex
CREATE INDEX "workspace_invite_delivery_attempts_workspace_id_created_at_idx" ON "workspace_invite_delivery_attempts"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_invite_delivery_attempts_invite_id_idx" ON "workspace_invite_delivery_attempts"("invite_id");

