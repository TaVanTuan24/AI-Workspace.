import { prisma } from "./prisma.js";
import { encryptSecretString, decryptSecretString } from "./secretBoxService.js";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { validatePayloadConfig } from "./notificationWebhookPayloadTemplateService.js";

// Basic URL validation
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/...`;
  } catch {
    return "Invalid URL";
  }
}

export async function listWebhookDestinations(userId: string) {
  let dests = await prisma.notificationWebhookDestination.findMany({
    where: { userId },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }]
  });

  // Lazy auto-migration of legacy webhook preference
  if (dests.length === 0) {
    const legacyPref = await prisma.notificationDeliveryPreference.findUnique({
      where: { userId_channel: { userId, channel: "webhook" } }
    });
    if (legacyPref?.configJson) {
      const config = JSON.parse(legacyPref.configJson);
      if (config.url && config.encryptedSigningSecret) {
        const migrated = await prisma.notificationWebhookDestination.create({
          data: {
            userId,
            name: "Default Webhook",
            enabled: legacyPref.enabled,
            priority: 100,
            isDefault: true,
            failoverEnabled: true,
            timeoutMs: env.NOTIFICATION_WEBHOOK_TIMEOUT_MS,
            maxAttempts: env.NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS,
            encryptedUrl: encryptSecretString(config.url),
            encryptedSigningSecret: config.encryptedSigningSecret, // already encrypted
          }
        });
        dests = [migrated];
      }
    }
  }

  return dests.map(d => ({
    id: d.id,
    name: d.name,
    enabled: d.enabled,
    priority: d.priority,
    isDefault: d.isDefault,
    routeKinds: d.routeKinds ? JSON.parse(d.routeKinds) : [],
    routeSeverities: d.routeSeverities ? JSON.parse(d.routeSeverities) : [],
    routePriorities: d.routePriorities ? JSON.parse(d.routePriorities) : [],
    failoverEnabled: d.failoverEnabled,
    timeoutMs: d.timeoutMs,
    maxAttempts: d.maxAttempts,
    payloadFormat: d.payloadFormat,
    payloadFields: d.payloadFields ? JSON.parse(d.payloadFields) : [],
    includeActionHref: d.includeActionHref,
    includeDeliveryMetadata: d.includeDeliveryMetadata,
    includeRoutingMetadata: d.includeRoutingMetadata,
    safeEndpointLabel: maskUrl(decryptSecretString(d.encryptedUrl)),
    lastSuccessAt: d.lastSuccessAt?.toISOString(),
    lastFailureAt: d.lastFailureAt?.toISOString(),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));
}

export async function createWebhookDestination(userId: string, data: any) {
  if (!isValidUrl(data.url)) {
    throw new Error("Invalid URL. Only HTTP and HTTPS are allowed.");
  }

  const rawSecret = crypto.randomBytes(32).toString("base64url");
  const encryptedUrl = encryptSecretString(data.url);
  const encryptedSigningSecret = encryptSecretString(rawSecret);

  if (data.isDefault) {
    // Unset other defaults if this is the new default
    await prisma.notificationWebhookDestination.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false }
    });
  }

  // Validate payload config
  const payloadFormat = data.payloadFormat || "uaiw_default";
  const payloadFields = data.payloadFields || null;
  const validation = validatePayloadConfig(payloadFormat, payloadFields);
  if (!validation.valid) {
    throw new Error(validation.errors.join("; "));
  }

  const dest = await prisma.notificationWebhookDestination.create({
    data: {
      userId,
      name: data.name.substring(0, 100),
      enabled: data.enabled ?? true,
      priority: data.priority ?? 100,
      isDefault: data.isDefault ?? false,
      routeKinds: data.routeKinds ? JSON.stringify(data.routeKinds) : "[]",
      routeSeverities: data.routeSeverities ? JSON.stringify(data.routeSeverities) : "[]",
      routePriorities: data.routePriorities ? JSON.stringify(data.routePriorities) : "[]",
      failoverEnabled: data.failoverEnabled ?? true,
      timeoutMs: data.timeoutMs || env.NOTIFICATION_WEBHOOK_TIMEOUT_MS,
      maxAttempts: data.maxAttempts || env.NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS,
      payloadFormat,
      payloadFields: payloadFields ? JSON.stringify(payloadFields) : null,
      includeActionHref: data.includeActionHref ?? true,
      includeDeliveryMetadata: data.includeDeliveryMetadata ?? true,
      includeRoutingMetadata: data.includeRoutingMetadata ?? true,
      encryptedUrl,
      encryptedSigningSecret
    }
  });

  return {
    id: dest.id,
    secret: rawSecret, // return once
  };
}

export async function updateWebhookDestination(userId: string, id: string, data: any) {
  const dest = await prisma.notificationWebhookDestination.findUnique({ where: { id } });
  if (!dest || dest.userId !== userId) throw new Error("Destination not found");

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name.substring(0, 100);
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
  if (data.routeKinds !== undefined) updateData.routeKinds = JSON.stringify(data.routeKinds);
  if (data.routeSeverities !== undefined) updateData.routeSeverities = JSON.stringify(data.routeSeverities);
  if (data.routePriorities !== undefined) updateData.routePriorities = JSON.stringify(data.routePriorities);
  if (data.failoverEnabled !== undefined) updateData.failoverEnabled = data.failoverEnabled;
  if (data.timeoutMs !== undefined) updateData.timeoutMs = data.timeoutMs;
  if (data.maxAttempts !== undefined) updateData.maxAttempts = data.maxAttempts;
  if (data.includeActionHref !== undefined) updateData.includeActionHref = data.includeActionHref;
  if (data.includeDeliveryMetadata !== undefined) updateData.includeDeliveryMetadata = data.includeDeliveryMetadata;
  if (data.includeRoutingMetadata !== undefined) updateData.includeRoutingMetadata = data.includeRoutingMetadata;

  // Validate payload config if changing format or fields
  if (data.payloadFormat !== undefined || data.payloadFields !== undefined) {
    const format = data.payloadFormat ?? dest.payloadFormat;
    const fields = data.payloadFields ?? (dest.payloadFields ? JSON.parse(dest.payloadFields) : null);
    const validation = validatePayloadConfig(format, fields);
    if (!validation.valid) {
      throw new Error(validation.errors.join("; "));
    }
    if (data.payloadFormat !== undefined) updateData.payloadFormat = data.payloadFormat;
    if (data.payloadFields !== undefined) updateData.payloadFields = data.payloadFields ? JSON.stringify(data.payloadFields) : null;
  }

  if (data.url) {
    if (!isValidUrl(data.url)) throw new Error("Invalid URL.");
    updateData.encryptedUrl = encryptSecretString(data.url);
  }

  if (updateData.isDefault) {
    await prisma.notificationWebhookDestination.updateMany({
      where: { userId, isDefault: true, id: { not: id } },
      data: { isDefault: false }
    });
  }

  await prisma.notificationWebhookDestination.update({
    where: { id },
    data: updateData
  });

  return { success: true };
}

export async function rotateDestinationSecret(userId: string, id: string) {
  const dest = await prisma.notificationWebhookDestination.findUnique({ where: { id } });
  if (!dest || dest.userId !== userId) throw new Error("Destination not found");

  const rawSecret = crypto.randomBytes(32).toString("base64url");
  const encryptedSigningSecret = encryptSecretString(rawSecret);

  await prisma.notificationWebhookDestination.update({
    where: { id },
    data: { encryptedSigningSecret }
  });

  return { secret: rawSecret };
}

export async function deleteWebhookDestination(userId: string, id: string) {
  const dest = await prisma.notificationWebhookDestination.findUnique({ where: { id } });
  if (!dest || dest.userId !== userId) throw new Error("Destination not found");

  // Soft delete / disable
  await prisma.notificationWebhookDestination.update({
    where: { id },
    data: { enabled: false, name: `${dest.name} (Deleted)` }
  });

  return { success: true };
}
