import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { conversationsRoutes } from "../conversations.js";
import * as exportService from "../../services/conversationExportService.js";
import * as importService from "../../services/conversationImportService.js";
import * as encryptedBackupService from "../../services/encryptedBackupService.js";

vi.mock("../../services/conversationExportService.js");
vi.mock("../../services/conversationImportService.js");
vi.mock("../../services/encryptedBackupService.js");

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (request) => {
    request.user = { id: "test-user-id", email: "test@example.com" };
  });
  app.register(conversationsRoutes);
  return app;
};

describe("conversations routes", () => {
  const app = buildApp();

  describe("POST /settings/conversations/export/encrypted", () => {
    it("returns encrypted backup", async () => {
      const mockExportData = { format: "unified-ai-workspace.conversations", threads: [] };
      const mockEncryptedData = { format: "unified-ai-workspace.encrypted-conversations", payload: "encrypted" };
      
      vi.mocked(exportService.exportAllConversations).mockResolvedValueOnce(mockExportData as any);
      vi.mocked(encryptedBackupService.encryptConversationExport).mockResolvedValueOnce(mockEncryptedData as any);

      const response = await app.inject({
        method: "POST",
        url: "/settings/conversations/export/encrypted",
        payload: { passphrase: "test" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockEncryptedData);
      expect(response.headers["content-disposition"]).toContain("attachment; filename=\"unified-ai-conversations-encrypted-");
    });
  });

  describe("POST /settings/conversations/import/encrypted/preview", () => {
    it("returns preview after decryption", async () => {
      const mockDecryptedFile = { format: "unified-ai-workspace.conversations" };
      const mockPreview = { valid: true, threadCount: 1, messageCount: 2 };
      
      vi.mocked(encryptedBackupService.decryptConversationBackup).mockResolvedValueOnce(mockDecryptedFile as any);
      vi.mocked(importService.previewConversationImport).mockResolvedValueOnce(mockPreview as any);

      const response = await app.inject({
        method: "POST",
        url: "/settings/conversations/import/encrypted/preview",
        payload: { file: { format: "unified-ai-workspace.encrypted-conversations" }, passphrase: "test" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockPreview);
    });

    it("returns safe error on wrong passphrase", async () => {
      vi.mocked(encryptedBackupService.decryptConversationBackup).mockRejectedValueOnce(new Error("BACKUP_DECRYPT_FAILED"));

      const response = await app.inject({
        method: "POST",
        url: "/settings/conversations/import/encrypted/preview",
        payload: { file: { format: "unified-ai-workspace.encrypted-conversations" }, passphrase: "wrong" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
      expect(response.json().error).toContain("BACKUP_DECRYPT_FAILED");
    });
  });

  describe("POST /settings/conversations/import/encrypted", () => {
    it("imports successfully after decryption", async () => {
      const mockDecryptedFile = { format: "unified-ai-workspace.conversations" };
      const mockResult = { importedThreads: 1, importedMessages: 2, skippedThreads: 0, warnings: [] };
      
      vi.mocked(encryptedBackupService.decryptConversationBackup).mockResolvedValueOnce(mockDecryptedFile as any);
      vi.mocked(importService.importConversations).mockResolvedValueOnce(mockResult as any);

      const response = await app.inject({
        method: "POST",
        url: "/settings/conversations/import/encrypted",
        payload: { file: { format: "unified-ai-workspace.encrypted-conversations" }, passphrase: "test" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResult);
    });
  });
});
