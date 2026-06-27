"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Save, TimerReset } from "lucide-react";
import type { ProviderId } from "@uaiw/shared/types/provider";
import {
  getProviderLimitAnalytics,
  getProviderRateLimits,
  getSettingsOverview,
  hasPermission,
  permissionDeniedMessage,
  updateProviderRateLimit,
  type ProviderLimitAnalyticsSummary,
  type ProviderRateLimitView,
  type WorkspacePermission
} from "../../../lib/api";

const providerLabels: Record<ProviderId, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude"
};

export default function ProviderRateLimitsPage() {
  const [limits, setLimits] = useState<ProviderRateLimitView[]>([]);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [analytics, setAnalytics] = useState<ProviderLimitAnalyticsSummary | null>(null);
  const [maxRequestsPerMinute, setMaxRequestsPerMinute] = useState(300);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void loadLimits();
  }, []);

  async function loadLimits() {
    try {
      setLoading(true);
      setError("");
      const [data, analyticsData, overviewData] = await Promise.all([
        getProviderRateLimits(),
        getProviderLimitAnalytics("24h").catch(() => ({ summary: null })),
        getSettingsOverview()
      ]);
      setLimits(data.limits);
      setPermissions(overviewData.currentUser.permissions);
      setAnalytics(analyticsData.summary);
      setMaxRequestsPerMinute(data.maxRequestsPerMinute);
      setDrafts(
        Object.fromEntries(
          data.limits.map((limit) => [
            limit.provider,
            limit.requestsPerMinute === null ? "" : String(limit.requestsPerMinute)
          ])
        )
      );
    } catch (err: any) {
      setError(err.message || "Failed to load provider rate limits");
    } finally {
      setLoading(false);
    }
  }

  const totalEffective = useMemo(
    () => limits.reduce((sum, limit) => sum + limit.effectiveRequestsPerMinute, 0),
    [limits]
  );
  const hitsByProvider = useMemo(() => {
    return new Map((analytics?.byProvider ?? []).map((item) => [item.provider, item.hits]));
  }, [analytics]);
  const canWriteModels = hasPermission(permissions, "models.write");

  async function saveProvider(provider: ProviderId) {
    if (!canWriteModels) {
      setError(permissionDeniedMessage);
      return;
    }
    const raw = drafts[provider]?.trim() ?? "";
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value <= 0 || value > maxRequestsPerMinute)) {
      setError(`Limit must be a whole number from 1 to ${maxRequestsPerMinute}, or blank for the environment default.`);
      return;
    }

    try {
      setSavingProvider(provider);
      setError("");
      setNotice("");
      const res = await updateProviderRateLimit(provider, value);
      setLimits((prev) => prev.map((limit) => (limit.provider === provider ? res.limit : limit)));
      setDrafts((prev) => ({
        ...prev,
        [provider]: res.limit.requestsPerMinute === null ? "" : String(res.limit.requestsPerMinute)
      }));
      setNotice(`${providerLabels[provider]} limit saved.`);
    } catch (err: any) {
      setError(err.message || "Failed to save provider rate limit");
    } finally {
      setSavingProvider(null);
    }
  }

  function updateDraft(provider: ProviderId, value: string) {
    setDrafts((prev) => ({ ...prev, [provider]: value }));
  }

  return (
    <div className="space-y-6 p-0 lg:p-2">
      <header>
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300">
          <TimerReset className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Provider Rate Limits</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Cap per-user browser automation requests before jobs enter the queue. Blank values use environment defaults.
        </p>
        <Link href="/settings/api-usage" className="mt-3 inline-flex text-sm font-medium text-indigo-300 hover:text-indigo-200">
          View provider-limit analytics
        </Link>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {!canWriteModels && !loading && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-sm text-slate-300">
          You don't have permission to perform this action.
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <Metric label="Configured providers" value={String(limits.length)} />
        <Metric label="Combined effective cap" value={`${totalEffective}/min`} />
        <Metric label="Maximum custom cap" value={`${maxRequestsPerMinute}/min`} />
      </section>

      {analytics && analytics.totalHits > 0 && (
        <section className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {analytics.totalHits} provider-limit hit{analytics.totalHits === 1 ? "" : "s"} in the last 24h. Review traffic in API Usage before raising caps.
        </section>
      )}

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-100">Limits</h2>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading provider limits...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-950 text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-medium">Provider</th>
                  <th className="px-5 py-3 font-medium">Effective</th>
                  <th className="px-5 py-3 font-medium">Last 24h hits</th>
                  <th className="px-5 py-3 font-medium">Source</th>
                  <th className="px-5 py-3 font-medium">Custom requests/min</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {limits.map((limit) => (
                  <tr key={limit.provider}>
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-100">{providerLabels[limit.provider]}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{limit.provider}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-200">{limit.effectiveRequestsPerMinute}/min</td>
                    <td className="px-5 py-4">
                      <div className={hitsByProvider.get(limit.provider) ? "text-amber-300" : "text-slate-300"}>
                        {hitsByProvider.get(limit.provider) ?? 0}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {(hitsByProvider.get(limit.provider) ?? 0) > 0
                          ? "This provider hit its limit recently."
                          : "No provider-limit hits in the last 24h."}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={limit.source === "custom" ? customBadge : envBadge}>
                        {limit.source === "custom" ? "Custom" : "Environment"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <input
                        type="number"
                        min={1}
                        max={maxRequestsPerMinute}
                        value={drafts[limit.provider] ?? ""}
                        onChange={(event) => updateDraft(limit.provider, event.target.value)}
                        disabled={!canWriteModels}
                        placeholder="Default"
                        className="h-9 w-36 rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          title="Reset to environment default"
                          onClick={() => {
                            if (!canWriteModels) {
                              setError(permissionDeniedMessage);
                              return;
                            }
                            updateDraft(limit.provider, "");
                            void updateProviderRateLimit(limit.provider, null).then((res) => {
                              setLimits((prev) => prev.map((item) => (item.provider === limit.provider ? res.limit : item)));
                              setNotice(`${providerLabels[limit.provider]} reset to environment default.`);
                            }).catch((err: any) => setError(err.message || "Failed to reset provider rate limit"));
                          }}
                          disabled={!canWriteModels}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          title="Save provider limit"
                          onClick={() => saveProvider(limit.provider)}
                          disabled={savingProvider === limit.provider || !canWriteModels}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
                        >
                          <Save className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </article>
  );
}

const customBadge = "inline-flex rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300";
const envBadge = "inline-flex rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300";
