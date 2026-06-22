import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cliArgs.js";

describe("parseCliArgs", () => {
  it("uses safe defaults", () => {
    const args = parseCliArgs([]);
    expect(args.provider).toBe("gemini");
    expect(args.mode).toBe("validate-session");
    expect(args.prompt).toBe("Say hello in one short sentence.");
  });

  it("rejects invalid providers", () => {
    expect(() => parseCliArgs(["--provider", "unknown"])).toThrow("UNKNOWN_PROVIDER");
  });

  it("rejects invalid modes", () => {
    expect(() => parseCliArgs(["--mode", "bad"])).toThrow("INVALID_SMOKE_MODE");
  });

  it("rejects invalid timeouts", () => {
    expect(() => parseCliArgs(["--timeout-ms", "nope"])).toThrow("INVALID_TIMEOUT_MS");
    expect(() => parseCliArgs(["--timeout-ms", "0"])).toThrow("INVALID_TIMEOUT_MS");
  });

  it("uses a long prompt for stop-generation by default", () => {
    const args = parseCliArgs(["--mode", "stop-generation", "--yes"]);
    expect(args.prompt).toContain("numbered list");
  });

  it("allows full --no-send without --yes", () => {
    const args = parseCliArgs(["--mode", "full", "--no-send"]);
    expect(args.noSend).toBe(true);
    expect(args.yes).toBe(false);
  });

  it("rejects full without --yes or --no-send", () => {
    expect(() => parseCliArgs(["--mode", "full"])).toThrow("FULL_REQUIRES_YES_OR_NO_SEND");
  });

  it("rejects send-message without --yes", () => {
    expect(() => parseCliArgs(["--mode", "send-message"])).toThrow("SEND_MESSAGE_REQUIRES_YES");
  });

  it("rejects ChatGPT send-message without --yes", () => {
    expect(() => parseCliArgs(["--provider", "chatgpt", "--mode", "send-message"])).toThrow(
      "SEND_MESSAGE_REQUIRES_YES"
    );
  });

  it("rejects Grok send-message without --yes", () => {
    expect(() => parseCliArgs(["--provider", "grok", "--mode", "send-message"])).toThrow(
      "SEND_MESSAGE_REQUIRES_YES"
    );
  });

  it("rejects --no-send outside full mode", () => {
    expect(() => parseCliArgs(["--mode", "validate-session", "--no-send"])).toThrow("NO_SEND_ONLY_FULL");
  });

  it("parses report-file and fail-on-warn", () => {
    const args = parseCliArgs([
      "--report-file",
      "./var/smoke-reports/gemini.json",
      "--fail-on-warn",
      "true"
    ]);
    expect(args.reportFile).toBe("./var/smoke-reports/gemini.json");
    expect(args.failOnWarn).toBe(true);
  });
});
