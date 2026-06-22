import { describe, expect, it } from "vitest";
import { safeParseEvent } from "./redisJobEventBus.js";

describe("redisJobEventBus", () => {
  it("parses valid provider events", () => {
    expect(
      safeParseEvent(JSON.stringify({ type: "started", provider: "gemini", jobId: "job_1" }))
    ).toEqual({ type: "started", provider: "gemini", jobId: "job_1" });
  });

  it("ignores invalid event JSON safely", () => {
    expect(safeParseEvent("{not-json")).toBeNull();
    expect(safeParseEvent(JSON.stringify({ provider: "gemini" }))).toBeNull();
  });
});
