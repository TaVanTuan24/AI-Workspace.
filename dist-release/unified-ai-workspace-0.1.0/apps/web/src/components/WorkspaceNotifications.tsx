"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { getWorkspaceNotifications, type WorkspaceNotification } from "../lib/api";
import {
  DISMISSED_NOTIFICATIONS_EVENT,
  dismissNotification,
  filterVisibleNotifications,
  readDismissedNotifications,
  writeDismissedNotifications,
  type DismissedNotificationMap
} from "../lib/notificationDismissals";
import { useEffect, useMemo, useState } from "react";

export function WorkspaceNotifications() {
  const [dismissed, setDismissed] = useState<DismissedNotificationMap>({});
  const notifications = useQuery({
    queryKey: ["workspaceNotifications"],
    queryFn: getWorkspaceNotifications,
    refetchInterval: 60_000
  });

  useEffect(() => {
    const syncDismissed = () => setDismissed(readDismissedNotifications());
    syncDismissed();
    window.addEventListener(DISMISSED_NOTIFICATIONS_EVENT, syncDismissed);
    return () => window.removeEventListener(DISMISSED_NOTIFICATIONS_EVENT, syncDismissed);
  }, []);

  const visible = useMemo(
    () => filterVisibleNotifications(notifications.data?.notifications ?? [], dismissed),
    [notifications.data?.notifications, dismissed]
  );

  if (visible.length === 0) return null;

  function handleDismiss(notification: WorkspaceNotification) {
    const next = dismissNotification(notification, dismissed);
    setDismissed(next);
    writeDismissedNotifications(next);
  }

  const shown = visible.slice(0, 2);
  return (
    <section className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:px-6 lg:px-8">
        {shown.map((notification) => (
          <div key={notification.fingerprint} className="flex items-start justify-between gap-4 text-sm text-amber-950">
            <div className="flex min-w-0 gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <div className="font-medium">{notification.title}</div>
                <div className="text-amber-800">{notification.message}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {notification.action ? (
                <Link
                  href={notification.action.href}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100"
                >
                  {notification.action.label}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              ) : null}
              {notification.dismissible ? (
                <button
                  type="button"
                  title="Dismiss notification"
                  onClick={() => handleDismiss(notification)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {visible.length > shown.length ? (
          <Link href="/settings" className="text-xs font-medium text-amber-800 underline">
            View {visible.length - shown.length} more in Settings
          </Link>
        ) : null}
      </div>
    </section>
  );
}
