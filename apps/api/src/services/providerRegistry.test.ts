import { describe, expect, it } from "vitest";
import { ProviderCapabilityError, ProviderRegistry } from "./providerRegistry.js";

describe("ProviderRegistry", () => {
  const registry = new ProviderRegistry();

  it("lists Gemini, ChatGPT, and Claude", () => {
    expect(registry.list().map((provider) => provider.id)).toEqual(["gemini", "chatgpt", "claude"]);
  });

  it("marks Gemini as chat-ready", () => {
    expect(registry.hasCapability("gemini", "send_message")).toBe(true);
    expect(registry.isReady("gemini")).toBe(true);
  });

  it("marks ChatGPT and Claude as chat-ready", () => {
    expect(registry.hasCapability("chatgpt", "send_message")).toBe(true);
    expect(registry.isReady("chatgpt")).toBe(true);
    expect(registry.hasCapability("claude", "send_message")).toBe(true);
    expect(registry.isReady("claude")).toBe(true);
  });

  it("throws a safe capability error", () => {
    expect(() => registry.assertCapability("claude", "not_a_capability" as never)).toThrow(ProviderCapabilityError);
  });
});
