import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { PROVIDERS, type ProviderId } from "@uaiw/shared/types/provider.js";
import { AesGcmSessionVault, type EncryptedSession } from "@uaiw/session-vault/index.js";
import { attachLocalUser } from "../middleware/auth.js";
import { prisma } from "../services/prisma.js";
import { browserManager } from "../services/browserManager.js";
import { providerRegistry } from "../services/providerRegistry.js";

const providerParams = z.object({
  provider: z.enum(PROVIDERS)
});

function officialLoginUrl(provider: ProviderId) {
  return providerRegistry.get(provider).definition.loginUrl;
}

const sessionVault = new AesGcmSessionVault();

export async function providerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/providers", async (request) => {
    const rows = await prisma.providerConnection.findMany({
      where: { userId: request.user.id }
    });

    const byProvider = new Map(rows.map((row) => [row.provider, row]));

    return {
      providers: providerRegistry.list().map((definition) => {
        const row = byProvider.get(definition.id);
        return {
          provider: definition.id,
          displayName: definition.displayName,
          readiness: definition.readiness,
          capabilities: definition.capabilities,
          defaultEnabled: definition.defaultEnabled,
          loginUrl: definition.loginUrl,
          status: row?.status ?? "not_connected",
          lastConnectedAt: row?.lastConnectedAt?.toISOString() ?? null,
          lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
          lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
          errorCode: row?.errorCode ?? null,
          errorMessageSafe: row?.errorMessageSafe ?? null
        };
      })
    };
  });

  app.post("/providers/:provider/connect/start", async (request, reply) => {
    const { provider } = providerParams.parse(request.params);
    const connectSessionId = `conn_${nanoid()}`;
    const registered = providerRegistry.get(provider);
    const adapter = registered.adapter;

    if (!registered.definition.capabilities.includes("connect")) {
      return reply.code(501).send({
        provider,
        status: "error",
        errorCode: "PROVIDER_NOT_READY",
        message: "This provider is not available for connection yet."
      });
    }

    await prisma.providerConnection.upsert({
      where: { userId_provider: { userId: request.user.id, provider } },
      create: {
        userId: request.user.id,
        provider,
        status: "connecting",
        browserProfileId: `${request.user.id}_${provider}`
      },
      update: {
        status: "connecting",
        errorCode: null,
        errorMessageSafe: null
      }
    });

    try {
      await browserManager.createLoginContext({
        connectSessionId,
        userId: request.user.id,
        provider,
        loginUrl: adapter.loginUrl
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user.id,
          provider,
          action: "provider.connect.started",
          result: "ok",
          requestId: request.id,
          metadataSafeJson: JSON.stringify({ connectSessionId })
        }
      });

      return reply.send({
        connectSessionId,
        provider,
        status: "connecting",
        message: "A browser window has opened. Please complete login there.",
        loginUrl: officialLoginUrl(provider)
      });
    } catch {
      await prisma.providerConnection.update({
        where: { userId_provider: { userId: request.user.id, provider } },
        data: {
          status: "error",
          errorCode: "BROWSER_CONTEXT_FAILED",
          errorMessageSafe: "Unable to open a local browser window for provider login."
        }
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user.id,
          provider,
          action: "provider.connect.started",
          result: "error",
          requestId: request.id
        }
      });

      return reply.code(500).send({
        provider,
        status: "error",
        errorCode: "BROWSER_CONTEXT_FAILED",
        message: "Unable to open a local browser window for provider login."
      });
    }
  });

  app.get("/providers/:provider/connect/status", async (request, reply) => {
    const { provider } = providerParams.parse(request.params);
    const query = z.object({ connectSessionId: z.string().min(1).optional() }).parse(request.query);

    const row = await prisma.providerConnection.findUnique({
      where: { userId_provider: { userId: request.user.id, provider } }
    });

    if (!query.connectSessionId) {
      return reply.send({
        provider,
        status: row?.status ?? "not_connected",
        manualActionRequired: row?.status === "manual_action_required" || row?.status === "requires_login"
      });
    }

    const runtime = browserManager.getConnectSession(query.connectSessionId);
    if (!runtime || runtime.userId !== request.user.id || runtime.provider !== provider) {
      return reply.code(404).send({
        provider,
        status: row?.status === "connected" ? "connected" : "error",
        errorCode: "CONNECT_SESSION_NOT_FOUND",
        message: "Login session was not found or expired. Please start connect again."
      });
    }

    const adapter = providerRegistry.get(provider).adapter;

    try {
      const authStatus = await adapter.detectLoggedIn(runtime.context);
      if (authStatus !== "connected") {
        await prisma.providerConnection.update({
          where: { userId_provider: { userId: request.user.id, provider } },
          data: {
            status: authStatus === "requires_login" ? "requires_login" : "manual_action_required",
            lastValidatedAt: new Date(),
            errorCode: null,
            errorMessageSafe: null
          }
        });

        return reply.send({
          provider,
          status: authStatus === "requires_login" ? "requires_login" : "manual_action_required",
          manualActionRequired: true,
          message: "Please complete login or verification in the browser window."
        });
      }

      const sessionState = await adapter.exportSession(runtime.context);
      const encrypted = await sessionVault.encryptSession({
        userId: request.user.id,
        provider,
        sessionState
      });

      await prisma.providerConnection.update({
        where: { userId_provider: { userId: request.user.id, provider } },
        data: {
          status: "connected",
          encryptedSessionBlob: JSON.stringify(encrypted satisfies EncryptedSession),
          encryptedSessionRef: null,
          encryptionVersion: encrypted.version,
          browserProfileId: `${request.user.id}_${provider}`,
          lastConnectedAt: new Date(),
          lastValidatedAt: new Date(),
          errorCode: null,
          errorMessageSafe: null
        }
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user.id,
          provider,
          action: "provider.connect.completed",
          result: "ok",
          requestId: request.id
        }
      });

      await browserManager.closeConnectSession(query.connectSessionId);

      return reply.send({
        provider,
        status: "connected",
        manualActionRequired: false
      });
    } catch (error) {
      await browserManager.closeConnectSession(query.connectSessionId).catch(() => {});
      await prisma.providerConnection.update({
        where: { userId_provider: { userId: request.user.id, provider } },
        data: {
          status: "error",
          errorCode: error instanceof Error ? safeErrorCode(error.message) : "UNKNOWN_SAFE_ERROR",
          errorMessageSafe: "Unable to verify or save provider session."
        }
      });

      return reply.code(500).send({
        provider,
        status: "error",
        errorCode: "UNKNOWN_SAFE_ERROR",
        message: "Unable to verify or save provider session."
      });
    }
  });

  app.post("/providers/:provider/test", async (request, reply) => {
    const { provider } = providerParams.parse(request.params);

    // M4: enqueue a lightweight worker validation job instead of testing here.
    const row = await prisma.providerConnection.findUnique({
      where: { userId_provider: { userId: request.user.id, provider } }
    });

    return reply.send({
      provider,
      status: row?.status ?? "not_connected"
    });
  });

  app.post("/providers/:provider/disconnect", async (request, reply) => {
    const { provider } = providerParams.parse(request.params);

    await prisma.providerConnection.upsert({
      where: { userId_provider: { userId: request.user.id, provider } },
      create: {
        userId: request.user.id,
        provider,
        status: "disconnected"
      },
      update: {
        status: "disconnected",
        encryptedSessionBlob: null,
        encryptedSessionRef: null,
        encryptionVersion: null,
        browserProfileId: null,
        errorCode: null,
        errorMessageSafe: null
      }
    });

    await browserManager.deleteBrowserProfile(request.user.id, provider);

    await prisma.auditLog.create({
      data: {
        userId: request.user.id,
        provider,
        action: "provider.disconnected",
        result: "ok",
        requestId: request.id
      }
    });

    return reply.send({ provider, status: "disconnected" });
  });
}

function safeErrorCode(message: string) {
  if (message.includes("SESSION_MASTER_KEY")) return "SESSION_ENCRYPT_FAILED";
  if (message.includes("SESSION_ENCRYPT_FAILED")) return "SESSION_ENCRYPT_FAILED";
  return "UNKNOWN_SAFE_ERROR";
}
