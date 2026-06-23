import { describe, it, expect } from "vitest";
import { redactSecrets } from "../redactSecrets.js";
import type { ApiEnv } from "../../config/env.js";

describe("redactSecrets", () => {
  it("redacts URLs with basic auth credentials", () => {
    const input = "Failed to connect to https://user:superSecretPass123@api.example.com/v1/send";
    const expected = "Failed to connect to https://user:***@api.example.com/v1/send";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer my-secret-token-12345\nContent-Type: application/json";
    const expected = "Authorization: Bearer ***\nContent-Type: application/json";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts generic API keys", () => {
    const input = "Here is the api_key: 1234567890abcdefghij12345. Use it wisely. API_KEY='another-long-secret-key-123'";
    const expected = "Here is the api_key: ***. Use it wisely. API_KEY='***'";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts workspace invite tokens", () => {
    const input = "Please visit http://localhost:3000/invite/inv_abc123def456ghi789jkl012mno345pqr to join.";
    const expected = "Please visit http://localhost:3000/invite/inv_*** to join.";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts exact string matches from env", () => {
    const env = {
      WORKSPACE_INVITE_SMTP_PASSWORD: "mySmtpPassword123!",
      INTERNAL_API_KEY: "internalKey456"
    } as ApiEnv;
    
    const input = "Error: SMTP auth failed for password mySmtpPassword123! or maybe internalKey456 was used.";
    const expected = "Error: SMTP auth failed for password *** or maybe *** was used.";
    
    expect(redactSecrets(input, env)).toBe(expected);
  });

  it("handles null or undefined input safely", () => {
    expect(redactSecrets("")).toBe("");
    expect(redactSecrets(null as any)).toBe(null);
    expect(redactSecrets(undefined as any)).toBe(undefined);
  });
});
