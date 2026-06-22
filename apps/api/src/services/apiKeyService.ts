import crypto from "crypto";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";

export interface SafeApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  rotatedAt?: string | null;
  scopeMode: "all_enabled_models" | "restricted";
  allowedModels: string[];
  rateLimitPerMinute?: number | null;
  effectiveRateLimitPerMinute: number;
}

export interface CreateApiKeyInput {
  userId: string;
  workspaceId: string;
  name: string;
  allowedModelIds?: string[];
  rateLimitPerMinute?: number | null;
}

export function generateInternalApiKey(): string {
  const randomBytes = crypto.randomBytes(32).toString("base64url");
  return `uai_live_${randomBytes}`;
}

export function hashApiKey(rawKey: string): string {
  if (!env.API_KEY_HASH_SECRET) {
    throw new Error("API_KEY_HASH_SECRET is not configured");
  }
  return crypto.createHmac("sha256", env.API_KEY_HASH_SECRET).update(rawKey).digest("hex");
}

export function getKeyPrefix(rawKey: string): string {
  // e.g. uai_live_1234567 (length 16)
  return rawKey.substring(0, 16);
}

export function getKeyLast4(rawKey: string): string {
  return rawKey.substring(rawKey.length - 4);
}

function mapToSafeApiKey(record: any): SafeApiKey {
  const scopes = record.modelScopes || [];
  const scopeMode = scopes.length === 0 ? "all_enabled_models" : "restricted";
  const allowedModels = scopes.map((s: any) => s.modelId);

  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    keyLast4: record.keyLast4,
    status: record.status as "active" | "revoked",
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    rotatedAt: record.rotatedAt?.toISOString() ?? null,
    scopeMode,
    allowedModels,
    rateLimitPerMinute: record.rateLimitPerMinute,
    effectiveRateLimitPerMinute: record.rateLimitPerMinute ?? env.INTERNAL_API_RATE_LIMIT_PER_MINUTE
  };
}

export async function createApiKey(input: CreateApiKeyInput): Promise<{ rawKey: string; record: SafeApiKey }> {
  if (!env.ENABLE_DB_API_KEYS) {
    throw new Error("DB API Keys are not enabled.");
  }
  
  const rawKey = generateInternalApiKey();
  const keyPrefix = getKeyPrefix(rawKey);
  const keyLast4 = getKeyLast4(rawKey);
  const keyHash = hashApiKey(rawKey);

  const dbRecord = await prisma.internalApiKey.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      name: input.name,
      keyPrefix,
      keyLast4,
      keyHash,
      status: "active",
      rateLimitPerMinute: input.rateLimitPerMinute,
      modelScopes: input.allowedModelIds && input.allowedModelIds.length > 0 ? {
        create: input.allowedModelIds.map(modelId => ({
          modelId,
          // Provider can be null or we can infer it. For simplicity, just use empty string or lookup.
          // Using a simple lookup via OPENAI_COMPAT_MODELS if we import it, otherwise leave as "" or "unknown"
          provider: "unknown" // This is fine as it's just metadata, but we'll try to keep it simple.
        }))
      } : undefined
    },
    include: {
      modelScopes: true
    }
  });

  // To fix the "unknown" provider we can dynamically import OPENAI_COMPAT_MODELS here if needed, but it's optional for the scope mechanism since modelId is the primary key.
  return { rawKey, record: mapToSafeApiKey(dbRecord) };
}

export async function listApiKeys(userId: string, workspaceId: string): Promise<SafeApiKey[]> {
  const records = await prisma.internalApiKey.findMany({
    where: { userId, workspaceId },
    orderBy: { createdAt: "desc" },
    include: { modelScopes: true }
  });
  return records.map(mapToSafeApiKey);
}

export async function revokeApiKey(userId: string, workspaceId: string, keyId: string): Promise<void> {
  await prisma.internalApiKey.update({
    where: { id: keyId, userId, workspaceId },
    data: {
      status: "revoked",
      revokedAt: new Date()
    }
  });
}

export async function rotateApiKey(
  userId: string,
  workspaceId: string,
  keyId: string, 
  preserveScopes: boolean = true
): Promise<{ rawKey: string; record: SafeApiKey }> {
  const existingKey = await prisma.internalApiKey.findUnique({
    where: { id: keyId, userId, workspaceId },
    include: { modelScopes: true }
  });

  if (!existingKey) {
    throw new Error("API Key not found or does not belong to user.");
  }

  await revokeApiKey(userId, workspaceId, keyId);
  await prisma.internalApiKey.update({
    where: { id: keyId },
    data: { rotatedAt: new Date() }
  });

  const name = existingKey.name.endsWith(" (Rotated)") ? existingKey.name : `${existingKey.name} (Rotated)`;
  const allowedModelIds = preserveScopes ? existingKey.modelScopes.map(s => s.modelId) : undefined;
  const rateLimitPerMinute = existingKey.rateLimitPerMinute;
  
  return createApiKey({ userId, workspaceId, name, allowedModelIds, rateLimitPerMinute });
}

export async function updateApiKeyRateLimit(
  userId: string,
  workspaceId: string,
  keyId: string,
  rateLimitPerMinute: number | null
): Promise<SafeApiKey> {
  const existingKey = await prisma.internalApiKey.findUnique({
    where: { id: keyId, userId, workspaceId }
  });

  if (!existingKey) {
    throw new Error("API Key not found or does not belong to user.");
  }

  if (rateLimitPerMinute !== null) {
    if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute <= 0) {
      throw new Error("Rate limit must be a positive integer.");
    }
    const maxLimit = env.INTERNAL_API_RATE_LIMIT_MAX_PER_MINUTE;
    if (rateLimitPerMinute > maxLimit) {
      throw new Error(`Rate limit cannot exceed ${maxLimit} requests per minute.`);
    }
  }

  const updatedKey = await prisma.internalApiKey.update({
    where: { id: keyId },
    data: { rateLimitPerMinute },
    include: { modelScopes: true }
  });

  return mapToSafeApiKey(updatedKey);
}

export async function verifyApiKey(rawKey: string): Promise<{ userId: string; workspaceId: string | null; keyId: string; keyPrefix: string; rateLimitPerMinute: number | null } | null> {
  if (!rawKey.startsWith("uai_live_")) {
    return null;
  }

  const prefix = getKeyPrefix(rawKey);
  const hash = hashApiKey(rawKey);

  const candidateKeys = await prisma.internalApiKey.findMany({
    where: {
      keyPrefix: prefix,
      status: "active"
    }
  });

  for (const key of candidateKeys) {
    // Timing-safe comparison of the hash
    if (crypto.timingSafeEqual(Buffer.from(key.keyHash), Buffer.from(hash))) {
      return {
        userId: key.userId,
        workspaceId: key.workspaceId,
        keyId: key.id,
        keyPrefix: key.keyPrefix,
        rateLimitPerMinute: key.rateLimitPerMinute
      };
    }
  }

  return null;
}

export async function markLastUsed(keyId: string): Promise<void> {
  // Fire and forget update
  prisma.internalApiKey.update({
    where: { id: keyId },
    data: { lastUsedAt: new Date() }
  }).catch(() => {});
}

export async function setApiKeyModelScopes(userId: string, workspaceId: string, keyId: string, modelIds: string[]): Promise<SafeApiKey> {
  // Verify key belongs to user
  const existingKey = await prisma.internalApiKey.findUnique({
    where: { id: keyId, userId, workspaceId }
  });

  if (!existingKey) {
    throw new Error("API Key not found or does not belong to user.");
  }

  // Delete old scopes and insert new ones in transaction
  await prisma.$transaction(async (tx) => {
    await tx.internalApiKeyModelScope.deleteMany({
      where: { apiKeyId: keyId }
    });

    if (modelIds.length > 0) {
      await tx.internalApiKeyModelScope.createMany({
        data: modelIds.map(modelId => ({
          apiKeyId: keyId,
          modelId,
          provider: "unknown" // Again, keeping it simple as provider is metadata here
        }))
      });
    }
  });

  const updatedKey = await prisma.internalApiKey.findUnique({
    where: { id: keyId },
    include: { modelScopes: true }
  });

  return mapToSafeApiKey(updatedKey);
}

export async function getApiKeyModelScopes(keyId: string): Promise<string[]> {
  const scopes = await prisma.internalApiKeyModelScope.findMany({
    where: { apiKeyId: keyId }
  });
  return scopes.map(s => s.modelId);
}

export async function isModelAllowedForApiKey(keyId: string, modelId: string): Promise<boolean> {
  const scopes = await getApiKeyModelScopes(keyId);
  if (scopes.length === 0) {
    // Empty array means unrestricted/all globally enabled models
    return true;
  }
  return scopes.includes(modelId);
}
