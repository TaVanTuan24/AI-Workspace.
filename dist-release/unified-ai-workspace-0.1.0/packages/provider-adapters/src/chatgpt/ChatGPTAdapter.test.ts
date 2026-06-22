import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../ProviderRegistry.js";
import { ChatGPTAdapter } from "./ChatGPTAdapter.js";
import { CHATGPT_SELECTORS } from "./selectors.js";

describe("ChatGPTAdapter", () => {
  it("uses the chatgpt provider id and official login URL", () => {
    const adapter = new ChatGPTAdapter();
    expect(adapter.providerId).toBe("chatgpt");
    expect(adapter.loginUrl).toBe("https://chatgpt.com");
  });

  it("exports non-empty selector groups", () => {
    expect(CHATGPT_SELECTORS.composerCandidates.length).toBeGreaterThan(0);
    expect(CHATGPT_SELECTORS.sendButtonCandidates.length).toBeGreaterThan(0);
    expect(CHATGPT_SELECTORS.responseCandidates.length).toBeGreaterThan(0);
    expect(CHATGPT_SELECTORS.loginIndicators.length).toBeGreaterThan(0);
    expect(CHATGPT_SELECTORS.manualActionIndicators.length).toBeGreaterThan(0);
    expect(CHATGPT_SELECTORS.rateLimitIndicators.length).toBeGreaterThan(0);
  });

  it("marks ChatGPT as chat-ready in the registry", () => {
    const registry = new ProviderRegistry();
    const chatgpt = registry.get("chatgpt").definition;
    expect(chatgpt.readiness).toBe("ready");
    expect(chatgpt.defaultEnabled).toBe(true);
    expect(chatgpt.capabilities).toEqual(
      expect.arrayContaining(["connect", "validate_session", "send_message", "pseudo_stream", "multi_provider"])
    );
  });
});
