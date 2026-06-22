import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../prisma.js";
import { exportAllConversations, exportThread } from "../conversationExportService.js";
import { previewConversationImport, importConversations } from "../conversationImportService.js";

describe("Conversation Export & Import", () => {
  const userId = "test-export-user";

  beforeEach(async () => {
    await prisma.message.deleteMany({ where: { userId } });
    await prisma.chatThread.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: {
        id: userId,
        email: "test-export@local.com"
      }
    });
  });

  afterEach(async () => {
    await prisma.message.deleteMany({ where: { userId } });
    await prisma.chatThread.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("should export only user owned threads and sanitize metadata", async () => {
    const thread = await prisma.chatThread.create({
      data: {
        userId,
        title: "Secret Thread",
      }
    });

    await prisma.message.create({
      data: {
        threadId: thread.id,
        userId,
        provider: "chatgpt",
        role: "assistant",
        content: "I am a secret",
        metadataJson: JSON.stringify({
          model: "gpt-4",
          apiKey: "sk-super-secret",
          jobId: "job-123"
        })
      }
    });

    const exportData = await exportAllConversations(userId);

    expect(exportData.threads).toHaveLength(1);
    expect(exportData.threads[0].title).toBe("Secret Thread");
    
    const messages = exportData.threads[0].messages;
    expect(messages).toHaveLength(1);
    
    const msg = messages[0];
    expect(msg.provider).toBe("chatgpt");
    expect(msg.model).toBe("gpt-4");
    
    // Check sanitation
    expect(msg.metadata?.model).toBe("gpt-4");
    expect(msg.metadata?.jobId).toBe("job-123");
    expect(msg.metadata?.apiKey).toBeUndefined(); // Dropped
  });

  it("should import conversations creating new ids safely", async () => {
    const fakeExport = {
      format: "unified-ai-workspace.conversations",
      version: 1,
      exportedAt: new Date().toISOString(),
      threads: [
        {
          sourceThreadId: "src-thread-1",
          title: "My backup",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [
            {
              sourceMessageId: "src-msg-1",
              role: "user",
              content: "Hello",
              createdAt: new Date().toISOString()
            }
          ]
        }
      ]
    };

    const preview = await previewConversationImport(userId, fakeExport);
    expect(preview.valid).toBe(true);
    expect(preview.threadCount).toBe(1);
    expect(preview.messageCount).toBe(1);

    const result = await importConversations(userId, fakeExport, { conflictStrategy: "create_new" });
    expect(result.importedThreads).toBe(1);
    expect(result.importedMessages).toBe(1);

    // Verify DB
    const threads = await prisma.chatThread.findMany({ where: { userId }, include: { messages: true } });
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("[Imported] My backup");
    expect(threads[0].id).not.toBe("src-thread-1");

    expect(threads[0].messages).toHaveLength(1);
    const msg = threads[0].messages[0];
    expect(msg.id).not.toBe("src-msg-1");
    
    const meta = JSON.parse(msg.metadataJson || "{}");
    expect(meta.importedFrom.sourceMessageId).toBe("src-msg-1");
    expect(meta.importedFrom.sourceThreadId).toBe("src-thread-1");
  });

  it("should reject oversized files in preview safely", async () => {
    // 26 threads * 2000 messages = 52000 messages (exceeds 50000 total limit)
    const manyMessages = Array.from({ length: 2000 }).map(() => ({
      role: "user",
      content: "Hi",
      createdAt: new Date().toISOString()
    }));

    const threads = Array.from({ length: 26 }).map((_, i) => ({
      title: `Thread ${i}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: manyMessages
    }));

    const fakeExport = {
      format: "unified-ai-workspace.conversations",
      version: 1,
      exportedAt: new Date().toISOString(),
      threads
    };

    const preview = await previewConversationImport(userId, fakeExport);
    expect(preview.valid).toBe(false);
    expect(preview.error).toMatch(/too many messages/i);
  });
});
