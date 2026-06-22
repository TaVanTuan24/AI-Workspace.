import type { ProviderRecoveryOverride } from "@prisma/client";
import { PROVIDERS, type ProviderId } from "@uaiw/shared/types/provider.js";
import { prisma } from "./prisma.js";

export const PROVIDER_RECOVERY_OVERRIDE_ACTION_TYPES = [
  "mark_provider_temporarily_degraded",
  "prefer_fallback_provider",
  "disable_model_temporarily"
] as const;

export type ProviderRecoveryOverrideActionType = (typeof PROVIDER_RECOVERY_OVERRIDE_ACTION_TYPES)[number];

export const PROVIDER_RECOVERY_OVERRIDE_STATUSES = [
  "active",
  "expired",
  "rolled_back",
  "superseded",
  "failed"
] as const;

export type ProviderRecoveryOverrideStatus = (typeof PROVIDER_RECOVERY_OVERRIDE_STATUSES)[number];

export interface ProviderRecoveryOverrideView {
  id: string;
  actionType: ProviderRecoveryOverrideActionType;
  provider?: ProviderId;
  modelId?: string;
  subModelId?: string;
  status: ProviderRecoveryOverrideStatus;
  reason?: string;
  safeSummary?: string;
  previousState?: Record<string, unknown>;
  overrideState?: Record<string, unknown>;
  startsAt: string;
  expiresAt: string;
  resolvedAt?: string;
  resolution?: string;
  policyId?: string;
  policyRunId?: string;
}

export interface ProviderRecoveryOverrideExpirySummary {
  scanned: number;
  expired: number;
  skipped: number;
  dryRun: boolean;
  expiredOverrides: ProviderRecoveryOverrideView[];
}

export interface EffectiveRecoveryState {
  degradedProviders: Record<string, {
    mode: "avoid_if_possible" | "block_for_duration";
    expiresAt: string;
    reason?: string;
    overrideId: string;
  }>;
  preferredFallbackOrder: Array<{
    provider?: ProviderId;
    onlyIfProvider?: ProviderId;
    fallbackProviderOrder: ProviderId[];
    expiresAt: string;
    reason?: string;
    overrideId: string;
  }>;
  temporarilyDisabledModels: Record<string, {
    provider?: ProviderId;
    modelId?: string;
    subModelId?: string;
    expiresAt: string;
    reason?: string;
    overrideId: string;
  }>;
}

export interface CreateRecoveryOverrideInput {
  userId: string;
  policyId?: string | null;
  policyRunId?: string | null;
  actionType: string;
  provider?: string | null;
  modelId?: string | null;
  subModelId?: string | null;
  durationMinutes: number;
  reason?: string | null;
  overrideState?: Record<string, unknown> | null;
  previousState?: Record<string, unknown> | null;
}

const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 7 * 24 * 60;
const MAX_REASON_LENGTH = 240;
const FORBIDDEN_JSON_KEY_PARTS = [
  "cookie",
  "token",
  "session",
  "storagestate",
  "localstorage",
  "password",
  "secret",
  "apikey",
  "api_key",
  "webhook",
  "signing"
];

export async function createRecoveryOverride(input: CreateRecoveryOverrideInput): Promise<ProviderRecoveryOverrideView> {
  const actionType = parseOverrideActionType(input.actionType);
  const provider = normalizeOptionalProvider(input.provider);
  const modelId = normalizeOptionalText(input.modelId, 120);
  const subModelId = normalizeOptionalText(input.subModelId, 120);
  const durationMinutes = normalizeDuration(input.durationMinutes);
  const reason = sanitizeText(input.reason, MAX_REASON_LENGTH);
  const previousState = sanitizeJsonObject(input.previousState);
  const overrideState = sanitizeJsonObject(input.overrideState);
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
  const safeSummary = buildSafeSummary(actionType, provider, modelId, subModelId, expiresAt, reason);

  const existing = await prisma.providerRecoveryOverride.findFirst({
    where: {
      userId: input.userId,
      status: "active",
      actionType,
      provider: provider ?? null,
      modelId: modelId ?? null,
      subModelId: subModelId ?? null
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    await prisma.providerRecoveryOverride.update({
      where: { id: existing.id },
      data: {
        status: "superseded",
        resolvedAt: startsAt,
        resolution: "superseded_by_new_override"
      }
    });
    await auditOverride(input.userId, "provider_recovery_override_superseded", "success", provider, {
      overrideId: existing.id,
      actionType,
      replacementPolicyRunId: safeRef(input.policyRunId)
    });
  }

  const created = await prisma.providerRecoveryOverride.create({
    data: {
      userId: input.userId,
      policyId: safeRef(input.policyId),
      policyRunId: safeRef(input.policyRunId),
      actionType,
      provider,
      modelId,
      subModelId,
      status: "active",
      reason,
      safeSummary,
      previousState: jsonString(previousState),
      overrideState: jsonString(overrideState),
      startsAt,
      expiresAt
    }
  });

  await auditOverride(input.userId, "provider_recovery_override_created", "success", provider, {
    overrideId: created.id,
    policyId: safeRef(input.policyId),
    policyRunId: safeRef(input.policyRunId),
    actionType,
    modelId,
    subModelId,
    expiresAt: expiresAt.toISOString()
  });

  return toOverrideView(created);
}

export async function rollbackOverride(input: {
  userId: string;
  overrideId: string;
  resolution: string;
}): Promise<ProviderRecoveryOverrideView | null> {
  const override = await prisma.providerRecoveryOverride.findFirst({
    where: { id: input.overrideId, userId: input.userId }
  });
  if (!override) return null;

  const resolution = normalizeResolution(input.resolution);
  const updated = await prisma.providerRecoveryOverride.update({
    where: { id: override.id },
    data: {
      status: "rolled_back",
      resolvedAt: new Date(),
      resolution
    }
  });

  await auditOverride(input.userId, "provider_recovery_override_rolled_back", "success", normalizeOptionalProvider(override.provider), {
    overrideId: override.id,
    actionType: override.actionType,
    resolution
  });

  return toOverrideView(updated);
}

export async function expireOverrides(input: { now?: Date; userId?: string; dryRun?: boolean; limit?: number } = {}): Promise<ProviderRecoveryOverrideExpirySummary> {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 5000);
  const overrides = await prisma.providerRecoveryOverride.findMany({
    where: {
      status: "active",
      expiresAt: { lte: now },
      ...(input.userId ? { userId: input.userId } : {})
    },
    orderBy: { expiresAt: "asc" },
    take: limit
  });

  if (input.dryRun) {
    return {
      scanned: overrides.length,
      expired: overrides.length,
      skipped: 0,
      dryRun: true,
      expiredOverrides: overrides.map(toOverrideView)
    };
  }

  const expired: ProviderRecoveryOverrideView[] = [];
  for (const override of overrides) {
    if (!isOverrideCurrentlyActiveAtOrBefore(override, now)) {
      continue;
    }
    const updated = await prisma.providerRecoveryOverride.update({
      where: { id: override.id },
      data: {
        status: "expired",
        resolvedAt: now,
        resolution: "expired"
      }
    });
    await auditOverride(override.userId, "provider_recovery_override_expired", "success", normalizeOptionalProvider(override.provider), {
      overrideId: override.id,
      actionType: override.actionType,
      expiresAt: override.expiresAt.toISOString()
    });
    expired.push(toOverrideView(updated));
  }

  return {
    scanned: overrides.length,
    expired: expired.length,
    skipped: overrides.length - expired.length,
    dryRun: false,
    expiredOverrides: expired
  };
}

export async function listRecoveryOverrides(input: {
  userId: string;
  status?: string;
  provider?: string;
  actionType?: string;
  limit?: number;
}): Promise<ProviderRecoveryOverrideView[]> {
  const status = input.status && input.status !== "all" ? parseOverrideStatus(input.status) : undefined;
  const provider = normalizeOptionalProvider(input.provider);
  const actionType = input.actionType ? parseOverrideActionType(input.actionType) : undefined;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);

  const overrides = await prisma.providerRecoveryOverride.findMany({
    where: {
      userId: input.userId,
      ...(status ? { status } : {}),
      ...(provider ? { provider } : {}),
      ...(actionType ? { actionType } : {})
    },
    orderBy: [{ status: "asc" }, { expiresAt: "asc" }],
    take: limit
  });
  return overrides.map(toOverrideView);
}

export async function getRecoveryOverride(userId: string, overrideId: string): Promise<ProviderRecoveryOverrideView | null> {
  const override = await prisma.providerRecoveryOverride.findFirst({
    where: { userId, id: overrideId }
  });
  return override ? toOverrideView(override) : null;
}

export async function listActiveOverrides(input: { userId: string; now?: Date }): Promise<ProviderRecoveryOverrideView[]> {
  const now = input.now ?? new Date();
  const overrides = await prisma.providerRecoveryOverride.findMany({
    where: {
      userId: input.userId,
      status: "active",
      expiresAt: { gt: now }
    },
    orderBy: { expiresAt: "asc" }
  });
  return overrides.map(toOverrideView).filter((override) => isOverrideCurrentlyActive(override, now));
}

export async function getEffectiveRecoveryState(userId: string): Promise<EffectiveRecoveryState> {
  const active = await listActiveOverrides({ userId });
  const state: EffectiveRecoveryState = {
    degradedProviders: {},
    preferredFallbackOrder: [],
    temporarilyDisabledModels: {}
  };

  for (const override of active) {
    if (override.actionType === "mark_provider_temporarily_degraded" && override.provider) {
      const mode = override.overrideState?.mode === "block_for_duration" ? "block_for_duration" : "avoid_if_possible";
      state.degradedProviders[override.provider] = {
        mode,
        expiresAt: override.expiresAt,
        reason: override.reason,
        overrideId: override.id
      };
    }

    if (override.actionType === "prefer_fallback_provider") {
      const order = Array.isArray(override.overrideState?.fallbackProviderOrder)
        ? override.overrideState.fallbackProviderOrder.filter((value): value is ProviderId => isProvider(value))
        : [];
      const onlyIfProvider = isProvider(override.overrideState?.onlyIfProvider)
        ? override.overrideState.onlyIfProvider
        : override.provider;
      if (order.length > 0) {
        state.preferredFallbackOrder.push({
          provider: override.provider,
          onlyIfProvider,
          fallbackProviderOrder: order,
          expiresAt: override.expiresAt,
          reason: override.reason,
          overrideId: override.id
        });
      }
    }

    if (override.actionType === "disable_model_temporarily") {
      const key = disabledModelKey(override.modelId, override.provider, override.subModelId);
      state.temporarilyDisabledModels[key] = {
        provider: override.provider,
        modelId: override.modelId,
        subModelId: override.subModelId,
        expiresAt: override.expiresAt,
        reason: override.reason,
        overrideId: override.id
      };
    }
  }

  return state;
}

export async function getModelRecoveryStatus(userId: string, modelId: string, provider?: ProviderId) {
  const state = await getEffectiveRecoveryState(userId);
  return getModelRecoveryStatusFromState(state, modelId, provider);
}

export function getModelRecoveryStatusFromState(state: EffectiveRecoveryState, modelId: string, provider?: ProviderId) {
  const disabled =
    state.temporarilyDisabledModels[disabledModelKey(modelId, provider)] ??
    (provider ? state.temporarilyDisabledModels[disabledModelKey(undefined, provider)] : undefined);
  const degraded = provider ? state.degradedProviders[provider] : undefined;
  return {
    providerDegraded: Boolean(degraded),
    degradedMode: degraded?.mode,
    degradedUntil: degraded?.expiresAt,
    degradedReason: degraded?.reason,
    temporarilyDisabled: Boolean(disabled),
    disabledUntil: disabled?.expiresAt,
    disabledReason: disabled?.reason,
    disabledOverrideId: disabled?.overrideId
  };
}

export function isRecoveryActionType(value: string): value is ProviderRecoveryOverrideActionType {
  return (PROVIDER_RECOVERY_OVERRIDE_ACTION_TYPES as readonly string[]).includes(value);
}

export function isOverrideCurrentlyActive(
  override: Pick<ProviderRecoveryOverrideView, "status" | "expiresAt">,
  now = new Date()
): boolean {
  return override.status === "active" && new Date(override.expiresAt).getTime() > now.getTime();
}

function isOverrideCurrentlyActiveAtOrBefore(
  override: Pick<ProviderRecoveryOverride, "status" | "expiresAt">,
  now: Date
): boolean {
  return override.status === "active" && override.expiresAt.getTime() <= now.getTime();
}

function toOverrideView(override: ProviderRecoveryOverride): ProviderRecoveryOverrideView {
  return {
    id: override.id,
    actionType: override.actionType as ProviderRecoveryOverrideActionType,
    provider: normalizeOptionalProvider(override.provider),
    modelId: override.modelId ?? undefined,
    subModelId: override.subModelId ?? undefined,
    status: override.status as ProviderRecoveryOverrideStatus,
    reason: override.reason ?? undefined,
    safeSummary: override.safeSummary ?? undefined,
    previousState: parseJsonObject(override.previousState),
    overrideState: parseJsonObject(override.overrideState),
    startsAt: override.startsAt.toISOString(),
    expiresAt: override.expiresAt.toISOString(),
    resolvedAt: override.resolvedAt?.toISOString(),
    resolution: override.resolution ?? undefined,
    policyId: override.policyId ?? undefined,
    policyRunId: override.policyRunId ?? undefined
  };
}

function parseOverrideActionType(value: string): ProviderRecoveryOverrideActionType {
  if (!isRecoveryActionType(value)) {
    throw new Error(`Unsupported recovery override action: ${value}`);
  }
  return value;
}

function parseOverrideStatus(value: string): ProviderRecoveryOverrideStatus {
  if (!(PROVIDER_RECOVERY_OVERRIDE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`Unsupported recovery override status: ${value}`);
  }
  return value as ProviderRecoveryOverrideStatus;
}

function normalizeDuration(value: number) {
  const duration = Number.isFinite(value) ? Math.floor(value) : 60;
  if (duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
    throw new Error(`Override duration must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`);
  }
  return duration;
}

function normalizeOptionalProvider(value?: string | null): ProviderId | undefined {
  if (!value) return undefined;
  if (!(PROVIDERS as readonly string[]).includes(value)) {
    throw new Error(`Invalid provider: ${value}`);
  }
  return value as ProviderId;
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return sanitizeText(String(value), maxLength);
}

function sanitizeText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return undefined;
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/cookie|token|session|storageState|localStorage|password|secret|api key|webhook/gi, "[redacted]")
    .trim()
    .slice(0, maxLength);
  return text || undefined;
}

function sanitizeJsonObject(input?: Record<string, unknown> | null): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return sanitizeJsonValue(input) as Record<string, unknown>;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return sanitizeText(value, 240);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeJsonValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenJsonKey(key)) {
        throw new Error(`Unsafe override metadata key: ${key}`);
      }
      const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
      if (!safeKey) continue;
      const safeValue = sanitizeJsonValue(nested, depth + 1);
      if (safeValue !== undefined) result[safeKey] = safeValue;
    }
    return result;
  }
  return undefined;
}

function isForbiddenJsonKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return FORBIDDEN_JSON_KEY_PARTS.some((part) => normalized.includes(part));
}

function parseJsonObject(input?: string | null): Record<string, unknown> | undefined {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function jsonString(input: unknown) {
  return JSON.stringify(input ?? {});
}

function disabledModelKey(modelId?: string, provider?: string, subModelId?: string) {
  return [modelId || "*", provider || "*", subModelId || "*"].join("|");
}

function buildSafeSummary(
  actionType: ProviderRecoveryOverrideActionType,
  provider: ProviderId | undefined,
  modelId: string | undefined,
  subModelId: string | undefined,
  expiresAt: Date,
  reason?: string
) {
  const target = modelId || provider || "workspace";
  const subModel = subModelId ? `/${subModelId}` : "";
  const reasonPart = reason ? `: ${reason}` : "";
  return `${actionType} for ${target}${subModel} until ${expiresAt.toISOString()}${reasonPart}`.slice(0, 400);
}

function safeRef(value?: string | null) {
  if (!value) return undefined;
  return String(value).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);
}

function normalizeResolution(value: string) {
  const allowed = new Set(["manual_rollback", "fixed", "incorrect_policy", "expired", "superseded_by_new_override"]);
  if (!allowed.has(value)) throw new Error("Invalid override resolution.");
  return value;
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

async function auditOverride(
  userId: string,
  action: string,
  result: "success" | "failed",
  provider: ProviderId | undefined,
  metadata: Record<string, unknown>
) {
  await prisma.auditLog.create({
    data: {
      userId,
      provider,
      action,
      result,
      metadataSafeJson: JSON.stringify(sanitizeJsonObject(metadata))
    }
  }).catch(() => undefined);
}
