"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Cable,
  DatabaseBackup,
  Gauge,
  KeyRound,
  RefreshCw,
  SlidersHorizontal,
  TimerReset,
  X
} from "lucide-react";
import {
  getOnboardingStatus,
  getSettingsOverview,
  getWorkspaceNotifications,
  type OnboardingStatus,
  type SettingsOverview,
  type WorkspaceNotification
} from "../../lib/api";
import {
  dismissNotification,
  filterVisibleNotifications,
  readDismissedNotifications,
  writeDismissedNotifications,
  type DismissedNotificationMap
} from "../../lib/notificationDismissals";

const quickLinks = [
  {
    href: "/settings/connections",
    label: "Manage connections",
    description: "Connect or disconnect ChatGPT, Gemini, and Grok.",
    icon: Cable
  },
  {
    href: "/settings/models",
    label: "Model preferences",
    description: "Choose enabled models, priorities, and the default route.",
    icon: SlidersHorizontal
  },
  {
    href: "/settings/api-keys",
    label: "API keys",
    description: "Create, rotate, revoke, and scope internal endpoint keys.",
    icon: KeyRound
  },
  {
    href: "/settings/api-usage",
    label: "Usage analytics",
    description: "Review request status, latency, and rate-limit metadata.",
    icon: Gauge
  },
  {
    href: "/settings/provider-rate-limits",
    label: "Provider limits",
    description: "Set ChatGPT, Gemini, and Grok caps before automation jobs enqueue.",
    icon: TimerReset
  },
  {
    href: "/settings/notifications",
    label: "Notification preferences",
    description: "Choose which operational alerts appear in the app.",
    icon: Bell
  }
];

export default function SettingsOverviewPage() {
  const [overview, setOverview] = useState<SettingsOverview | null>(null);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [dismissed, setDismissed] = useState<DismissedNotificationMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDismissed(readDismissedNotifications());

    async function loadOverview() {
      try {
        setLoading(true);
        setError("");
        const [data, notificationData, onboardingData] = await Promise.all([
          getSettingsOverview(),
          getWorkspaceNotifications(),
          getOnboardingStatus()
        ]);
        if (!cancelled) {
          setOverview(data);
          setNotifications(notificationData.notifications);
          setOnboarding(onboardingData);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load settings overview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadOverview();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleNotifications = useMemo(
    () => filterVisibleNotifications(notifications, dismissed),
    [notifications, dismissed]
  );
  const warnings = useMemo(() => buildOperationalWarnings(overview), [overview]);

  function handleDismiss(notification: WorkspaceNotification) {
    const next = dismissNotification(notification, dismissed);
    setDismissed(next);
    writeDismissedNotifications(next);
  }

  return (
    <div className="space-y-8 p-0 lg:p-2">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Workspace Settings</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          A central hub for provider sessions, model routing, internal API controls, usage metadata, backups, and scheduled checks.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !overview ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-lg border border-slate-800 bg-slate-900" />
          ))}
        </div>
      ) : overview ? (
        <>
          {onboarding && !onboarding.completed ? (
            <section className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-medium text-indigo-300">
                    {onboarding.skipped ? "Onboarding skipped" : "Complete setup"}
                  </div>
                  <h2 className="mt-1 text-xl font-semibold text-slate-100">
                    Connect a provider, choose a default model, and create an API key.
                  </h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Recommended next step: {onboarding.recommendedNextStep.replace(/_/g, " ")}.
                  </p>
                </div>
                <Link
                  href="/onboarding"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  {onboarding.skipped ? "Resume onboarding" : "Continue onboarding"}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </section>
          ) : null}

          {visibleNotifications.length > 0 && (
            <section className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-300">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Needs attention
              </div>
              <div className="grid gap-3">
                {visibleNotifications.map((notification) => (
                  <div
                    key={notification.fingerprint}
                    className="flex items-start justify-between gap-4 rounded-md border border-amber-500/10 bg-slate-950/40 px-3 py-3 text-sm text-amber-100"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{notification.title}</div>
                      <div className="mt-1 text-amber-100/80">{notification.message}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {notification.action ? (
                        <Link
                          href={notification.action.href}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-100 hover:bg-amber-500/20"
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
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-500/20 bg-slate-950/50 text-amber-100 hover:bg-slate-950"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {warnings.length > 0 && (
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 text-sm font-medium text-slate-200">Operational reminders</div>
              <div className="grid gap-2 md:grid-cols-2">
                {warnings.map((warning) => (
                  <Link
                    key={warning.label}
                    href={warning.href}
                    className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300 hover:bg-slate-950/70"
                  >
                    <span>{warning.label}</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <OverviewCard
              icon={Cable}
              label="Providers"
              value={`${overview.providers.usable}/${overview.providers.total} usable`}
              detail={`${overview.providers.connected} connected, ${overview.providers.requiresLogin} need login`}
              tone={overview.providers.requiresLogin > 0 ? "warning" : "ok"}
            />
            <OverviewCard
              icon={SlidersHorizontal}
              label="Models"
              value={`${overview.models.usable}/${overview.models.total} usable`}
              detail={`${overview.models.enabled} enabled, default ${overview.models.defaultModelId ?? "not set"}`}
              tone={overview.models.usable === 0 ? "danger" : "ok"}
            />
            <OverviewCard
              icon={KeyRound}
              label="API Keys"
              value={`${overview.apiKeys.active} active`}
              detail={`${overview.apiKeys.revoked} revoked`}
              tone={overview.apiKeys.active === 0 ? "warning" : "neutral"}
            />
            <OverviewCard
              icon={Gauge}
              label="API Usage"
              value={`${overview.usage.requests24h} in 24h`}
              detail={`${overview.usage.requests7d} in 7d, ${overview.usage.failed24h} failed, ${overview.usage.providerRateLimited24h} provider-limit hits`}
              tone={overview.usage.failed24h > 0 || overview.usage.providerRateLimited24h > 0 ? "warning" : "neutral"}
            />
            <OverviewCard
              icon={DatabaseBackup}
              label="Backups"
              value={overview.backups.tracked ? "Tracked" : "Not tracked"}
              detail={overview.backups.lastExportAt ? `Last export ${new Date(overview.backups.lastExportAt).toLocaleString()}` : "Export history is not tracked yet"}
              tone="neutral"
            />
            <OverviewCard
              icon={Activity}
              label="Health Scheduler"
              value={overview.scheduler.providerHealthEnabled ? "Enabled" : "Disabled"}
              detail={overview.scheduler.providerHealthEnabled ? "Background provider checks can run" : "Manual refresh only"}
              tone={overview.scheduler.providerHealthEnabled ? "ok" : "warning"}
            />
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-slate-100">Quick Links</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {quickLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group rounded-lg border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-indigo-500/30 hover:bg-slate-900/80"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-950 text-slate-300">
                        <link.icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block font-medium text-slate-100">{link.label}</span>
                        <span className="mt-1 block text-sm text-slate-500">{link.description}</span>
                      </span>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-600 transition-colors group-hover:text-indigo-300" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-slate-400">
          No settings metadata is available yet.
        </div>
      )}
    </div>
  );
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  detail,
  tone
}: {
  icon: typeof Cable;
  label: string;
  value: string;
  detail: string;
  tone: "ok" | "warning" | "danger" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-300"
      : tone === "warning"
        ? "text-amber-300"
        : tone === "danger"
          ? "text-red-300"
          : "text-slate-200";

  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-400">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 bg-slate-950 text-slate-400">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-2 text-sm text-slate-500">{detail}</div>
    </article>
  );
}

function buildOperationalWarnings(overview: SettingsOverview | null) {
  if (!overview) return [];

  const warnings: Array<{ label: string; href: string }> = [];
  if (overview.apiKeys.active === 0) {
    warnings.push({ label: "No active internal API keys", href: "/settings/api-keys" });
  }
  if (!overview.scheduler.providerHealthEnabled) {
    warnings.push({ label: "Provider health scheduler is disabled", href: "/settings/provider-health" });
  }
  if (overview.usage.failed24h > 0) {
    warnings.push({ label: `${overview.usage.failed24h} API request${overview.usage.failed24h === 1 ? "" : "s"} failed in 24h`, href: "/settings/api-usage" });
  }
  if (overview.usage.rateLimited24h > 0) {
    warnings.push({
      label: `${overview.usage.rateLimited24h} API request${overview.usage.rateLimited24h === 1 ? "" : "s"} hit rate limits in 24h`,
      href: "/settings/api-usage"
    });
  }
  if (overview.usage.providerRateLimited24h > 0) {
    warnings.push({
      label: `${overview.usage.providerRateLimited24h} provider-limit hit${overview.usage.providerRateLimited24h === 1 ? "" : "s"} in the last 24h`,
      href: "/settings/api-usage"
    });
  }
  return warnings;
}
