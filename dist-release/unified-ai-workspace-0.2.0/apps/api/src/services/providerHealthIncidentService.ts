import { prisma } from "./prisma.js";
import type { ProviderHealth } from "./providerHealthService.js";
import type { NotificationEventView } from "@uaiw/shared/types/provider.js";

function getSeverityForStatus(status: string): string {
  switch (status) {
    case "error":
      return "error";
    case "no_usable_models":
      return "critical";
    case "ui_changed":
      return "critical";
    case "requires_login":
    case "manual_action_required":
    case "expired":
      return "warning";
    default:
      return "info";
  }
}

function sanitizeMetadata(input: any): Record<string, any> {
  if (typeof input !== "object" || input === null) return {};

  const allowedKeys = new Set([
    "source",
    "statusCategory",
    "safeMessage",
    "notificationKind"
  ]);

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowedKeys.has(key)) {
      result[key] = value;
    }
  }

  return result;
}

export async function recordHealthObservation(
  userId: string,
  health: ProviderHealth,
  context?: { source: string }
) {
  // If provider is healthy and usable, resolve open incidents
  if (health.isUsable) {
    await prisma.providerHealthIncident.updateMany({
      where: {
        userId,
        provider: health.provider,
        resolvedAt: null
      },
      data: {
        resolvedAt: new Date()
      }
    });
    return null;
  }

  // Not usable
  const status = health.healthStatus === "healthy" ? health.connectionStatus : health.healthStatus;
  const reason = health.errorMessage || health.errorCode || "Unknown issue";
  const fingerprint = `${userId}:${health.provider}:${status}:${health.errorCode || ""}`;

  const existingIncident = await prisma.providerHealthIncident.findFirst({
    where: {
      userId,
      provider: health.provider,
      resolvedAt: null
    },
    orderBy: { startedAt: "desc" }
  });

  if (existingIncident) {
    if (existingIncident.fingerprint === fingerprint) {
      // Exact same issue, increment and update lastSeenAt
      const updated = await prisma.providerHealthIncident.update({
        where: { id: existingIncident.id },
        data: {
          occurrenceCount: existingIncident.occurrenceCount + 1,
          lastSeenAt: new Date(),
          metadata: JSON.stringify(sanitizeMetadata({
            ...(existingIncident.metadata ? JSON.parse(existingIncident.metadata) : {}),
            ...context
          }))
        }
      });
      if (updated.occurrenceCount === 3) {
        await evaluateRecoveryPolicySafely({
          userId,
          triggerType: "provider_incident_repeated",
          triggerRefId: updated.id,
          provider: updated.provider,
          severity: updated.severity,
          status: updated.status,
          metadata: { source: context?.source, statusCategory: updated.status }
        });
      }
      return updated;
    } else {
      // Transition to a new status: resolve the old one, and create a new one
      await prisma.providerHealthIncident.update({
        where: { id: existingIncident.id },
        data: {
          resolvedAt: new Date(),
          metadata: JSON.stringify(sanitizeMetadata({
            ...(existingIncident.metadata ? JSON.parse(existingIncident.metadata) : {}),
            safeMessage: `Resolved implicitly due to transition to ${status}`
          }))
        }
      });
    }
  }

  // Create new incident
  const created = await prisma.providerHealthIncident.create({
    data: {
      userId,
      provider: health.provider,
      status,
      severity: getSeverityForStatus(status),
      reason,
      fingerprint,
      metadata: JSON.stringify(sanitizeMetadata({
        statusCategory: status,
        safeMessage: reason,
        source: context?.source
      }))
    }
  });
  await evaluateRecoveryPolicySafely({
    userId,
    triggerType: "provider_incident_opened",
    triggerRefId: created.id,
    provider: created.provider,
    severity: created.severity,
    status: created.status,
    metadata: { source: context?.source, statusCategory: created.status }
  });
  if (created.severity === "critical") {
    await evaluateRecoveryPolicySafely({
      userId,
      triggerType: "provider_incident_critical",
      triggerRefId: created.id,
      provider: created.provider,
      severity: created.severity,
      status: created.status,
      metadata: { source: context?.source, statusCategory: created.status }
    });
  }
  return created;
}

export async function resolveIncident(
  userId: string,
  incidentId: string,
  resolution: string,
  note?: string
) {
  const incident = await prisma.providerHealthIncident.findUnique({
    where: { id: incidentId }
  });

  if (!incident || incident.userId !== userId) {
    throw new Error("Incident not found");
  }

  const safeNote = note ? note.substring(0, 500) : undefined;
  const metadata = incident.metadata ? JSON.parse(incident.metadata) : {};

  return prisma.providerHealthIncident.update({
    where: { id: incidentId },
    data: {
      resolvedAt: new Date(),
      metadata: JSON.stringify({
        ...metadata,
        resolution,
        resolutionNote: safeNote
      })
    }
  });
}

export async function linkNotificationEvents(
  userId: string,
  events: NotificationEventView[]
) {
  for (const event of events) {
    if (!event.provider) continue;

    // find most recent open incident for this provider
    const openIncident = await prisma.providerHealthIncident.findFirst({
      where: {
        userId,
        provider: event.provider,
        resolvedAt: null
      },
      orderBy: { startedAt: "desc" }
    });

    if (openIncident && !openIncident.notificationEventId) {
      await prisma.providerHealthIncident.update({
        where: { id: openIncident.id },
        data: {
          notificationEventId: event.id
        }
      });
    }
  }
}

export async function listProviderHealthIncidents(userId: string, filters: {
  provider?: string;
  status?: string;
  severity?: string;
  limit?: number;
}) {
  const where: any = { userId };
  
  if (filters.provider) {
    where.provider = filters.provider;
  }
  
  if (filters.status === "open") {
    where.resolvedAt = null;
  } else if (filters.status === "resolved") {
    where.resolvedAt = { not: null };
  }

  if (filters.severity) {
    where.severity = filters.severity;
  }

  return prisma.providerHealthIncident.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: filters.limit || 50
  });
}

export async function getProviderHealthIncident(userId: string, incidentId: string) {
  return prisma.providerHealthIncident.findFirst({
    where: {
      id: incidentId,
      userId
    }
  });
}

async function evaluateRecoveryPolicySafely(input: {
  userId: string;
  triggerType: string;
  triggerRefId: string;
  provider?: string;
  severity?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const { evaluateProviderRecoveryPolicies } = await import("./providerRecoveryPolicyService.js");
    await evaluateProviderRecoveryPolicies(input);
  } catch (error) {
    console.error("Provider recovery policy evaluation failed", { triggerType: input.triggerType });
  }
}
