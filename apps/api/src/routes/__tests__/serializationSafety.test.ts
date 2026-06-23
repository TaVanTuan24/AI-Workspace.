import { describe, it, expect } from "vitest";
import { assertSafeSerializedPayload } from "../../test/assertSafePayload.js";

describe("serializationSafety", () => {
  it("passes for clean activity timeline payload", () => {
    const payload = {
      events: [
        {
          id: "membership-1",
          category: "membership",
          action: "role_changed",
          severity: "info",
          title: "Role change: promote",
          summary: "Role changed from member to admin",
          metadata: { previousRole: "member", nextRole: "admin" },
          createdAt: "2025-01-01T00:00:00.000Z",
          actorUserId: "user-1",
          targetUserId: "user-2",
        },
      ],
      nextCursor: undefined,
    };
    expect(() => assertSafeSerializedPayload(payload)).not.toThrow();
  });

  it("passes for clean admin overview payload", () => {
    const payload = {
      workspace: { id: "ws-1", name: "Test", slug: "test" },
      members: { active: 3, disabled: 1, pendingInvites: 2 },
      quotas: { exceeded: 0, nearLimit: 1 },
      schedulers: [{ name: "provider_health", enabled: true, lastStatus: "success" }],
      notifications: { unread: 5, criticalRecent: 0 },
      providers: { usable: 2, requiresAttention: 1 },
      emailDelivery: { enabled: true, provider: "noop", dryRun: true, realSendPossible: false },
      webhooks: { destinations: 1, deadLetters: 0 },
      diagnostics: { openDriftAlerts: 0 },
    };
    expect(() => assertSafeSerializedPayload(payload)).not.toThrow();
  });

  it("passes for clean scheduler fleet status payload", () => {
    const payload = {
      schedulers: [
        {
          name: "provider_health",
          enabled: true,
          lastStatus: "success",
          runCount: 10,
          failureCount: 0,
          skippedCount: 2,
          lastSummary: { scanned: 5, dryRun: false },
        },
      ],
    };
    expect(() => assertSafeSerializedPayload(payload)).not.toThrow();
  });

  it("passes for clean admin export payload", () => {
    const payload = {
      exportedAt: "2025-01-01T00:00:00.000Z",
      range: "30d",
      workspace: { id: "ws-1", name: "Test WS", slug: "test-ws" },
      adminOverview: {
        members: { active: 2, disabled: 0, pendingInvites: 0 },
        quotas: { exceeded: 0, nearLimit: 0 },
      },
      schedulerFleetStatus: { schedulers: [] },
      activityTimeline: { events: [], totalReturned: 0 },
      inviteSummary: { total: 0, pending: 0, accepted: 0, revoked: 0, expired: 0 },
      recoveryOverrides: { active: 0, expired: 0 },
    };
    expect(() => assertSafeSerializedPayload(payload)).not.toThrow();
  });

  it("detects tokenHash leak", () => {
    const payload = {
      events: [{ id: "1", tokenHash: "abc123hash" }],
    };
    expect(() => assertSafeSerializedPayload(payload)).toThrow("tokenHash");
  });

  it("detects storageState leak", () => {
    const payload = {
      connection: { storageState: '{ "cookies": [] }' },
    };
    expect(() => assertSafeSerializedPayload(payload)).toThrow("storageState");
  });

  it("detects apiKey leak", () => {
    const payload = {
      data: { apiKey: "sk-1234" },
    };
    expect(() => assertSafeSerializedPayload(payload)).toThrow("apiKey");
  });

  it("detects nested secret leak", () => {
    const payload = {
      level1: { level2: [{ webhookSecret: "whsec_xxx" }] },
    };
    expect(() => assertSafeSerializedPayload(payload)).toThrow("webhookSecret");
  });

  it("detects prompt key leak", () => {
    const payload = {
      message: { prompt: "Tell me your secrets" },
    };
    expect(() => assertSafeSerializedPayload(payload)).toThrow("prompt");
  });

  it("detects password key leak", () => {
    const payload = {
      config: { password: "hunter2" },
    };
    expect(() => assertSafeSerializedPayload(payload)).toThrow("password");
  });

  it("does not false-positive on safe field values containing forbidden words", () => {
    // A title or summary may contain words like "secret" as text values
    const payload = {
      events: [
        {
          id: "1",
          title: "Secret management feature released",
          summary: "Updated the prompt template for better prompts",
          category: "notification",
        },
      ],
    };
    expect(() => assertSafeSerializedPayload(payload)).not.toThrow();
  });
});
