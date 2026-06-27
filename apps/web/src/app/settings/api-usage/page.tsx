"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getApiUsageSummary,
  getApiUsageLogs,
  getProviderLimitAnalytics,
  getProviderRateLimits,
  type ApiUsageSummary,
  type PaginatedApiUsageLogs,
  type ProviderLimitAnalyticsSummary,
  type ProviderRateLimitView
} from "../../../lib/api";

const providerLabels: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude"
};

const sourceLabels: Record<string, string> = {
  openai_compat: "OpenAI-compatible",
  internal_chat: "Internal chat",
  internal_multi_chat: "Compare mode",
  internal_retry: "Retry"
};

export default function ApiUsagePage() {
  const [summary, setSummary] = useState<ApiUsageSummary | null>(null);
  const [logs, setLogs] = useState<PaginatedApiUsageLogs | null>(null);
  const [providerLimitSummary, setProviderLimitSummary] = useState<ProviderLimitAnalyticsSummary | null>(null);
  const [providerLimits, setProviderLimits] = useState<ProviderRateLimitView[]>([]);
  const [providerLimitRange, setProviderLimitRange] = useState<"24h" | "7d">("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, [providerLimitRange]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [sum, logData, providerLimitData, providerLimitSettings] = await Promise.all([
        getApiUsageSummary(),
        getApiUsageLogs({ pageSize: 50 }),
        getProviderLimitAnalytics(providerLimitRange),
        getProviderRateLimits().catch(() => ({ limits: [] }))
      ]);
      setSummary(sum);
      setLogs(logData);
      setProviderLimitSummary(providerLimitData.summary);
      setProviderLimits(providerLimitSettings.limits);
    } catch (err: any) {
      setError(err.message || "Failed to load usage analytics");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">API Usage Analytics</h1>
        <p className="text-slate-400 mt-2">
          Monitor your OpenAI-compatible endpoint usage. Only operational metadata is tracked.
        </p>
        <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-sm rounded-lg inline-block">
          <strong>Security Note:</strong> Usage analytics are designed for operational visibility. Prompt and response content are intentionally excluded and never logged.
        </div>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">
          {error}
        </div>
      )}

      {loading && !summary ? (
        <div className="text-slate-500">Loading analytics...</div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <StatCard label="Total Requests" value={summary.totals.requests} />
            <StatCard label="Completed" value={summary.totals.completed} className="text-emerald-400" />
            <StatCard label="Failed" value={summary.totals.failed} className="text-red-400" />
            <StatCard label="Rate Limited" value={summary.totals.rateLimited} className="text-amber-400" />
            <StatCard label="Avg Latency" value={`${summary.totals.avgDurationMs}ms`} />
            <StatCard label="Input Chars" value={summary.totals.inputChars} />
            <StatCard label="Output Chars" value={summary.totals.outputChars} />
          </div>

          {providerLimitSummary && (
            <ProviderLimitSection
              summary={providerLimitSummary}
              limits={providerLimits}
              range={providerLimitRange}
              onRangeChange={setProviderLimitRange}
            />
          )}

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 font-medium text-slate-200">Usage by Model</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-6 py-3 font-medium">Model</th>
                      <th className="px-6 py-3 font-medium text-right">Requests</th>
                      <th className="px-6 py-3 font-medium text-right">Completed</th>
                      <th className="px-6 py-3 font-medium text-right">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {summary.byModel.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-4 text-center text-slate-500">No data</td></tr>
                    ) : summary.byModel.map(m => (
                      <tr key={m.model}>
                        <td className="px-6 py-3">{m.model}</td>
                        <td className="px-6 py-3 text-right">{m.requests}</td>
                        <td className="px-6 py-3 text-right text-emerald-400">{m.completed}</td>
                        <td className="px-6 py-3 text-right text-red-400">{m.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 font-medium text-slate-200">Usage by Provider</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-6 py-3 font-medium">Provider</th>
                      <th className="px-6 py-3 font-medium text-right">Requests</th>
                      <th className="px-6 py-3 font-medium text-right">Completed</th>
                      <th className="px-6 py-3 font-medium text-right">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {summary.byProvider.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-4 text-center text-slate-500">No data</td></tr>
                    ) : summary.byProvider.map(p => (
                      <tr key={p.provider}>
                        <td className="px-6 py-3">{p.provider}</td>
                        <td className="px-6 py-3 text-right">{p.requests}</td>
                        <td className="px-6 py-3 text-right text-emerald-400">{p.completed}</td>
                        <td className="px-6 py-3 text-right text-red-400">{p.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {logs && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 font-medium text-slate-200 flex justify-between">
            <span>Recent Logs</span>
            <span className="text-sm font-normal text-slate-500">Showing last {logs.items.length} of {logs.total}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Key Prefix</th>
                  <th className="px-6 py-3 font-medium">Model</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Chars In/Out</th>
                  <th className="px-6 py-3 font-medium text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {logs.items.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">No logs found</td></tr>
                ) : logs.items.map(log => (
                  <tr key={log.id}>
                    <td className="px-6 py-3 whitespace-nowrap text-xs text-slate-400">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs">
                      {log.apiKeyPrefix ? `${log.apiKeyPrefix}...` : 'N/A'}
                    </td>
                    <td className="px-6 py-3">{log.model}</td>
                    <td className="px-6 py-3">
                      <StatusBadge status={log.status} error={log.errorCode} />
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap text-xs">
                      <span className="text-slate-400">{log.inputCharCount}</span>
                      <span className="text-slate-600 mx-1">/</span>
                      <span className="text-emerald-400/80">{log.outputCharCount ?? '-'}</span>
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      {log.durationMs ? `${log.durationMs}ms` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderLimitSection({
  summary,
  limits,
  range,
  onRangeChange
}: {
  summary: ProviderLimitAnalyticsSummary;
  limits: ProviderRateLimitView[];
  range: "24h" | "7d";
  onRangeChange: (range: "24h" | "7d") => void;
}) {
  const topProvider = summary.byProvider.reduce(
    (top, item) => (item.hits > top.hits ? item : top),
    { provider: "none", hits: 0 }
  );
  const affectedApiKeys = summary.byApiKey.filter((item) => item.hits > 0).length;
  const maxProviderHits = Math.max(1, ...summary.byProvider.map((item) => item.hits));

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Provider Rate-limit Hits</h2>
          <p className="mt-1 text-sm text-slate-500">
            Aggregated provider-level limit events only.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-1">
          {(["24h", "7d"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onRangeChange(option)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                range === option ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Provider-limit Hits" value={summary.totalHits} className={summary.totalHits > 0 ? "text-amber-400" : ""} />
          <StatCard
            label="Top Provider"
            value={topProvider.hits > 0 ? `${providerLabels[topProvider.provider] ?? topProvider.provider}: ${topProvider.hits}` : "None"}
          />
          <StatCard label="Affected API Keys" value={affectedApiKeys} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
            <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium text-slate-200">By Provider</div>
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Hits</th>
                  <th className="px-4 py-3 font-medium">Effective Limit</th>
                  <th className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {summary.byProvider.map((item) => {
                  const currentLimit = limits.find((limit) => limit.provider === item.provider);
                  return (
                    <tr key={item.provider}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-100">{providerLabels[item.provider] ?? item.provider}</div>
                        <div className="mt-2 h-1.5 rounded-full bg-slate-800">
                          <div
                            className="h-1.5 rounded-full bg-amber-400"
                            style={{ width: `${Math.max(4, Math.round((item.hits / maxProviderHits) * 100))}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">{item.hits}</td>
                      <td className="px-4 py-3">{currentLimit ? `${currentLimit.effectiveRequestsPerMinute}/min` : "Unavailable"}</td>
                      <td className="px-4 py-3 text-right">
                        <Link className="text-indigo-300 hover:text-indigo-200" href="/settings/provider-rate-limits">
                          Limits
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
            <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium text-slate-200">By Model</div>
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 text-right font-medium">Hits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {summary.byModel.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">No provider-limit hits</td></tr>
                ) : summary.byModel.map((item) => (
                  <tr key={`${item.provider}:${item.modelId}`}>
                    <td className="px-4 py-3">{item.modelId}</td>
                    <td className="px-4 py-3">{providerLabels[item.provider] ?? item.provider}</td>
                    <td className="px-4 py-3 text-right">{item.hits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
            <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium text-slate-200">By API Key</div>
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Key</th>
                  <th className="px-4 py-3 font-medium">Prefix</th>
                  <th className="px-4 py-3 text-right font-medium">Hits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {summary.byApiKey.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">No affected API keys</td></tr>
                ) : summary.byApiKey.map((item) => (
                  <tr key={item.apiKeyId}>
                    <td className="px-4 py-3">{item.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.keyPrefix ? `${item.keyPrefix}...` : "N/A"}</td>
                    <td className="px-4 py-3 text-right">{item.hits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
            <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium text-slate-200">Traffic Source</div>
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 text-right font-medium">Hits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {summary.bySource.map((item) => (
                  <tr key={item.source}>
                    <td className="px-4 py-3">{sourceLabels[item.source] ?? item.source}</td>
                    <td className="px-4 py-3 text-right">{item.hits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
            <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium text-slate-200">Recent Provider-limit Events</div>
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">API Key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {summary.recentEvents.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No recent provider-limit events</td></tr>
                ) : summary.recentEvents.map((event, index) => (
                  <tr key={`${event.createdAt}:${event.provider}:${index}`}>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">{new Date(event.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">{providerLabels[event.provider] ?? event.provider}</td>
                    <td className="px-4 py-3">{event.modelId ?? "Unknown"}</td>
                    <td className="px-4 py-3">{event.source ? sourceLabels[event.source] ?? event.source : "Unknown"}</td>
                    <td className="px-4 py-3">{event.apiKeyName ?? "Unknown key"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, className = "" }: { label: string, value: string | number, className?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold mt-2 text-slate-200 ${className}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: string, error?: string | null }) {
  if (status === "completed") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Completed</span>;
  }
  if (status === "rate_limited") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Rate Limited</span>;
  }
  if (status === "failed" || status === "timeout" || status === "client_disconnected") {
    return (
      <div className="flex flex-col gap-1 items-start">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 capitalize">{status.replace('_', ' ')}</span>
        {error && <span className="text-[10px] text-red-400/70">{error}</span>}
      </div>
    );
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20 capitalize">{status.replace('_', ' ')}</span>;
}
