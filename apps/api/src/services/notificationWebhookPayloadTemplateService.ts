/**
 * Webhook Payload Template Service
 *
 * Builds safe, allowlisted webhook payloads for each destination.
 * Supports 4 built-in formats: uaiw_default, minimal, slack_compatible, custom_allowlist.
 *
 * Security rules:
 * - Only allowlisted fields may appear in output.
 * - No prompts, responses, sessions, cookies, tokens, API keys, secrets, encrypted values.
 * - Field values are truncated to safe lengths.
 * - Total payload is capped at 32KB.
 * - No template language, no eval, no remote includes.
 */

// ─── Allowlisted fields ───────────────────────────────────────────────

export const ALLOWED_PAYLOAD_FIELDS = [
  "event.id",
  "event.kind",
  "event.title",
  "event.message",
  "event.severity",
  "event.priority",
  "event.createdAt",
  "event.actionHref",
  "delivery.channel",
  "delivery.destinationId",
  "delivery.destinationName",
  "delivery.attemptId",
  "delivery.timestamp",
  "routing.reason",
  "routing.failoverIndex",
  "routing.failoverFromDestinationId",
] as const;

export type WebhookPayloadField = (typeof ALLOWED_PAYLOAD_FIELDS)[number];

export const SUPPORTED_PAYLOAD_FORMATS = [
  "uaiw_default",
  "minimal",
  "slack_compatible",
  "custom_allowlist",
] as const;

export type WebhookPayloadFormat = (typeof SUPPORTED_PAYLOAD_FORMATS)[number];

// ─── Forbidden keys (must never appear in output) ─────────────────────

const FORBIDDEN_OUTPUT_KEYS = [
  "token", "cookie", "session", "storageState",
  "apiKey", "apikey", "api_key",
  "secret", "signingSecret", "signing_secret",
  "encryptedUrl", "encrypted_url",
  "encryptedSigningSecret", "encrypted_signing_secret",
  "password", "passwordHash", "password_hash",
  "prompt", "response", "promptText", "responseText",
];

// ─── Truncation limits ────────────────────────────────────────────────

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_ACTION_HREF_LENGTH = 500;
const MAX_PAYLOAD_SIZE_BYTES = 32 * 1024; // 32KB

function truncate(value: string | null | undefined, maxLen: number): string | undefined {
  if (!value) return undefined;
  return value.length > maxLen ? value.substring(0, maxLen) + "…" : value;
}

// ─── Input / Output types ─────────────────────────────────────────────

export interface BuildWebhookPayloadInput {
  event: {
    id: string;
    kind: string;
    title: string;
    message: string;
    severity: string;
    priority?: string;
    createdAt: string;
    actionHref?: string | null;
  };
  destination: {
    id: string;
    name: string;
    payloadFormat: string;
    payloadFields?: string | null;         // JSON array string
    includeActionHref: boolean;
    includeDeliveryMetadata: boolean;
    includeRoutingMetadata: boolean;
  };
  deliveryAttemptId?: string;
  routing?: {
    reason?: string;
    failoverIndex?: number;
    failoverFromDestinationId?: string;
  };
  now?: Date;
}

export interface BuildWebhookPayloadResult {
  payload: Record<string, unknown>;
  rawBody: string;
  sizeBytes: number;
  schema: string;
  format: WebhookPayloadFormat;
  includedFields: string[];
  warnings: string[];
}

// ─── Validation ───────────────────────────────────────────────────────

export function validatePayloadConfig(
  format: string,
  fields?: string[] | null
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!SUPPORTED_PAYLOAD_FORMATS.includes(format as WebhookPayloadFormat)) {
    errors.push(`Unsupported payload format: ${format}. Supported: ${SUPPORTED_PAYLOAD_FORMATS.join(", ")}`);
  }

  if (format === "custom_allowlist") {
    if (!fields || fields.length === 0) {
      errors.push("custom_allowlist format requires at least one payload field.");
    } else if (fields.length > 30) {
      errors.push(`Too many payload fields (${fields.length}). Maximum is 30.`);
    } else {
      for (const f of fields) {
        if (!ALLOWED_PAYLOAD_FIELDS.includes(f as WebhookPayloadField)) {
          errors.push(`Invalid payload field: ${f}. Allowed: ${ALLOWED_PAYLOAD_FIELDS.join(", ")}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Forbidden key scanner ────────────────────────────────────────────

function assertNoForbiddenKeys(obj: Record<string, unknown>, path = ""): void {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    for (const forbidden of FORBIDDEN_OUTPUT_KEYS) {
      if (lower === forbidden.toLowerCase()) {
        throw new Error(`Forbidden key "${key}" found in webhook payload at "${path}${key}"`);
      }
    }
    if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
      assertNoForbiddenKeys(obj[key] as Record<string, unknown>, `${path}${key}.`);
    }
  }
}

// ─── Field resolver ───────────────────────────────────────────────────

function resolveField(field: WebhookPayloadField, input: BuildWebhookPayloadInput): unknown {
  const now = input.now ?? new Date();
  switch (field) {
    case "event.id": return input.event.id;
    case "event.kind": return input.event.kind;
    case "event.title": return truncate(input.event.title, MAX_TITLE_LENGTH);
    case "event.message": return truncate(input.event.message, MAX_MESSAGE_LENGTH);
    case "event.severity": return input.event.severity;
    case "event.priority": return input.event.priority ?? "normal";
    case "event.createdAt": return input.event.createdAt;
    case "event.actionHref":
      return input.destination.includeActionHref
        ? truncate(input.event.actionHref, MAX_ACTION_HREF_LENGTH)
        : undefined;
    case "delivery.channel": return "webhook";
    case "delivery.destinationId": return input.destination.id;
    case "delivery.destinationName": return input.destination.name;
    case "delivery.attemptId": return input.deliveryAttemptId;
    case "delivery.timestamp": return now.toISOString();
    case "routing.reason": return input.routing?.reason;
    case "routing.failoverIndex": return input.routing?.failoverIndex ?? 0;
    case "routing.failoverFromDestinationId": return input.routing?.failoverFromDestinationId;
    default: return undefined;
  }
}

// ─── Format builders ──────────────────────────────────────────────────

function buildUaiwDefault(input: BuildWebhookPayloadInput): BuildWebhookPayloadResult {
  const now = input.now ?? new Date();
  const includedFields: string[] = [
    "event.id", "event.kind", "event.title", "event.message",
    "event.severity", "event.createdAt",
  ];

  const event: Record<string, unknown> = {
    id: input.event.id,
    kind: input.event.kind,
    title: truncate(input.event.title, MAX_TITLE_LENGTH),
    message: truncate(input.event.message, MAX_MESSAGE_LENGTH),
    severity: input.event.severity,
    createdAt: input.event.createdAt,
  };

  if (input.destination.includeActionHref && input.event.actionHref) {
    event.actionHref = truncate(input.event.actionHref, MAX_ACTION_HREF_LENGTH);
    includedFields.push("event.actionHref");
  }

  const payload: Record<string, unknown> = {
    schema: "uaiw.notification.v1",
    event,
  };

  if (input.destination.includeDeliveryMetadata) {
    payload.delivery = {
      channel: "webhook",
      destinationId: input.destination.id,
      destinationName: input.destination.name,
      attemptId: input.deliveryAttemptId,
      timestamp: now.toISOString(),
    };
    includedFields.push("delivery.channel", "delivery.destinationId", "delivery.destinationName", "delivery.timestamp");
  }

  if (input.destination.includeRoutingMetadata && input.routing) {
    payload.routing = {
      reason: input.routing.reason,
      failoverIndex: input.routing.failoverIndex ?? 0,
    };
    includedFields.push("routing.reason", "routing.failoverIndex");
  }

  return finalize(payload, "uaiw.notification.v1", "uaiw_default", includedFields);
}

function buildMinimal(input: BuildWebhookPayloadInput): BuildWebhookPayloadResult {
  const payload: Record<string, unknown> = {
    schema: "uaiw.notification.minimal.v1",
    event: {
      id: input.event.id,
      kind: input.event.kind,
      severity: input.event.severity,
      createdAt: input.event.createdAt,
    },
  };

  return finalize(payload, "uaiw.notification.minimal.v1", "minimal", [
    "event.id", "event.kind", "event.severity", "event.createdAt",
  ]);
}

function buildSlackCompatible(input: BuildWebhookPayloadInput): BuildWebhookPayloadResult {
  const severity = input.event.severity;
  const title = truncate(input.event.title, MAX_TITLE_LENGTH) ?? "Notification";
  const message = truncate(input.event.message, MAX_MESSAGE_LENGTH) ?? "";

  // Sanitize for Slack mrkdwn: escape < > &
  const sanitize = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const severityEmoji: Record<string, string> = {
    critical: "🔴",
    error: "🟠",
    warning: "🟡",
    info: "🔵",
  };
  const emoji = severityEmoji[severity] ?? "⚪";

  const text = `${emoji} [${severity}] ${sanitize(title)}`;

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${sanitize(title)}*\n${sanitize(message)}`,
      },
    },
  ];

  if (input.destination.includeActionHref && input.event.actionHref) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Details" },
          url: truncate(input.event.actionHref, MAX_ACTION_HREF_LENGTH),
        },
      ],
    });
  }

  const payload: Record<string, unknown> = { text, blocks };

  return finalize(payload, "uaiw.notification.slack.v1", "slack_compatible", [
    "event.kind", "event.title", "event.message", "event.severity",
  ]);
}

function buildCustomAllowlist(input: BuildWebhookPayloadInput): BuildWebhookPayloadResult {
  const selectedFields: WebhookPayloadField[] = input.destination.payloadFields
    ? JSON.parse(input.destination.payloadFields).filter(
        (f: string) => ALLOWED_PAYLOAD_FIELDS.includes(f as WebhookPayloadField)
      )
    : [];

  const fields: Record<string, unknown> = {};
  const includedFields: string[] = [];

  for (const field of selectedFields) {
    const value = resolveField(field, input);
    if (value !== undefined) {
      fields[field] = value;
      includedFields.push(field);
    }
  }

  const payload: Record<string, unknown> = {
    schema: "uaiw.notification.custom.v1",
    fields,
  };

  return finalize(payload, "uaiw.notification.custom.v1", "custom_allowlist", includedFields);
}

// ─── Finalize + safety checks ─────────────────────────────────────────

function finalize(
  payload: Record<string, unknown>,
  schema: string,
  format: WebhookPayloadFormat,
  includedFields: string[]
): BuildWebhookPayloadResult {
  const warnings: string[] = [];

  // Forbidden key check
  assertNoForbiddenKeys(payload);

  const rawBody = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(rawBody, "utf8");

  if (sizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
    warnings.push(`Payload size (${sizeBytes} bytes) exceeds maximum (${MAX_PAYLOAD_SIZE_BYTES} bytes). Payload was truncated.`);
    // Truncate by removing message if present
    if (typeof (payload as any).event?.message === "string") {
      (payload as any).event.message = (payload as any).event.message.substring(0, 200) + "… [truncated]";
    }
  }

  const finalBody = JSON.stringify(payload);
  const finalSize = Buffer.byteLength(finalBody, "utf8");

  return {
    payload,
    rawBody: finalBody,
    sizeBytes: finalSize,
    schema,
    format,
    includedFields,
    warnings,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────

export function buildWebhookPayload(input: BuildWebhookPayloadInput): BuildWebhookPayloadResult {
  const format = (input.destination.payloadFormat || "uaiw_default") as WebhookPayloadFormat;

  switch (format) {
    case "uaiw_default":
      return buildUaiwDefault(input);
    case "minimal":
      return buildMinimal(input);
    case "slack_compatible":
      return buildSlackCompatible(input);
    case "custom_allowlist":
      return buildCustomAllowlist(input);
    default:
      // Fallback to default for unknown formats
      return buildUaiwDefault(input);
  }
}

// ─── Legacy payload builder (for destinations without a record) ───────

export function buildLegacyPayload(input: {
  eventId: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  provider?: string | null;
  modelId?: string | null;
  actionHref?: string | null;
}): { rawBody: string; sizeBytes: number } {
  const payload = {
    id: input.eventId,
    type: input.kind === "test_webhook" ? "test.event" : "notification.event",
    createdAt: new Date().toISOString(),
    notification: {
      kind: input.kind,
      severity: input.severity,
      title: truncate(input.title, MAX_TITLE_LENGTH),
      message: truncate(input.message, MAX_MESSAGE_LENGTH),
      provider: input.provider,
      modelId: input.modelId,
      actionHref: truncate(input.actionHref, MAX_ACTION_HREF_LENGTH),
    },
  };

  const rawBody = JSON.stringify(payload);
  return { rawBody, sizeBytes: Buffer.byteLength(rawBody, "utf8") };
}
