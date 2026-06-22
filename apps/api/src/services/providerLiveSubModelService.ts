import { prisma } from "./prisma.js";
import { providerRegistry } from "./providerRegistry.js";
import { browserManager } from "./browserManager.js";
import { AesGcmSessionVault } from "@uaiw/session-vault/index.js";
import type { ProviderId, LiveDetectedSubModel, ProviderSubModel } from "@uaiw/shared/types/provider.js";

const sessionVault = new AesGcmSessionVault();

export interface ProviderLiveSubModelCacheView {
  provider: ProviderId;
  subModels: LiveDetectedSubModel[];
  detectedAt: string;
  status: string;
  errorCode?: string | null;
}

export async function getCachedLiveSubModels(userId: string): Promise<ProviderLiveSubModelCacheView[]> {
  const caches = await prisma.providerLiveSubModelCache.findMany({
    where: { userId }
  });

  return caches.map(cache => ({
    provider: cache.provider as ProviderId,
    subModels: JSON.parse(cache.subModelsJson) as LiveDetectedSubModel[],
    detectedAt: cache.detectedAt.toISOString(),
    status: cache.status,
    errorCode: cache.errorCode
  }));
}

export async function refreshLiveSubModels(userId: string, provider: ProviderId): Promise<ProviderLiveSubModelCacheView> {
  const registered = providerRegistry.get(provider);
  const def = registered.definition;
  const adapter = registered.adapter;

  if (!adapter.detectLiveSubModels) {
    return saveCacheResult(userId, provider, {
      provider,
      status: "error",
      errorCode: "not_implemented",
      subModels: [],
      warnings: ["Adapter does not implement live sub-model detection"],
      detectedAt: new Date().toISOString()
    });
  }

  const conn = await prisma.providerConnection.findUnique({
    where: { userId_provider: { userId, provider } }
  });

  if (!conn || !conn.encryptedSessionBlob || conn.status === "disconnected" || conn.status === "not_connected") {
    return saveCacheResult(userId, provider, {
      provider,
      status: "requires_login",
      errorCode: "SESSION_MISSING",
      subModels: [],
      warnings: [],
      detectedAt: new Date().toISOString()
    });
  }

  let sessionState: unknown;
  try {
    sessionState = await sessionVault.decryptSession({
      userId,
      provider,
      blob: JSON.parse(conn.encryptedSessionBlob) as any
    });
  } catch (err) {
    return saveCacheResult(userId, provider, {
      provider,
      status: "error",
      errorCode: "SESSION_DECRYPT_FAILED",
      subModels: [],
      warnings: [],
      detectedAt: new Date().toISOString()
    });
  }

  let context;
  try {
    context = await browserManager.createContextFromStorageState({
      userId,
      provider,
      storageState: sessionState
    });

    const detectionResult = await adapter.detectLiveSubModels(context);
    
    // Only update cache with models if it was successful or ui_changed (meaning empty models but safe to override)
    // If requires_login, we just save the status.
    return saveCacheResult(userId, provider, detectionResult);
  } catch (err: any) {
    return saveCacheResult(userId, provider, {
      provider,
      status: "error",
      errorCode: "UNKNOWN_SAFE_ERROR",
      subModels: [],
      warnings: [],
      detectedAt: new Date().toISOString()
    });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function saveCacheResult(userId: string, provider: ProviderId, result: any): Promise<ProviderLiveSubModelCacheView> {
  const cache = await prisma.providerLiveSubModelCache.upsert({
    where: { userId_provider: { userId, provider } },
    update: {
      subModelsJson: JSON.stringify(result.subModels || []),
      detectedAt: new Date(result.detectedAt),
      status: result.status,
      errorCode: result.errorCode || null
    },
    create: {
      userId,
      provider,
      subModelsJson: JSON.stringify(result.subModels || []),
      detectedAt: new Date(result.detectedAt),
      status: result.status,
      errorCode: result.errorCode || null
    }
  });

  return {
    provider,
    subModels: JSON.parse(cache.subModelsJson),
    detectedAt: cache.detectedAt.toISOString(),
    status: cache.status,
    errorCode: cache.errorCode
  };
}

export async function getMergedSubModelsForProvider(userId: string, provider: ProviderId): Promise<{
  provider: ProviderId;
  staticSubModels: ProviderSubModel[];
  liveSubModels: LiveDetectedSubModel[];
  merged: Array<ProviderSubModel | LiveDetectedSubModel>;
  cacheStatus?: string;
  detectedAt?: string | null;
}> {
  const registered = providerRegistry.get(provider);
  const staticSubModels = registered.definition.subModels || [];

  const cache = await prisma.providerLiveSubModelCache.findUnique({
    where: { userId_provider: { userId, provider } }
  });

  const liveSubModels: LiveDetectedSubModel[] = cache ? JSON.parse(cache.subModelsJson) : [];
  
  // Merge: all static, plus any live ones that don't match static IDs exactly (or maybe we just list them all? UI can handle grouping)
  const merged = [...staticSubModels];
  const staticIds = new Set(staticSubModels.map(s => s.id));

  for (const live of liveSubModels) {
    if (!staticIds.has(live.id)) {
      merged.push(live);
    }
  }

  return {
    provider,
    staticSubModels,
    liveSubModels,
    merged,
    cacheStatus: cache?.status,
    detectedAt: cache?.detectedAt?.toISOString()
  };
}
