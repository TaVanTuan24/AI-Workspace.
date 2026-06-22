import { describe, expect, it } from "vitest";
import { ProviderCapabilityError, ProviderRegistry } from "./providerRegistry.js";

describe("ProviderRegistry", () => {
  const registry = new ProviderRegistry();

  it("lists Gemini, ChatGPT, and Grok", () => {
    expect(registry.list().map((provider) => provider.id)).toEqual(["gemini", "chatgpt", "grok"]);
  });

  it("marks Gemini as chat-ready", () => {
    expect(registry.hasCapability("gemini", "send_message")).toBe(true);
    expect(registry.isReady("gemini")).toBe(true);
  });

  it("marks ChatGPT and Grok as chat-ready", () => {
    expect(registry.hasCapability("chatgpt", "send_message")).toBe(true);
    expect(registry.isReady("chatgpt")).toBe(true);
    expect(registry.hasCapability("grok", "send_message")).toBe(true);
    expect(registry.isReady("grok")).toBe(true);
  });

  it("throws a safe capability error", () => {
    expect(() => registry.assertCapability("grok", "not_a_capability" as never)).toThrow(ProviderCapabilityError);
  });
});
