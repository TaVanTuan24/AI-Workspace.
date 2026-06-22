import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmSessionVault, EnvKeyProvider } from "./SessionVault.js";
import type { EncryptedSession } from "./types.js";

function key() {
  return randomBytes(32).toString("base64");
}

function vaultWith(encodedKey: string) {
  return new AesGcmSessionVault(new EnvKeyProvider(encodedKey, "test-key"));
}

const sessionState = {
  cookies: [
    {
      name: "session-token",
      value: "plain-secret-cookie-value",
      domain: ".example.test",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax"
    }
  ],
  origins: [
    {
      origin: "https://gemini.google.com",
      localStorage: [{ name: "token", value: "plain-local-storage-token" }]
    }
  ]
};

describe("AesGcmSessionVault", () => {
  it("encrypts and decrypts a session round trip", async () => {
    const vault = vaultWith(key());
    const encrypted = await vault.encryptSession({
      userId: "user_1",
      provider: "gemini",
      sessionState
    });

    await expect(vault.validateSessionBlob(encrypted)).resolves.toBe(true);
    await expect(
      vault.decryptSession({ userId: "user_1", provider: "gemini", blob: encrypted })
    ).resolves.toEqual(sessionState);
  });

  it("fails to decrypt with the wrong key", async () => {
    const encrypted = await vaultWith(key()).encryptSession({
      userId: "user_1",
      provider: "gemini",
      sessionState
    });

    await expect(
      vaultWith(key()).decryptSession({ userId: "user_1", provider: "gemini", blob: encrypted })
    ).rejects.toThrow("SESSION_DECRYPT_FAILED");
  });

  it("fails when ciphertext is tampered", async () => {
    const vault = vaultWith(key());
    const encrypted = await vault.encryptSession({
      userId: "user_1",
      provider: "gemini",
      sessionState
    });
    const tampered: EncryptedSession = {
      ...encrypted,
      ciphertext: Buffer.from("tampered").toString("base64")
    };

    await expect(
      vault.decryptSession({ userId: "user_1", provider: "gemini", blob: tampered })
    ).rejects.toThrow("SESSION_DECRYPT_FAILED");
  });

  it("fails when authTag is tampered", async () => {
    const vault = vaultWith(key());
    const encrypted = await vault.encryptSession({
      userId: "user_1",
      provider: "gemini",
      sessionState
    });
    const tampered: EncryptedSession = {
      ...encrypted,
      authTag: randomBytes(16).toString("base64")
    };

    await expect(
      vault.decryptSession({ userId: "user_1", provider: "gemini", blob: tampered })
    ).rejects.toThrow("SESSION_DECRYPT_FAILED");
  });

  it("rejects invalid master keys", async () => {
    await expect(
      vaultWith(Buffer.from("too-short").toString("base64")).encryptSession({
        userId: "user_1",
        provider: "gemini",
        sessionState
      })
    ).rejects.toThrow("SESSION_MASTER_KEY");
  });

  it("rejects empty or null session state", async () => {
    const vault = vaultWith(key());
    await expect(
      vault.encryptSession({ userId: "user_1", provider: "gemini", sessionState: null })
    ).rejects.toThrow("SESSION_ENCRYPT_FAILED");
    await expect(
      vault.encryptSession({ userId: "user_1", provider: "gemini", sessionState: {} })
    ).rejects.toThrow("SESSION_ENCRYPT_FAILED");
  });

  it("does not include plaintext in encrypted output", async () => {
    const encrypted = await vaultWith(key()).encryptSession({
      userId: "user_1",
      provider: "gemini",
      sessionState
    });

    const serialized = JSON.stringify(encrypted);
    expect(serialized).not.toContain("plain-secret-cookie-value");
    expect(serialized).not.toContain("plain-local-storage-token");
    expect(serialized).not.toContain("session-token");
  });
});
