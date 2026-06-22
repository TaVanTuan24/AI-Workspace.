import { useState, useEffect } from "react";
import { getProviderHealthIncidents, resolveProviderHealthIncident, getProviderHealthIncidentRunbook, type ProviderHealthIncidentView } from "../../../lib/api";
import { RunbookPanel } from "./RunbookPanel";

export function IncidentTimeline() {
  const [incidents, setIncidents] = useState<ProviderHealthIncidentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterProvider, setFilterProvider] = useState("");

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const [activeRunbook, setActiveRunbook] = useState<any>(null);
  const [loadingRunbookId, setLoadingRunbookId] = useState<string | null>(null);

  useEffect(() => {
    loadIncidents();
  }, [filterStatus, filterSeverity, filterProvider]);

  async function loadIncidents() {
    try {
      setLoading(true);
      setError("");
      const res = await getProviderHealthIncidents({
        status: filterStatus === "all" ? undefined : filterStatus,
        severity: filterSeverity || undefined,
        provider: filterProvider || undefined,
        limit: 100
      });
      setIncidents(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(id: string) {
    if (!resolvingId) {
      setResolvingId(id);
      return;
    }

    try {
      setError("");
      await resolveProviderHealthIncident(id, "ignored", resolveNote);
      setResolvingId(null);
      setResolveNote("");
      loadIncidents();
    } catch (err: any) {
      setError(err.message || "Failed to resolve incident");
    }
  }

  async function handleOpenRunbook(id: string) {
    try {
      setLoadingRunbookId(id);
      setError("");
      const res = await getProviderHealthIncidentRunbook(id);
      setActiveRunbook(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load runbook");
    } finally {
      setLoadingRunbookId(null);
    }
  }

  const openCount = incidents.filter(i => !i.resolvedAt).length;
  const criticalCount = incidents.filter(i => !i.resolvedAt && i.severity === "critical").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Open Incidents</div>
          <div className="text-3xl font-bold text-slate-100 mt-1">{openCount}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Critical Issues</div>
          <div className="text-3xl font-bold text-red-400 mt-1">{criticalCount}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Most Affected</div>
          <div className="text-xl font-bold text-slate-300 mt-2 truncate">
            {incidents.length > 0 ? incidents[0].provider : "None"}
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <select 
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select 
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          value={filterSeverity}
          onChange={e => setFilterSeverity(e.target.value)}
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm">Loading timeline...</div>
      ) : incidents.length === 0 ? (
        <div className="text-slate-500 text-center py-12 border border-slate-800 border-dashed rounded-xl">
          No incidents found.
        </div>
      ) : (
        <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-800 before:to-transparent">
          {incidents.map(inc => (
            <div key={inc.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-slate-950 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm ${
                !inc.resolvedAt ? (inc.severity === 'critical' ? 'bg-red-500' : inc.severity === 'error' ? 'bg-orange-500' : 'bg-amber-500') : 'bg-slate-700'
              }`}>
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono bg-slate-950 px-2 py-1 rounded text-slate-400">{inc.provider}</span>
                  <time className="text-xs text-slate-500">{new Date(inc.startedAt).toLocaleString()}</time>
                </div>
                <h3 className="font-semibold text-slate-200 capitalize mb-1">{inc.status.replace(/_/g, " ")}</h3>
                {inc.reason && <p className="text-sm text-slate-400 line-clamp-2 mb-3">{inc.reason}</p>}
                
                <div className="flex items-center justify-between mt-4">
                  <div className="text-xs text-slate-500 flex gap-3">
                    <span>{inc.occurrenceCount} {inc.occurrenceCount === 1 ? 'occurrence' : 'occurrences'}</span>
                  </div>
                  {inc.resolvedAt ? (
                    <span className="text-xs text-emerald-500 font-medium bg-emerald-500/10 px-2 py-1 rounded">Resolved</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleOpenRunbook(inc.id)} 
                        disabled={loadingRunbookId === inc.id}
                        className="text-xs text-blue-400 hover:text-blue-300 font-medium px-2 py-1 bg-slate-800 rounded flex items-center gap-1 disabled:opacity-50"
                      >
                        {loadingRunbookId === inc.id ? "Loading..." : "View Runbook"}
                      </button>
                      {resolvingId === inc.id ? (
                        <div className="flex items-center gap-2">
                          <input 
                            type="text" 
                            className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 w-32 focus:outline-none focus:border-slate-700" 
                            placeholder="Reason (optional)" 
                            value={resolveNote}
                            onChange={e => setResolveNote(e.target.value)}
                          />
                          <button onClick={() => handleResolve(inc.id)} className="text-xs text-emerald-400 hover:text-emerald-300 font-medium px-2 py-1 bg-slate-800 rounded">Save</button>
                          <button onClick={() => setResolvingId(null)} className="text-xs text-slate-400 hover:text-slate-300">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => handleResolve(inc.id)} className="text-xs text-slate-400 hover:text-slate-300 font-medium px-2 py-1 bg-slate-800 rounded">Mark Resolved</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeRunbook && (
        <RunbookPanel 
          runbook={activeRunbook} 
          onClose={() => setActiveRunbook(null)}
          onActionComplete={() => loadIncidents()}
        />
      )}
    </div>
  );
}
