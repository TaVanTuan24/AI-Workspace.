import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../ProviderRegistry.js";
import { GrokAdapter } from "./GrokAdapter.js";
import { GROK_SELECTORS, GROK_URLS } from "./selectors.js";

describe("GrokAdapter", () => {
  it("uses the grok provider id and primary official URL", () => {
    const adapter = new GrokAdapter();
    expect(adapter.providerId).toBe("grok");
    expect(adapter.loginUrl).toBe(GROK_URLS.primaryLoginUrl);
  });

  it("exports non-empty URL and selector groups", () => {
    expect(GROK_URLS.primaryLoginUrl).toBe("https://grok.com");
    expect(GROK_URLS.fallbackLoginUrls.length).toBeGreaterThan(0);
    expect(GROK_SELECTORS.composerCandidates.length).toBeGreaterThan(0);
    expect(GROK_SELECTORS.sendButtonCandidates.length).toBeGreaterThan(0);
    expect(GROK_SELECTORS.responseCandidates.length).toBeGreaterThan(0);
    expect(GROK_SELECTORS.loginIndicators.length).toBeGreaterThan(0);
    expect(GROK_SELECTORS.manualActionIndicators.length).toBeGreaterThan(0);
    expect(GROK_SELECTORS.rateLimitIndicators.length).toBeGreaterThan(0);
  });

  it("marks Grok as chat-ready in the registry", () => {
    const registry = new ProviderRegistry();
    const grok = registry.get("grok").definition;
    expect(grok.readiness).toBe("ready");
    expect(grok.defaultEnabled).toBe(true);
    expect(grok.capabilities).toEqual(
      expect.arrayContaining(["connect", "validate_session", "send_message", "pseudo_stream", "multi_provider"])
    );
  });
});
