import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../ProviderRegistry.js";
import { ClaudeAdapter } from "./ClaudeAdapter.js";
import { CLAUDE_SELECTORS, CLAUDE_URLS } from "./selectors.js";

describe("ClaudeAdapter", () => {
  it("uses the claude provider id and primary official URL", () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.providerId).toBe("claude");
    expect(adapter.loginUrl).toBe(CLAUDE_URLS.primaryLoginUrl);
  });

  it("exports non-empty URL and selector groups", () => {
    expect(CLAUDE_URLS.primaryLoginUrl).toBe("https://claude.ai");
    expect(CLAUDE_SELECTORS.composerCandidates.length).toBeGreaterThan(0);
    expect(CLAUDE_SELECTORS.sendButtonCandidates.length).toBeGreaterThan(0);
    expect(CLAUDE_SELECTORS.responseCandidates.length).toBeGreaterThan(0);
    expect(CLAUDE_SELECTORS.loginIndicators.length).toBeGreaterThan(0);
    expect(CLAUDE_SELECTORS.manualActionIndicators.length).toBeGreaterThan(0);
    expect(CLAUDE_SELECTORS.rateLimitIndicators.length).toBeGreaterThan(0);
  });

  it("marks Claude as chat-ready in the registry", () => {
    const registry = new ProviderRegistry();
    const claude = registry.get("claude").definition;
    expect(claude.readiness).toBe("ready");
    expect(claude.defaultEnabled).toBe(true);
    expect(claude.capabilities).toEqual(
      expect.arrayContaining(["connect", "validate_session", "send_message", "pseudo_stream", "multi_provider"])
    );
  });
});
