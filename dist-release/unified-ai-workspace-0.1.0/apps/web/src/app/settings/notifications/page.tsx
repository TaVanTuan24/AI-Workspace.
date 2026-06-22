"use client";

import { useEffect, useState } from "react";
import { Bell, RotateCcw, Save } from "lucide-react";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  getNotificationEvents,
  markNotificationEventRead,
  markAllNotificationEventsRead,
  getNotificationDeliveryPreferences,
  updateNotificationDeliveryPreference,
  getNotificationDeliveryAttempts,
  getWebhookDeliveryConfig,
  updateWebhookDeliveryConfig,
  rotateWebhookSigningSecret,
  testWebhookDelivery,
  type NotificationPreferences,
  type NotificationEventView,
  type NotificationDeliveryPreferenceView,
  type NotificationDeliveryAttemptView,
  retryNotificationDeliveryAttempt
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

  const [deliveryPreferences, setDeliveryPreferences] = useState<NotificationDeliveryPreferenceView[]>([]);
  const [deliveryAttempts, setDeliveryAttempts] = useState<NotificationDeliveryAttemptView[]>([]);
  const [loadingDelivery, setLoadingDelivery] = useState(true);

  // Webhook specific state
  const [webhookUrlDraft, setWebhookUrlDraft] = useState("");
  const [webhookEnabledDraft, setWebhookEnabledDraft] = useState(false);
  const [webhookSecretDisplay, setWebhookSecretDisplay] = useState<string | null>(null);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  useEffect(() => {
    void loadPreferences();
    void loadEvents();
    void loadDeliveryData();
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
      void loadEvents(); // reload to get fresh data and unread count
      // Or optimistically update
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, readAt: new Date().toISOString() } : e)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark read", err);
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationEventsRead();
      void loadEvents();
      setEvents((prev) => prev.map((e) => ({ ...e, readAt: e.readAt || new Date().toISOString() })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all read", err);
    }
  }

  async function loadDeliveryData() {
    try {
      setLoadingDelivery(true);
      const [prefsRes, attemptsRes] = await Promise.all([
        getNotificationDeliveryPreferences(),
        getNotificationDeliveryAttempts({ limit: 50 })
      ]);
      setDeliveryPreferences(prefsRes.preferences);
      setDeliveryAttempts(attemptsRes.attempts);

      const webhookPref = prefsRes.preferences.find(p => p.channel === "webhook");
      if (webhookPref) {
        setWebhookEnabledDraft(webhookPref.enabled);
        if (webhookPref.config?.urlPreview) {
          setWebhookUrlDraft(webhookPref.config.urlPreview);
        }
      }
    } catch (err) {
      console.error("Failed to load delivery data", err);
    } finally {
      setLoadingDelivery(false);
    }
  }

  async function handleToggleDeliveryChannel(channel: string, enabled: boolean) {
    if (channel === "in_app") return; // cannot disable
    try {
      const updated = await updateNotificationDeliveryPreference(channel, enabled);
      setDeliveryPreferences((prev) =>
        prev.map((p) => (p.channel === channel ? updated : p))
      );
    } catch (err: any) {
      setError(err.message || "Failed to update delivery channel preference");
    }
  }

  async function handleSaveWebhookConfig() {
    try {
      setSavingWebhook(true);
      setError("");
      setWebhookSecretDisplay(null);
      const res = await updateWebhookDeliveryConfig({ enabled: webhookEnabledDraft, url: webhookUrlDraft });
      setDeliveryPreferences((prev) => prev.map((p) => p.channel === "webhook" ? res.preference : p));
      if (res.newSecret) {
        setWebhookSecretDisplay(res.newSecret);
      }
      setNotice("Webhook configuration saved.");
    } catch (err: any) {
      setError(err.message || "Failed to save webhook configuration");
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleRotateWebhookSecret() {
    if (!window.confirm("Are you sure you want to rotate the webhook signing secret? The previous secret will immediately stop working.")) return;
    try {
      setSavingWebhook(true);
      setError("");
      const res = await rotateWebhookSigningSecret();
      setDeliveryPreferences((prev) => prev.map((p) => p.channel === "webhook" ? res.preference : p));
      setWebhookSecretDisplay(res.signingSecret);
      setNotice("Webhook secret rotated successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to rotate webhook secret");
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleTestWebhook() {
    try {
      setTestingWebhook(true);
      setError("");
      await testWebhookDelivery();
      setNotice("Test webhook dispatched.");
      void loadDeliveryData();
    } catch (err: any) {
      setError(err.message || "Failed to send test webhook");
    } finally {
      setTestingWebhook(false);
    }
  }

  async function handleRetryAttempt(attemptId: string) {
    try {
      setError("");
      await retryNotificationDeliveryAttempt(attemptId);
      setNotice("Retry queued.");
      void loadDeliveryData();
    } catch (err: any) {
      setError(err.message || "Failed to retry delivery attempt");
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
          Choose which in-app operational alerts appear across the workspace.
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

          <section className="mt-10 rounded-lg border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Delivery channels</h2>
            </div>
            <div className="p-0">
              {loadingDelivery ? (
                <div className="p-5 text-sm text-slate-500">Loading delivery channels...</div>
              ) : (
                <div className="space-y-4 p-5">
                  {deliveryPreferences.filter(p => p.channel !== "webhook").map((pref) => (
                    <div key={pref.channel} className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-100">{pref.label}</span>
                          {!pref.configured && (
                            <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 border border-amber-500/20">
                              Scaffold only / Coming soon
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{pref.description}</p>
                      </div>
                      <div className="shrink-0 pt-1">
                        <label className={`relative inline-flex cursor-pointer items-center ${pref.channel === 'in_app' ? 'opacity-50' : ''}`}>
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={pref.enabled}
                            disabled={pref.channel === "in_app"}
                            onChange={(e) => handleToggleDeliveryChannel(pref.channel, e.target.checked)}
                          />
                          <div className="h-6 w-11 rounded-full bg-slate-700 peer-focus:ring-2 peer-focus:ring-indigo-500/30 peer-checked:after:translate-x-full peer-checked:bg-indigo-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all peer-checked:after:border-white"></div>
                        </label>
                      </div>
                    </div>
                  ))}

                  {/* Webhook specific configuration card */}
                  {deliveryPreferences.find(p => p.channel === "webhook") && (() => {
                    const webhookPref = deliveryPreferences.find(p => p.channel === "webhook")!;
                    return (
                      <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <span className="font-medium text-slate-100">Webhook</span>
                            <p className="mt-1 text-sm text-slate-500">{webhookPref.description}</p>
                          </div>
                          <div className="shrink-0 pt-1">
                            <label className="relative inline-flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={webhookEnabledDraft}
                                onChange={(e) => setWebhookEnabledDraft(e.target.checked)}
                              />
                              <div className="h-6 w-11 rounded-full bg-slate-700 peer-focus:ring-2 peer-focus:ring-indigo-500/30 peer-checked:after:translate-x-full peer-checked:bg-indigo-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all peer-checked:after:border-white"></div>
                            </label>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <label className="block">
                            <span className="block text-sm font-medium text-slate-300">Webhook URL</span>
                            <input
                              type="url"
                              value={webhookUrlDraft}
                              onChange={(e) => setWebhookUrlDraft(e.target.value)}
                              placeholder="https://example.com/uaiw-webhook"
                              className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </label>

                          {webhookSecretDisplay && (
                            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                              <h4 className="text-sm font-medium text-emerald-400">Signing Secret Generated</h4>
                              <p className="mt-1 text-xs text-emerald-300/80">
                                Copy this secret now. It will not be shown again. Use it to verify the <code className="text-emerald-200 bg-emerald-500/20 px-1 rounded">X-UAIW-Signature</code> HMAC-SHA256 header.
                              </p>
                              <div className="mt-3 flex items-center gap-2">
                                <code className="block w-full rounded bg-slate-900 p-2 text-xs text-slate-300 font-mono break-all border border-slate-800 select-all">
                                  {webhookSecretDisplay}
                                </code>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={handleSaveWebhookConfig}
                                disabled={savingWebhook}
                                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                              >
                                {savingWebhook ? "Saving..." : "Save Webhook"}
                              </button>
                              {webhookPref.config?.hasSigningSecret && (
                                <button
                                  type="button"
                                  onClick={handleTestWebhook}
                                  disabled={testingWebhook}
                                  className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                                >
                                  {testingWebhook ? "Testing..." : "Test"}
                                </button>
                              )}
                            </div>

                            {webhookPref.config?.hasSigningSecret && (
                              <button
                                type="button"
                                onClick={handleRotateWebhookSecret}
                                disabled={savingWebhook}
                                className="text-xs font-medium text-amber-500 hover:text-amber-400 disabled:opacity-50"
                              >
                                Rotate Secret
                              </button>
                            )}
                          </div>
                          
                          <div className="text-xs text-slate-500 mt-2">
                            {webhookPref.config?.hasSigningSecret ? (
                              <span>Configured. Signature headers enabled.</span>
                            ) : (
                              <span>Save to generate a signing secret.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </section>

          <section className="mt-10 rounded-lg border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Delivery attempts</h2>
            </div>
            <div className="p-0">
              {loadingDelivery ? (
                <div className="p-5 text-sm text-slate-500">Loading delivery attempts...</div>
              ) : deliveryAttempts.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">No delivery attempts recorded yet.</div>
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {deliveryAttempts.map((attempt) => (
                    <li key={attempt.id} className="p-5 transition-colors hover:bg-slate-800/20 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="text-slate-400 min-w-[140px]">
                            {new Date(attempt.attemptedAt).toLocaleString()}
                          </span>
                          <span className="font-medium text-slate-300 w-24">
                            {attempt.channel}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                            attempt.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            attempt.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                            'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                            {attempt.status}
                          </span>
                          {attempt.errorCode && (
                            <span className="text-red-400 text-xs">Error: {attempt.errorCode}</span>
                          )}
                          <span className="text-slate-500 text-xs">
                            Attempt: {attempt.attemptNumber}
                          </span>
                          {attempt.nextRetryAt && (
                            <span className="text-amber-500 text-xs">
                              Next retry: {new Date(attempt.nextRetryAt).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                        {attempt.channel === "webhook" && attempt.status === "failed" && (
                          <div>
                            <button
                              type="button"
                              onClick={() => handleRetryAttempt(attempt.id)}
                              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                            >
                              Retry Now
                            </button>
                          </div>
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
