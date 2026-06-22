import { describe, it, expect } from "vitest";
import {
  encryptConversationExport,
  decryptConversationBackup,
  isEncryptedConversationBackup,
  EncryptedConversationBackup
} from "../encryptedBackupService.js";
import { ExportFile } from "../conversationImportSchema.js";

describe("encryptedBackupService", () => {
  const mockExport: ExportFile = {
    format: "unified-ai-workspace.conversations",
    version: 1,
    exportedAt: "2026-06-21T10:00:00.000Z",
    source: {
      app: "Unified AI Workspace",
      type: "conversation_export"
    },
    threads: [
      {
        sourceThreadId: "thread-1",
        title: "Test Thread",
        createdAt: "2026-06-21T10:00:00.000Z",
        updatedAt: "2026-06-21T10:00:00.000Z",
        messages: [
          {
            sourceMessageId: "msg-1",
            role: "user",
            content: "Hello",
            createdAt: "2026-06-21T10:00:00.000Z"
          }
        ]
      }
    ]
  };

  const passphrase = "super-secret-passphrase";

  it("should encrypt and decrypt correctly", async () => {
    const encrypted = await encryptConversationExport(mockExport, passphrase);
    
    expect(isEncryptedConversationBackup(encrypted)).toBe(true);
    expect(encrypted.payload).toBeDefined();
    expect(encrypted.payload).not.toContain("Hello"); // plaintext shouldn't be visible
    expect(encrypted.crypto.salt).toBeDefined();
    expect(encrypted.crypto.iv).toBeDefined();

    const decrypted = await decryptConversationBackup(encrypted, passphrase);
    expect(decrypted).toEqual(mockExport);
  });

  it("should fail to decrypt with wrong passphrase", async () => {
    const encrypted = await encryptConversationExport(mockExport, passphrase);
    
    await expect(decryptConversationBackup(encrypted, "wrong-passphrase"))
      .rejects.toThrow("BACKUP_DECRYPT_FAILED");
  });

  it("should fail to decrypt tampered ciphertext", async () => {
    const encrypted = await encryptConversationExport(mockExport, passphrase);
    
    // Modify payload slightly
    const payloadBuf = Buffer.from(encrypted.payload, "base64url");
    payloadBuf[0] ^= 1;
    const tampered: EncryptedConversationBackup = { ...encrypted, payload: payloadBuf.toString("base64url") };

    await expect(decryptConversationBackup(tampered, passphrase))
      .rejects.toThrow("BACKUP_DECRYPT_FAILED");
  });

  it("should fail to decrypt tampered tag", async () => {
    const encrypted = await encryptConversationExport(mockExport, passphrase);
    
    const tagBuf = Buffer.from(encrypted.crypto.tag, "base64url");
    tagBuf[0] ^= 1;
    const tampered: EncryptedConversationBackup = {
      ...encrypted,
      crypto: { ...encrypted.crypto, tag: tagBuf.toString("base64url") }
    };

    await expect(decryptConversationBackup(tampered, passphrase))
      .rejects.toThrow("BACKUP_DECRYPT_FAILED");
  });

  it("should use unique salt and iv per export", async () => {
    const encrypted1 = await encryptConversationExport(mockExport, passphrase);
    const encrypted2 = await encryptConversationExport(mockExport, passphrase);

    expect(encrypted1.crypto.salt).not.toBe(encrypted2.crypto.salt);
    expect(encrypted1.crypto.iv).not.toBe(encrypted2.crypto.iv);
  });
});
