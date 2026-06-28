import { describe, expect, it } from "vitest";
import { ChatGPTAdapter } from "./chatgpt/ChatGPTAdapter.js";
import { ClaudeAdapter } from "./claude/ClaudeAdapter.js";
import { GeminiAdapter } from "./gemini/GeminiAdapter.js";

// Subclasses expose the protected continuity guard so we can assert the
// per-provider conversation URL patterns without launching a browser.
class ChatGPTProbe extends ChatGPTAdapter {
  check(url: string) {
    return this.isConversationUrl(url);
  }
}
class ClaudeProbe extends ClaudeAdapter {
  check(url: string) {
    return this.isConversationUrl(url);
  }
}
class GeminiProbe extends GeminiAdapter {
  check(url: string) {
    return this.isConversationUrl(url);
  }
}

describe("conversation continuity URL detection", () => {
  it("recognizes resumable ChatGPT conversation URLs but not the entry point", () => {
    const probe = new ChatGPTProbe();
    expect(probe.check("https://chatgpt.com/c/0c8f5b1a-1234-49ab-9def-000000000000")).toBe(true);
    expect(probe.check("https://chatgpt.com/g/g-abc123/c/0c8f5b1a-1234-49ab-9def-000000000000")).toBe(true);
    expect(probe.check("https://chatgpt.com")).toBe(false);
    expect(probe.check("https://chatgpt.com/")).toBe(false);
  });

  it("recognizes resumable Claude conversation URLs but not the entry point", () => {
    const probe = new ClaudeProbe();
    expect(probe.check("https://claude.ai/chat/0c8f5b1a-1234-49ab-9def-000000000000")).toBe(true);
    expect(probe.check("https://claude.ai")).toBe(false);
    expect(probe.check("https://claude.ai/new")).toBe(false);
  });

  it("recognizes resumable Gemini conversation URLs but not the bare /app entry point", () => {
    const probe = new GeminiProbe();
    expect(probe.check("https://gemini.google.com/app/c_1a2b3c4d5e")).toBe(true);
    expect(probe.check("https://gemini.google.com/app")).toBe(false);
    expect(probe.check("https://gemini.google.com/app/")).toBe(false);
  });

  it("does not match an unrelated provider's URL", () => {
    expect(new ChatGPTProbe().check("https://claude.ai/chat/0c8f5b1a")).toBe(false);
    expect(new ClaudeProbe().check("https://chatgpt.com/c/0c8f5b1a")).toBe(false);
  });
});
