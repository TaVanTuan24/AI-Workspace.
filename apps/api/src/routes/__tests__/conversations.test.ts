import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { conversationsRoutes } from "../conversations.js";
import * as exportService from "../../services/conversationExportService.js";
import * as importService from "../../services/conversationImportService.js";
import * as encryptedBackupService from "../../services/encryptedBackupService.js";
import * as historyService from "../../services/conversationHistoryService.js";

vi.mock("../../services/conversationExportService.js");
vi.mock("../../services/conversationImportService.js");
vi.mock("../../services/encryptedBackupService.js");
vi.mock("../../services/conversationHistoryService.js");

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

  describe("GET /settings/conversations (list)", () => {
    it("returns thread list", async () => {
      const mockResult = {
        threads: [
          { id: "t1", title: "Hello", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", messageCount: 4, providers: ["chatgpt", "gemini"] }
        ],
        nextCursor: null
      };
      vi.mocked(historyService.listThreads).mockResolvedValueOnce(mockResult as any);

      const response = await app.inject({ method: "GET", url: "/settings/conversations?limit=10" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResult);
      expect(historyService.listThreads).toHaveBeenCalledWith(expect.any(String), { limit: 10 });
    });

    it("rejects an invalid limit", async () => {
      const response = await app.inject({ method: "GET", url: "/settings/conversations?limit=0" });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /settings/conversations/discussion (save)", () => {
    it("saves a discussion and returns the thread id", async () => {
      vi.mocked(historyService.saveDiscussion).mockResolvedValueOnce({ threadId: "disc-1" } as any);
      const response = await app.inject({
        method: "POST",
        url: "/settings/conversations/discussion",
        payload: {
          topic: "Is AI conscious?",
          entries: [
            { round: 1, provider: "gemini", text: "yes" },
            { round: 1, provider: "chatgpt", text: "no" }
          ]
        }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ threadId: "disc-1" });
      expect(historyService.saveDiscussion).toHaveBeenCalledWith(
        expect.any(String),
        "Is AI conscious?",
        [
          { round: 1, provider: "gemini", text: "yes" },
          { round: 1, provider: "chatgpt", text: "no" }
        ]
      );
    });

    it("rejects an empty entries array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/settings/conversations/discussion",
        payload: { topic: "x", entries: [] }
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /settings/conversations/:threadId (detail)", () => {
    it("returns thread detail", async () => {
      const mockDetail = {
        id: "t1",
        title: "Hello",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        providers: ["chatgpt"],
        messages: [{ id: "m1", role: "user", provider: null, content: "hi", model: null, createdAt: "2026-01-01T00:00:00.000Z" }]
      };
      vi.mocked(historyService.getThreadDetail).mockResolvedValueOnce(mockDetail as any);

      const response = await app.inject({ method: "GET", url: "/settings/conversations/t1" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockDetail);
    });

    it("returns 404 when the thread is missing", async () => {
      vi.mocked(historyService.getThreadDetail).mockResolvedValueOnce(null);
      const response = await app.inject({ method: "GET", url: "/settings/conversations/missing" });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("PATCH /settings/conversations/:threadId (rename)", () => {
    it("renames a thread", async () => {
      const mockThread = { id: "t1", title: "Renamed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", messageCount: 2, providers: [] };
      vi.mocked(historyService.renameThread).mockResolvedValueOnce(mockThread as any);

      const response = await app.inject({ method: "PATCH", url: "/settings/conversations/t1", payload: { title: "Renamed" } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ thread: mockThread });
    });

    it("rejects an empty title", async () => {
      const response = await app.inject({ method: "PATCH", url: "/settings/conversations/t1", payload: { title: "" } });
      expect(response.statusCode).toBe(400);
    });

    it("returns 404 when the thread is missing", async () => {
      vi.mocked(historyService.renameThread).mockResolvedValueOnce(null);
      const response = await app.inject({ method: "PATCH", url: "/settings/conversations/missing", payload: { title: "x" } });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /settings/conversations/:threadId", () => {
    it("deletes a thread", async () => {
      vi.mocked(historyService.deleteThread).mockResolvedValueOnce(true);
      const response = await app.inject({ method: "DELETE", url: "/settings/conversations/t1" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });

    it("returns 404 when the thread is missing", async () => {
      vi.mocked(historyService.deleteThread).mockResolvedValueOnce(false);
      const response = await app.inject({ method: "DELETE", url: "/settings/conversations/missing" });
      expect(response.statusCode).toBe(404);
    });
  });
});
