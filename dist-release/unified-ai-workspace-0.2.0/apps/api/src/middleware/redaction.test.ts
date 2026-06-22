import { describe, expect, it } from "vitest";
import { pinoRedactPaths } from "./redaction.js";

describe("pinoRedactPaths", () => {
  it("covers provider sessions, credentials, and API key material", () => {
    const paths = pinoRedactPaths();

    expect(paths).toContain("req.headers.authorization");
    expect(paths).toContain("req.headers.cookie");
    expect(paths).toContain("req.headers['x-api-key']");
    expect(paths).toContain("res.headers['set-cookie']");
    expect(paths).toContain("**.SESSION_MASTER_KEY");
    expect(paths).toContain("**.API_KEY_HASH_SECRET");
    expect(paths).toContain("**.encryptedSessionBlob");
    expect(paths).toContain("**.storageState");
    expect(paths).toContain("**.rawKey");
    expect(paths).toContain("**.passphrase");
  });
});
