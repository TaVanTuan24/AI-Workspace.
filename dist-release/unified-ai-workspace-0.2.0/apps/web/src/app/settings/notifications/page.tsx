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
  retryNotificationDeliveryAttempt,
  type NotificationDeadLetterView,
  getDeadLetters,
  retryDeadLetter,
  resolveDeadLetter,
  reconcileDeadLetters,
  type WebhookDestinationView,
  getWebhookDestinations,
  createWebhookDestination,
  updateWebhookDestination,
  rotateWebhookDestinationSecret,
  testWebhookDestination,
  deleteWebhookDestination,
  previewWebhookRoutePlan,
  previewWebhookPayload,
  type WebhookPayloadPreview
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

  // Dead letters state
  const [deadLetters, setDeadLetters] = useState<NotificationDeadLetterView[]>([]);
  const [loadingDeadLetters, setLoadingDeadLetters] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Webhook specific state
  const [webhookDestinations, setWebhookDestinations] = useState<WebhookDestinationView[]>([]);
  const [webhookSecretDisplay, setWebhookSecretDisplay] = useState<string | null>(null);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [editingDestination, setEditingDestination] = useState<Partial<WebhookDestinationView> | null>(null);
  const [payloadPreview, setPayloadPreview] = useState<WebhookPayloadPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    void loadPreferences();
    void loadEvents();
    void loadDeliveryData();
    void loadDeadLetters();
  }, []);

  async function loadDeadLetters() {
    try {
      setLoadingDeadLetters(true);
      const data = await getDeadLetters();
      setDeadLetters(data.deadLetters);
    } catch (err) {
      console.error("Failed to load dead letters", err);
    } finally {
      setLoadingDeadLetters(false);
    }
  }

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
      const [prefsRes, attemptsRes, destsRes] = await Promise.all([
        getNotificationDeliveryPreferences(),
        getNotificationDeliveryAttempts({ limit: 50 }),
        getWebhookDestinations()
      ]);
      setDeliveryPreferences(prefsRes.preferences);
      setDeliveryAttempts(attemptsRes.attempts);
      setWebhookDestinations(destsRes.destinations);
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

  async function handleSaveWebhookDestination(data: any) {
    try {
      setSavingWebhook(true);
      setError("");
      setWebhookSecretDisplay(null);
      let res;
      if (editingDestination?.id) {
        res = await updateWebhookDestination(editingDestination.id, data);
        setNotice("Webhook destination updated.");
      } else {
        res = await createWebhookDestination(data);
        if (res.secret) {
          setWebhookSecretDisplay(res.secret);
        }
        setNotice("Webhook destination created.");
      }
      setEditingDestination(null);
      void loadDeliveryData();
    } catch (err: any) {
      setError(err.message || "Failed to save webhook destination");
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleRotateDestinationSecret(id: string) {
    if (!window.confirm("Are you sure you want to rotate the webhook signing secret? The previous secret will immediately stop working.")) return;
    try {
      setSavingWebhook(true);
      setError("");
      setWebhookSecretDisplay(null);
      const res = await rotateWebhookDestinationSecret(id);
      setWebhookSecretDisplay(res.secret);
      setNotice("Webhook secret rotated successfully.");
      void loadDeliveryData();
    } catch (err: any) {
      setError(err.message || "Failed to rotate webhook secret");
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleTestDestination(id: string) {
    try {
      setTestingWebhookId(id);
      setError("");
      await testWebhookDestination(id);
      setNotice("Test webhook dispatched.");
      void loadDeliveryData();
    } catch (err: any) {
      setError(err.message || "Failed to send test webhook");
    } finally {
      setTestingWebhookId(null);
    }
  }

  async function handleDeleteDestination(id: string) {
    if (!window.confirm("Are you sure you want to delete this destination?")) return;
    try {
      setError("");
      await deleteWebhookDestination(id);
      setNotice("Destination deleted.");
      void loadDeliveryData();
    } catch (err: any) {
      setError(err.message || "Failed to delete destination");
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

  async function handleRetryDeadLetter(id: string) {
    try {
      setError("");
      await retryDeadLetter(id);
      setNotice("Dead letter retry queued.");
      void loadDeadLetters();
      void loadDeliveryData();
    } catch (err: any) {
      setError(err.message || "Failed to retry dead letter");
    }
  }

  async function handleResolveDeadLetter(id: string) {
    const resolution = window.prompt("Resolution reason (ignored, fixed_externally, no_longer_needed):", "ignored");
    if (!resolution) return;
    
    try {
      setResolvingId(id);
      setError("");
      await resolveDeadLetter(id, resolution);
      setNotice("Dead letter resolved.");
      void loadDeadLetters();
    } catch (err: any) {
      setError(err.message || "Failed to resolve dead letter");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleReconcileDeadLetters() {
    try {
      setError("");
      const res = await reconcileDeadLetters();
      setNotice(`Reconciled. Created: ${res.created}, Skipped: ${res.skipped}.`);
      void loadDeadLetters();
    } catch (err: any) {
      setError(err.message || "Failed to reconcile dead letters");
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

                  {/* Webhook Destinations Section */}
                  <div className="mt-8 border-t border-slate-800 pt-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-md font-semibold text-slate-100">Webhook Destinations</h3>
                      <button
                        type="button"
                        onClick={() => setEditingDestination({})}
                        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                      >
                        Add Destination
                      </button>
                    </div>

                    {webhookDestinations.length === 0 ? (
                      <p className="text-sm text-slate-500">No webhook destinations configured.</p>
                    ) : (
                      <div className="space-y-4">
                        {webhookDestinations.map(dest => (
                          <div key={dest.id} className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-slate-100">{dest.name}</span>
                                  {!dest.enabled && (
                                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400 border border-slate-700">Disabled</span>
                                  )}
                                  {dest.isDefault && (
                                    <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400 border border-indigo-500/20">Default</span>
                                  )}
                                  <span className="text-xs text-slate-500">Priority: {dest.priority}</span>
                                </div>
                                <p className="mt-1 text-sm font-mono text-slate-500">{dest.safeEndpointLabel}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingDestination(dest)}
                                  className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRotateDestinationSecret(dest.id)}
                                  disabled={savingWebhook}
                                  className="text-xs font-medium text-amber-500 hover:text-amber-400"
                                >
                                  Rotate Secret
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleTestDestination(dest.id)}
                                  disabled={testingWebhookId === dest.id}
                                  className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
                                >
                                  {testingWebhookId === dest.id ? "Testing..." : "Test"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDestination(dest.id)}
                                  className="text-xs font-medium text-red-400 hover:text-red-300"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            
                            <div className="flex flex-wrap gap-2 text-xs">
                              {dest.routeKinds.length > 0 && (
                                <span className="text-slate-400">Kinds: {dest.routeKinds.join(", ")}</span>
                              )}
                              {dest.routeSeverities.length > 0 && (
                                <span className="text-slate-400">Severities: {dest.routeSeverities.join(", ")}</span>
                              )}
                              {dest.failoverEnabled && (
                                <span className="text-slate-400">Failover: Yes</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {webhookSecretDisplay && (
                      <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
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

                    {editingDestination && (
                      <div className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
                        <h4 className="text-md font-medium text-slate-100 mb-4">
                          {editingDestination.id ? "Edit Destination" : "New Destination"}
                        </h4>
                        <form onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          const payloadFormat = fd.get("payloadFormat") as string;
                          const payloadFieldsRaw = fd.getAll("payloadFields") as string[];
                          handleSaveWebhookDestination({
                            name: fd.get("name"),
                            url: fd.get("url") || undefined,
                            enabled: fd.get("enabled") === "true",
                            isDefault: fd.get("isDefault") === "true",
                            priority: parseInt(fd.get("priority") as string, 10),
                            failoverEnabled: fd.get("failoverEnabled") === "true",
                            timeoutMs: parseInt(fd.get("timeoutMs") as string, 10),
                            maxAttempts: parseInt(fd.get("maxAttempts") as string, 10),
                            routeKinds: (fd.get("routeKinds") as string).split(",").map(s => s.trim()).filter(Boolean),
                            routeSeverities: (fd.get("routeSeverities") as string).split(",").map(s => s.trim()).filter(Boolean),
                            payloadFormat,
                            payloadFields: payloadFormat === "custom_allowlist" ? payloadFieldsRaw : undefined,
                            includeActionHref: fd.get("includeActionHref") === "true",
                            includeDeliveryMetadata: fd.get("includeDeliveryMetadata") === "true",
                            includeRoutingMetadata: fd.get("includeRoutingMetadata") === "true",
                          });
                        }} className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <label className="block">
                              <span className="text-sm text-slate-300">Name</span>
                              <input required name="name" defaultValue={editingDestination.name} className="mt-1 block w-full rounded bg-slate-900 px-3 py-2 text-sm text-slate-200 border border-slate-700" />
                            </label>
                            <label className="block">
                              <span className="text-sm text-slate-300">URL {editingDestination.id ? "(leave blank to keep)" : ""}</span>
                              <input type="url" required={!editingDestination.id} name="url" placeholder="https://..." className="mt-1 block w-full rounded bg-slate-900 px-3 py-2 text-sm text-slate-200 border border-slate-700" />
                            </label>
                            <label className="block">
                              <span className="text-sm text-slate-300">Priority (lower is higher)</span>
                              <input type="number" required name="priority" defaultValue={editingDestination.priority ?? 100} className="mt-1 block w-full rounded bg-slate-900 px-3 py-2 text-sm text-slate-200 border border-slate-700" />
                            </label>
                            <label className="block">
                              <span className="text-sm text-slate-300">Timeout (ms)</span>
                              <input type="number" required name="timeoutMs" defaultValue={editingDestination.timeoutMs ?? 5000} className="mt-1 block w-full rounded bg-slate-900 px-3 py-2 text-sm text-slate-200 border border-slate-700" />
                            </label>
                            <label className="block">
                              <span className="text-sm text-slate-300">Max Attempts</span>
                              <input type="number" required name="maxAttempts" defaultValue={editingDestination.maxAttempts ?? 3} className="mt-1 block w-full rounded bg-slate-900 px-3 py-2 text-sm text-slate-200 border border-slate-700" />
                            </label>
                            <label className="block">
                              <span className="text-sm text-slate-300">Route Kinds (comma separated)</span>
                              <input name="routeKinds" defaultValue={editingDestination.routeKinds?.join(", ")} placeholder="test_webhook, error" className="mt-1 block w-full rounded bg-slate-900 px-3 py-2 text-sm text-slate-200 border border-slate-700" />
                            </label>
                            <label className="block">
                              <span className="text-sm text-slate-300">Route Severities (comma separated)</span>
                              <input name="routeSeverities" defaultValue={editingDestination.routeSeverities?.join(", ")} placeholder="info, critical" className="mt-1 block w-full rounded bg-slate-900 px-3 py-2 text-sm text-slate-200 border border-slate-700" />
                            </label>
                            <div className="flex flex-col gap-2 pt-6">
                              <label className="flex items-center gap-2">
                                <input type="checkbox" name="enabled" value="true" defaultChecked={editingDestination.enabled ?? true} />
                                <span className="text-sm text-slate-300">Enabled</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input type="checkbox" name="isDefault" value="true" defaultChecked={editingDestination.isDefault ?? false} />
                                <span className="text-sm text-slate-300">Is Default Fallback</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input type="checkbox" name="failoverEnabled" value="true" defaultChecked={editingDestination.failoverEnabled ?? true} />
                                <span className="text-sm text-slate-300">Enable Failover</span>
                              </label>
                            </div>

                            {/* Payload Format Controls */}
                            <div className="col-span-2 border-t border-slate-700 pt-4 mt-2">
                              <h5 className="text-sm font-medium text-slate-200 mb-3">Payload Format</h5>
                              <div className="grid grid-cols-2 gap-4">
                                <label className="block">
                                  <span className="text-sm text-slate-300">Format</span>
                                  <select name="payloadFormat" defaultValue={editingDestination.payloadFormat ?? "uaiw_default"} className="mt-1 block w-full rounded bg-slate-900 px-3 py-2 text-sm text-slate-200 border border-slate-700">
                                    <option value="uaiw_default">UAIW Default</option>
                                    <option value="minimal">Minimal</option>
                                    <option value="slack_compatible">Slack Compatible</option>
                                    <option value="custom_allowlist">Custom Allowlist</option>
                                  </select>
                                </label>
                                <div className="flex flex-col gap-2 pt-5">
                                  <label className="flex items-center gap-2">
                                    <input type="checkbox" name="includeActionHref" value="true" defaultChecked={editingDestination.includeActionHref ?? true} />
                                    <span className="text-sm text-slate-300">Include action link</span>
                                  </label>
                                  <label className="flex items-center gap-2">
                                    <input type="checkbox" name="includeDeliveryMetadata" value="true" defaultChecked={editingDestination.includeDeliveryMetadata ?? true} />
                                    <span className="text-sm text-slate-300">Include delivery metadata</span>
                                  </label>
                                  <label className="flex items-center gap-2">
                                    <input type="checkbox" name="includeRoutingMetadata" value="true" defaultChecked={editingDestination.includeRoutingMetadata ?? true} />
                                    <span className="text-sm text-slate-300">Include routing metadata</span>
                                  </label>
                                </div>
                              </div>

                              {/* Custom Allowlist Field Selector */}
                              <details className="mt-3">
                                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">Custom allowlist fields (for Custom Allowlist format)</summary>
                                <div className="mt-2 grid grid-cols-2 gap-1">
                                  {[
                                    "event.id", "event.kind", "event.title", "event.message",
                                    "event.severity", "event.priority", "event.createdAt", "event.actionHref",
                                    "delivery.channel", "delivery.destinationId", "delivery.destinationName",
                                    "delivery.attemptId", "delivery.timestamp",
                                    "routing.reason", "routing.failoverIndex"
                                  ].map(field => (
                                    <label key={field} className="flex items-center gap-1.5 text-xs text-slate-400">
                                      <input type="checkbox" name="payloadFields" value={field}
                                        defaultChecked={editingDestination.payloadFields?.includes(field)} />
                                      <span className="font-mono">{field}</span>
                                    </label>
                                  ))}
                                </div>
                              </details>

                              {/* Payload Preview */}
                              {editingDestination.id && (
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    disabled={loadingPreview}
                                    onClick={async () => {
                                      try {
                                        setLoadingPreview(true);
                                        setPayloadPreview(null);
                                        const preview = await previewWebhookPayload(editingDestination.id!);
                                        setPayloadPreview(preview);
                                      } catch (err: any) {
                                        setError(err.message);
                                      } finally {
                                        setLoadingPreview(false);
                                      }
                                    }}
                                    className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
                                  >
                                    {loadingPreview ? "Loading preview…" : "Preview Payload"}
                                  </button>
                                  {payloadPreview && (
                                    <div className="mt-2 space-y-1">
                                      <div className="flex gap-3 text-xs text-slate-500">
                                        <span>Format: <strong className="text-slate-300">{payloadPreview.format}</strong></span>
                                        <span>Size: <strong className="text-slate-300">{payloadPreview.sizeBytes} bytes</strong></span>
                                        <span>Schema: <strong className="text-slate-300">{payloadPreview.schema}</strong></span>
                                      </div>
                                      {payloadPreview.warnings.length > 0 && (
                                        <div className="text-xs text-amber-400">
                                          {payloadPreview.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                                        </div>
                                      )}
                                      <pre className="max-h-48 overflow-auto rounded bg-slate-950 border border-slate-800 p-3 text-xs text-slate-300 font-mono">
                                        {JSON.stringify(payloadPreview.payload, null, 2)}
                                      </pre>
                                      <p className="text-xs text-slate-600">Preview uses sample/safe notification data only.</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setEditingDestination(null)} className="rounded px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white">Cancel</button>
                            <button type="submit" disabled={savingWebhook} className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Save</button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>

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

          <section className="mt-10 rounded-lg border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-100">Dead Letters</h2>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300 border border-slate-700">
                  Failed Deliveries
                </span>
              </div>
              <button
                type="button"
                onClick={handleReconcileDeadLetters}
                className="text-sm font-medium text-slate-400 hover:text-slate-300 transition-colors"
              >
                Reconcile
              </button>
            </div>
            <div className="p-0">
              {loadingDeadLetters ? (
                <div className="p-5 text-sm text-slate-500">Loading dead letters...</div>
              ) : deadLetters.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">No dead-lettered notifications.</div>
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {deadLetters.map((dlq) => (
                    <li key={dlq.id} className={`p-5 transition-colors ${dlq.status === 'resolved' ? 'opacity-60 bg-slate-950/40' : 'hover:bg-slate-800/20'} text-sm`}>
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="text-slate-400 min-w-[140px]">
                            {new Date(dlq.deadLetteredAt).toLocaleString()}
                          </span>
                          <div className="flex flex-col gap-0.5 w-48">
                            <span className="font-medium text-slate-300 truncate" title={dlq.eventTitle}>
                              {dlq.eventTitle}
                            </span>
                            <span className="text-xs text-slate-500">{dlq.kind}</span>
                          </div>
                          <span className="font-medium text-slate-300 w-20">
                            {dlq.channel}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                            dlq.status === 'open' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                            {dlq.status}
                          </span>
                          {dlq.reason && (
                            <span className="text-red-400 text-xs truncate max-w-[200px]" title={dlq.reason}>
                              {dlq.reason}
                            </span>
                          )}
                          <span className="text-slate-500 text-xs">
                            Retries: {dlq.retryCount}
                          </span>
                        </div>
                        {dlq.status === "open" && (
                          <div className="flex items-center gap-2">
                            {dlq.retryable && dlq.channel === "webhook" && (
                              <button
                                type="button"
                                onClick={() => handleRetryDeadLetter(dlq.id)}
                                className="rounded border border-indigo-700 bg-indigo-600/10 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-600/20 transition-colors"
                              >
                                Retry
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={resolvingId === dlq.id}
                              onClick={() => handleResolveDeadLetter(dlq.id)}
                              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
                            >
                              Resolve
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
