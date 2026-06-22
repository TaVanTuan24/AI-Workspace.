import { describe, expect, it } from "vitest";
import { toSafeProviderError } from "./safeProviderError.js";

describe("toSafeProviderError", () => {
  it("maps login errors to safe reconnect messages", () => {
    expect(toSafeProviderError(new Error("SESSION_DECRYPT_FAILED"))).toEqual({
      errorCode: "SESSION_DECRYPT_FAILED",
      message: "Please reconnect Gemini."
    });
  });

  it("maps timeout errors without exposing raw details", () => {
    expect(toSafeProviderError(new Error("Timeout 30000ms waiting for selector"))).toEqual({
      errorCode: "PROVIDER_TIMEOUT",
      message: "Gemini did not finish response in time."
    });
  });

  it("maps provider readiness errors safely", () => {
    expect(toSafeProviderError(new Error("PROVIDER_NOT_READY"), "chatgpt")).toEqual({
      errorCode: "PROVIDER_NOT_READY",
      message: "This provider is not chat-ready yet."
    });
  });

  it("maps unknown errors to generic safe messages", () => {
    expect(toSafeProviderError(new Error("raw playwright internals"))).toEqual({
      errorCode: "UNKNOWN_SAFE_ERROR",
      message: "Unexpected provider error."
    });
  });

  it("maps job lifecycle errors safely", () => {
    expect(toSafeProviderError(new Error("JOB_CANCELLED"), "gemini")).toEqual({
      errorCode: "JOB_CANCELLED",
      message: "Job was cancelled."
    });
    expect(toSafeProviderError(new Error("JOB_TIMEOUT"), "gemini")).toEqual({
      errorCode: "JOB_TIMEOUT",
      message: "Gemini job timed out."
    });
  });
});
