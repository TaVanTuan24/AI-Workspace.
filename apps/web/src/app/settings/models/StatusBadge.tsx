import type { ModelPreferenceView } from "../../../lib/api";

export function StatusBadge({ isUsable, status, recovery }: { isUsable: boolean, status: string, recovery?: ModelPreferenceView["recovery"] }) {
  if (recovery?.temporarilyDisabled) {
    return (
      <span className="inline-flex flex-col gap-0.5 rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300">
        <span>Temporarily Disabled</span>
        {recovery.disabledUntil ? <span className="font-normal text-red-200/70">Until {new Date(recovery.disabledUntil).toLocaleString()}</span> : null}
      </span>
    );
  }
  if (recovery?.providerDegraded) {
    return (
      <span className="inline-flex flex-col gap-0.5 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-300">
        <span>{recovery.degradedMode === "block_for_duration" ? "Blocked by Recovery" : "Degraded"}</span>
        {recovery.degradedUntil ? <span className="font-normal text-amber-200/70">Until {new Date(recovery.degradedUntil).toLocaleString()}</span> : null}
      </span>
    );
  }
  if (isUsable) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Usable</span>;
  }
  if (status === "requires_login" || status === "expired") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Login Required</span>;
  }
  if (status === "not_connected") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">Not Connected</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 capitalize">{status.replace('_', ' ')}</span>;
}
