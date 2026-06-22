"use client";

import { useEffect, useState } from "react";
import { getWorkspaces, switchWorkspace, createWorkspace, type WorkspaceMembershipInfo } from "../../lib/api";
import { Check, ChevronsUpDown, Building, Plus, X } from "lucide-react";

export function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<WorkspaceMembershipInfo[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWorkspaces()
      .then((data) => {
        if (!cancelled) {
          setWorkspaces(data.workspaces);
          setCurrentWorkspaceId(data.currentWorkspaceId);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
        <div className="h-8 w-8 animate-pulse rounded-md bg-slate-800" />
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-800" />
          <div className="h-2 w-16 animate-pulse rounded bg-slate-800" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-6 rounded-lg border border-red-900/50 bg-red-900/10 p-3 text-sm text-red-400">
        Failed to load workspaces
      </div>
    );
  }

  if (workspaces.length === 0) {
    return null; // Should not happen in normal flow, but just in case
  }

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId) || workspaces[0];

  const handleSwitch = async (workspaceId: string) => {
    if (workspaceId === currentWorkspaceId || switching) return;
    
    setSwitching(true);
    try {
      await switchWorkspace(workspaceId);
      // Force a full page reload to ensure all state/context is cleanly reset
      // This is the safest approach to prevent cross-workspace data leakage in the UI
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
      setSwitching(false);
      setOpen(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating || !createName.trim()) return;

    setCreating(true);
    setCreateError(null);

    try {
      await createWorkspace(createName.trim());
      window.location.reload();
    } catch (err: any) {
      setCreateError(err.message);
      setCreating(false);
    }
  };

  return (
    <>
      <div className="mb-6 relative">
        <button
          onClick={() => setOpen(!open)}
          disabled={switching}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-left transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-400">
              <Building className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-200">{currentWorkspace.name}</p>
              <p className="text-xs text-slate-500 capitalize">{currentWorkspace.role}</p>
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-500" />
        </button>

        {open && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-md border border-slate-800 bg-slate-900 shadow-xl">
              <div className="max-h-60 overflow-y-auto p-1">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    onClick={() => handleSwitch(workspace.id)}
                    className={`flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-slate-800 ${
                      workspace.id === currentWorkspaceId ? "bg-slate-800 text-indigo-300" : "text-slate-300"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{workspace.name}</div>
                      <div className="text-xs text-slate-500 capitalize">{workspace.role}</div>
                    </div>
                    {workspace.id === currentWorkspaceId && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                ))}
                
                <div className="my-1 border-t border-slate-800" />
                
                <button
                  onClick={() => {
                    setOpen(false);
                    setShowCreateModal(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>Create workspace</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <h2 className="text-lg font-semibold text-slate-100">Create workspace</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                disabled={creating}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="p-4">
              {createError && (
                <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                  {createError}
                </div>
              )}
              
              <div className="mb-6 space-y-2">
                <label htmlFor="workspaceName" className="block text-sm font-medium text-slate-300">
                  Workspace Name
                </label>
                <input
                  id="workspaceName"
                  type="text"
                  required
                  disabled={creating}
                  minLength={2}
                  maxLength={80}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. My Team, Personal"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !createName.trim()}
                  className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
