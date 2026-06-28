"use client";

import { useEffect, useState } from "react";
import { Bell, RotateCcw, Save } from "lucide-react";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  getNotificationEvents,
  markNotificationEventRead,
  markAllNotificationEventsRead,
  type NotificationPreferences,
  type NotificationEventView
} from "../../../lib/api";

const defaultPreferences: NotificationPreferences = {
  notifyProviderSessionIssues: true,
  notifyNoUsableModels: true,
  notifyProviderLimitSpikes: true,
  providerLimitSpikeThreshold24h: 10
};

export default function NotificationPreferencesPage() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences);
  const [thresholdDraft, setThresholdDraft] = useState("10");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [events, setEvents] = useState<NotificationEventView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    void loadPreferences();
    void loadEvents();
  }, []);

  async function loadEvents() {
    try {
      setLoadingEvents(true);
      const data = await getNotificationEvents({ limit: 50 });
      setEvents(data.events);
      setUnreadCount(data.unreadCount);
    } catch (err: any) {
      console.error("Failed to load events", err);
    } finally {
      setLoadingEvents(false);
    }
  }

  async function handleMarkRead(id: string) {
    try {
      await markNotificationEventRead(id);
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, readAt: new Date().toISOString() } : e)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark read", err);
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationEventsRead();
      setEvents((prev) => prev.map((e) => ({ ...e, readAt: e.readAt || new Date().toISOString() })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all read", err);
    }
  }

  async function loadPreferences() {
    try {
      setLoading(true);
      setError("");
      const data = await getNotificationPreferences();
      setPreferences(data.preferences);
      setThresholdDraft(String(data.preferences.providerLimitSpikeThreshold24h));
    } catch (err: any) {
      setError(err.message || "Failed to load notification preferences");
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(key: keyof NotificationPreferences, value: boolean | number) {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  }

  async function savePreferences(input: NotificationPreferences = preferences, thresholdValue = thresholdDraft) {
    const threshold = Number(thresholdValue);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10_000) {
      setError("Provider limit spike threshold must be a whole number from 1 to 10000.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setNotice("");
      const data = await updateNotificationPreferences({
        ...input,
        providerLimitSpikeThreshold24h: threshold
      });
      setPreferences(data.preferences);
      setThresholdDraft(String(data.preferences.providerLimitSpikeThreshold24h));
      setNotice("Notification preferences saved.");
    } catch (err: any) {
      setError(err.message || "Failed to save notification preferences");
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    setPreferences(defaultPreferences);
    setThresholdDraft(String(defaultPreferences.providerLimitSpikeThreshold24h));
    await savePreferences(defaultPreferences, String(defaultPreferences.providerLimitSpikeThreshold24h));
  }

  return (
    <div className="space-y-6 p-0 lg:p-2">
      <header>
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300">
          <Bell className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Notification Preferences</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Choose which in-app operational alerts appear.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-slate-500">
          Loading notification preferences...
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Session & Provider Health</h2>
            </div>
            <div className="space-y-4 p-5">
              <ToggleRow
                label="Provider session issues"
                description="Expired sessions, reconnect prompts, manual actions, provider UI changes, and unusable providers."
                checked={preferences.notifyProviderSessionIssues}
                onChange={(checked) => updateDraft("notifyProviderSessionIssues", checked)}
              />
            </div>
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Model Availability</h2>
            </div>
            <div className="space-y-4 p-5">
              <ToggleRow
                label="No usable models"
                description="Critical alert when enabled models cannot currently run."
                checked={preferences.notifyNoUsableModels}
                onChange={(checked) => updateDraft("notifyNoUsableModels", checked)}
              />
              {!preferences.notifyNoUsableModels && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                  Disabling this can hide chat blockers. The app will still fail safely, but the global warning will be hidden.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Provider Rate-limit Spikes</h2>
            </div>
            <div className="space-y-5 p-5">
              <ToggleRow
                label="Provider limit spike alerts"
                description="Shown when a provider hits its provider-level rate limit repeatedly within 24h."
                checked={preferences.notifyProviderLimitSpikes}
                onChange={(checked) => updateDraft("notifyProviderLimitSpikes", checked)}
              />
              <label className="block max-w-xs">
                <span className="text-sm font-medium text-slate-300">Threshold hits in last 24h</span>
                <input
                  type="number"
                  min={1}
                  max={10_000}
                  value={thresholdDraft}
                  onChange={(event) => setThresholdDraft(event.target.value)}
                  disabled={!preferences.notifyProviderLimitSpikes}
                  className="mt-2 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <span className="mt-2 block text-xs text-slate-500">
                  Example: threshold 10 shows an alert when ChatGPT has at least 10 provider-limit hits in 24h.
                </span>
              </label>
            </div>
          </section>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => savePreferences()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving ? "Saving..." : "Save preferences"}
            </button>
            <button
              type="button"
              onClick={resetDefaults}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset defaults
            </button>
          </div>

          <section className="mt-10 rounded-lg border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-100">Notification History</h2>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/30">
                    {unreadCount} unread
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="p-0">
              {loadingEvents ? (
                <div className="p-5 text-sm text-slate-500">Loading history...</div>
              ) : events.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">No notification history yet.</div>
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {events.map((event) => (
                    <li key={event.id} className="p-5 transition-colors hover:bg-slate-800/20">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          {!event.readAt && (
                            <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                          )}
                          <div className={event.readAt ? "ml-5" : ""}>
                            <h3 className={`text-sm font-medium ${event.readAt ? "text-slate-300" : "text-slate-100"}`}>
                              {event.title}
                            </h3>
                            <p className="mt-1 text-sm text-slate-400">{event.message}</p>
                            <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                              <span>{new Date(event.createdAt).toLocaleString()}</span>
                              {event.provider && (
                                <span className="rounded bg-slate-800 px-1.5 py-0.5">{event.provider}</span>
                              )}
                            </div>
                            {event.action && (
                              <div className="mt-3">
                                <a
                                  href={event.action.href}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                                >
                                  {event.action.label}
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        {!event.readAt && (
                          <button
                            type="button"
                            onClick={() => handleMarkRead(event.id)}
                            className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <span>
        <span className="block font-medium text-slate-100">{label}</span>
        <span className="mt-1 block text-sm text-slate-500">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 rounded border-slate-700 bg-slate-950 text-indigo-500"
      />
    </label>
  );
}
