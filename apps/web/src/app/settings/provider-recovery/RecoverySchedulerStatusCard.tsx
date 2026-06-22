import type { RecoverySchedulerStatusView } from "../../../lib/api";

export function RecoverySchedulerStatusCard({ status }: { status?: RecoverySchedulerStatusView | null }) {
  const summary = status?.lastSummary;
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Expiry Scheduler</h2>
          <p className="mt-1 text-sm text-slate-500">
            Cleans up expired temporary recovery overrides without calling provider pages.
          </p>
        </div>
        <a
          href="#duration-bound-recovery-overrides"
          className="text-sm text-indigo-300 hover:text-indigo-200"
        >
          View docs
        </a>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric label="Enabled" value={status?.enabled ? "Enabled" : "Disabled"} tone={status?.enabled ? "good" : "muted"} />
        <Metric label="Last status" value={status?.lastStatus ?? "No runs yet"} tone={status?.lastStatus === "failed" ? "bad" : status?.lastStatus === "success" ? "good" : "muted"} />
        <Metric label="Interval" value={status ? `${status.intervalSeconds}s` : "Unknown"} />
        <Metric label="Max per run" value={status ? String(status.maxPerRun) : "Unknown"} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm">
          <div className="text-slate-500">Last started</div>
          <div className="mt-1 text-slate-200">{formatDate(status?.lastStartedAt)}</div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm">
          <div className="text-slate-500">Last finished</div>
          <div className="mt-1 text-slate-200">{formatDate(status?.lastFinishedAt)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <Metric label="Scanned" value={formatNumber(summary?.scanned)} />
        <Metric label="Expired" value={formatNumber(summary?.expired)} />
        <Metric label="Skipped" value={formatNumber(summary?.skipped)} />
        <Metric label="Duration" value={summary?.durationMs !== undefined ? `${summary.durationMs}ms` : "None"} />
        <Metric label="Lock" value={summary?.lock ?? (status?.lastLockAcquired ? "acquired" : "None")} />
      </div>

      {status?.lastError ? (
        <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
          <div className="font-medium">Last sanitized error</div>
          <div className="mt-1 break-words text-red-100/80">{status.lastError}</div>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" | "muted" }) {
  const toneClass =
    tone === "good" ? "text-emerald-300" :
    tone === "bad" ? "text-red-300" :
    tone === "muted" ? "text-slate-400" :
    "text-slate-200";
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm">
      <div className="text-slate-500">{label}</div>
      <div className={`mt-1 font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function formatNumber(value?: number) {
  return value === undefined ? "None" : String(value);
}
