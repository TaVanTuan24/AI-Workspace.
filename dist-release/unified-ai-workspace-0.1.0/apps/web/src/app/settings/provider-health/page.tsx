"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getProviderHealth, refreshProviderHealth, refreshAllProviderHealth, type ProviderHealth } from "../../../lib/api";

export default function ProviderHealthPage() {
  const [healths, setHealths] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingProviders, setRefreshingProviders] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const res = await getProviderHealth();
      setHealths(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load provider health");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshAll() {
    try {
      setRefreshingAll(true);
      setError("");
      const res = await refreshAllProviderHealth();
      setHealths(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to refresh all providers");
    } finally {
      setRefreshingAll(false);
    }
  }

  async function handleRefreshSingle(provider: string) {
    try {
      setRefreshingProviders(prev => ({ ...prev, [provider]: true }));
      setError("");
      const res = await refreshProviderHealth(provider);
      setHealths(prev => prev.map(h => h.provider === provider ? res : h));
    } catch (err: any) {
      setError(err.message || `Failed to refresh ${provider}`);
    } finally {
      setRefreshingProviders(prev => ({ ...prev, [provider]: false }));
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">Provider Health & Readiness</h1>
          <p className="text-slate-400 mt-2">
            Monitor the status and usability of your connected AI providers.
          </p>
          <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-sm rounded-lg inline-block">
            <strong>Security Note:</strong> Health checks validate active browser session cookies in isolated profiles only. They do not send prompts or arbitrary messages.
          </div>
        </div>
        <button
          onClick={handleRefreshAll}
          disabled={loading || refreshingAll}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {refreshingAll ? "Refreshing..." : "Refresh All"}
        </button>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-500">Loading provider health...</div>
      ) : (
        <div className="grid gap-6">
          {healths.map((health) => (
            <ProviderHealthCard
              key={health.provider}
              health={health}
              onRefresh={() => handleRefreshSingle(health.provider)}
              isRefreshing={refreshingProviders[health.provider] || refreshingAll}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderHealthCard({ 
  health, 
  onRefresh, 
  isRefreshing 
}: { 
  health: ProviderHealth; 
  onRefresh: () => void; 
  isRefreshing: boolean;
}) {
  const actionable = isActionableHealth(health);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col md:flex-row gap-6 md:items-center">
      <div className="flex-1 space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-slate-200">{health.displayName}</h2>
          <span className="text-xs font-mono text-slate-500 bg-slate-950 px-2 py-1 rounded">{health.provider}</span>
          <StatusBadge isUsable={health.isUsable} status={health.healthStatus} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-slate-500 mb-1">Readiness</div>
            <div className="text-slate-300 capitalize">{health.readiness}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-1">Connection</div>
            <div className="text-slate-300 capitalize">{health.connectionStatus.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-1">Last Validated</div>
            <div className="text-slate-300">{health.lastValidatedAt ? new Date(health.lastValidatedAt).toLocaleString() : "Never"}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-1">Capabilities</div>
            <div className="text-slate-300 flex flex-wrap gap-1">
              {health.capabilities.slice(0, 2).map(c => (
                 <span key={c} className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded">{c}</span>
              ))}
              {health.capabilities.length > 2 && <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded">+{health.capabilities.length - 2}</span>}
            </div>
          </div>
        </div>

        {actionable && (
          <div className="mt-2 text-sm text-amber-300 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
            <div className="font-medium">{health.displayName} needs attention</div>
            <div className="mt-1 text-amber-200/80">
              {healthMessage(health)}
            </div>
            {health.errorCode && (
              <div className="mt-2 text-xs text-amber-200/70">
                Status code: {health.errorCode}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 min-w-[140px]">
        {actionable && health.connectionStatus !== "not_connected" ? (
          <Link
            href="/connections"
            className="w-full text-center px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium transition-colors"
          >
            Reconnect provider
          </Link>
        ) : health.connectionStatus === "not_connected" ? (
          <Link
            href="/connections"
            className="w-full text-center px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium transition-colors"
          >
            Connect
          </Link>
        ) : null}

        <button
          onClick={onRefresh}
          disabled={isRefreshing || health.connectionStatus === "not_connected"}
          className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {isRefreshing ? "Validating..." : "Validate Now"}
        </button>
      </div>
    </div>
  );
}

function isActionableHealth(health: ProviderHealth) {
  return (
    health.connectionStatus === "requires_login" ||
    health.connectionStatus === "expired" ||
    health.connectionStatus === "manual_action_required" ||
    health.connectionStatus === "error" ||
    health.healthStatus === "requires_login" ||
    health.healthStatus === "expired" ||
    health.healthStatus === "manual_action_required" ||
    health.healthStatus === "ui_changed" ||
    health.errorCode === "PROVIDER_UI_CHANGED"
  );
}

function healthMessage(health: ProviderHealth) {
  if (health.connectionStatus === "expired" || health.healthStatus === "expired") {
    return "This saved session appears to be expired. Reconnect on the official provider page to continue.";
  }
  if (health.connectionStatus === "manual_action_required" || health.healthStatus === "manual_action_required") {
    return "The provider is asking for manual verification. Reconnect and complete the challenge directly with the provider.";
  }
  if (health.errorCode === "PROVIDER_UI_CHANGED" || health.healthStatus === "ui_changed") {
    return "The provider web UI may have changed. Validate manually and update selectors if needed.";
  }
  if (health.connectionStatus === "requires_login" || health.healthStatus === "requires_login") {
    return "This provider needs a fresh login before it can be used.";
  }
  return health.errorMessage || "This provider is not currently usable. Reconnect or validate before sending prompts.";
}

function StatusBadge({ isUsable, status }: { isUsable: boolean, status: string }) {
  if (isUsable) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Usable</span>;
  }
  if (status === "requires_login" || status === "expired" || status === "manual_action_required") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Action Required</span>;
  }
  if (status === "not_connected") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">Not Connected</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 capitalize">{status.replace('_', ' ')}</span>;
}
