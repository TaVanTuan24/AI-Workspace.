import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { workspaceRoutes } from "../workspace.js";
import { prisma } from "../../services/prisma.js";
import { withTestUserScope } from "../../test/testIsolation.js";

describe("Workspace Routes", () => {
  let app: FastifyInstance;
  const scopeA = withTestUserScope("ws-user-a");

  beforeEach(async () => {
    app = Fastify();
    await app.register(workspaceRoutes);

    await scopeA.cleanup();

    await prisma.user.create({
      data: {
        id: scopeA.userId,
        email: scopeA.email,
        role: "owner"
      }
    });
  });

  afterEach(async () => {
    await scopeA.cleanup();
  });

  it("should list active workspaces", async () => {
    const ws1 = await prisma.workspace.create({
      data: { name: "Workspace 1", slug: `ws-1-${scopeA.runId}` }
    });
    const ws2 = await prisma.workspace.create({
      data: { name: "Workspace 2", slug: `ws-2-${scopeA.runId}` }
    });
    const ws3 = await prisma.workspace.create({
      data: { name: "Workspace 3", slug: `ws-3-${scopeA.runId}` }
    });

    await prisma.workspaceMembership.create({
      data: { workspaceId: ws1.id, userId: scopeA.userId, role: "owner", status: "active" }
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: ws2.id, userId: scopeA.userId, role: "member", status: "active" }
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: ws3.id, userId: scopeA.userId, role: "member", status: "inactive" } // Disabled
    });

    await prisma.user.update({
      where: { id: scopeA.userId },
      data: { workspaceId: ws1.id }
    });

    const response = await app.inject({
      method: "GET",
      url: "/settings/workspaces",
      headers: { "x-local-user-id": scopeA.userId }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    
    expect(body.currentWorkspaceId).toBe(ws1.id);
    expect(body.workspaces).toHaveLength(2); // Only active ones
    expect(body.workspaces.map((w: any) => w.id)).toContain(ws1.id);
    expect(body.workspaces.map((w: any) => w.id)).toContain(ws2.id);
    expect(body.workspaces.find((w: any) => w.id === ws1.id).role).toBe("owner");
    
    // Clean up workspaces
    await prisma.workspace.deleteMany({ where: { id: { in: [ws1.id, ws2.id, ws3.id] } } });
  });

  it("should switch workspace securely", async () => {
    const ws1 = await prisma.workspace.create({
      data: { name: "Workspace 1", slug: `ws-switch-1-${scopeA.runId}` }
    });
    const ws2 = await prisma.workspace.create({
      data: { name: "Workspace 2", slug: `ws-switch-2-${scopeA.runId}` }
    });

    await prisma.workspaceMembership.create({
      data: { workspaceId: ws1.id, userId: scopeA.userId, role: "owner", status: "active" }
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: ws2.id, userId: scopeA.userId, role: "viewer", status: "active" }
    });

    await prisma.user.update({
      where: { id: scopeA.userId },
      data: { workspaceId: ws1.id }
    });

    const response = await app.inject({
      method: "POST",
      url: "/settings/workspaces/switch",
      headers: { "x-local-user-id": scopeA.userId },
      payload: { workspaceId: ws2.id }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    
    expect(body.currentWorkspaceId).toBe(ws2.id);
    expect(body.role).toBe("viewer");
    expect(body.permissions).toContain("settings.read");

    // Verify DB update
    const user = await prisma.user.findUnique({ where: { id: scopeA.userId } });
    expect(user?.workspaceId).toBe(ws2.id);

    // Clean up
    await prisma.workspace.deleteMany({ where: { id: { in: [ws1.id, ws2.id] } } });
  });

  it("should reject switch to workspace without membership", async () => {
    const wsNoAccess = await prisma.workspace.create({
      data: { name: "No Access", slug: `ws-noaccess-${scopeA.runId}` }
    });

    const response = await app.inject({
      method: "POST",
      url: "/settings/workspaces/switch",
      headers: { "x-local-user-id": scopeA.userId },
      payload: { workspaceId: wsNoAccess.id }
    });

    expect(response.statusCode).toBe(403);
    
    await prisma.workspace.deleteMany({ where: { id: wsNoAccess.id } });
  });

  describe("Workspace Creation", () => {
    it("should create a new workspace safely", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/settings/workspaces",
        headers: { "x-local-user-id": scopeA.userId },
        payload: { name: `  My New Team ${scopeA.runId}!  ` }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.workspace.name).toBe(`My New Team ${scopeA.runId}!`);
      expect(body.workspace.slug).toBe(`my-new-team-${scopeA.runId}`);
      expect(body.workspace.role).toBe("owner");

      const user = await prisma.user.findUnique({ where: { id: scopeA.userId } });
      expect(user?.workspaceId).toBe(body.workspace.id);

      // Clean up
      await prisma.workspace.deleteMany({ where: { id: body.workspace.id } });
    });

    it("should reject invalid workspace names", async () => {
      const response1 = await app.inject({
        method: "POST",
        url: "/settings/workspaces",
        headers: { "x-local-user-id": scopeA.userId },
        payload: { name: "x" } // too short
      });
      expect(response1.statusCode).toBe(400);

      const response2 = await app.inject({
        method: "POST",
        url: "/settings/workspaces",
        headers: { "x-local-user-id": scopeA.userId },
        payload: { name: "safe\nname" } // control char
      });
      expect(response2.statusCode).toBe(400);
    });

    it("should not copy sensitive records from old workspace", async () => {
      // 1. Setup old workspace with sensitive data
      const oldWs = await prisma.workspace.create({
        data: { name: "Old WS", slug: `ws-old-${scopeA.runId}` }
      });
      await prisma.workspaceMembership.create({
        data: { workspaceId: oldWs.id, userId: scopeA.userId, role: "owner", status: "active" }
      });
      await prisma.user.update({
        where: { id: scopeA.userId },
        data: { workspaceId: oldWs.id }
      });

      // Add API Key
      await prisma.internalApiKey.create({
        data: {
          workspaceId: oldWs.id,
          userId: scopeA.userId,
          name: "Old Key",
          keyPrefix: "sk-old",
          keyLast4: "1234",
          keyHash: "hash123",
          status: "active"
        }
      });

      // Add provider connection
      await prisma.providerConnection.create({
        data: {
          workspaceId: oldWs.id,
          userId: scopeA.userId,
          provider: "chatgpt",
          status: "connected",
          encryptedSessionBlob: "blob"
        }
      });

      // 2. Create new workspace
      const response = await app.inject({
        method: "POST",
        url: "/settings/workspaces",
        headers: { "x-local-user-id": scopeA.userId },
        payload: { name: "New WS" }
      });
      expect(response.statusCode).toBe(200);
      const newWsId = response.json().workspace.id;

      // 3. Verify no data is copied to new workspace
      const newApiKeys = await prisma.internalApiKey.count({ where: { workspaceId: newWsId } });
      const newProviders = await prisma.providerConnection.count({ where: { workspaceId: newWsId } });

      expect(newApiKeys).toBe(0);
      expect(newProviders).toBe(0);

      // Verify old data is intact in old workspace
      expect(await prisma.internalApiKey.count({ where: { workspaceId: oldWs.id } })).toBe(1);
      expect(await prisma.providerConnection.count({ where: { workspaceId: oldWs.id } })).toBe(1);

      // Clean up
      await prisma.workspace.deleteMany({ where: { id: { in: [oldWs.id, newWsId] } } });
    });
  });
});
