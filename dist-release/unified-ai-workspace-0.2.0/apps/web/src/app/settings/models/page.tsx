"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { 
  apiGetModelPreferences, 
  apiUpdateModelPreferences, 
  refreshProviderHealth,
  getLiveSubModels,
  refreshLiveSubModels,
  type ModelPreferenceView, 
  type ModelPreferencesResponse 
} from "../../../lib/api";
import { StatusBadge } from "./StatusBadge";

export default function ModelPreferencesPage() {
  const [data, setData] = useState<ModelPreferencesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [modelsState, setModelsState] = useState<ModelPreferenceView[]>([]);
  const [liveModels, setLiveModels] = useState<Record<string, any[]>>({});
  const [autoSelectState, setAutoSelectState] = useState(true);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [detecting, setDetecting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [res, liveRes] = await Promise.all([
        apiGetModelPreferences(),
        getLiveSubModels().catch(() => ({ providers: [] }))
      ]);
      setData(res);
      setModelsState(res.models);
      setAutoSelectState(res.autoSelectFirstUsable);
      
      const liveMap: Record<string, any[]> = {};
      if (liveRes && liveRes.providers) {
        for (const p of liveRes.providers) {
          liveMap[p.provider] = p.subModels || [];
        }
      }
      setLiveModels(liveMap);
    } catch (err: any) {
      setError(err.message || "Failed to load model preferences");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");
      const res = await apiUpdateModelPreferences({
        autoSelectFirstUsable: autoSelectState,
        models: modelsState.map(m => ({
          modelId: m.modelId,
          enabled: m.enabled,
          isDefault: m.isDefault,
          priority: m.priority,
          selectedSubModelId: m.selectedSubModelId
        }))
      });
      setData(res);
      setModelsState(res.models);
      setAutoSelectState(res.autoSelectFirstUsable);
      setSuccessMsg("Settings saved successfully.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshSingle(provider: string) {
    try {
      setRefreshing(prev => ({ ...prev, [provider]: true }));
      setError("");
      const health = await refreshProviderHealth(provider);
      
      setModelsState(prev => prev.map(m => {
        if (m.provider === provider) {
          return {
            ...m,
            healthStatus: health.healthStatus,
            isUsable: health.isUsable,
            readiness: health.readiness,
            requiresLogin: health.requiresLogin,
            capabilities: health.capabilities
          };
        }
        return m;
      }));
    } catch (err: any) {
      setError(err.message || `Failed to refresh ${provider}`);
    } finally {
      setRefreshing(prev => ({ ...prev, [provider]: false }));
    }
  }

  async function handleDetectLive(provider: string) {
    try {
      setDetecting(prev => ({ ...prev, [provider]: true }));
      setError("");
      const res = await refreshLiveSubModels(provider as any);
      setLiveModels(prev => ({ ...prev, [provider]: res.subModels || [] }));
      setSuccessMsg(`Detected models for ${provider}`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setError(err.message || `Failed to detect live models for ${provider}`);
    } finally {
      setDetecting(prev => ({ ...prev, [provider]: false }));
    }
  }

  function handleDefaultChange(modelId: string) {
    setModelsState(prev => prev.map(m => ({
      ...m,
      isDefault: m.modelId === modelId,
      // Ensure the default model is enabled
      enabled: m.modelId === modelId ? true : m.enabled
    })));
  }

  function handleToggleEnabled(modelId: string, checked: boolean) {
    setModelsState(prev => prev.map(m => {
      if (m.modelId === modelId) {
        return {
          ...m,
          enabled: checked,
          // Cannot disable the default model directly without changing default first
          isDefault: checked ? m.isDefault : false
        };
      }
      // If we disabled the default model, we might want to auto-assign default, but let user handle it or save handles it
      return m;
    }));
  }

  function handlePriorityChange(modelId: string, val: number) {
    setModelsState(prev => prev.map(m => 
      m.modelId === modelId ? { ...m, priority: val } : m
    ));
  }

  function handleVariantChange(modelId: string, subModelId: string) {
    setModelsState(prev => prev.map(m => 
      m.modelId === modelId ? { ...m, selectedSubModelId: subModelId } : m
    ));
  }

  const allDisabled = modelsState.every(m => !m.enabled);
  const noDefault = !modelsState.some(m => m.isDefault);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">Model Preferences</h1>
          <p className="text-slate-400 mt-2">
            Configure which models are enabled, their selection priorities, and default behaviors for chat and the internal API.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={loading || saving}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Preferences"}
        </button>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-500/10 text-emerald-400 p-4 rounded-lg border border-emerald-500/20">
          {successMsg}
        </div>
      )}
      {(allDisabled || noDefault) && !loading && (
        <div className="bg-amber-500/10 text-amber-400 p-4 rounded-lg border border-amber-500/20">
          <strong>Warning:</strong> You must have at least one enabled default model for auto-selection and single-chat mode to work properly.
        </div>
      )}

      {loading ? (
        <div className="text-slate-500">Loading preferences...</div>
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={autoSelectState}
                onChange={(e) => setAutoSelectState(e.target.checked)}
                className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
              />
              <div>
                <div className="font-medium text-slate-200">Auto-select first usable provider</div>
                <div className="text-sm text-slate-500">If your default model is offline or disconnected, the system will automatically fallback to the highest priority usable model.</div>
              </div>
            </label>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-sm font-medium text-slate-400">
                  <th className="p-4 font-medium">Model</th>
                  <th className="p-4 font-medium text-center">Enabled</th>
                  <th className="p-4 font-medium text-center">Default</th>
                  <th className="p-4 font-medium">Priority</th>
                  <th className="p-4 font-medium">Variant</th>
                  <th className="p-4 font-medium">Usability</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {modelsState.sort((a, b) => a.priority - b.priority).map(model => (
                  <tr key={model.modelId} className="hover:bg-slate-800/20 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-slate-200">{model.displayName}</div>
                      <div className="text-xs text-slate-500 font-mono mt-1">{model.modelId}</div>
                    </td>
                    <td className="p-4 text-center">
                      <input 
                        type="checkbox"
                        checked={model.enabled}
                        onChange={(e) => handleToggleEnabled(model.modelId, e.target.checked)}
                        className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900 cursor-pointer"
                      />
                    </td>
                    <td className="p-4 text-center">
                      <input 
                        type="radio"
                        name="defaultModel"
                        checked={model.isDefault}
                        onChange={() => handleDefaultChange(model.modelId)}
                        className="w-5 h-5 border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900 cursor-pointer"
                      />
                    </td>
                    <td className="p-4">
                      <input 
                        type="number" 
                        value={model.priority}
                        onChange={(e) => handlePriorityChange(model.modelId, parseInt(e.target.value) || 0)}
                        className="w-20 bg-slate-950 border border-slate-700 rounded-md px-3 py-1.5 text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </td>
                    <td className="p-4">
                      {(() => {
                        const staticOpts = model.subModels || [];
                        const liveOpts = liveModels[model.provider] || [];
                        const mergedIds = new Set(staticOpts.map(s => s.id));
                        const mergedOpts = [...staticOpts];
                        for (const l of liveOpts) {
                          if (!mergedIds.has(l.id)) mergedOpts.push(l);
                        }

                        if (mergedOpts.length > 0) {
                          return (
                            <select
                              value={model.selectedSubModelId || "current"}
                              onChange={(e) => handleVariantChange(model.modelId, e.target.value)}
                              className="bg-slate-950 border border-slate-700 rounded-md px-3 py-1.5 text-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full max-w-[200px]"
                            >
                              {mergedOpts.map(sm => (
                                <option key={sm.id} value={sm.id}>
                                  {sm.label} {mergedIds.has(sm.id) ? "" : "(Live)"}
                                </option>
                              ))}
                            </select>
                          );
                        }
                        return <span className="text-xs text-slate-500 italic">Default only</span>;
                      })()}
                    </td>
                    <td className="p-4">
                      <StatusBadge isUsable={model.isUsable} status={model.healthStatus} recovery={model.recovery} />
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2 flex-wrap max-w-[150px] ml-auto">
                        <button
                          onClick={() => handleDetectLive(model.provider)}
                          disabled={detecting[model.provider] || model.requiresLogin}
                          title="Detect Live UI Models"
                          className="text-xs px-2 py-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 rounded-md transition-colors disabled:opacity-50"
                        >
                          {detecting[model.provider] ? "Detecting..." : "Detect Models"}
                        </button>
                        {model.requiresLogin && (
                           <Link
                             href="/settings/connections"
                             className="text-xs px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md transition-colors"
                           >
                             Connect
                           </Link>
                        )}
                        <button
                          onClick={() => handleRefreshSingle(model.provider)}
                          disabled={refreshing[model.provider]}
                          className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors disabled:opacity-50"
                        >
                          {refreshing[model.provider] ? "Validating..." : "Validate"}
                        </button>
                      </div>
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
