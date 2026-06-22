import { useState } from "react";
import { executeProviderAction } from "../../../lib/api";

interface Action {
  type: string;
  label: string;
  href?: string;
  provider?: string;
  connectionId?: string;
  endpoint?: string;
  method?: string;
  incidentId?: string;
}

interface Step {
  id: string;
  label: string;
  description: string;
  action?: Action;
  safetyNote?: string;
}

interface RunbookView {
  provider: string;
  incidentId?: string;
  status: string;
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  summary: string;
  likelyCauses: string[];
  recommendedSteps: Step[];
  actions: Action[];
}

export function RunbookPanel({ 
  runbook, 
  onClose,
  onActionComplete
}: { 
  runbook: RunbookView, 
  onClose: () => void,
  onActionComplete?: () => void
}) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resultData, setResultData] = useState<any>(null);

  async function handleAction(action: Action) {
    if (action.type === "start_reconnect" || action.type === "open_connection_settings" || action.type === "open_provider_health" || action.type === "open_model_settings") {
      if (action.href) {
        window.location.href = action.href;
      }
      return;
    }

    if (!action.endpoint) return;

    try {
      setLoadingAction(action.type);
      setError("");
      setSuccess("");
      setResultData(null);

      const res = await executeProviderAction(action.endpoint, action.method || "POST");
      setSuccess(`Action "${action.label}" completed successfully.`);
      if (res.data) setResultData(res.data);
      if (onActionComplete && action.type === "mark_incident_resolved") {
        onActionComplete();
        onClose();
      }
    } catch (err: any) {
      setError(`Failed to run ${action.label}: ${err.message || "Unknown error"}`);
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-6">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl max-h-full rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              runbook.severity === 'critical' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' :
              runbook.severity === 'error' ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]' :
              runbook.severity === 'warning' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]' :
              'bg-blue-500'
            }`} />
            <h2 className="text-lg font-semibold text-slate-100">{runbook.title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 w-8 h-8 flex items-center justify-center rounded hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="text-slate-300">
            <p>{runbook.summary}</p>
          </div>

          {(error || success) && (
            <div className={`p-4 rounded-xl border text-sm ${error ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
              <div className="font-semibold mb-1">{error ? "Action Failed" : "Success"}</div>
              {error || success}
              {resultData && (
                <pre className="mt-3 bg-slate-950 p-3 rounded-lg overflow-x-auto text-xs text-slate-300 border border-slate-800/50">
                  {JSON.stringify(resultData, null, 2)}
                </pre>
              )}
            </div>
          )}

          {runbook.likelyCauses.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Likely Causes</h3>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                {runbook.likelyCauses.map((cause, idx) => (
                  <li key={idx}>{cause}</li>
                ))}
              </ul>
            </div>
          )}

          {runbook.recommendedSteps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Recommended Steps</h3>
              <div className="space-y-4">
                {runbook.recommendedSteps.map((step, idx) => (
                  <div key={step.id} className="flex gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/50">
                    <div className="flex shrink-0 items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-slate-400 text-sm font-medium">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-200 font-medium mb-1">{step.label}</div>
                      <div className="text-slate-400 text-sm mb-3">{step.description}</div>
                      {step.safetyNote && (
                        <div className="mb-3 text-xs flex gap-2 items-start text-emerald-400/90 bg-emerald-400/10 p-2.5 rounded-lg border border-emerald-400/20">
                          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                          <span>{step.safetyNote}</span>
                        </div>
                      )}
                      {step.action && (
                        <button
                          onClick={() => handleAction(step.action!)}
                          disabled={loadingAction === step.action!.type}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors border border-slate-700 disabled:opacity-50"
                        >
                          {loadingAction === step.action!.type ? (
                            <>
                              <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                              Running...
                            </>
                          ) : step.action.label}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-800/50 flex justify-end shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
