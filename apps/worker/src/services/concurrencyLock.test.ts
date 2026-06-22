import { describe, expect, it } from "vitest";
import { chatLockKey } from "./concurrencyLock.js";

describe("chatLockKey", () => {
  it("scopes locks by user and provider", () => {
    expect(chatLockKey("user_1", "gemini")).toBe("lock:chat:user_1:gemini");
    expect(chatLockKey("user_1", "gemini")).not.toBe(chatLockKey("user_2", "gemini"));
  });
});
