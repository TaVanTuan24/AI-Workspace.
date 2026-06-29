import { prisma } from "./prisma.js";

export interface ThreadListItem {
  id: string;
  title: string | null;
  kind: "chat" | "discussion";
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
  round: number | null;
  createdAt: string;
}

export interface ThreadDetail {
  id: string;
  title: string | null;
  kind: "chat" | "discussion";
  createdAt: string;
  updatedAt: string;
  providers: string[];
  messages: ThreadDetailMessage[];
}

export interface DiscussionEntryInput {
  round: number;
  provider: string;
  text: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function parseMetadata(metadataJson: string | null): { model: string | null; round: number | null } {
  if (!metadataJson) return { model: null, round: null };
  try {
    const parsed = JSON.parse(metadataJson);
    if (parsed && typeof parsed === "object") {
      return {
        model: typeof parsed.model === "string" ? parsed.model : null,
        round: typeof parsed.round === "number" ? parsed.round : null
      };
    }
  } catch {
    // ignore malformed metadata
  }
  return { model: null, round: null };
}

export async function listThreads(
  userId: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<ThreadListResult> {
  const limit = clampLimit(options.limit);

  const rows = await prisma.chatThread.findMany({
    where: { userId },
    // Secondary sort by id keeps pagination deterministic when multiple threads
    // share the same updatedAt (millisecond ties), so cursor paging never skips
    // or duplicates a row.
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
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

  const pageIds = page.map((t) => t.id);
  const providersByThread = await getProvidersByThread(pageIds);
  const discussionIds = await getDiscussionThreadIds(pageIds);

  const threads: ThreadListItem[] = page.map((t) => ({
    id: t.id,
    title: t.title,
    kind: discussionIds.has(t.id) ? "discussion" : "chat",
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    messageCount: t._count.messages,
    providers: providersByThread.get(t.id) ?? []
  }));

  return { threads, nextCursor };
}

// Threads with discussion-tagged messages, detected via metadata (survives
// renaming the thread title, unlike a title-prefix heuristic).
async function getDiscussionThreadIds(threadIds: string[]): Promise<Set<string>> {
  if (threadIds.length === 0) return new Set();
  const rows = await prisma.message.findMany({
    where: { threadId: { in: threadIds }, metadataJson: { contains: '"kind":"discussion"' } },
    distinct: ["threadId"],
    select: { threadId: true }
  });
  return new Set(rows.map((row) => row.threadId));
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
  let isDiscussion = false;
  const messages: ThreadDetailMessage[] = thread.messages.map((msg) => {
    if (msg.provider) providers.add(msg.provider);
    const { model, round } = parseMetadata(msg.metadataJson);
    if (round !== null) isDiscussion = true;
    return {
      id: msg.id,
      role: msg.role,
      provider: msg.provider,
      content: msg.content,
      model,
      round,
      createdAt: msg.createdAt.toISOString()
    };
  });

  return {
    id: thread.id,
    title: thread.title,
    kind: isDiscussion ? "discussion" : "chat",
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    providers: Array.from(providers).sort(),
    messages
  };
}

const MAX_DISCUSSION_ENTRIES = 200;

// Persist a completed discussion as a single thread: one user message holding
// the topic, then one assistant message per turn carrying { round } metadata so
// the thread can be recognised and replayed as a discussion later.
export async function saveDiscussion(
  userId: string,
  topic: string,
  entries: DiscussionEntryInput[]
): Promise<{ threadId: string }> {
  const trimmedTopic = topic.trim().slice(0, 2000) || "Discussion";
  if (entries.length === 0) {
    throw new Error("A discussion needs at least one turn to save.");
  }
  const kept = entries.slice(0, MAX_DISCUSSION_ENTRIES);
  const title = `[Discussion] ${trimmedTopic}`.slice(0, 200);

  const thread = await prisma.chatThread.create({ data: { userId, title } });
  await prisma.message.create({
    data: {
      threadId: thread.id,
      userId,
      role: "user",
      content: trimmedTopic,
      metadataJson: JSON.stringify({ kind: "discussion" })
    }
  });
  for (const entry of kept) {
    await prisma.message.create({
      data: {
        threadId: thread.id,
        userId,
        role: "assistant",
        provider: entry.provider,
        content: entry.text,
        metadataJson: JSON.stringify({ kind: "discussion", round: entry.round })
      }
    });
  }

  return { threadId: thread.id };
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
  const discussionIds = await getDiscussionThreadIds([updated.id]);
  return {
    id: updated.id,
    title: updated.title,
    kind: discussionIds.has(updated.id) ? "discussion" : "chat",
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    messageCount: updated._count.messages,
    providers: providersByThread.get(updated.id) ?? []
  };
}
