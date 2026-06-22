import type { WorkspaceNotification } from "./api";

export const DISMISSED_NOTIFICATIONS_KEY = "uai.dismissedNotifications.v1";
export const DISMISSED_NOTIFICATIONS_EVENT = "uai:dismissed-notifications-changed";

export type DismissedNotificationMap = Record<string, string>;

export function readDismissedNotifications(): DismissedNotificationMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeDismissedNotifications(dismissed: DismissedNotificationMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(dismissed));
  window.dispatchEvent(new Event(DISMISSED_NOTIFICATIONS_EVENT));
}

export function dismissNotification(
  notification: WorkspaceNotification,
  dismissed: DismissedNotificationMap
): DismissedNotificationMap {
  if (!notification.dismissible) return dismissed;
  return {
    ...dismissed,
    [notification.fingerprint]: new Date().toISOString()
  };
}

export function filterVisibleNotifications(
  notifications: WorkspaceNotification[],
  dismissed: DismissedNotificationMap
) {
  return notifications.filter((notification) => !notification.dismissible || !dismissed[notification.fingerprint]);
}
