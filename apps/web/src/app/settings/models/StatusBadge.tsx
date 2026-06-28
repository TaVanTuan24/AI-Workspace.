export function StatusBadge({ isUsable, status }: { isUsable: boolean, status: string }) {
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
