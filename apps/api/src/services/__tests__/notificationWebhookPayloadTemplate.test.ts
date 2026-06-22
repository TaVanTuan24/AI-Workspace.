import { describe, it, expect } from "vitest";
import {
  buildWebhookPayload,
  buildLegacyPayload,
  validatePayloadConfig,
  ALLOWED_PAYLOAD_FIELDS,
  SUPPORTED_PAYLOAD_FORMATS,
  type BuildWebhookPayloadInput,
} from "../notificationWebhookPayloadTemplateService.js";

const baseInput: BuildWebhookPayloadInput = {
  event: {
    id: "evt-001",
    kind: "provider_session_issue",
    title: "Provider requires login",
    message: "ChatGPT session has expired. Please reconnect.",
    severity: "critical",
    createdAt: "2026-01-01T00:00:00.000Z",
    actionHref: "/settings/connections",
  },
  destination: {
    id: "dest-001",
    name: "Primary Webhook",
    payloadFormat: "uaiw_default",
    payloadFields: null,
    includeActionHref: true,
    includeDeliveryMetadata: true,
    includeRoutingMetadata: true,
  },
  deliveryAttemptId: "attempt-001",
  routing: {
    reason: "kind_match_provider_session_issue",
    failoverIndex: 0,
  },
  now: new Date("2026-01-01T00:00:00.000Z"),
};

describe("notificationWebhookPayloadTemplateService", () => {
  describe("validatePayloadConfig", () => {
    it("accepts all supported formats", () => {
      for (const fmt of SUPPORTED_PAYLOAD_FORMATS) {
        if (fmt === "custom_allowlist") {
          const result = validatePayloadConfig(fmt, ["event.id"]);
          expect(result.valid).toBe(true);
        } else {
          const result = validatePayloadConfig(fmt);
          expect(result.valid).toBe(true);
        }
      }
    });

    it("rejects unsupported format", () => {
      const result = validatePayloadConfig("jinja_template");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unsupported payload format");
    });

    it("requires fields for custom_allowlist", () => {
      const result = validatePayloadConfig("custom_allowlist", []);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("at least one");
    });

    it("rejects invalid field names", () => {
      const result = validatePayloadConfig("custom_allowlist", ["event.id", "user.password"]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Invalid payload field");
    });

    it("rejects too many fields", () => {
      const tooMany = Array.from({ length: 31 }, (_, i) => `event.id`);
      // This would have duplicates but the count check happens first
      const result = validatePayloadConfig("custom_allowlist", tooMany);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Too many");
    });
  });

  describe("uaiw_default format", () => {
    it("produces expected structure", () => {
      const result = buildWebhookPayload(baseInput);

      expect(result.format).toBe("uaiw_default");
      expect(result.schema).toBe("uaiw.notification.v1");
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.warnings).toHaveLength(0);

      const p = result.payload as any;
      expect(p.schema).toBe("uaiw.notification.v1");
      expect(p.event.id).toBe("evt-001");
      expect(p.event.kind).toBe("provider_session_issue");
      expect(p.event.title).toBe("Provider requires login");
      expect(p.event.message).toBe("ChatGPT session has expired. Please reconnect.");
      expect(p.event.severity).toBe("critical");
      expect(p.event.actionHref).toBe("/settings/connections");
      expect(p.delivery.channel).toBe("webhook");
      expect(p.delivery.destinationId).toBe("dest-001");
      expect(p.routing.reason).toBe("kind_match_provider_session_issue");
    });

    it("excludes actionHref when includeActionHref is false", () => {
      const input = {
        ...baseInput,
        destination: { ...baseInput.destination, includeActionHref: false },
      };
      const result = buildWebhookPayload(input);
      expect((result.payload as any).event.actionHref).toBeUndefined();
    });

    it("excludes delivery metadata when flag is false", () => {
      const input = {
        ...baseInput,
        destination: { ...baseInput.destination, includeDeliveryMetadata: false },
      };
      const result = buildWebhookPayload(input);
      expect((result.payload as any).delivery).toBeUndefined();
    });

    it("excludes routing metadata when flag is false", () => {
      const input = {
        ...baseInput,
        destination: { ...baseInput.destination, includeRoutingMetadata: false },
      };
      const result = buildWebhookPayload(input);
      expect((result.payload as any).routing).toBeUndefined();
    });
  });

  describe("minimal format", () => {
    it("produces minimal structure", () => {
      const input = {
        ...baseInput,
        destination: { ...baseInput.destination, payloadFormat: "minimal" },
      };
      const result = buildWebhookPayload(input);

      expect(result.format).toBe("minimal");
      expect(result.schema).toBe("uaiw.notification.minimal.v1");

      const p = result.payload as any;
      expect(p.event.id).toBe("evt-001");
      expect(p.event.kind).toBe("provider_session_issue");
      expect(p.event.severity).toBe("critical");
      expect(p.event.title).toBeUndefined();
      expect(p.event.message).toBeUndefined();
      expect(p.delivery).toBeUndefined();
      expect(p.routing).toBeUndefined();
    });
  });

  describe("slack_compatible format", () => {
    it("produces Slack-style payload", () => {
      const input = {
        ...baseInput,
        destination: { ...baseInput.destination, payloadFormat: "slack_compatible" },
      };
      const result = buildWebhookPayload(input);

      expect(result.format).toBe("slack_compatible");
      const p = result.payload as any;
      expect(p.text).toContain("[critical]");
      expect(p.text).toContain("Provider requires login");
      expect(p.blocks).toBeDefined();
      expect(p.blocks.length).toBeGreaterThanOrEqual(1);
      expect(p.blocks[0].type).toBe("section");
    });

    it("sanitizes special characters for Slack mrkdwn", () => {
      const input = {
        ...baseInput,
        event: { ...baseInput.event, title: "Test <script> & more" },
        destination: { ...baseInput.destination, payloadFormat: "slack_compatible" },
      };
      const result = buildWebhookPayload(input);
      const p = result.payload as any;
      expect(p.text).not.toContain("<script>");
      expect(p.text).toContain("&lt;script&gt;");
      expect(p.text).toContain("&amp;");
    });
  });

  describe("custom_allowlist format", () => {
    it("includes only selected fields", () => {
      const input = {
        ...baseInput,
        destination: {
          ...baseInput.destination,
          payloadFormat: "custom_allowlist",
          payloadFields: JSON.stringify(["event.kind", "event.severity"]),
        },
      };
      const result = buildWebhookPayload(input);

      expect(result.format).toBe("custom_allowlist");
      expect(result.schema).toBe("uaiw.notification.custom.v1");
      const p = result.payload as any;
      expect(p.fields["event.kind"]).toBe("provider_session_issue");
      expect(p.fields["event.severity"]).toBe("critical");
      expect(p.fields["event.title"]).toBeUndefined();
      expect(result.includedFields).toEqual(["event.kind", "event.severity"]);
    });

    it("ignores invalid fields silently at build time", () => {
      const input = {
        ...baseInput,
        destination: {
          ...baseInput.destination,
          payloadFormat: "custom_allowlist",
          payloadFields: JSON.stringify(["event.kind", "user.password"]),
        },
      };
      const result = buildWebhookPayload(input);
      const p = result.payload as any;
      expect(p.fields["event.kind"]).toBe("provider_session_issue");
      expect(p.fields["user.password"]).toBeUndefined();
    });
  });

  describe("field truncation", () => {
    it("truncates long title", () => {
      const longTitle = "A".repeat(300);
      const input = {
        ...baseInput,
        event: { ...baseInput.event, title: longTitle },
      };
      const result = buildWebhookPayload(input);
      const p = result.payload as any;
      expect(p.event.title.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    });

    it("truncates long message", () => {
      const longMsg = "B".repeat(2000);
      const input = {
        ...baseInput,
        event: { ...baseInput.event, message: longMsg },
      };
      const result = buildWebhookPayload(input);
      const p = result.payload as any;
      expect(p.event.message.length).toBeLessThanOrEqual(1001);
    });
  });

  describe("forbidden keys", () => {
    it("no forbidden keys appear in uaiw_default payload", () => {
      const result = buildWebhookPayload(baseInput);
      const raw = result.rawBody.toLowerCase();
      const forbidden = ["token", "cookie", "session", "storagestate", "apikey", "api_key", "secret", "signingsecret", "encryptedurl", "password", "prompt", "response"];
      for (const key of forbidden) {
        // Check as JSON key (surrounded by quotes)
        expect(raw).not.toContain(`"${key}"`);
      }
    });

    it("no forbidden keys appear in minimal payload", () => {
      const input = {
        ...baseInput,
        destination: { ...baseInput.destination, payloadFormat: "minimal" },
      };
      const result = buildWebhookPayload(input);
      const raw = result.rawBody.toLowerCase();
      expect(raw).not.toContain('"token"');
      expect(raw).not.toContain('"secret"');
    });
  });

  describe("legacy payload builder", () => {
    it("produces backward-compatible shape", () => {
      const result = buildLegacyPayload({
        eventId: "evt-legacy",
        kind: "test_webhook",
        severity: "info",
        title: "Test",
        message: "Hello",
        provider: "chatgpt",
        modelId: null,
        actionHref: null,
      });

      const body = JSON.parse(result.rawBody);
      expect(body.id).toBe("evt-legacy");
      expect(body.type).toBe("test.event");
      expect(body.notification.kind).toBe("test_webhook");
      expect(body.notification.title).toBe("Test");
      expect(result.sizeBytes).toBeGreaterThan(0);
    });
  });
});
