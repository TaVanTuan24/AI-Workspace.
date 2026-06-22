import { prisma } from "./prisma.js";
import { ExportFileSchema, ExportFile, MAX_TOTAL_MESSAGES } from "./conversationImportSchema.js";
import { ZodError } from "zod";

export interface ImportPreview {
  valid: boolean;
  format?: string;
  version?: number;
  threadCount: number;
  messageCount: number;
  warnings: string[];
  error?: string;
}

export interface ImportOptions {
  conflictStrategy: "create_new" | "skip_duplicates";
}

export interface ImportResult {
  importedThreads: number;
  importedMessages: number;
  skippedThreads: number;
  warnings: string[];
}

export async function previewConversationImport(userId: string, fileData: unknown): Promise<ImportPreview> {
  try {
    const parsed = ExportFileSchema.parse(fileData);
    
    let messageCount = 0;
    for (const thread of parsed.threads) {
      messageCount += thread.messages.length;
    }

    const warnings: string[] = [];

    if (messageCount > MAX_TOTAL_MESSAGES) {
      return {
        valid: false,
        threadCount: parsed.threads.length,
        messageCount,
        warnings,
        error: `File contains too many messages (${messageCount}). Maximum allowed is ${MAX_TOTAL_MESSAGES}.`
      };
    }

    return {
      valid: true,
      format: parsed.format,
      version: parsed.version,
      threadCount: parsed.threads.length,
      messageCount,
      warnings
    };

  } catch (error) {
    if (error instanceof ZodError) {
      return {
        valid: false,
        threadCount: 0,
        messageCount: 0,
        warnings: [],
        error: "Invalid file format or structure."
      };
    }
    return {
      valid: false,
      threadCount: 0,
      messageCount: 0,
      warnings: [],
      error: "Unexpected error during validation."
    };
  }
}

export async function importConversations(userId: string, fileData: unknown, options: ImportOptions): Promise<ImportResult> {
  if (options.conflictStrategy !== "create_new") {
    throw new Error(`Unsupported conflict strategy: ${options.conflictStrategy}`);
  }

  const parsed = ExportFileSchema.parse(fileData);
  let importedThreads = 0;
  let importedMessages = 0;
  const skippedThreads = 0;
  const warnings: string[] = [];

  // Wrap inside a transaction correctly assigning ownership seamlessly
  await prisma.$transaction(async (tx) => {
    for (const thread of parsed.threads) {
      const title = thread.title ? `[Imported] ${thread.title}` : `[Imported] New Chat`;

      // Safe metadata storing explicit mapped roots gracefully
      const createdThread = await tx.chatThread.create({
        data: {
          userId,
          title,
          createdAt: new Date(thread.createdAt),
          updatedAt: new Date(thread.updatedAt),
        }
      });
      importedThreads++;

      if (thread.messages.length > 0) {
        const messagesData = thread.messages.map(msg => {
          let metadataJson: string | undefined = undefined;
          
          if (msg.metadata || msg.sourceMessageId) {
            const safeMeta: any = { ...msg.metadata };
            if (msg.sourceMessageId) {
              safeMeta.importedFrom = {
                sourceMessageId: msg.sourceMessageId,
                sourceThreadId: thread.sourceThreadId
              };
            }
            metadataJson = JSON.stringify(safeMeta);
          }

          return {
            threadId: createdThread.id,
            userId,
            provider: msg.provider || null,
            role: msg.role,
            content: msg.content,
            metadataJson,
            createdAt: new Date(msg.createdAt)
          };
        });

        const msgs = await tx.message.createMany({
          data: messagesData
        });
        importedMessages += msgs.count;
      }
    }
  });

  return {
    importedThreads,
    importedMessages,
    skippedThreads,
    warnings
  };
}
