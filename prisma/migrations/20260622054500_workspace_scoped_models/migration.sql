-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- [FIX FOR SHADOW DB] Table was missing from previous migrations
CREATE TABLE "notification_webhook_destinations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "encrypted_url" TEXT NOT NULL,
    "encrypted_signing_secret" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "route_kinds" TEXT,
    "route_severities" TEXT,
    "route_priorities" TEXT,
    "failover_enabled" BOOLEAN NOT NULL DEFAULT true,
    "max_attempts" INTEGER,
    "timeout_ms" INTEGER,
    "payload_format" TEXT NOT NULL DEFAULT 'uaiw_default',
    "payload_fields" TEXT,
    "include_action_href" BOOLEAN NOT NULL DEFAULT true,
    "include_delivery_metadata" BOOLEAN NOT NULL DEFAULT true,
    "include_routing_metadata" BOOLEAN NOT NULL DEFAULT true,
    "last_success_at" DATETIME,
    "last_failure_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_webhook_destinations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "new_internal_api_keys" (
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
INSERT INTO "new_internal_api_keys" ("created_at", "id", "key_hash", "key_last4", "key_prefix", "last_used_at", "name", "rate_limit_per_minute", "revoked_at", "rotated_at", "status", "user_id") SELECT "created_at", "id", "key_hash", "key_last4", "key_prefix", "last_used_at", "name", "rate_limit_per_minute", "revoked_at", "rotated_at", "status", "user_id" FROM "internal_api_keys";
DROP TABLE "internal_api_keys";
ALTER TABLE "new_internal_api_keys" RENAME TO "internal_api_keys";
CREATE INDEX "internal_api_keys_user_id_idx" ON "internal_api_keys"("user_id");
CREATE INDEX "internal_api_keys_key_prefix_idx" ON "internal_api_keys"("key_prefix");
CREATE INDEX "internal_api_keys_status_idx" ON "internal_api_keys"("status");
CREATE INDEX "internal_api_keys_workspace_id_idx" ON "internal_api_keys"("workspace_id");
CREATE TABLE "new_internal_api_usage_logs" (
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
INSERT INTO "new_internal_api_usage_logs" ("api_key_id", "api_key_last4", "api_key_name", "api_key_prefix", "created_at", "duration_ms", "endpoint", "error_code", "error_type", "id", "input_char_count", "job_id", "limit_per_minute", "limit_type", "message_count", "model", "output_char_count", "provider", "queued_ms", "request_id", "source", "status", "stream", "user_id", "worker_duration_ms") SELECT "api_key_id", "api_key_last4", "api_key_name", "api_key_prefix", "created_at", "duration_ms", "endpoint", "error_code", "error_type", "id", "input_char_count", "job_id", "limit_per_minute", "limit_type", "message_count", "model", "output_char_count", "provider", "queued_ms", "request_id", "source", "status", "stream", "user_id", "worker_duration_ms" FROM "internal_api_usage_logs";
DROP TABLE "internal_api_usage_logs";
ALTER TABLE "new_internal_api_usage_logs" RENAME TO "internal_api_usage_logs";
CREATE INDEX "internal_api_usage_logs_user_id_created_at_idx" ON "internal_api_usage_logs"("user_id", "created_at");
CREATE INDEX "internal_api_usage_logs_api_key_id_created_at_idx" ON "internal_api_usage_logs"("api_key_id", "created_at");
CREATE INDEX "internal_api_usage_logs_model_created_at_idx" ON "internal_api_usage_logs"("model", "created_at");
CREATE INDEX "internal_api_usage_logs_provider_created_at_idx" ON "internal_api_usage_logs"("provider", "created_at");
CREATE INDEX "internal_api_usage_logs_status_created_at_idx" ON "internal_api_usage_logs"("status", "created_at");
CREATE INDEX "internal_api_usage_logs_workspace_id_idx" ON "internal_api_usage_logs"("workspace_id");
CREATE TABLE "new_notification_dead_letters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "notification_event_id" TEXT NOT NULL,
    "delivery_attempt_id" TEXT,
    "channel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "failure_code" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "first_failed_at" DATETIME NOT NULL,
    "dead_lettered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_retry_at" DATETIME,
    "resolved_at" DATETIME,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "metadata_json" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_dead_letters_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_dead_letters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_dead_letters_notification_event_id_fkey" FOREIGN KEY ("notification_event_id") REFERENCES "notification_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_dead_letters_delivery_attempt_id_fkey" FOREIGN KEY ("delivery_attempt_id") REFERENCES "notification_delivery_attempts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_notification_dead_letters" ("channel", "created_at", "dead_lettered_at", "delivery_attempt_id", "failure_code", "first_failed_at", "id", "last_retry_at", "metadata_json", "notification_event_id", "reason", "resolved_at", "retry_count", "retryable", "status", "updated_at", "user_id") SELECT "channel", "created_at", "dead_lettered_at", "delivery_attempt_id", "failure_code", "first_failed_at", "id", "last_retry_at", "metadata_json", "notification_event_id", "reason", "resolved_at", "retry_count", "retryable", "status", "updated_at", "user_id" FROM "notification_dead_letters";
DROP TABLE "notification_dead_letters";
ALTER TABLE "new_notification_dead_letters" RENAME TO "notification_dead_letters";
CREATE INDEX "notification_dead_letters_user_id_dead_lettered_at_idx" ON "notification_dead_letters"("user_id", "dead_lettered_at");
CREATE INDEX "notification_dead_letters_user_id_channel_idx" ON "notification_dead_letters"("user_id", "channel");
CREATE INDEX "notification_dead_letters_user_id_notification_event_id_idx" ON "notification_dead_letters"("user_id", "notification_event_id");
CREATE INDEX "notification_dead_letters_user_id_status_idx" ON "notification_dead_letters"("user_id", "status");
CREATE INDEX "notification_dead_letters_workspace_id_idx" ON "notification_dead_letters"("workspace_id");
CREATE TABLE "new_notification_delivery_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
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
    CONSTRAINT "notification_delivery_attempts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_delivery_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_delivery_attempts_notification_event_id_fkey" FOREIGN KEY ("notification_event_id") REFERENCES "notification_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_notification_delivery_attempts" ("attempt_number", "attempted_at", "channel", "error_code", "id", "job_id", "metadata_json", "next_retry_at", "notification_event_id", "retryable", "status", "user_id") SELECT "attempt_number", "attempted_at", "channel", "error_code", "id", "job_id", "metadata_json", "next_retry_at", "notification_event_id", "retryable", "status", "user_id" FROM "notification_delivery_attempts";
DROP TABLE "notification_delivery_attempts";
ALTER TABLE "new_notification_delivery_attempts" RENAME TO "notification_delivery_attempts";
CREATE INDEX "notification_delivery_attempts_user_id_attempted_at_idx" ON "notification_delivery_attempts"("user_id", "attempted_at");
CREATE INDEX "notification_delivery_attempts_notification_event_id_idx" ON "notification_delivery_attempts"("notification_event_id");
CREATE INDEX "notification_delivery_attempts_user_id_channel_idx" ON "notification_delivery_attempts"("user_id", "channel");
CREATE INDEX "notification_delivery_attempts_workspace_id_idx" ON "notification_delivery_attempts"("workspace_id");
CREATE TABLE "new_notification_delivery_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_delivery_preferences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_delivery_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_notification_delivery_preferences" ("channel", "config_json", "created_at", "enabled", "id", "updated_at", "user_id") SELECT "channel", "config_json", "created_at", "enabled", "id", "updated_at", "user_id" FROM "notification_delivery_preferences";
DROP TABLE "notification_delivery_preferences";
ALTER TABLE "new_notification_delivery_preferences" RENAME TO "notification_delivery_preferences";
CREATE INDEX "notification_delivery_preferences_user_id_idx" ON "notification_delivery_preferences"("user_id");
CREATE INDEX "notification_delivery_preferences_workspace_id_idx" ON "notification_delivery_preferences"("workspace_id");
CREATE UNIQUE INDEX "notification_delivery_preferences_user_id_channel_key" ON "notification_delivery_preferences"("user_id", "channel");
CREATE TABLE "new_notification_webhook_destinations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "encrypted_url" TEXT NOT NULL,
    "encrypted_signing_secret" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "route_kinds" TEXT,
    "route_severities" TEXT,
    "route_priorities" TEXT,
    "failover_enabled" BOOLEAN NOT NULL DEFAULT true,
    "max_attempts" INTEGER,
    "timeout_ms" INTEGER,
    "payload_format" TEXT NOT NULL DEFAULT 'uaiw_default',
    "payload_fields" TEXT,
    "include_action_href" BOOLEAN NOT NULL DEFAULT true,
    "include_delivery_metadata" BOOLEAN NOT NULL DEFAULT true,
    "include_routing_metadata" BOOLEAN NOT NULL DEFAULT true,
    "last_success_at" DATETIME,
    "last_failure_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_webhook_destinations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_webhook_destinations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_notification_webhook_destinations" ("created_at", "enabled", "encrypted_signing_secret", "encrypted_url", "failover_enabled", "id", "include_action_href", "include_delivery_metadata", "include_routing_metadata", "is_default", "last_failure_at", "last_success_at", "max_attempts", "name", "payload_fields", "payload_format", "priority", "route_kinds", "route_priorities", "route_severities", "timeout_ms", "updated_at", "user_id") SELECT "created_at", "enabled", "encrypted_signing_secret", "encrypted_url", "failover_enabled", "id", "include_action_href", "include_delivery_metadata", "include_routing_metadata", "is_default", "last_failure_at", "last_success_at", "max_attempts", "name", "payload_fields", "payload_format", "priority", "route_kinds", "route_priorities", "route_severities", "timeout_ms", "updated_at", "user_id" FROM "notification_webhook_destinations";
DROP TABLE "notification_webhook_destinations";
ALTER TABLE "new_notification_webhook_destinations" RENAME TO "notification_webhook_destinations";
CREATE INDEX "notification_webhook_destinations_user_id_enabled_idx" ON "notification_webhook_destinations"("user_id", "enabled");
CREATE INDEX "notification_webhook_destinations_user_id_priority_idx" ON "notification_webhook_destinations"("user_id", "priority");
CREATE INDEX "notification_webhook_destinations_workspace_id_idx" ON "notification_webhook_destinations"("workspace_id");
CREATE TABLE "new_provider_connections" (
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
INSERT INTO "new_provider_connections" ("browser_profile_id", "created_at", "encrypted_session_blob", "encrypted_session_ref", "encryption_version", "error_code", "error_message_safe", "id", "last_connected_at", "last_used_at", "last_validated_at", "provider", "status", "updated_at", "user_id") SELECT "browser_profile_id", "created_at", "encrypted_session_blob", "encrypted_session_ref", "encryption_version", "error_code", "error_message_safe", "id", "last_connected_at", "last_used_at", "last_validated_at", "provider", "status", "updated_at", "user_id" FROM "provider_connections";
DROP TABLE "provider_connections";
ALTER TABLE "new_provider_connections" RENAME TO "provider_connections";
CREATE INDEX "provider_connections_status_idx" ON "provider_connections"("status");
CREATE INDEX "provider_connections_workspace_id_idx" ON "provider_connections"("workspace_id");
CREATE UNIQUE INDEX "provider_connections_user_id_provider_key" ON "provider_connections"("user_id", "provider");
CREATE TABLE "new_provider_diagnostics_baselines" (
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
INSERT INTO "new_provider_diagnostics_baselines" ("connection_id", "created_at", "detected_capabilities_json", "fingerprint", "id", "is_active", "metadata_json", "missing_capabilities_json", "name", "provider", "selector_hints_json", "source_run_id", "status", "updated_at", "user_id") SELECT "connection_id", "created_at", "detected_capabilities_json", "fingerprint", "id", "is_active", "metadata_json", "missing_capabilities_json", "name", "provider", "selector_hints_json", "source_run_id", "status", "updated_at", "user_id" FROM "provider_diagnostics_baselines";
DROP TABLE "provider_diagnostics_baselines";
ALTER TABLE "new_provider_diagnostics_baselines" RENAME TO "provider_diagnostics_baselines";
CREATE INDEX "provider_diagnostics_baselines_user_id_provider_is_active_idx" ON "provider_diagnostics_baselines"("user_id", "provider", "is_active");
CREATE INDEX "provider_diagnostics_baselines_user_id_connection_id_idx" ON "provider_diagnostics_baselines"("user_id", "connection_id");
CREATE INDEX "provider_diagnostics_baselines_workspace_id_idx" ON "provider_diagnostics_baselines"("workspace_id");
CREATE TABLE "new_provider_diagnostics_drift_alerts" (
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
INSERT INTO "new_provider_diagnostics_drift_alerts" ("added_detected_capabilities_json", "added_missing_capabilities_json", "baseline_id", "changed_selector_hints_json", "connection_id", "created_at", "diagnostics_run_id", "drift_score", "id", "metadata_json", "notification_event_id", "provider", "provider_health_incident_id", "removed_detected_capabilities_json", "removed_missing_capabilities_json", "resolved_at", "severity", "status", "summary", "updated_at", "user_id") SELECT "added_detected_capabilities_json", "added_missing_capabilities_json", "baseline_id", "changed_selector_hints_json", "connection_id", "created_at", "diagnostics_run_id", "drift_score", "id", "metadata_json", "notification_event_id", "provider", "provider_health_incident_id", "removed_detected_capabilities_json", "removed_missing_capabilities_json", "resolved_at", "severity", "status", "summary", "updated_at", "user_id" FROM "provider_diagnostics_drift_alerts";
DROP TABLE "provider_diagnostics_drift_alerts";
ALTER TABLE "new_provider_diagnostics_drift_alerts" RENAME TO "provider_diagnostics_drift_alerts";
CREATE INDEX "provider_diagnostics_drift_alerts_user_id_provider_status_idx" ON "provider_diagnostics_drift_alerts"("user_id", "provider", "status");
CREATE INDEX "provider_diagnostics_drift_alerts_user_id_created_at_idx" ON "provider_diagnostics_drift_alerts"("user_id", "created_at");
CREATE INDEX "provider_diagnostics_drift_alerts_user_id_baseline_id_idx" ON "provider_diagnostics_drift_alerts"("user_id", "baseline_id");
CREATE INDEX "provider_diagnostics_drift_alerts_workspace_id_idx" ON "provider_diagnostics_drift_alerts"("workspace_id");
CREATE TABLE "new_provider_diagnostics_runs" (
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
INSERT INTO "new_provider_diagnostics_runs" ("completed_at", "connection_id", "created_at", "detected_capabilities_json", "duration_ms", "id", "incident_id", "metadata_json", "missing_capabilities_json", "provider", "reason", "redaction_stats_json", "selector_hints_json", "severity", "started_at", "status", "summary", "user_id") SELECT "completed_at", "connection_id", "created_at", "detected_capabilities_json", "duration_ms", "id", "incident_id", "metadata_json", "missing_capabilities_json", "provider", "reason", "redaction_stats_json", "selector_hints_json", "severity", "started_at", "status", "summary", "user_id" FROM "provider_diagnostics_runs";
DROP TABLE "provider_diagnostics_runs";
ALTER TABLE "new_provider_diagnostics_runs" RENAME TO "provider_diagnostics_runs";
CREATE INDEX "provider_diagnostics_runs_user_id_provider_started_at_idx" ON "provider_diagnostics_runs"("user_id", "provider", "started_at");
CREATE INDEX "provider_diagnostics_runs_user_id_incident_id_idx" ON "provider_diagnostics_runs"("user_id", "incident_id");
CREATE INDEX "provider_diagnostics_runs_user_id_status_idx" ON "provider_diagnostics_runs"("user_id", "status");
CREATE INDEX "provider_diagnostics_runs_workspace_id_idx" ON "provider_diagnostics_runs"("workspace_id");
CREATE TABLE "new_provider_health_incidents" (
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
INSERT INTO "new_provider_health_incidents" ("connection_id", "created_at", "fingerprint", "id", "last_seen_at", "metadata", "notification_event_id", "occurrence_count", "previous_status", "provider", "reason", "resolved_at", "severity", "started_at", "status", "updated_at", "user_id") SELECT "connection_id", "created_at", "fingerprint", "id", "last_seen_at", "metadata", "notification_event_id", "occurrence_count", "previous_status", "provider", "reason", "resolved_at", "severity", "started_at", "status", "updated_at", "user_id" FROM "provider_health_incidents";
DROP TABLE "provider_health_incidents";
ALTER TABLE "new_provider_health_incidents" RENAME TO "provider_health_incidents";
CREATE INDEX "provider_health_incidents_user_id_provider_started_at_idx" ON "provider_health_incidents"("user_id", "provider", "started_at");
CREATE INDEX "provider_health_incidents_user_id_status_idx" ON "provider_health_incidents"("user_id", "status");
CREATE INDEX "provider_health_incidents_user_id_resolved_at_idx" ON "provider_health_incidents"("user_id", "resolved_at");
CREATE INDEX "provider_health_incidents_workspace_id_idx" ON "provider_health_incidents"("workspace_id");
CREATE TABLE "new_provider_rate_limit_settings" (
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
INSERT INTO "new_provider_rate_limit_settings" ("created_at", "enabled", "id", "provider", "requests_per_minute", "updated_at", "user_id") SELECT "created_at", "enabled", "id", "provider", "requests_per_minute", "updated_at", "user_id" FROM "provider_rate_limit_settings";
DROP TABLE "provider_rate_limit_settings";
ALTER TABLE "new_provider_rate_limit_settings" RENAME TO "provider_rate_limit_settings";
CREATE INDEX "provider_rate_limit_settings_provider_idx" ON "provider_rate_limit_settings"("provider");
CREATE INDEX "provider_rate_limit_settings_workspace_id_idx" ON "provider_rate_limit_settings"("workspace_id");
CREATE UNIQUE INDEX "provider_rate_limit_settings_user_id_provider_key" ON "provider_rate_limit_settings"("user_id", "provider");
CREATE TABLE "new_provider_recovery_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "policy_run_id" TEXT,
    "action_type" TEXT NOT NULL,
    "provider" TEXT,
    "model_id" TEXT,
    "sub_model_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reason" TEXT,
    "safe_summary" TEXT,
    "previous_state" TEXT,
    "override_state" TEXT,
    "starts_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "resolved_at" DATETIME,
    "resolution" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_recovery_overrides_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_recovery_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_provider_recovery_overrides" ("action_type", "created_at", "expires_at", "id", "model_id", "override_state", "policy_id", "policy_run_id", "previous_state", "provider", "reason", "resolution", "resolved_at", "safe_summary", "starts_at", "status", "sub_model_id", "updated_at", "user_id") SELECT "action_type", "created_at", "expires_at", "id", "model_id", "override_state", "policy_id", "policy_run_id", "previous_state", "provider", "reason", "resolution", "resolved_at", "safe_summary", "starts_at", "status", "sub_model_id", "updated_at", "user_id" FROM "provider_recovery_overrides";
DROP TABLE "provider_recovery_overrides";
ALTER TABLE "new_provider_recovery_overrides" RENAME TO "provider_recovery_overrides";
CREATE INDEX "provider_recovery_overrides_user_id_status_idx" ON "provider_recovery_overrides"("user_id", "status");
CREATE INDEX "provider_recovery_overrides_user_id_provider_idx" ON "provider_recovery_overrides"("user_id", "provider");
CREATE INDEX "provider_recovery_overrides_user_id_expires_at_idx" ON "provider_recovery_overrides"("user_id", "expires_at");
CREATE INDEX "provider_recovery_overrides_user_id_policy_run_id_idx" ON "provider_recovery_overrides"("user_id", "policy_run_id");
CREATE INDEX "provider_recovery_overrides_workspace_id_idx" ON "provider_recovery_overrides"("workspace_id");
CREATE TABLE "new_provider_recovery_policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger_types" TEXT NOT NULL,
    "providers" TEXT,
    "severities" TEXT,
    "statuses" TEXT,
    "actions" TEXT NOT NULL,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "last_triggered_at" DATETIME,
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_recovery_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_recovery_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_provider_recovery_policies" ("actions", "cooldown_minutes", "created_at", "enabled", "id", "last_triggered_at", "name", "providers", "severities", "statuses", "trigger_count", "trigger_types", "updated_at", "user_id") SELECT "actions", "cooldown_minutes", "created_at", "enabled", "id", "last_triggered_at", "name", "providers", "severities", "statuses", "trigger_count", "trigger_types", "updated_at", "user_id" FROM "provider_recovery_policies";
DROP TABLE "provider_recovery_policies";
ALTER TABLE "new_provider_recovery_policies" RENAME TO "provider_recovery_policies";
CREATE INDEX "provider_recovery_policies_user_id_enabled_idx" ON "provider_recovery_policies"("user_id", "enabled");
CREATE INDEX "provider_recovery_policies_workspace_id_idx" ON "provider_recovery_policies"("workspace_id");
CREATE TABLE "new_provider_recovery_policy_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "trigger_ref_id" TEXT,
    "provider" TEXT,
    "severity" TEXT,
    "status" TEXT NOT NULL,
    "actions_attempted" TEXT,
    "actions_succeeded" TEXT,
    "actions_failed" TEXT,
    "skipped_reason" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    "metadata" TEXT,
    CONSTRAINT "provider_recovery_policy_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_recovery_policy_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_recovery_policy_runs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "provider_recovery_policies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_provider_recovery_policy_runs" ("actions_attempted", "actions_failed", "actions_succeeded", "completed_at", "id", "metadata", "policy_id", "provider", "severity", "skipped_reason", "started_at", "status", "trigger_ref_id", "trigger_type", "user_id") SELECT "actions_attempted", "actions_failed", "actions_succeeded", "completed_at", "id", "metadata", "policy_id", "provider", "severity", "skipped_reason", "started_at", "status", "trigger_ref_id", "trigger_type", "user_id" FROM "provider_recovery_policy_runs";
DROP TABLE "provider_recovery_policy_runs";
ALTER TABLE "new_provider_recovery_policy_runs" RENAME TO "provider_recovery_policy_runs";
CREATE INDEX "provider_recovery_policy_runs_user_id_policy_id_started_at_idx" ON "provider_recovery_policy_runs"("user_id", "policy_id", "started_at");
CREATE INDEX "provider_recovery_policy_runs_user_id_status_idx" ON "provider_recovery_policy_runs"("user_id", "status");
CREATE INDEX "provider_recovery_policy_runs_workspace_id_idx" ON "provider_recovery_policy_runs"("workspace_id");
CREATE TABLE "new_user_model_preferences" (
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
INSERT INTO "new_user_model_preferences" ("created_at", "enabled", "id", "is_default", "model_id", "priority", "provider", "selected_sub_model_id", "selected_sub_model_label", "updated_at", "user_id") SELECT "created_at", "enabled", "id", "is_default", "model_id", "priority", "provider", "selected_sub_model_id", "selected_sub_model_label", "updated_at", "user_id" FROM "user_model_preferences";
DROP TABLE "user_model_preferences";
ALTER TABLE "new_user_model_preferences" RENAME TO "user_model_preferences";
CREATE INDEX "user_model_preferences_user_id_enabled_idx" ON "user_model_preferences"("user_id", "enabled");
CREATE INDEX "user_model_preferences_user_id_priority_idx" ON "user_model_preferences"("user_id", "priority");
CREATE INDEX "user_model_preferences_workspace_id_idx" ON "user_model_preferences"("workspace_id");
CREATE UNIQUE INDEX "user_model_preferences_user_id_model_id_key" ON "user_model_preferences"("user_id", "model_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

