import { describe, expect, it } from "vitest";
import type { BrowserContext } from "playwright";
import type { ProviderAdapter } from "@uaiw/provider-adapters/ProviderAdapter.js";
import { detectUiMode } from "./modes.js";

describe("detectUiMode", () => {
  it("uses adapter inspectUi when available", async () => {
    const adapter = {
      providerId: "chatgpt",
      loginUrl: "https://chatgpt.com",
      inspectUi: async () => ({
        composerFound: true,
        sendButtonFound: true,
        responseContainerFound: false,
        notes: ["No assistant message yet."]
      })
    } as unknown as ProviderAdapter;

    const result = await detectUiMode({
      provider: "chatgpt",
      adapter,
      context: {} as BrowserContext
    });

    expect(result.checks).toContainEqual({ name: "composer_found", status: "pass" });
    expect(result.checks).toContainEqual({ name: "send_button_found", status: "pass" });
    expect(result.checks).toContainEqual({ name: "response_container_found", status: "warn" });
    expect(result.checks).toContainEqual({ name: "ui_note", status: "warn", message: "No assistant message yet." });
  });

  it("supports Grok inspectUi through the same provider-agnostic path", async () => {
    const adapter = {
      providerId: "grok",
      loginUrl: "https://grok.com",
      inspectUi: async () => ({
        composerFound: true,
        sendButtonFound: false,
        responseContainerFound: true,
        notes: []
      })
    } as unknown as ProviderAdapter;

    const result = await detectUiMode({
      provider: "grok",
      adapter,
      context: {} as BrowserContext
    });

    expect(result.checks).toContainEqual({ name: "composer_found", status: "pass" });
    expect(result.checks).toContainEqual({ name: "send_button_found", status: "warn" });
    expect(result.checks).toContainEqual({ name: "response_container_found", status: "pass" });
  });
});
