import { describe, expect, it, vi } from "vitest";
import { ChatGPTAdapter } from "./chatgpt/ChatGPTAdapter.js";

// Expose the protected navigation retry helper without launching a browser.
class Probe extends ChatGPTAdapter {
  run(page: any, url: string, attempts?: number) {
    return this.gotoWithRetry(page, url, attempts);
  }
}

function fakePage(gotoImpl: () => Promise<void>) {
  return {
    goto: vi.fn(gotoImpl),
    waitForLoadState: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {})
  };
}

describe("gotoWithRetry", () => {
  it("returns after the first successful navigation", async () => {
    const page = fakePage(async () => {});
    await new Probe().run(page as any, "https://example.com");
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("retries a transient failure, then succeeds", async () => {
    let calls = 0;
    const page = fakePage(async () => {
      calls += 1;
      if (calls === 1) throw new Error("net::ERR_NETWORK_CHANGED");
    });
    await new Probe().run(page as any, "https://example.com", 2);
    expect(page.goto).toHaveBeenCalledTimes(2);
    // One backoff wait between the failed and successful attempt.
    expect(page.waitForTimeout).toHaveBeenCalledTimes(1);
  });

  it("gives up quietly after exhausting attempts", async () => {
    const page = fakePage(async () => {
      throw new Error("Timeout 45000ms exceeded");
    });
    await expect(new Probe().run(page as any, "https://example.com", 2)).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledTimes(2);
  });
});
