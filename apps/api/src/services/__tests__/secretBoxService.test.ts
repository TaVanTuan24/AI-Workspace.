import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecretString, decryptSecretString } from "../secretBoxService.js";
import { env } from "../../config/env.js";

describe("secretBoxService", () => {
  beforeEach(() => {
    process.env.SESSION_MASTER_KEY = Buffer.alloc(32, "a").toString("hex");
  });

  afterEach(() => {
    delete process.env.SESSION_MASTER_KEY;
  });

  it("encrypts and decrypts string successfully", () => {
    // Rely on the test env having SESSION_MASTER_KEY set (from vitest.config.ts or defaults)
    const plaintext = "test_secret_string_123";
    const ciphertext = encryptSecretString(plaintext);
    
    expect(ciphertext).not.toContain(plaintext);
    expect(JSON.parse(ciphertext).alg).toBe("aes-256-gcm");

    const decrypted = decryptSecretString(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext due to random IV", () => {
    const plaintext = "test_secret_string_123";
    const ct1 = encryptSecretString(plaintext);
    const ct2 = encryptSecretString(plaintext);
    expect(ct1).not.toBe(ct2);
  });

  it("throws error if ciphertext is tampered with", () => {
    const plaintext = "test_secret_string_123";
    const ciphertext = encryptSecretString(plaintext);
    const parsed = JSON.parse(ciphertext);
    
    // Tamper with auth tag
    parsed.tag = Buffer.alloc(16, "b").toString("base64");
    
    expect(() => decryptSecretString(JSON.stringify(parsed))).toThrow();
  });
});
