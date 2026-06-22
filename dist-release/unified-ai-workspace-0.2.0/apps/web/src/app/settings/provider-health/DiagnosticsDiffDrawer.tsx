import { useEffect, useState } from "react";
import { diffProviderDiagnosticsRuns } from "../../../lib/api";

export function DiagnosticsDiffDrawer({ leftRunId, rightRunId, onClose }: { leftRunId: string, rightRunId: string, onClose: () => void }) {
  const [diff, setDiff] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadDiff();
  }, [leftRunId, rightRunId]);

  async function loadDiff() {
    try {
      setLoading(true);
      setError("");
      const res = await diffProviderDiagnosticsRuns(leftRunId, rightRunId);
      setDiff(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to load diff");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-end z-50">
      <div className="bg-slate-900 border-l border-slate-700 w-full max-w-xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-800/50">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Diagnostics Diff</h2>
            <div className="text-sm text-slate-400 mt-1 flex gap-2">
              <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-xs">{leftRunId.split("-")[0]}</span>
              <span>vs</span>
              <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-xs">{rightRunId.split("-")[0]}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 w-8 h-8 flex items-center justify-center rounded hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {loading ? (
            <div className="text-slate-500 animate-pulse">Computing diff...</div>
          ) : error ? (
            <div className="p-4 bg-red-500/10 text-red-400 rounded border border-red-500/20">{error}</div>
          ) : diff ? (
            <div className="space-y-8">
              
              {/* Overview */}
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Overview</h3>
                <div className="bg-slate-800/30 p-4 rounded-xl border border-slate-800 space-y-2 text-sm text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Provider</span>
                    <span className="uppercase tracking-wider font-medium text-slate-200">{diff.provider}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status Change</span>
                    <span className={diff.changedStatus ? "text-amber-400 font-medium" : "text-slate-500"}>
                      {diff.changedStatus ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Detected Capabilities */}
              {(diff.addedDetectedCapabilities.length > 0 || diff.removedDetectedCapabilities.length > 0) && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Capabilities Detected</h3>
                  <div className="bg-slate-800/30 rounded-xl border border-slate-800 overflow-hidden text-sm divide-y divide-slate-800/50">
                    {diff.addedDetectedCapabilities.map((c: string) => (
                      <div key={c} className="p-3 flex items-center gap-3 bg-emerald-500/5">
                        <span className="text-emerald-500 font-bold">+</span>
                        <span className="text-slate-300">{c}</span>
                      </div>
                    ))}
                    {diff.removedDetectedCapabilities.map((c: string) => (
                      <div key={c} className="p-3 flex items-center gap-3 bg-red-500/5">
                        <span className="text-red-500 font-bold">-</span>
                        <span className="text-slate-300 line-through opacity-70">{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing Capabilities */}
              {(diff.addedMissingCapabilities.length > 0 || diff.removedMissingCapabilities.length > 0) && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Capabilities Missing</h3>
                  <div className="bg-slate-800/30 rounded-xl border border-slate-800 overflow-hidden text-sm divide-y divide-slate-800/50">
                    {diff.addedMissingCapabilities.map((c: string) => (
                      <div key={c} className="p-3 flex items-center gap-3 bg-red-500/5">
                        <span className="text-red-500 font-bold">+</span>
                        <span className="text-slate-300">Now missing: {c}</span>
                      </div>
                    ))}
                    {diff.removedMissingCapabilities.map((c: string) => (
                      <div key={c} className="p-3 flex items-center gap-3 bg-emerald-500/5">
                        <span className="text-emerald-500 font-bold">-</span>
                        <span className="text-slate-300 opacity-70">No longer missing: {c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Selector Hints */}
              {diff.changedSelectorHints.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">DOM Drift (Selector Hints)</h3>
                  <div className="space-y-3">
                    {diff.changedSelectorHints.map((hint: any) => (
                      <div key={hint.key} className="bg-slate-800/30 p-4 rounded-xl border border-slate-800 text-sm">
                        <div className="font-medium text-slate-200 mb-2">{hint.key}</div>
                        {hint.before && (
                          <div className="text-red-400 bg-red-500/10 p-2 rounded border border-red-500/10 mb-2 font-mono text-xs overflow-x-auto whitespace-pre">
                            - {hint.before}
                          </div>
                        )}
                        {hint.after && (
                          <div className="text-emerald-400 bg-emerald-500/10 p-2 rounded border border-emerald-500/10 font-mono text-xs overflow-x-auto whitespace-pre">
                            + {hint.after}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diff.addedDetectedCapabilities.length === 0 && diff.removedDetectedCapabilities.length === 0 && diff.addedMissingCapabilities.length === 0 && diff.removedMissingCapabilities.length === 0 && diff.changedSelectorHints.length === 0 && (
                <div className="text-slate-500 italic p-4 bg-slate-800/20 rounded-xl border border-slate-800 text-center">
                  No structural differences found between these two runs.
                </div>
              )}

            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
