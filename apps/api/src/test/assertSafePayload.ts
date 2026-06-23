/**
 * Scans a serialized API payload for forbidden patterns that would indicate
 * accidental secret leakage. Checks object key names (not values) to avoid
 * false positives on descriptive text containing words like "secret".
 */
export function assertSafeSerializedPayload(payload: unknown): void {
  const FORBIDDEN_KEYS = [
    "tokenHash",
    "storageState",
    "cookie",
    "authorization",
    "bearer",
    "apiKey",
    "secret",
    "smtp_password",
    "smtpPassword",
    "webhookSecret",
    "signingSecret",
    "prompt",
    "responseText",
    "rawHtml",
    "providerHtml",
    "keyHash",
    "keyRaw",
    "rawToken",
    "accessToken",
    "refreshToken",
    "sessionToken",
    "password",
  ];

  const violations: string[] = [];

  function walk(obj: unknown, path: string): void {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        walk(obj[i], `${path}[${i}]`);
      }
      return;
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      for (const forbidden of FORBIDDEN_KEYS) {
        if (lowerKey === forbidden.toLowerCase()) {
          violations.push(`${path}.${key} (matched forbidden key "${forbidden}")`);
        }
      }
      walk(value, `${path}.${key}`);
    }
  }

  walk(payload, "$");

  if (violations.length > 0) {
    throw new Error(
      `Payload contains forbidden keys that may leak secrets:\n` +
      violations.map((v) => `  - ${v}`).join("\n")
    );
  }
}
