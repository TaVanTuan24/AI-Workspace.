import { describe, it, expect } from "vitest";
import { redactText, truncateSafe } from "../safeDomDiagnostics.js";

describe("safeDomDiagnostics redaction", () => {
  it("should redact emails", () => {
    const input = "Contact john.doe123@example-domain.com for info.";
    const output = redactText(input);
    expect(output).toBe("Contact [redacted-email] for info.");
  });

  it("should redact URLs", () => {
    const input = "Visit https://example.com/secret?token=123 or http://localhost:3000/a";
    const output = redactText(input);
    expect(output).toBe("Visit [redacted-url] or [redacted-url]");
  });

  it("should redact tokens", () => {
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const input = `Auth: ${token}`;
    const output = redactText(input);
    expect(output).toBe("Auth: [redacted-token]");
  });

  it("should redact UUIDs and long numbers", () => {
    const input = "ID: 123e4567-e89b-12d3-a456-426614174000 and num 123456789012";
    const output = redactText(input);
    expect(output).toBe("ID: [redacted-uuid] and num [redacted-number]");
  });

  it("should safely truncate long text after redaction", () => {
    const input = "This is a very long text that goes on and on and on and on and on and on and on and on and on and on, way past 80 characters.";
    const output = truncateSafe(input, 80);
    expect(output.length).toBeLessThanOrEqual(83); // 80 + "..."
    expect(output.endsWith("...")).toBe(true);
  });
});
