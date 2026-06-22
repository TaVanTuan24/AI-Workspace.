"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getProviderHealth, refreshProviderHealth, refreshAllProviderHealth, type ProviderHealth } from "../../../lib/api";

import { IncidentTimeline } from "./IncidentTimeline";
import { DiagnosticsHistoryTab } from "./DiagnosticsHistoryTab";
import { ProviderHealthCard } from "./ProviderHealthCard";

export default function ProviderHealthPage() {
  const [activeTab, setActiveTab] = useState<"status" | "timeline" | "history">("status");
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
        <div className="flex flex-col gap-2">
          <Link
            href="/settings/provider-recovery"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors text-center"
          >
            Configure recovery policy
          </Link>
          <button
            onClick={handleRefreshAll}
            disabled={loading || refreshingAll}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {refreshingAll ? "Refreshing..." : "Refresh All"}
          </button>
        </div>
      </header>

      <div className="flex space-x-4 border-b border-slate-800 pb-px">
        <button
          onClick={() => setActiveTab("status")}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "status"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-700"
          }`}
        >
          Current Status
        </button>
        <button
          onClick={() => setActiveTab("timeline")}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "timeline"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-700"
          }`}
        >
          Incident Timeline
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "history"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-700"
          }`}
        >
          Diagnostics History
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">
          {error}
        </div>
      )}

      {activeTab === "status" && (
        loading ? (
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
        )
      )}

      {activeTab === "timeline" && <IncidentTimeline />}

      {activeTab === "history" && (
        <DiagnosticsHistoryTab />
      )}
    </div>
  );
}
