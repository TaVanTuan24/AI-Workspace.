import { prisma } from "./prisma.js";
import { providerRegistry } from "./providerRegistry.js";
import { browserManager } from "./browserManager.js";
import { AesGcmSessionVault } from "@uaiw/session-vault/index.js";
import { env } from "../config/env.js";
import type { ProviderId, ProviderCapability } from "@uaiw/shared/types/provider.js";

const sessionVault = new AesGcmSessionVault();

export interface ProviderHealth {
  provider: ProviderId;
  displayName: string;
  readiness: string;
  capabilities: ProviderCapability[];
  connectionStatus: string;
  healthStatus: string;
  requiresLogin: boolean;
  isUsable: boolean;
  lastConnectedAt?: string | null;
  lastValidatedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function getProviderHealth(userId: string): Promise<ProviderHealth[]> {
  const connections = await prisma.providerConnection.findMany({
    where: { userId }
  });

  const byProvider = new Map(connections.map(c => [c.provider, c]));

  return providerRegistry.list().map(def => {
    const conn = byProvider.get(def.id);
    const connectionStatus = conn?.status ?? "not_connected";
    const lastValidatedAt = conn?.lastValidatedAt;

    let healthStatus = "unknown";
    if (connectionStatus === "connected") healthStatus = "healthy";
    else if (connectionStatus === "requires_login") healthStatus = "requires_login";
    else if (connectionStatus === "manual_action_required") healthStatus = "manual_action_required";
    else if (connectionStatus === "expired") healthStatus = "expired";
    else if (connectionStatus === "error") healthStatus = "error";

    const isUsable = 
      def.readiness === "ready" &&
      def.capabilities.includes("send_message") &&
      connectionStatus === "connected" &&
      healthStatus === "healthy";

    return {
      provider: def.id as ProviderId,
      displayName: def.displayName,
      readiness: def.readiness,
      capabilities: def.capabilities,
      connectionStatus,
      healthStatus,
      requiresLogin: connectionStatus === "requires_login" || connectionStatus === "not_connected",
      isUsable,
      lastConnectedAt: conn?.lastConnectedAt?.toISOString(),
      lastValidatedAt: lastValidatedAt?.toISOString(),
      errorCode: conn?.errorCode,
      errorMessage: conn?.errorMessageSafe
    };
  });
}

export async function refreshProviderHealth(userId: string, provider: ProviderId): Promise<ProviderHealth> {
  const registered = providerRegistry.get(provider);
  const def = registered.definition;

  const conn = await prisma.providerConnection.findUnique({
    where: { userId_provider: { userId, provider } }
  });

  if (!conn || conn.status === "disconnected" || conn.status === "not_connected") {
    return buildHealthResult(def, conn, "not_connected");
  }

  if (!conn.encryptedSessionBlob) {
    await updateConnectionStatus(userId, provider, "requires_login");
    return buildHealthResult(def, conn, "requires_login");
  }

  let sessionState: unknown;
  try {
    sessionState = await sessionVault.decryptSession({
      userId,
      provider,
      blob: JSON.parse(conn.encryptedSessionBlob) as any
    });
  } catch (err) {
    await updateConnectionStatus(userId, provider, "error", "SESSION_DECRYPT_FAILED", "Unable to decrypt session.");
    return buildHealthResult(def, conn, "error", "SESSION_DECRYPT_FAILED");
  }

  let newStatus = conn.status;
  let newErrorCode: string | null = null;
  let newErrorMessage: string | null = null;
  let context;

  try {
    context = await browserManager.createContextFromStorageState({
      userId,
      provider,
      storageState: sessionState
    });

    const adapter = registered.adapter;
    const authStatus = await Promise.race([
      adapter.validateSession(context),
      new Promise<"error">((_, reject) => setTimeout(() => reject(new Error("Timeout")), env.PROVIDER_HEALTH_TIMEOUT_MS))
    ]) as any;

    newStatus = authStatus;
    if (authStatus !== "connected") {
      newErrorCode = authStatus === "requires_login" ? "SESSION_EXPIRED" : "MANUAL_ACTION_REQUIRED";
      newErrorMessage = "Please complete login or verification in the browser window.";
    }
  } catch (err: any) {
    newStatus = "error";
    newErrorCode = err.message === "Timeout" ? "TIMEOUT" : "UNKNOWN_SAFE_ERROR";
    newErrorMessage = "Failed to validate session.";
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }

  const updatedConn = await updateConnectionStatus(userId, provider, newStatus, newErrorCode, newErrorMessage);
  return buildHealthResult(def, updatedConn, newStatus);
}

export async function refreshAllProviderHealth(userId: string): Promise<ProviderHealth[]> {
  const healths = await getProviderHealth(userId);
  const toRefresh = healths.filter(h => h.connectionStatus !== "not_connected" && h.connectionStatus !== "disconnected");
  
  const results = [];
  for (const h of toRefresh) {
    try {
      const result = await refreshProviderHealth(userId, h.provider);
      results.push(result);
    } catch {
      // Safe fallback if the entire refresh crashes
      results.push(h);
    }
  }

  // Reload everything to get the full updated list
  return getProviderHealth(userId);
}

function buildHealthResult(def: any, conn: any, currentStatus: string, errorCode?: string): ProviderHealth {
  let healthStatus = "unknown";
  if (currentStatus === "connected") healthStatus = "healthy";
  else if (currentStatus === "requires_login") healthStatus = "requires_login";
  else if (currentStatus === "manual_action_required") healthStatus = "manual_action_required";
  else if (currentStatus === "expired") healthStatus = "expired";
  else if (currentStatus === "error") healthStatus = "error";

  const isUsable = 
    def.readiness === "ready" &&
    def.capabilities.includes("send_message") &&
    currentStatus === "connected" &&
    healthStatus === "healthy";

  return {
    provider: def.id,
    displayName: def.displayName,
    readiness: def.readiness,
    capabilities: def.capabilities,
    connectionStatus: currentStatus,
    healthStatus,
    requiresLogin: currentStatus === "requires_login" || currentStatus === "not_connected",
    isUsable,
    lastConnectedAt: conn?.lastConnectedAt?.toISOString(),
    lastValidatedAt: new Date().toISOString(), // we just validated
    errorCode: errorCode || conn?.errorCode,
    errorMessage: conn?.errorMessageSafe
  };
}

async function updateConnectionStatus(userId: string, provider: ProviderId, status: string, errorCode: string | null = null, errorMessageSafe: string | null = null) {
  return prisma.providerConnection.update({
    where: { userId_provider: { userId, provider } },
    data: {
      status,
      lastValidatedAt: new Date(),
      errorCode,
      errorMessageSafe
    }
  }).catch(() => null);
}
