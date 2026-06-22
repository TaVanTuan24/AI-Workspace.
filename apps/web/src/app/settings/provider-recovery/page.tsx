"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, PlayCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  createProviderRecoveryPolicy,
  deleteProviderRecoveryPolicy,
  getProviderRecoverySchedulerStatus,
  getSettingsOverview,
  hasPermission,
  listProviderRecoveryOverrides,
  listProviderRecoveryPolicies,
  listProviderRecoveryPolicyRuns,
  previewProviderRecoveryPolicies,
  rollbackProviderRecoveryOverride,
  setProviderRecoveryPolicyEnabled,
  updateProviderRecoveryPolicy,
  type ProviderRecoveryActionType,
  type ProviderRecoveryOverrideView,
  type ProviderRecoveryPolicyInput,
  type ProviderRecoveryPolicyRunView,
  type ProviderRecoveryPolicyView,
  type RecoverySchedulerStatusView,
  type WorkspacePermission
} from "../../../lib/api";
import {
  ActionConfigFields,
  RecoveryOverrideTable,
  defaultAction
} from "./RecoveryOverrideUi";
import { RecoverySchedulerStatusCard } from "./RecoverySchedulerStatusCard";

const triggerOptions = [
  "provider_incident_opened",
  "provider_incident_repeated",
  "provider_incident_critical",
  "diagnostics_drift_alert_opened",
  "diagnostics_drift_alert_error",
  "no_usable_models"
];

const providerOptions = ["chatgpt", "gemini", "grok"];
const severityOptions = ["info", "warning", "error", "critical"];
const statusOptions = ["open", "requires_login", "manual_action_required", "expired", "error", "ui_changed", "no_usable_models"];

const actionOptions: Array<{ type: ProviderRecoveryActionType; label: string; availability: "available" | "scaffolded" }> = [
  { type: "notify_in_app", label: "Notify in-app", availability: "available" },
  { type: "run_safe_health_check", label: "Run safe health check", availability: "available" },
  { type: "run_safe_ui_diagnostics", label: "Run safe UI diagnostics", availability: "available" },
  { type: "create_or_update_incident", label: "Create/update incident", availability: "available" },
  { type: "prefer_fallback_provider", label: "Prefer fallback provider", availability: "available" },
  { type: "disable_model_temporarily", label: "Disable model temporarily", availability: "available" },
  { type: "mark_provider_temporarily_degraded", label: "Mark provider degraded", availability: "available" }
];

const forbiddenActions = ["auto_login", "auto_reconnect", "submit_prompt", "bypass_challenge", "dump_dom", "capture_screenshot"];

const defaultForm: ProviderRecoveryPolicyInput = {
  name: "Notify and diagnose provider drift",
  enabled: false,
  triggerTypes: ["diagnostics_drift_alert_opened"],
  providers: [],
  severities: ["warning", "error"],
  statuses: ["open"],
  actions: [
    { type: "notify_in_app", enabled: true },
    { type: "run_safe_ui_diagnostics", enabled: false }
  ],
  cooldownMinutes: 60
};

export default function ProviderRecoveryPage() {
  const [policies, setPolicies] = useState<ProviderRecoveryPolicyView[]>([]);
  const [runs, setRuns] = useState<ProviderRecoveryPolicyRunView[]>([]);
  const [overrides, setOverrides] = useState<ProviderRecoveryOverrideView[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<RecoverySchedulerStatusView | null>(null);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [form, setForm] = useState<ProviderRecoveryPolicyInput>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewInput, setPreviewInput] = useState({
    triggerType: "diagnostics_drift_alert_opened",
    provider: "chatgpt",
    severity: "warning",
    status: "open"
  });
  const [preview, setPreview] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [policyData, runData, overrideData, schedulerData, overviewData] = await Promise.all([
        listProviderRecoveryPolicies(),
        listProviderRecoveryPolicyRuns({ limit: 25 }),
        listProviderRecoveryOverrides({ status: "all", limit: 50 }),
        getProviderRecoverySchedulerStatus(),
        getSettingsOverview()
      ]);
      setPolicies(policyData.data);
      setRuns(runData.data);
      setOverrides(overrideData.data);
      setSchedulerStatus(schedulerData.data);
      setPermissions(overviewData.currentUser.permissions);
    } catch (err: any) {
      setError(err.message || "Failed to load recovery policies");
    } finally {
      setLoading(false);
    }
  }

  async function savePolicy() {
    if (!canWriteRecovery) {
      setError("You don't have permission to perform this action.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      if (editingId) {
        await updateProviderRecoveryPolicy(editingId, form);
      } else {
        await createProviderRecoveryPolicy(form);
      }
      setEditingId(null);
      setForm(defaultForm);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to save recovery policy");
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    if (!canWriteRecovery) {
      setError("You don't have permission to perform this action.");
      return;
    }
    try {
      setError("");
      const result = await previewProviderRecoveryPolicies(previewInput);
      setPreview(result.data.matchedPolicies);
    } catch (err: any) {
      setError(err.message || "Failed to preview policies");
    }
  }

  function editPolicy(policy: ProviderRecoveryPolicyView) {
    setEditingId(policy.id);
    setForm({
      name: policy.name,
      enabled: policy.enabled,
      triggerTypes: policy.triggerTypes,
      providers: policy.providers,
      severities: policy.severities,
      statuses: policy.statuses,
      actions: policy.actions.map((action) => ({
        type: action.type,
        enabled: action.enabled,
        config: action.config
      })),
      cooldownMinutes: policy.cooldownMinutes
    });
  }

  const selectedActionTypes = useMemo(() => new Set(form.actions.map((action) => action.type)), [form.actions]);
  const canWriteRecovery = hasPermission(permissions, "providerRecovery.write");

  return (
    <div className="space-y-8 p-0 lg:p-2">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">Provider Recovery Policies</h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            Configure bounded, safe reactions for provider incidents and diagnostics drift.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Recovery never logs in, submits prompts, captures raw DOM, or stores browser session data.
          </div>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {!canWriteRecovery && !loading ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-sm text-slate-300">
          You don't have permission to perform this action.
        </div>
      ) : null}

      <RecoverySchedulerStatusCard status={schedulerStatus} />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">Policies</h2>
            <span className="text-sm text-slate-500">{policies.length} configured</span>
          </div>
          {loading ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 text-slate-500">Loading policies...</div>
          ) : policies.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
              No recovery policies yet. Suggested templates stay disabled until you create and enable one.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="bg-slate-900 text-left text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Triggers</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                    <th className="px-4 py-3 font-medium">Cooldown</th>
                    <th className="px-4 py-3 font-medium">Runs</th>
                    <th className="px-4 py-3 font-medium">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950/40 text-slate-300">
                  {policies.map((policy) => (
                    <tr key={policy.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-100">{policy.name}</div>
                        <div className={policy.enabled ? "text-xs text-emerald-300" : "text-xs text-slate-500"}>
                          {policy.enabled ? "Enabled" : "Disabled"}
                        </div>
                      </td>
                      <td className="px-4 py-3">{compactList(policy.triggerTypes)}</td>
                      <td className="px-4 py-3">{compactList(policy.actions.filter((a) => a.enabled).map((a) => a.type))}</td>
                      <td className="px-4 py-3">{policy.cooldownMinutes}m</td>
                      <td className="px-4 py-3">
                        <div>{policy.triggerCount}</div>
                        <div className="text-xs text-slate-500">{policy.lastTriggeredAt ? new Date(policy.lastTriggeredAt).toLocaleString() : "Never"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => editPolicy(policy)}
                            disabled={!canWriteRecovery}
                            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!canWriteRecovery) {
                                setError("You don't have permission to perform this action.");
                                return;
                              }
                              await setProviderRecoveryPolicyEnabled(policy.id, !policy.enabled);
                              await loadData();
                            }}
                            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
                            disabled={!canWriteRecovery}
                          >
                            {policy.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            title="Delete policy"
                            onClick={async () => {
                              if (!canWriteRecovery) {
                                setError("You don't have permission to perform this action.");
                                return;
                              }
                              await deleteProviderRecoveryPolicy(policy.id);
                              await loadData();
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-500/20 text-red-300 hover:bg-red-500/10"
                            disabled={!canWriteRecovery}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold text-slate-100">{editingId ? "Edit Policy" : "Policy Builder"}</h2>
          <div className="mt-5 space-y-5">
            <label className="block">
              <span className="text-sm text-slate-400">Name</span>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                disabled={!canWriteRecovery}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500"
              />
            </label>

            <FieldSet label="Triggers" options={triggerOptions} values={form.triggerTypes} onChange={(triggerTypes) => setForm({ ...form, triggerTypes })} />
            <FieldSet label="Providers" options={providerOptions} values={form.providers ?? []} onChange={(providers) => setForm({ ...form, providers })} />
            <FieldSet label="Severities" options={severityOptions} values={form.severities ?? []} onChange={(severities) => setForm({ ...form, severities })} />
            <FieldSet label="Statuses" options={statusOptions} values={form.statuses ?? []} onChange={(statuses) => setForm({ ...form, statuses })} />

            <div>
              <div className="mb-2 text-sm text-slate-400">Actions</div>
              <div className="grid gap-2">
                {actionOptions.map((action) => (
                  <div key={action.type} className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <label className="flex items-center justify-between gap-3">
                      <span>
                        <span className="block text-slate-200">{action.label}</span>
                        <span className="text-xs text-emerald-300">Available safe action</span>
                      </span>
              <input
                type="checkbox"
                        checked={selectedActionTypes.has(action.type) && form.actions.find((item) => item.type === action.type)?.enabled !== false}
                        onChange={(event) => {
                          if (!canWriteRecovery) return;
                          const without = form.actions.filter((item) => item.type !== action.type);
                          setForm({
                            ...form,
                            actions: event.target.checked ? [...without, defaultAction(action.type)] : without
                          });
                        }}
                        className="h-4 w-4 accent-indigo-500"
                        disabled={!canWriteRecovery}
                      />
                    </label>
                    {selectedActionTypes.has(action.type) ? (
                      <ActionConfigFields
                        type={action.type}
                        action={form.actions.find((item) => item.type === action.type)}
                        onChange={(config) => setForm({
                          ...form,
                          actions: form.actions.map((item) => item.type === action.type ? { ...item, config } : item)
                        })}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-sky-500/20 bg-sky-500/10 p-3 text-sm text-sky-100">
              Temporary override actions always expire, can be rolled back manually, and never reconnect, log in, or submit prompts.
            </div>

            <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Not supported
              </div>
              <div className="flex flex-wrap gap-2">
                {forbiddenActions.map((action) => (
                  <span key={action} className="rounded border border-amber-500/20 bg-slate-950/30 px-2 py-1 text-xs">
                    {action}
                  </span>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-sm text-slate-400">Cooldown minutes</span>
              <input
                type="number"
                min={5}
                max={10080}
                value={form.cooldownMinutes}
                onChange={(event) => setForm({ ...form, cooldownMinutes: Number(event.target.value) })}
                disabled={!canWriteRecovery}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={savePolicy}
                disabled={saving || !canWriteRecovery}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                <PlayCircle className="h-4 w-4" aria-hidden="true" />
                {saving ? "Saving..." : editingId ? "Save changes" : "Create policy"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setForm(defaultForm);
                  }}
                  className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Active Recovery Overrides</h2>
            <p className="mt-1 text-sm text-slate-500">Duration-bound model and fallback changes created by enabled policies.</p>
          </div>
          <span className="text-sm text-slate-500">{overrides.filter((override) => override.status === "active").length} active</span>
        </div>
        <RecoveryOverrideTable
          overrides={overrides}
          onRollback={async (overrideId) => {
            await rollbackProviderRecoveryOverride(overrideId);
            await loadData();
          }}
          canRollback={canWriteRecovery}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold text-slate-100">Preview</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Select label="Trigger" value={previewInput.triggerType} options={triggerOptions} onChange={(triggerType) => setPreviewInput({ ...previewInput, triggerType })} />
            <Select label="Provider" value={previewInput.provider} options={providerOptions} onChange={(provider) => setPreviewInput({ ...previewInput, provider })} />
            <Select label="Severity" value={previewInput.severity} options={severityOptions} onChange={(severity) => setPreviewInput({ ...previewInput, severity })} />
            <Select label="Status" value={previewInput.status} options={statusOptions} onChange={(status) => setPreviewInput({ ...previewInput, status })} />
          </div>
          <button
            type="button"
            onClick={runPreview}
            disabled={!canWriteRecovery}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            Preview matching policies
          </button>
          <div className="mt-4 space-y-2 text-sm">
            {preview.length === 0 ? (
              <div className="text-slate-500">No preview result yet.</div>
            ) : preview.map((policy) => (
              <div key={policy.id} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                <div className="font-medium text-slate-200">{policy.name}</div>
                <div className="mt-1 text-slate-500">{compactList(policy.actionsWouldRun.map((action: any) => action.type))}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold text-slate-100">Policy Runs</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-800">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950 text-left text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Policy</th>
                  <th className="px-3 py-2 font-medium">Trigger</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950/30 text-slate-300">
                {runs.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-slate-500">No runs yet.</td></tr>
                ) : runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2">{new Date(run.startedAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{run.policyName ?? run.policyId}</td>
                    <td className="px-3 py-2">{run.triggerType}</td>
                    <td className="px-3 py-2 capitalize">{run.status}</td>
                    <td className="px-3 py-2">{run.actionsSucceeded.length}/{run.actionsAttempted.length} succeeded</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function FieldSet({ label, options, values, onChange }: { label: string; options: string[]; values: string[]; onChange: (values: string[]) => void }) {
  const selected = new Set(values);
  return (
    <div>
      <div className="mb-2 text-sm text-slate-400">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option} className="inline-flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={selected.has(option)}
              onChange={(event) => {
                const next = event.target.checked
                  ? Array.from(new Set([...values, option]))
                  : values.filter((value) => value !== option);
                onChange(next);
              }}
              className="h-3.5 w-3.5 accent-indigo-500"
            />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
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

function compactList(values: string[]) {
  if (values.length === 0) return "Any";
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}
