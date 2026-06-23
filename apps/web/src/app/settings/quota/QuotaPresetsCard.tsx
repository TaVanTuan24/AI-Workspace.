import { useState, useEffect } from "react";
import { getWorkspaceQuotaPresets, applyWorkspaceQuotaPreset, type QuotaPreset } from "../../../lib/api";

export function QuotaPresetsCard({ onApply }: { onApply: () => void }) {
  const [presets, setPresets] = useState<Record<string, QuotaPreset>>({});
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<{ presetId: string, resources: any[] } | null>(null);

  useEffect(() => {
    getWorkspaceQuotaPresets().then(res => {
      setPresets(res.presets);
    }).catch(err => {
      setError(err.message);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  async function handleApply(presetId: string, confirm: boolean = false) {
    try {
      setApplying(presetId);
      setError("");
      setWarning(null);
      await applyWorkspaceQuotaPreset(presetId, confirm);
      onApply();
    } catch (err: any) {
      if (err.isExceededWarning) {
        setWarning({ presetId, resources: err.exceededResources });
      } else {
        setError(err.message || "Failed to apply preset");
      }
    } finally {
      setApplying("");
    }
  }

  if (loading) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-8">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50">
        <h2 className="text-lg font-medium text-slate-200">Quota Presets</h2>
        <p className="mt-1 text-sm text-slate-400">
          Apply a preset to update your workspace resource limits. This does not involve billing.
        </p>
      </div>

      <div className="p-6">
        {error && (
          <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20 mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Object.entries(presets).map(([id, preset]) => (
            <div key={id} className="border border-slate-800 rounded-lg p-6 bg-slate-950/30 flex flex-col relative">
              <h3 className="text-lg font-bold text-slate-100">{preset.label}</h3>
              <p className="text-sm text-slate-400 mt-2 mb-6 flex-grow">{preset.description}</p>
              
              <button
                onClick={() => handleApply(id)}
                disabled={!!applying}
                className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md font-medium transition-colors disabled:opacity-50"
              >
                {applying === id ? "Applying..." : "Apply Preset"}
              </button>
            </div>
          ))}
        </div>

        {warning && (
          <div className="mt-6 bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg">
            <h4 className="text-amber-400 font-medium">Warning: Limits Lower Than Current Usage</h4>
            <p className="text-amber-200/70 text-sm mt-1">
              Applying the <strong>{presets[warning.presetId]?.label}</strong> preset will lower some limits below your current usage. This may prevent users from taking certain actions until usage is reduced.
            </p>
            <ul className="list-disc pl-5 mt-2 text-sm text-slate-300">
              {warning.resources.map((r, i) => (
                <li key={i}>{r.resource}: using {r.used}, new limit will be {r.newLimit}</li>
              ))}
            </ul>
            <div className="mt-4 flex gap-4">
              <button
                onClick={() => handleApply(warning.presetId, true)}
                disabled={!!applying}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium text-sm disabled:opacity-50 transition-colors"
              >
                Confirm and Apply Anyway
              </button>
              <button
                onClick={() => setWarning(null)}
                disabled={!!applying}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium text-sm disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
