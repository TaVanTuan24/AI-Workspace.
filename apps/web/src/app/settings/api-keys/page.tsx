"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { 
  apiGetApiKeys, 
  apiCreateApiKey, 
  revokeApiKey, 
  apiRotateApiKey, 
  apiUpdateApiKeyScopes, 
  apiUpdateApiKeyRateLimit,
  ApiKey, 
  apiGetModelPreferences, 
  ModelPreferenceView,
  getWorkspaceNotifications,
  getSettingsOverview,
  hasPermission,
  permissionDeniedMessage,
  type WorkspaceNotification,
  type WorkspacePermission
} from "../../../lib/api";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [allModels, setAllModels] = useState<ModelPreferenceView[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);

  const [createScopeMode, setCreateScopeMode] = useState<"all" | "restricted">("all");
  const [createAllowedModels, setCreateAllowedModels] = useState<Set<string>>(new Set());

  const [createRateLimitMode, setCreateRateLimitMode] = useState<"default" | "custom">("default");
  const [createRateLimit, setCreateRateLimit] = useState<string>("30");

  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editAllowedModels, setEditAllowedModels] = useState<Set<string>>(new Set());
  const [editScopeMode, setEditScopeMode] = useState<"all" | "restricted">("all");
  const [isSavingScopes, setIsSavingScopes] = useState(false);

  const [editingRateLimitKeyId, setEditingRateLimitKeyId] = useState<string | null>(null);
  const [editRateLimitMode, setEditRateLimitMode] = useState<"default" | "custom">("default");
  const [editRateLimit, setEditRateLimit] = useState<string>("30");
  const [isSavingRateLimit, setIsSavingRateLimit] = useState(false);


  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [keysRes, modelsRes, notificationRes, overviewRes] = await Promise.all([
        apiGetApiKeys(),
        apiGetModelPreferences().catch(() => ({ models: [] })),
        getWorkspaceNotifications().catch(() => ({ notifications: [] })),
        getSettingsOverview()
      ]);
      setKeys(keysRes.keys);
      setAllModels(modelsRes.models);
      setNotifications(notificationRes.notifications);
      setPermissions(overviewRes.currentUser.permissions);
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!canWriteApiKeys) {
      setError(permissionDeniedMessage);
      return;
    }
    if (!newName.trim()) return;
    try {
      setIsCreating(true);
      setError("");
      const allowedModelIds = createScopeMode === "restricted" ? Array.from(createAllowedModels) : undefined;
      const rateLimitPerMinute = createRateLimitMode === "custom" ? parseInt(createRateLimit, 10) : undefined;
      const res = await apiCreateApiKey(newName.trim(), allowedModelIds, rateLimitPerMinute);
      setNewRawKey(res.rawKey);
      setNewName("");
      setCreateScopeMode("all");
      setCreateAllowedModels(new Set());
      setCreateRateLimitMode("default");
      setCreateRateLimit("30");
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to create key");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!canWriteApiKeys) {
      setError(permissionDeniedMessage);
      return;
    }
    if (!confirm("Are you sure you want to revoke this API key?")) return;
    try {
      await revokeApiKey(id);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to revoke key");
    }
  }

  async function handleRotate(id: string) {
    if (!canWriteApiKeys) {
      setError(permissionDeniedMessage);
      return;
    }
    if (!confirm("Are you sure you want to rotate this key? The old key will stop working immediately.")) return;
    try {
      const res = await apiRotateApiKey(id, true); // preserve scopes
      setNewRawKey(res.rawKey);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to rotate key");
    }
  }

  function handleCopyNewKey() {
    if (newRawKey) {
      navigator.clipboard.writeText(newRawKey);
    }
  }

  function openEditScopes(key: ApiKey) {
    if (!canWriteApiKeys) {
      setError(permissionDeniedMessage);
      return;
    }
    setEditingKeyId(key.id);
    setEditScopeMode(key.scopeMode === "restricted" ? "restricted" : "all");
    setEditAllowedModels(new Set(key.allowedModels || []));
  }

  async function saveEditedScopes() {
    if (!canWriteApiKeys) {
      setError(permissionDeniedMessage);
      return;
    }
    if (!editingKeyId) return;
    try {
      setIsSavingScopes(true);
      setError("");
      const allowedModelIds = editScopeMode === "restricted" ? Array.from(editAllowedModels) : [];
      await apiUpdateApiKeyScopes(editingKeyId, allowedModelIds);
      setEditingKeyId(null);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to save scopes");
    } finally {
      setIsSavingScopes(false);
    }
  }

  function openEditRateLimit(key: ApiKey) {
    if (!canWriteApiKeys) {
      setError(permissionDeniedMessage);
      return;
    }
    setEditingRateLimitKeyId(key.id);
    if (key.rateLimitPerMinute !== null && key.rateLimitPerMinute !== undefined) {
      setEditRateLimitMode("custom");
      setEditRateLimit(key.rateLimitPerMinute.toString());
    } else {
      setEditRateLimitMode("default");
      setEditRateLimit("30");
    }
  }

  async function saveEditedRateLimit() {
    if (!canWriteApiKeys) {
      setError(permissionDeniedMessage);
      return;
    }
    if (!editingRateLimitKeyId) return;
    try {
      setIsSavingRateLimit(true);
      setError("");
      const limit = editRateLimitMode === "custom" ? parseInt(editRateLimit, 10) : null;
      await apiUpdateApiKeyRateLimit(editingRateLimitKeyId, limit);
      setEditingRateLimitKeyId(null);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to save rate limit");
    } finally {
      setIsSavingRateLimit(false);
    }
  }

  const noUsableProviderWarning = notifications.find((notification) => notification.kind === "no_usable_models");
  const canWriteApiKeys = hasPermission(permissions, "apiKeys.write");

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">API Keys</h1>
        <p className="text-slate-400 mt-2">
          API keys allow external tools to call your connected AI providers through this workspace. Keep them secret. You will only see a key once. Revoke keys you no longer use.
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">
          {error}
        </div>
      )}

      {!canWriteApiKeys && !loading && (
        <div className="bg-slate-800/70 text-slate-300 p-4 rounded-lg border border-slate-700">
          You don't have permission to perform this action.
        </div>
      )}


      {noUsableProviderWarning && (
        <div className="bg-amber-500/10 text-amber-300 p-4 rounded-lg border border-amber-500/20">
          <div className="font-medium">{noUsableProviderWarning.title}</div>
          <p className="mt-1 text-sm text-amber-200/80">
            {noUsableProviderWarning.message} API keys can still be managed, but OpenAI-compatible requests will fail until a provider is usable.
          </p>
          <Link
            href={noUsableProviderWarning.action?.href ?? "/connections"}
            className="mt-3 inline-flex rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-500/20"
          >
            {noUsableProviderWarning.action?.label ?? "Open connections"}
          </Link>
        </div>
      )}

      {newRawKey && (
        <div className="bg-emerald-500/10 text-emerald-300 p-6 rounded-lg border border-emerald-500/20 space-y-4">
          <h2 className="font-semibold text-lg text-emerald-200">New API Key Created!</h2>
          <p className="text-sm">Please copy this key and save it somewhere safe. <strong>You will not be able to see it again.</strong></p>
          <div className="flex gap-2 items-center bg-black/30 p-2 rounded">
            <code className="flex-1 font-mono break-all text-emerald-100">{newRawKey}</code>
            <button 
              onClick={handleCopyNewKey}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded text-sm transition-colors whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <button 
            onClick={() => setNewRawKey(null)}
            className="text-emerald-400 hover:text-emerald-300 text-sm mt-2 underline"
          >
            I have saved the key, close this
          </button>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex flex-col md:flex-row gap-4 items-start md:items-end">
          <div className="flex-1 space-y-4 w-full">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Create new API key</label>
              <input 
                type="text" 
                value={newName}
                onChange={e => setNewName(e.target.value)}
                disabled={!canWriteApiKeys}
                placeholder="e.g. OpenWebUI Local"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
              />
            </div>
            
            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 space-y-3">
              <div className="text-sm font-medium text-slate-300">Model Scope</div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="createScope" checked={createScopeMode === "all"} onChange={() => setCreateScopeMode("all")} className="text-indigo-500 bg-slate-900 border-slate-700" />
                  <span className="text-sm text-slate-300">All enabled models</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="createScope" checked={createScopeMode === "restricted"} onChange={() => setCreateScopeMode("restricted")} className="text-indigo-500 bg-slate-900 border-slate-700" />
                  <span className="text-sm text-slate-300">Restricted</span>
                </label>
              </div>
              
              {createScopeMode === "restricted" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  {allModels.map(m => (
                    <label key={m.modelId} className="flex items-center gap-2 cursor-pointer bg-slate-900 p-2 rounded border border-slate-800">
                      <input 
                        type="checkbox" 
                        checked={createAllowedModels.has(m.modelId)}
                        onChange={(e) => {
                          const next = new Set(createAllowedModels);
                          if (e.target.checked) next.add(m.modelId);
                          else next.delete(m.modelId);
                          setCreateAllowedModels(next);
                        }}
                        className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-300">{m.displayName}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 space-y-3">
              <div className="text-sm font-medium text-slate-300">Rate Limit (per minute)</div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="createRateLimit" checked={createRateLimitMode === "default"} onChange={() => setCreateRateLimitMode("default")} className="text-indigo-500 bg-slate-900 border-slate-700" />
                  <span className="text-sm text-slate-300">Workspace Default</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="createRateLimit" checked={createRateLimitMode === "custom"} onChange={() => setCreateRateLimitMode("custom")} className="text-indigo-500 bg-slate-900 border-slate-700" />
                  <span className="text-sm text-slate-300">Custom</span>
                </label>
              </div>
              
              {createRateLimitMode === "custom" && (
                <div className="mt-2">
                  <input 
                    type="number" 
                    min="1"
                    value={createRateLimit}
                    onChange={e => setCreateRateLimit(e.target.value)}
                    className="w-32 bg-slate-900 border border-slate-700 rounded px-3 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}
            </div>
          </div>
          <button 
            onClick={handleCreate}
            disabled={isCreating || !newName.trim() || !canWriteApiKeys}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors h-[42px]"
          >
            Create Key
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading keys...</div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No API keys found. Create one above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4 font-medium">NAME</th>
                  <th className="px-6 py-4 font-medium">KEY</th>
                  <th className="px-6 py-4 font-medium">SCOPES</th>
                  <th className="px-6 py-4 font-medium">RATE LIMIT</th>
                  <th className="px-6 py-4 font-medium">CREATED</th>
                  <th className="px-6 py-4 font-medium">LAST USED</th>
                  <th className="px-6 py-4 font-medium text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {keys.map(key => (
                  <tr key={key.id} className={key.status === "revoked" ? "opacity-50" : ""}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-slate-200">{key.name}</div>
                      {key.status === "revoked" && (
                         <span className="inline-block mt-1 px-2 py-0.5 bg-red-500/10 text-red-400 rounded text-xs">Revoked</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs">
                      {key.keyPrefix}...{key.keyLast4}
                    </td>
                    <td className="px-6 py-4">
                      {key.scopeMode === "all_enabled_models" ? (
                        <span className="text-slate-400">All enabled</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {key.allowedModels.map(m => {
                            const name = allModels.find(x => x.modelId === m)?.displayName || m;
                            return <span key={m} className="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 rounded text-xs border border-indigo-500/20">{name}</span>;
                          })}
                          {key.allowedModels.length === 0 && <span className="text-slate-500 italic">None</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {key.rateLimitPerMinute === null || key.rateLimitPerMinute === undefined ? (
                        <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-xs border border-slate-700">Default ({key.effectiveRateLimitPerMinute}/min)</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-300 rounded text-xs border border-emerald-500/20">Custom {key.rateLimitPerMinute}/min</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {new Date(key.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right space-x-3">
                      {key.status === "active" && (
                        <>
                          <button 
                            onClick={() => openEditScopes(key)}
                            disabled={!canWriteApiKeys}
                            className="text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40"
                          >
                            Scopes
                          </button>
                          <button 
                            onClick={() => openEditRateLimit(key)}
                            disabled={!canWriteApiKeys}
                            className="text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40"
                          >
                            Limit
                          </button>
                          <button 
                            onClick={() => handleRotate(key.id)}
                            disabled={!canWriteApiKeys}
                            className="text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40"
                          >
                            Rotate
                          </button>
                          <button 
                            onClick={() => handleRevoke(key.id)}
                            disabled={!canWriteApiKeys}
                            className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingKeyId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full space-y-6">
            <h3 className="text-xl font-bold text-slate-100">Edit Key Scopes</h3>
            
            <div className="space-y-4">
              <div className="flex gap-4 border-b border-slate-800 pb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="editScope" checked={editScopeMode === "all"} onChange={() => setEditScopeMode("all")} className="text-indigo-500 bg-slate-900 border-slate-700" />
                  <span className="text-sm text-slate-300">All enabled models</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="editScope" checked={editScopeMode === "restricted"} onChange={() => setEditScopeMode("restricted")} className="text-indigo-500 bg-slate-900 border-slate-700" />
                  <span className="text-sm text-slate-300">Restricted</span>
                </label>
              </div>
              
              {editScopeMode === "restricted" && (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                  {allModels.map(m => (
                    <label key={m.modelId} className="flex items-center gap-3 cursor-pointer bg-slate-800/50 p-3 rounded border border-slate-800 hover:bg-slate-800 transition-colors">
                      <input 
                        type="checkbox" 
                        checked={editAllowedModels.has(m.modelId)}
                        onChange={(e) => {
                          const next = new Set(editAllowedModels);
                          if (e.target.checked) next.add(m.modelId);
                          else next.delete(m.modelId);
                          setEditAllowedModels(next);
                        }}
                        className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                      />
                      <span className="text-slate-200 font-medium">{m.displayName}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button 
                onClick={() => setEditingKeyId(null)}
                className="px-4 py-2 text-slate-400 hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={saveEditedScopes}
                disabled={isSavingScopes}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
              >
                {isSavingScopes ? "Saving..." : "Save Scopes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingRateLimitKeyId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full space-y-6">
            <h3 className="text-xl font-bold text-slate-100">Edit Rate Limit</h3>
            
            <div className="space-y-4">
              <div className="flex gap-4 border-b border-slate-800 pb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="editRateLimit" checked={editRateLimitMode === "default"} onChange={() => setEditRateLimitMode("default")} className="text-indigo-500 bg-slate-900 border-slate-700" />
                  <span className="text-sm text-slate-300">Workspace Default</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="editRateLimit" checked={editRateLimitMode === "custom"} onChange={() => setEditRateLimitMode("custom")} className="text-indigo-500 bg-slate-900 border-slate-700" />
                  <span className="text-sm text-slate-300">Custom</span>
                </label>
              </div>
              
              {editRateLimitMode === "custom" && (
                <div className="mt-2">
                  <label className="block text-sm font-medium text-slate-300 mb-1">Requests per minute</label>
                  <input 
                    type="number" 
                    min="1"
                    value={editRateLimit}
                    onChange={e => setEditRateLimit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button 
                onClick={() => setEditingRateLimitKeyId(null)}
                className="px-4 py-2 text-slate-400 hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={saveEditedRateLimit}
                disabled={isSavingRateLimit}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
              >
                {isSavingRateLimit ? "Saving..." : "Save Rate Limit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
