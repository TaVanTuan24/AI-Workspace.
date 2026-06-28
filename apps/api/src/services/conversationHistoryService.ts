import { prisma } from "./prisma.js";

export interface ThreadListItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  providers: string[];
}

export interface ThreadListResult {
  threads: ThreadListItem[];
  nextCursor: string | null;
}

export interface ThreadDetailMessage {
  id: string;
  role: string;
  provider: string | null;
  content: string;
  model: string | null;
  createdAt: string;
}

export interface ThreadDetail {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  providers: string[];
  messages: ThreadDetailMessage[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function modelFromMetadata(metadataJson: string | null): string | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson);
    if (parsed && typeof parsed === "object" && typeof parsed.model === "string") {
      return parsed.model;
    }
  } catch {
    // ignore malformed metadata
  }
  return null;
}

export async function listThreads(
  userId: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<ThreadListResult> {
  const limit = clampLimit(options.limit);

  const rows = await prisma.chatThread.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } }
    }
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]!.id : null;

  const providersByThread = await getProvidersByThread(page.map((t) => t.id));

  const threads: ThreadListItem[] = page.map((t) => ({
    id: t.id,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    messageCount: t._count.messages,
    providers: providersByThread.get(t.id) ?? []
  }));

  return { threads, nextCursor };
}

async function getProvidersByThread(threadIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (threadIds.length === 0) return result;

  const grouped = await prisma.message.groupBy({
    by: ["threadId", "provider"],
    where: { threadId: { in: threadIds }, provider: { not: null } }
  });

  for (const row of grouped) {
    if (!row.provider) continue;
    const list = result.get(row.threadId) ?? [];
    list.push(row.provider);
    result.set(row.threadId, list);
  }
  for (const [key, list] of result) {
    result.set(key, list.sort());
  }
  return result;
}

export async function getThreadDetail(userId: string, threadId: string): Promise<ThreadDetail | null> {
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, userId },
    include: {
      messages: { orderBy: { createdAt: "asc" } }
    }
  });

  if (!thread) return null;

  const providers = new Set<string>();
  const messages: ThreadDetailMessage[] = thread.messages.map((msg) => {
    if (msg.provider) providers.add(msg.provider);
    return {
      id: msg.id,
      role: msg.role,
      provider: msg.provider,
      content: msg.content,
      model: modelFromMetadata(msg.metadataJson),
      createdAt: msg.createdAt.toISOString()
    };
  });

  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    providers: Array.from(providers).sort(),
    messages
  };
}

export async function deleteThread(userId: string, threadId: string): Promise<boolean> {
  // Messages and jobs cascade via the schema's onDelete: Cascade relations.
  const result = await prisma.chatThread.deleteMany({ where: { id: threadId, userId } });
  return result.count > 0;
}

export async function renameThread(
  userId: string,
  threadId: string,
  title: string
): Promise<ThreadListItem | null> {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new Error("Title must be between 1 and 200 characters.");
  }

  const result = await prisma.chatThread.updateMany({
    where: { id: threadId, userId },
    data: { title: trimmed }
  });
  if (result.count === 0) return null;

  const updated = await prisma.chatThread.findFirst({
    where: { id: threadId, userId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } }
    }
  });
  if (!updated) return null;

  const providersByThread = await getProvidersByThread([updated.id]);
  return {
    id: updated.id,
    title: updated.title,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    messageCount: updated._count.messages,
    providers: providersByThread.get(updated.id) ?? []
  };
}
