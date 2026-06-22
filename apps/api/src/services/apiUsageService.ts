import { prisma } from "./prisma.js";
import { Prisma } from "@prisma/client";
import { PROVIDERS, isProviderId, type ProviderId } from "@uaiw/shared/types/provider.js";

export type UsageTrafficSource =
  | "openai_compat"
  | "internal_chat"
  | "internal_multi_chat"
  | "internal_retry";

const USAGE_TRAFFIC_SOURCES: UsageTrafficSource[] = [
  "openai_compat",
  "internal_chat",
  "internal_multi_chat",
  "internal_retry"
];

export interface CreateUsageStartInput {
  userId: string;
  workspaceId: string;
  apiKeyId?: string;
  apiKeyPrefix?: string;
  model: string;
  provider: string;
  source?: UsageTrafficSource;
  endpoint: string;
  requestId: string;
  stream: boolean;
  messageCount: number;
  inputCharCount: number;
}

export async function createUsageStart(input: CreateUsageStartInput) {
  return prisma.internalApiUsageLog.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      apiKeyId: input.apiKeyId,
      apiKeyPrefix: input.apiKeyPrefix,
      model: input.model,
      provider: input.provider,
      source: input.source ?? "openai_compat",
      endpoint: input.endpoint,
      requestId: input.requestId,
      status: "queued",
      stream: input.stream,
      messageCount: input.messageCount,
      inputCharCount: input.inputCharCount,
    }
  });
}

export async function completeUsageSuccess(logId: string, input: { outputCharCount: number; durationMs: number; jobId?: string }) {
  await prisma.internalApiUsageLog.update({
    where: { id: logId },
    data: {
      status: "completed",
      outputCharCount: input.outputCharCount,
      durationMs: input.durationMs,
      jobId: input.jobId
    }
  }).catch(() => {});
}

export async function completeUsageError(logId: string, input: { errorCode?: string; errorType?: string; durationMs?: number; jobId?: string; status?: string; source?: UsageTrafficSource; limitType?: string; limitPerMinute?: number }) {
  await prisma.internalApiUsageLog.update({
    where: { id: logId },
    data: {
      status: input.status || "failed",
      errorCode: input.errorCode,
      errorType: input.errorType,
      source: input.source,
      limitType: input.limitType,
      limitPerMinute: input.limitPerMinute,
      durationMs: input.durationMs,
      jobId: input.jobId
    }
  }).catch(() => {});
}

export async function logRateLimitHit(input: Omit<CreateUsageStartInput, "stream" | "messageCount" | "inputCharCount">) {
  await prisma.internalApiUsageLog.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      apiKeyId: input.apiKeyId,
      apiKeyPrefix: input.apiKeyPrefix,
      model: input.model,
      provider: input.provider,
      source: "openai_compat",
      endpoint: input.endpoint,
      requestId: input.requestId,
      status: "rate_limited",
      errorCode: "rate_limit_exceeded",
      errorType: "rate_limit_error",
      limitType: "api_key",
      stream: false,
      messageCount: 0,
      inputCharCount: 0,
    }
  }).catch(() => {});
}

export async function logProviderRateLimitHit(input: {
  userId: string;
  workspaceId: string;
  provider: ProviderId;
  modelId?: string | null;
  source: UsageTrafficSource;
  limitPerMinute: number;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  apiKeyPrefix?: string | null;
  usageLogId?: string | null;
}): Promise<void> {
  const model = input.modelId ?? modelIdForProvider(input.provider);
  const data = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    apiKeyId: input.apiKeyId ?? null,
    apiKeyName: input.apiKeyName ?? null,
    apiKeyPrefix: input.apiKeyPrefix ?? null,
    model,
    provider: input.provider,
    source: input.source,
    endpoint: endpointForSource(input.source),
    requestId: `provider-limit:${input.source}:${input.provider}:${Date.now()}`,
    status: "rate_limited",
    errorCode: "provider_rate_limit_exceeded",
    errorType: "rate_limit_error",
    limitType: "provider",
    limitPerMinute: input.limitPerMinute,
    stream: false,
    messageCount: 0,
    inputCharCount: 0
  };

  try {
    if (input.usageLogId) {
      await prisma.internalApiUsageLog.update({
        where: { id: input.usageLogId },
        data: {
          status: data.status,
          errorCode: data.errorCode,
          errorType: data.errorType,
          source: data.source,
          limitType: data.limitType,
          limitPerMinute: data.limitPerMinute,
          apiKeyName: data.apiKeyName,
          apiKeyPrefix: data.apiKeyPrefix
        }
      });
      return;
    }

    await prisma.internalApiUsageLog.create({ data });
  } catch {
    // Analytics logging must not change the provider-limit response path.
  }
}

export function modelIdForProvider(provider: ProviderId): string {
  return `${provider}-web`;
}

function endpointForSource(source: UsageTrafficSource): string {
  if (source === "internal_chat") return "/chat";
  if (source === "internal_multi_chat") return "/chat/multi";
  if (source === "internal_retry") return "/chat/:jobId/retry";
  return "/v1/chat/completions";
}

export async function getUsageSummary(userId: string, filters: { from?: Date; to?: Date; apiKeyId?: string; model?: string; provider?: string }) {
  const where: Prisma.InternalApiUsageLogWhereInput = {
    userId,
    ...(filters.apiKeyId ? { apiKeyId: filters.apiKeyId } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.from || filters.to ? {
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {})
      }
    } : {})
  };

  const totalsPromise = prisma.internalApiUsageLog.aggregate({
    where,
    _count: { id: true },
    _sum: { inputCharCount: true, outputCharCount: true, durationMs: true },
    _avg: { durationMs: true }
  });

  const statusCountPromise = prisma.internalApiUsageLog.groupBy({
    by: ['status'],
    where,
    _count: { id: true }
  });

  const byModelPromise = prisma.internalApiUsageLog.groupBy({
    by: ['model', 'status'],
    where,
    _count: { id: true }
  });

  const byProviderPromise = prisma.internalApiUsageLog.groupBy({
    by: ['provider', 'status'],
    where,
    _count: { id: true }
  });

  const [totals, statusCounts, byModel, byProvider] = await Promise.all([
    totalsPromise,
    statusCountPromise,
    byModelPromise,
    byProviderPromise
  ]);

  const completed = statusCounts.find(s => s.status === 'completed')?._count.id || 0;
  const failed = statusCounts.find(s => s.status === 'failed')?._count.id || 0;
  const rateLimited = statusCounts.find(s => s.status === 'rate_limited')?._count.id || 0;

  const modelMap = new Map<string, { model: string; requests: number; completed: number; failed: number }>();
  for (const m of byModel) {
    const existing = modelMap.get(m.model) || { model: m.model, requests: 0, completed: 0, failed: 0 };
    existing.requests += m._count.id;
    if (m.status === "completed") existing.completed += m._count.id;
    if (m.status === "failed") existing.failed += m._count.id;
    modelMap.set(m.model, existing);
  }

  const providerMap = new Map<string, { provider: string; requests: number; completed: number; failed: number }>();
  for (const p of byProvider) {
    const existing = providerMap.get(p.provider) || { provider: p.provider, requests: 0, completed: 0, failed: 0 };
    existing.requests += p._count.id;
    if (p.status === "completed") existing.completed += p._count.id;
    if (p.status === "failed") existing.failed += p._count.id;
    providerMap.set(p.provider, existing);
  }

  return {
    totals: {
      requests: totals._count.id,
      completed,
      failed,
      rateLimited,
      inputChars: totals._sum.inputCharCount || 0,
      outputChars: totals._sum.outputCharCount || 0,
      avgDurationMs: Math.round(totals._avg.durationMs || 0)
    },
    byModel: Array.from(modelMap.values()),
    byProvider: Array.from(providerMap.values())
  };
}

export interface ProviderLimitAnalyticsRange {
  from: Date;
  to: Date;
}

export interface ProviderLimitHitBucket {
  provider: ProviderId;
  modelId?: string | null;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  apiKeyPrefix?: string | null;
  hits: number;
}

export interface ProviderLimitAnalyticsSummary {
  range: "24h" | "7d" | "custom";
  from: string;
  to: string;
  totalHits: number;
  byProvider: Array<{
    provider: ProviderId;
    hits: number;
  }>;
  byModel: Array<{
    modelId: string;
    provider: ProviderId;
    hits: number;
  }>;
  byApiKey: Array<{
    apiKeyId: string;
    name: string;
    keyPrefix?: string | null;
    hits: number;
  }>;
  bySource: Array<{
    source: UsageTrafficSource;
    hits: number;
  }>;
  recentEvents: Array<{
    createdAt: string;
    provider: ProviderId;
    modelId?: string | null;
    apiKeyName?: string | null;
    source?: UsageTrafficSource | null;
    errorCode: "provider_rate_limit_exceeded";
  }>;
}

export async function getProviderLimitAnalytics(
  userId: string,
  input: { range?: "24h" | "7d"; from?: Date; to?: Date } = {}
): Promise<ProviderLimitAnalyticsSummary> {
  const now = input.to ?? new Date();
  const range = input.from || input.to ? "custom" : input.range ?? "24h";
  const from =
    input.from ??
    new Date(now.getTime() - (range === "7d" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000));
  const to = now;

  const where: Prisma.InternalApiUsageLogWhereInput = {
    userId,
    status: "rate_limited",
    errorCode: "provider_rate_limit_exceeded",
    createdAt: {
      gte: from,
      lte: to
    }
  };

  const [totalHits, providerGroups, modelGroups, apiKeyGroups, sourceGroups, recentEvents] = await Promise.all([
    prisma.internalApiUsageLog.count({ where }),
    prisma.internalApiUsageLog.groupBy({
      by: ["provider"],
      where,
      _count: { id: true }
    }),
    prisma.internalApiUsageLog.groupBy({
      by: ["model", "provider"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } }
    }),
    prisma.internalApiUsageLog.groupBy({
      by: ["apiKeyId", "apiKeyPrefix"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } }
    }),
    prisma.internalApiUsageLog.groupBy({
      by: ["source"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } }
    }),
    prisma.internalApiUsageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        createdAt: true,
        provider: true,
        model: true,
        source: true,
        errorCode: true,
        apiKeyName: true,
        apiKeyPrefix: true,
        apiKey: {
          select: {
            id: true,
            name: true,
            keyPrefix: true
          }
        }
      }
    })
  ]);

  const providerHits = new Map<ProviderId, number>();
  for (const item of providerGroups) {
    if (isProviderId(item.provider)) {
      providerHits.set(item.provider, item._count.id);
    }
  }

  const apiKeyIds = apiKeyGroups
    .map((item) => item.apiKeyId)
    .filter((id): id is string => Boolean(id));
  const apiKeys =
    apiKeyIds.length > 0
      ? await prisma.internalApiKey.findMany({
          where: { userId, id: { in: apiKeyIds } },
          select: { id: true, name: true, keyPrefix: true }
        })
      : [];
  const apiKeySafeDisplay = new Map(apiKeys.map((key) => [key.id, key]));
  const sourceHits = new Map<UsageTrafficSource, number>();
  for (const item of sourceGroups) {
    if (isUsageTrafficSource(item.source)) {
      sourceHits.set(item.source, item._count.id);
    }
  }

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    totalHits,
    byProvider: PROVIDERS.map((provider) => ({
      provider,
      hits: providerHits.get(provider) ?? 0
    })),
    byModel: modelGroups
      .filter((item) => isProviderId(item.provider))
      .map((item) => ({
        modelId: item.model,
        provider: item.provider as ProviderId,
        hits: item._count.id
      })),
    byApiKey: apiKeyGroups.map((item) => {
      const safeKey = item.apiKeyId ? apiKeySafeDisplay.get(item.apiKeyId) : null;
      return {
        apiKeyId: item.apiKeyId ?? "env_fallback",
        name: safeKey?.name ?? (item.apiKeyId ? "Deleted API key" : "Environment key"),
        keyPrefix: safeKey?.keyPrefix ?? item.apiKeyPrefix ?? null,
        hits: item._count.id
      };
    }),
    bySource: USAGE_TRAFFIC_SOURCES.map((source) => ({
      source,
      hits: sourceHits.get(source) ?? 0
    })),
    recentEvents: recentEvents
      .filter((event) => isProviderId(event.provider))
      .map((event) => ({
        createdAt: event.createdAt.toISOString(),
        provider: event.provider as ProviderId,
        modelId: event.model,
        apiKeyName: event.apiKey?.name ?? event.apiKeyName ?? (event.apiKeyPrefix ? "API key" : "Environment key"),
        source: isUsageTrafficSource(event.source) ? event.source : null,
        errorCode: "provider_rate_limit_exceeded"
      }))
  };
}

function isUsageTrafficSource(value: string | null): value is UsageTrafficSource {
  return Boolean(value && (USAGE_TRAFFIC_SOURCES as readonly string[]).includes(value));
}

export async function listUsageLogs(userId: string, filters: { page?: number; pageSize?: number; from?: Date; to?: Date; apiKeyId?: string; model?: string; provider?: string; status?: string }) {
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;

  const where: Prisma.InternalApiUsageLogWhereInput = {
    userId,
    ...(filters.apiKeyId ? { apiKeyId: filters.apiKeyId } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from || filters.to ? {
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {})
      }
    } : {})
  };

  const total = await prisma.internalApiUsageLog.count({ where });
  const items = await prisma.internalApiUsageLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  return {
    items: items.map(item => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      apiKeyId: item.apiKeyId,
      apiKeyPrefix: item.apiKeyPrefix,
      model: item.model,
      provider: item.provider,
      source: item.source,
      status: item.status,
      errorCode: item.errorCode,
      stream: item.stream,
      messageCount: item.messageCount,
      inputCharCount: item.inputCharCount,
      outputCharCount: item.outputCharCount,
      durationMs: item.durationMs
    })),
    page,
    pageSize,
    total
  };
}
