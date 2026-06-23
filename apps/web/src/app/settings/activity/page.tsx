"use client";

import { useEffect, useState } from "react";
import {
  getWorkspaceActivity,
  getSettingsOverview,
  hasPermission,
  permissionDeniedMessage,
  type ActivityEvent,
  type ActivityCategory,
  type WorkspacePermission
} from "../../../lib/api";

const RANGES = ["24h", "7d", "30d", "90d"] as const;

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  membership: "Membership",
  invite: "Invites",
  invite_delivery: "Invite Delivery",
  quota: "Quotas",
  notification: "Notifications",
  scheduler: "Schedulers",
  provider_health: "Provider Health",
  diagnostics: "Diagnostics",
  recovery: "Recovery",
  webhook: "Webhooks",
  api_usage: "API Usage",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  warning: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  error: "bg-red-500/10 text-red-300 border-red-500/20",
  critical: "bg-red-600/20 text-red-200 border-red-500/30",
};

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState<string>("7d");
  const [category, setCategory] = useState<string>("");
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    loadData();
  }, [range, category]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [overviewRes, activityRes] = await Promise.all([
        getSettingsOverview(),
        getWorkspaceActivity({
          range,
          category: category || undefined,
          limit: 50,
        }),
      ]);
      setPermissions(overviewRes.currentUser.permissions);
      setEvents(activityRes.events);
      setNextCursor(activityRes.nextCursor);
    } catch (err: any) {
      setError(err.message || "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await getWorkspaceActivity({
        range,
        category: category || undefined,
        limit: 50,
        cursor: nextCursor,
      });
      setEvents((prev) => [...prev, ...res.events]);
      setNextCursor(res.nextCursor);
    } catch (err: any) {
      setError(err.message || "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  if (!loading && !hasPermission(permissions, "settings.read")) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="bg-slate-800/70 text-slate-300 p-4 rounded-lg border border-slate-700">
          {permissionDeniedMessage}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Activity Timeline</h1>
        <p className="text-slate-400 mt-2">
          Workspace-wide activity across memberships, invites, quotas, notifications, and schedulers.
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">{error}</div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                range === r
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="p-8 text-center text-slate-500">Loading activity...</div>
      ) : events.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <div className="text-slate-500 text-lg">No activity found</div>
          <p className="text-slate-600 mt-2 text-sm">
            Try expanding the time range or removing filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${
                      SEVERITY_COLORS[event.severity ?? "info"]
                    }`}>
                      {event.severity ?? "info"}
                    </span>
                    <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-xs border border-slate-700">
                      {CATEGORY_LABELS[event.category] ?? event.category}
                    </span>
                    <h3 className="font-medium text-slate-200 text-sm truncate">{event.title}</h3>
                  </div>
                  <p className="text-slate-400 text-sm mt-1">{event.summary}</p>
                  {event.metadata && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {Object.entries(event.metadata).map(([key, value]) => (
                        <span key={key} className="px-2 py-0.5 bg-slate-800/50 text-slate-400 rounded text-xs">
                          {key}: {String(value ?? "—")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <time className="text-xs text-slate-500 whitespace-nowrap shrink-0">
                  {new Date(event.createdAt).toLocaleString()}
                </time>
              </div>
            </div>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="text-center pt-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
