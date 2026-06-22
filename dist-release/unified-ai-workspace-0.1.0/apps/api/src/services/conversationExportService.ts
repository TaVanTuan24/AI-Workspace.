import { prisma } from "./prisma.js";
import { ExportFile, ExportThread, ExportMessage } from "./conversationImportSchema.js";
import { Prisma } from "@prisma/client";

// List of strictly safe metadata keys allowed for export
const SAFE_METADATA_KEYS = ["finishReason", "provider", "model", "jobId", "durationMs", "errorCode"];

function sanitizeMessageMetadata(metadataJson: string | null): Record<string, unknown> | undefined {
  if (!metadataJson) return undefined;
  try {
    const parsed = JSON.parse(metadataJson);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    
    const sanitized: Record<string, unknown> = {};
    let hasKeys = false;
    for (const key of SAFE_METADATA_KEYS) {
      if (key in parsed) {
        sanitized[key] = parsed[key];
        hasKeys = true;
      }
    }
    return hasKeys ? sanitized : undefined;
  } catch {
    return undefined;
  }
}

function mapRole(role: string): "system" | "user" | "assistant" | "tool" | "error" {
  switch(role) {
    case "system":
    case "user":
    case "assistant":
    case "tool":
    case "error":
      return role;
    default:
      return "user"; // Safe default fallback
  }
}

async function serializeThread(threadId: string, userId: string): Promise<ExportThread | null> {
  const thread = await prisma.chatThread.findUnique({
    where: {
      id: threadId,
      userId
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!thread) return null;

  const messages: ExportMessage[] = thread.messages.map(msg => {
    let modelName: string | null | undefined = undefined;
    const sanitizedMeta = sanitizeMessageMetadata(msg.metadataJson);
    if (sanitizedMeta && typeof sanitizedMeta.model === "string") {
      modelName = sanitizedMeta.model;
    }

    return {
      sourceMessageId: msg.id,
      role: mapRole(msg.role),
      content: msg.content,
      provider: msg.provider,
      model: modelName,
      createdAt: msg.createdAt.toISOString(),
      metadata: sanitizedMeta
    };
  });

  return {
    sourceThreadId: thread.id,
    title: thread.title,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    messages
  };
}

function generateExportContainer(threads: ExportThread[]): ExportFile {
  return {
    format: "unified-ai-workspace.conversations",
    version: 1,
    exportedAt: new Date().toISOString(),
    source: {
      app: "Unified AI Workspace",
      type: "conversation_export"
    },
    threads
  };
}

export async function exportAllConversations(userId: string): Promise<ExportFile> {
  const threads = await prisma.chatThread.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });

  const exportThreads: ExportThread[] = [];
  for (const t of threads) {
    const serialized = await serializeThread(t.id, userId);
    if (serialized) {
      exportThreads.push(serialized);
    }
  }

  return generateExportContainer(exportThreads);
}

export async function exportThread(userId: string, threadId: string): Promise<ExportFile | null> {
  const serialized = await serializeThread(threadId, userId);
  if (!serialized) return null;
  return generateExportContainer([serialized]);
}
