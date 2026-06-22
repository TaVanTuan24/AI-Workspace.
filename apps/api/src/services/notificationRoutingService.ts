import { prisma } from "./prisma.js";
import type { NotificationEventView } from "@uaiw/shared/types/provider.js";

export type NotificationRoutePlan = {
  eventId: string;
  channel: "webhook";
  destinations: Array<{
    destinationId: string;
    name: string;
    priority: number;
    reason: string;
    failoverEnabled: boolean;
  }>;
};

export async function computeWebhookRoutePlan(
  userId: string,
  event: NotificationEventView
): Promise<NotificationRoutePlan> {
  const destinations = await prisma.notificationWebhookDestination.findMany({
    where: { userId, enabled: true },
    orderBy: [
      { priority: "asc" },
      { createdAt: "asc" }
    ]
  });

  const matched = [];
  const defaults = [];

  for (const dest of destinations) {
    if (dest.isDefault) {
      defaults.push(dest);
    }

    let isMatch = false;
    let matchReason = "";

    const kinds: string[] = dest.routeKinds ? JSON.parse(dest.routeKinds) : [];
    const severities: string[] = dest.routeSeverities ? JSON.parse(dest.routeSeverities) : [];
    const priorities: string[] = dest.routePriorities ? JSON.parse(dest.routePriorities) : [];

    const noFilters = kinds.length === 0 && severities.length === 0 && priorities.length === 0;

    if (noFilters) {
      isMatch = true;
      matchReason = "no_filters";
    } else if (kinds.includes(event.kind)) {
      isMatch = true;
      matchReason = `kind_match_${event.kind}`;
    } else if (severities.includes(event.severity)) {
      isMatch = true;
      matchReason = `severity_match_${event.severity}`;
    } else {
      // no priority mapped yet on NotificationEvent in standard way, wait is priority mapped to severity?
      // Event has no 'priority' field, it has 'severity' and 'kind'.
      // Assume priority filter isn't matching unless matched by something else.
    }

    if (isMatch) {
      matched.push({
        destinationId: dest.id,
        name: dest.name,
        priority: dest.priority,
        reason: matchReason,
        failoverEnabled: dest.failoverEnabled
      });
    }
  }

  // If no match found, fallback to defaults
  if (matched.length === 0 && defaults.length > 0) {
    for (const d of defaults) {
      matched.push({
        destinationId: d.id,
        name: d.name,
        priority: d.priority,
        reason: "default_fallback",
        failoverEnabled: d.failoverEnabled
      });
    }
  }

  return {
    eventId: event.id,
    channel: "webhook",
    destinations: matched
  };
}
