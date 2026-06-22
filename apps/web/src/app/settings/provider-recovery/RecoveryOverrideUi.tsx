import { RotateCcw } from "lucide-react";
import type {
  ProviderRecoveryActionType,
  ProviderRecoveryOverrideView
} from "../../../lib/api";

const providerOptions = ["chatgpt", "gemini", "grok"];

export function RecoveryOverrideTable({
  overrides,
  onRollback,
  canRollback = true
}: {
  overrides: ProviderRecoveryOverrideView[];
  onRollback: (overrideId: string) => Promise<void> | void;
  canRollback?: boolean;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800 text-sm">
        <thead className="bg-slate-950 text-left text-slate-400">
          <tr>
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Target</th>
            <th className="px-3 py-2 font-medium">Reason</th>
            <th className="px-3 py-2 font-medium">Expires</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Manage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 bg-slate-950/30 text-slate-300">
          {overrides.length === 0 ? (
            <tr><td colSpan={6} className="px-3 py-4 text-slate-500">No recovery overrides yet.</td></tr>
          ) : overrides.map((override) => (
            <tr key={override.id}>
              <td className="px-3 py-2">{override.actionType}</td>
              <td className="px-3 py-2">
                <div>{override.modelId ?? override.provider ?? "workspace"}</div>
                {override.subModelId ? <div className="text-xs text-slate-500">{override.subModelId}</div> : null}
              </td>
              <td className="px-3 py-2">{override.reason ?? override.safeSummary ?? "Temporary recovery override"}</td>
              <td className="px-3 py-2">{new Date(override.expiresAt).toLocaleString()}</td>
              <td className="px-3 py-2 capitalize">{override.status.replace("_", " ")}</td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  disabled={override.status !== "active" || !canRollback}
                  onClick={() => void onRollback(override.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Rollback
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActionConfigFields({
  type,
  action,
  onChange
}: {
  type: ProviderRecoveryActionType;
  action?: { config?: Record<string, unknown> };
  onChange: (config: Record<string, unknown>) => void;
}) {
  const config = action?.config ?? {};
  const update = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  if (!["mark_provider_temporarily_degraded", "prefer_fallback_provider", "disable_model_temporarily"].includes(type)) return null;

  return (
    <div className="mt-3 grid gap-3 rounded-md border border-slate-800 bg-slate-900/60 p-3">
      <label className="block">
        <span className="text-xs text-slate-500">Duration minutes</span>
        <input
          type="number"
          min={5}
          max={10080}
          value={Number(config.durationMinutes ?? 60)}
          onChange={(event) => update({ durationMinutes: Number(event.target.value) })}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
        />
      </label>

      {type === "mark_provider_temporarily_degraded" ? (
        <Select
          label="Mode"
          value={String(config.mode ?? "avoid_if_possible")}
          options={["avoid_if_possible", "block_for_duration"]}
          onChange={(mode) => update({ mode })}
        />
      ) : null}

      {type === "prefer_fallback_provider" ? (
        <>
          <Select
            label="Only if provider"
            value={String(config.onlyIfProvider ?? "chatgpt")}
            options={providerOptions}
            onChange={(onlyIfProvider) => update({ onlyIfProvider })}
          />
          <label className="block">
            <span className="text-xs text-slate-500">Fallback order</span>
            <input
              value={Array.isArray(config.fallbackProviderOrder) ? config.fallbackProviderOrder.join(",") : "gemini,chatgpt,grok"}
              onChange={(event) => update({ fallbackProviderOrder: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
            />
          </label>
        </>
      ) : null}

      {type === "disable_model_temporarily" ? (
        <>
          <label className="block">
            <span className="text-xs text-slate-500">Model ID</span>
            <input
              value={String(config.modelId ?? "")}
              onChange={(event) => update({ modelId: event.target.value })}
              placeholder="chatgpt-web"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Reason</span>
            <input
              value={String(config.reason ?? "")}
              onChange={(event) => update({ reason: event.target.value })}
              placeholder="Provider UI drift detected"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
            />
          </label>
        </>
      ) : null}
    </div>
  );
}

export function defaultAction(type: ProviderRecoveryActionType) {
  if (type === "mark_provider_temporarily_degraded") {
    return { type, enabled: true, config: { durationMinutes: 60, mode: "avoid_if_possible" } };
  }
  if (type === "prefer_fallback_provider") {
    return { type, enabled: true, config: { durationMinutes: 60, onlyIfProvider: "chatgpt", fallbackProviderOrder: ["gemini", "chatgpt", "grok"] } };
  }
  if (type === "disable_model_temporarily") {
    return { type, enabled: true, config: { durationMinutes: 60, modelId: "chatgpt-web", reason: "Provider UI drift detected" } };
  }
  return { type, enabled: true };
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
