import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../prisma.js";
import { makeTestRunId, withTestUserScope, cleanupTestUserData } from "../../test/testIsolation.js";
import {
  listThreads,
  getThreadDetail,
  deleteThread,
  renameThread,
  saveDiscussion
} from "../conversationHistoryService.js";

const runId = makeTestRunId("conversationHistory");

describe("conversationHistoryService", () => {
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    const scope = await withTestUserScope(runId);
    userId = scope.userId;
    await prisma.user.create({ data: { id: userId, email: scope.email } });

    const other = await withTestUserScope(`${runId}-other`);
    otherUserId = other.userId;
    await prisma.user.create({ data: { id: otherUserId, email: other.email } });
  });

  afterEach(async () => {
    await cleanupTestUserData(userId);
    await cleanupTestUserData(otherUserId);
  });

  async function seedThread(ownerId: string, title: string, providers: string[]) {
    const thread = await prisma.chatThread.create({ data: { userId: ownerId, title } });
    await prisma.message.create({
      data: { threadId: thread.id, userId: ownerId, role: "user", content: `Q for ${title}` }
    });
    for (const provider of providers) {
      await prisma.message.create({
        data: {
          threadId: thread.id,
          userId: ownerId,
          role: "assistant",
          provider,
          content: `A from ${provider}`,
          metadataJson: JSON.stringify({ provider, model: `${provider}-web` })
        }
      });
    }
    return thread;
  }

  it("lists only the owner's threads with counts and providers", async () => {
    await seedThread(userId, "Mine", ["chatgpt", "gemini"]);
    await seedThread(otherUserId, "Theirs", ["claude"]);

    const result = await listThreads(userId);

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].title).toBe("Mine");
    expect(result.threads[0].messageCount).toBe(3);
    expect(result.threads[0].providers).toEqual(["chatgpt", "gemini"]);
    expect(result.nextCursor).toBeNull();
  });

  it("paginates with a cursor", async () => {
    await seedThread(userId, "First", []);
    await seedThread(userId, "Second", []);
    await seedThread(userId, "Third", []);

    const firstPage = await listThreads(userId, { limit: 2 });
    expect(firstPage.threads).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listThreads(userId, { limit: 2, cursor: firstPage.nextCursor! });
    expect(secondPage.threads).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const allIds = [...firstPage.threads, ...secondPage.threads].map((t) => t.id);
    expect(new Set(allIds).size).toBe(3);
  });

  it("returns ordered messages with model metadata in detail", async () => {
    const thread = await seedThread(userId, "Detail", ["chatgpt"]);

    const detail = await getThreadDetail(userId, thread.id);

    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(2);
    expect(detail!.messages[0].role).toBe("user");
    expect(detail!.messages[1].role).toBe("assistant");
    expect(detail!.messages[1].model).toBe("chatgpt-web");
    expect(detail!.providers).toEqual(["chatgpt"]);
  });

  it("does not leak another user's thread detail", async () => {
    const thread = await seedThread(otherUserId, "Secret", ["claude"]);
    const detail = await getThreadDetail(userId, thread.id);
    expect(detail).toBeNull();
  });

  it("renames a thread and rejects ownership mismatch", async () => {
    const thread = await seedThread(userId, "Old", []);

    const renamed = await renameThread(userId, thread.id, "New title");
    expect(renamed?.title).toBe("New title");

    const foreign = await renameThread(otherUserId, thread.id, "Hijack");
    expect(foreign).toBeNull();
  });

  it("rejects an out-of-range title", async () => {
    const thread = await seedThread(userId, "Old", []);
    await expect(renameThread(userId, thread.id, "")).rejects.toThrow();
    await expect(renameThread(userId, thread.id, "x".repeat(201))).rejects.toThrow();
  });

  it("deletes a thread and cascades messages, scoped by owner", async () => {
    const thread = await seedThread(userId, "ToDelete", ["gemini"]);

    const foreignDelete = await deleteThread(otherUserId, thread.id);
    expect(foreignDelete).toBe(false);

    const deleted = await deleteThread(userId, thread.id);
    expect(deleted).toBe(true);

    const remaining = await prisma.message.count({ where: { threadId: thread.id } });
    expect(remaining).toBe(0);
  });

  it("saves a discussion and reloads it as a discussion thread with rounds", async () => {
    const { threadId } = await saveDiscussion(userId, "Is AI conscious?", [
      { round: 1, provider: "gemini", text: "Gemini round 1" },
      { round: 1, provider: "chatgpt", text: "ChatGPT round 1" },
      { round: 2, provider: "gemini", text: "Gemini round 2" }
    ]);

    const detail = await getThreadDetail(userId, threadId);
    expect(detail).not.toBeNull();
    expect(detail!.kind).toBe("discussion");
    expect(detail!.title).toBe("[Discussion] Is AI conscious?");

    // 1 topic (user) + 3 assistant turns.
    expect(detail!.messages).toHaveLength(4);
    expect(detail!.messages[0].role).toBe("user");
    expect(detail!.messages[0].round).toBeNull();
    const assistantRounds = detail!.messages.filter((m) => m.role === "assistant").map((m) => m.round);
    expect(assistantRounds).toEqual([1, 1, 2]);
    expect(detail!.providers).toEqual(["chatgpt", "gemini"]);

    // It also shows up in the thread list, tagged as a discussion.
    const list = await listThreads(userId);
    const listed = list.threads.find((t) => t.id === threadId);
    expect(listed).toBeDefined();
    expect(listed!.kind).toBe("discussion");
  });

  it("rejects an empty discussion", async () => {
    await expect(saveDiscussion(userId, "Topic", [])).rejects.toThrow();
  });
});
