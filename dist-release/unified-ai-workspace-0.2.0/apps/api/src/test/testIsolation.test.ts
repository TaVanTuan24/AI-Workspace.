import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../services/prisma.js";
import {
  makeTestRunId,
  makeTestUserId,
  makeTestEmail,
  withTestUserScope,
  cleanupTestUserData
} from "./testIsolation.js";

describe("testIsolation helper", () => {
  it("should generate IDs containing the prefix", () => {
    const runId = makeTestRunId("auth");
    expect(runId).toContain("auth-");

    const userId = makeTestUserId("billing");
    expect(userId).toContain("user-billing-");

    const email = makeTestEmail("usage");
    expect(email).toContain("user-usage-");
    expect(email).toContain("@test.local");
  });

  it("should generate distinct IDs for consecutive calls", () => {
    const id1 = makeTestRunId("test");
    const id2 = makeTestRunId("test");
    expect(id1).not.toBe(id2);
  });

  describe("cleanupTestUserData", () => {
    // We will use User A and User B to prove that User A's cleanup
    // does not affect User B's data (regression test for 45B).
    const scopeA = withTestUserScope("regression-A");
    const scopeB = withTestUserScope("regression-B");

    beforeEach(async () => {
      await scopeA.cleanup();
      await scopeB.cleanup();

      // Create User A
      await prisma.user.create({
        data: {
          id: scopeA.userId,
          email: scopeA.email
        }
      });

      // Create User B
      await prisma.user.create({
        data: {
          id: scopeB.userId,
          email: scopeB.email
        }
      });
    });

    afterEach(async () => {
      await scopeA.cleanup();
      await scopeB.cleanup();
    });

    it("should delete only scoped user records", async () => {
      // 1. Create API key for User A
      await prisma.internalApiKey.create({
        data: {
          userId: scopeA.userId,
          name: "Key A",
          keyPrefix: "preA",
          keyLast4: "1234",
          keyHash: "hashA",
          status: "active"
        }
      });

      // 2. Create API key for User B
      await prisma.internalApiKey.create({
        data: {
          userId: scopeB.userId,
          name: "Key B",
          keyPrefix: "preB",
          keyLast4: "5678",
          keyHash: "hashB",
          status: "active"
        }
      });

      // Assert both exist
      expect(await prisma.internalApiKey.count({ where: { userId: scopeA.userId } })).toBe(1);
      expect(await prisma.internalApiKey.count({ where: { userId: scopeB.userId } })).toBe(1);

      // 3. Run cleanup for User A ONLY
      await scopeA.cleanup();

      // 4. Assert User A is gone, but User B remains intact
      expect(await prisma.internalApiKey.count({ where: { userId: scopeA.userId } })).toBe(0);
      expect(await prisma.user.count({ where: { id: scopeA.userId } })).toBe(0);

      expect(await prisma.internalApiKey.count({ where: { userId: scopeB.userId } })).toBe(1);
      expect(await prisma.user.count({ where: { id: scopeB.userId } })).toBe(1);
    });
  });
});
