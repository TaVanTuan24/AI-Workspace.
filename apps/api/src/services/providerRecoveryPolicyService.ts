import type { ProviderRecoveryPolicy, ProviderRecoveryPolicyRun } from "@prisma/client";
import { PROVIDERS, type ProviderId } from "@uaiw/shared/types/provider.js";
import { prisma } from "./prisma.js";
import { getProviderHealth, refreshProviderHealth, runUiDiagnostics } from "./providerHealthService.js";
import { providerDiagnosticsHistoryService } from "./providerDiagnosticsHistoryService.js";
import {
  createRecoveryOverride,
  isRecoveryActionType
} from "./providerRecoveryOverrideService.js";
import { assertWorkspaceQuota } from "./workspaceQuotaService.js";

export const PROVIDER_RECOVERY_TRIGGER_TYPES = [
  "provider_incident_opened",
  "provider_incident_repeated",
  "provider_incident_critical",
  "diagnostics_drift_alert_opened",
  "diagnostics_drift_alert_error",
  "no_usable_models"
] as const;

export type ProviderRecoveryTriggerType = (typeof PROVIDER_RECOVERY_TRIGGER_TYPES)[number];

export const PROVIDER_RECOVERY_ACTION_TYPES = [
  "notify_in_app",
  "run_safe_health_check",
  "run_safe_ui_diagnostics",
  "create_or_update_incident",
  "mark_provider_temporarily_degraded",
  "prefer_fallback_provider",
  "disable_model_temporarily"
] as const;

export type ProviderRecoveryActionType = (typeof PROVIDER_RECOVERY_ACTION_TYPES)[number];

export const FORBIDDEN_PROVIDER_RECOVERY_ACTION_TYPES = [
  "auto_reconnect",
  "auto_login",
  "submit_prompt",
  "bypass_challenge",
  "capture_screenshot",
  "dump_dom",
  "export_session"
] as const;

const AVAILABLE_ACTIONS = new Set<ProviderRecoveryActionType>([
  "notify_in_app",
  "run_safe_health_check",
  "run_safe_ui_diagnostics",
  "create_or_update_incident",
  "mark_provider_temporarily_degraded",
  "prefer_fallback_provider",
  "disable_model_temporarily"
]);

const RECOVERY_STATUSES = ["open", "resolved", "requires_login", "manual_action_required", "expired", "error", "ui_changed", "no_usable_models"] as const;
const RECOVERY_SEVERITIES = ["info", "warning", "error", "critical"] as const;
const MIN_COOLDOWN_MINUTES = 5;
const MAX_COOLDOWN_MINUTES = 10080;
const MAX_ACTIONS = 10;
const MAX_NAME_LENGTH = 100;
const DEFAULT_OVERRIDE_DURATION_MINUTES = 60;
const MIN_OVERRIDE_DURATION_MINUTES = 5;
const MAX_OVERRIDE_DURATION_MINUTES = 10080;
const MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  chatgpt: "chatgpt-web",
  gemini: "gemini-web",
  claude: "claude-web"
};

export interface ProviderRecoveryActionInput {
  type: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface ProviderRecoveryActionView {
  type: ProviderRecoveryActionType;
  enabled: boolean;
  config?: Record<string, unknown>;
  availability: "available" | "scaffolded" | "unsupported";
}

export interface ProviderRecoveryPolicyInput {
  name: string;
  enabled?: boolean;
  triggerTypes: string[];
  providers?: string[];
  severities?: string[];
  statuses?: string[];
  actions: ProviderRecoveryActionInput[];
  cooldownMinutes?: number;
}

export interface ProviderRecoveryPolicyPatchInput {
  name?: string;
  enabled?: boolean;
  triggerTypes?: string[];
  providers?: string[];
  severities?: string[];
  statuses?: string[];
  actions?: ProviderRecoveryActionInput[];
  cooldownMinutes?: number;
}

export interface ProviderRecoveryPolicyView {
  id: string;
  name: string;
  enabled: boolean;
  triggerTypes: ProviderRecoveryTriggerType[];
  providers: ProviderId[];
  severities: string[];
  statuses: string[];
  actions: ProviderRecoveryActionView[];
  cooldownMinutes: number;
  lastTriggeredAt?: string;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRecoveryPolicyRunView {
  id: string;
  policyId: string;
  policyName?: string;
  triggerType: ProviderRecoveryTriggerType;
  triggerRefId?: string;
  provider?: string;
  severity?: string;
  status: "running" | "success" | "partial" | "failed" | "skipped";
  actionsAttempted: string[];
  actionsSucceeded: string[];
  actionsFailed: Array<{ type: string; reason: string }>;
  skippedReason?: string;
  startedAt: string;
  completedAt?: string;
}

export interface EvaluateProviderRecoveryPoliciesInput {
  userId: string;
  triggerType: string;
  triggerRefId?: string;
  provider?: string;
  severity?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderRecoveryPolicyPreviewInput {
  userId: string;
  triggerType: string;
  provider?: string;
  severity?: string;
  status?: string;
}

export async function listProviderRecoveryPolicies(userId: string): Promise<ProviderRecoveryPolicyView[]> {
  const policies = await prisma.providerRecoveryPolicy.findMany({
    where: { userId },
    orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }]
  });
  return policies.map(toPolicyView);
}

export async function createProviderRecoveryPolicy(
  userId: string,
  input: ProviderRecoveryPolicyInput
): Promise<ProviderRecoveryPolicyView> {
  const workspaceId = (await prisma.user.findUnique({ where: { id: userId } }))?.workspaceId || null;
  if (workspaceId) {
    await assertWorkspaceQuota({
      workspaceId,
      resource: 'recoveryPolicies',
      actorUserId: userId,
      source: 'recovery_policy_create'
    });
  }

  const normalized = normalizePolicyInput(input);
  const created = await prisma.providerRecoveryPolicy.create({
    data: {
      userId,
      workspaceId,
      name: normalized.name,
      enabled: normalized.enabled,
      triggerTypes: jsonString(normalized.triggerTypes),
      providers: jsonString(normalized.providers),
      severities: jsonString(normalized.severities),
      statuses: jsonString(normalized.statuses),
      actions: jsonString(normalized.actions),
      cooldownMinutes: normalized.cooldownMinutes
    }
  });
  return toPolicyView(created);
}

export async function updateProviderRecoveryPolicy(
  userId: string,
  policyId: string,
  input: ProviderRecoveryPolicyPatchInput
): Promise<ProviderRecoveryPolicyView> {
  const policy = await findOwnedPolicy(userId, policyId);
  const normalized = normalizePolicyPatchInput(input);
  const updated = await prisma.providerRecoveryPolicy.update({
    where: { id: policy.id },
    data: normalized
  });
  return toPolicyView(updated);
}

export async function setProviderRecoveryPolicyEnabled(
  userId: string,
  policyId: string,
  enabled: boolean
): Promise<ProviderRecoveryPolicyView> {
  return updateProviderRecoveryPolicy(userId, policyId, { enabled });
}

export async function deleteProviderRecoveryPolicy(userId: string, policyId: string): Promise<void> {
  const policy = await findOwnedPolicy(userId, policyId);
  await prisma.providerRecoveryPolicy.delete({ where: { id: policy.id } });
}

export async function listProviderRecoveryPolicyRuns(input: {
  userId: string;
  policyId?: string;
  status?: string;
  limit?: number;
}): Promise<ProviderRecoveryPolicyRunView[]> {
  const runs = await prisma.providerRecoveryPolicyRun.findMany({
    where: {
      userId: input.userId,
      ...(input.policyId ? { policyId: input.policyId } : {}),
      ...(input.status ? { status: input.status } : {})
    },
    include: { policy: true },
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(input.limit ?? 50, 1), 100)
  });
  return runs.map(toRunView);
}

export async function getProviderRecoveryPolicyRun(
  userId: string,
  runId: string
): Promise<ProviderRecoveryPolicyRunView | null> {
  const run = await prisma.providerRecoveryPolicyRun.findFirst({
    where: { id: runId, userId },
    include: { policy: true }
  });
  return run ? toRunView(run) : null;
}

export async function previewProviderRecoveryPolicies(
  input: ProviderRecoveryPolicyPreviewInput
): Promise<{
  matchedPolicies: Array<ProviderRecoveryPolicyView & { actionsWouldRun: ProviderRecoveryActionView[]; skippedReason?: string }>;
}> {
  const triggerType = parseTriggerType(input.triggerType);
  const policies = await prisma.providerRecoveryPolicy.findMany({
    where: { userId: input.userId, enabled: true },
    orderBy: { updatedAt: "desc" }
  });

  const matchedPolicies = policies
    .filter((policy) => policyMatches(policy, {
      triggerType,
      provider: input.provider,
      severity: input.severity,
      status: input.status
    }))
    .map((policy) => {
      const view = toPolicyView(policy);
      const actionsWouldRun = view.actions.filter((action) => action.enabled);
      return {
        ...view,
        actionsWouldRun,
        skippedReason: actionsWouldRun.length === 0 ? "No enabled actions." : undefined
      };
    });

  return { matchedPolicies };
}

export async function evaluateProviderRecoveryPolicies(
  input: EvaluateProviderRecoveryPoliciesInput
): Promise<ProviderRecoveryPolicyRunView[]> {
  let triggerType: ProviderRecoveryTriggerType;
  try {
    triggerType = parseTriggerType(input.triggerType);
  } catch {
    return [];
  }

  const policies = await prisma.providerRecoveryPolicy.findMany({
    where: { userId: input.userId, enabled: true },
    orderBy: { updatedAt: "asc" }
  });

  const runs: ProviderRecoveryPolicyRunView[] = [];
  for (const policy of policies) {
    if (!policyMatches(policy, {
      triggerType,
      provider: input.provider,
      severity: input.severity,
      status: input.status
    })) {
      continue;
    }

    const cooldownReason = cooldownSkipReason(policy);
    if (cooldownReason) {
      const skipped = await createSkippedRun(policy, input, triggerType, cooldownReason);
      runs.push(toRunView(skipped));
      continue;
    }

    const run = await prisma.providerRecoveryPolicyRun.create({
      data: {
        userId: input.userId,
        policyId: policy.id,
        triggerType,
        triggerRefId: safeRef(input.triggerRefId),
        provider: asOptionalProvider(input.provider),
        severity: asOptionalSeverity(input.severity),
        status: "running",
        actionsAttempted: jsonString([]),
        actionsSucceeded: jsonString([]),
        actionsFailed: jsonString([]),
        metadata: jsonString(sanitizeRunMetadata(input.metadata))
      }
    });

    await prisma.providerRecoveryPolicy.update({
      where: { id: policy.id },
      data: {
        lastTriggeredAt: new Date(),
        triggerCount: { increment: 1 }
      }
    });

    const result = await executePolicyRun(policy, run, input, triggerType);
    runs.push(result);
  }

  return runs;
}

async function executePolicyRun(
  policy: ProviderRecoveryPolicy,
  run: ProviderRecoveryPolicyRun,
  input: EvaluateProviderRecoveryPoliciesInput,
  triggerType: ProviderRecoveryTriggerType
): Promise<ProviderRecoveryPolicyRunView> {
  const actions = actionsFromJson(policy.actions).filter((action) => action.enabled);
  const attempted: string[] = [];
  const succeeded: string[] = [];
  const failed: Array<{ type: string; reason: string }> = [];

  if (actions.length === 0) {
    const updated = await prisma.providerRecoveryPolicyRun.update({
      where: { id: run.id },
      data: {
        status: "skipped",
        skippedReason: "No enabled actions.",
        completedAt: new Date(),
        actionsAttempted: jsonString([]),
        actionsSucceeded: jsonString([]),
        actionsFailed: jsonString([])
      },
      include: { policy: true }
    });
    return toRunView(updated);
  }

  for (const action of actions) {
    attempted.push(action.type);
    try {
      const result = await executeRecoveryAction(action, policy, run, input, triggerType);
      succeeded.push(result.overrideId ? `${action.type}:${result.overrideId}` : action.type);
    } catch (error: any) {
      failed.push({
        type: action.type,
        reason: safeFailureReason(error?.message)
      });
    }
  }

  const status =
    succeeded.length === 0
      ? "failed"
      : failed.length > 0
        ? "partial"
        : "success";

  const updated = await prisma.providerRecoveryPolicyRun.update({
    where: { id: run.id },
    data: {
      status,
      completedAt: new Date(),
      actionsAttempted: jsonString(attempted),
      actionsSucceeded: jsonString(succeeded),
      actionsFailed: jsonString(failed)
    },
    include: { policy: true }
  });

  return toRunView(updated);
}

async function executeRecoveryAction(
  action: ProviderRecoveryActionView,
  policy: ProviderRecoveryPolicy,
  run: ProviderRecoveryPolicyRun,
  input: EvaluateProviderRecoveryPoliciesInput,
  triggerType: ProviderRecoveryTriggerType
): Promise<{ overrideId?: string }> {
  switch (action.type) {
    case "notify_in_app":
      await notifyInApp(policy, run, input, triggerType);
      return {};
    case "run_safe_health_check":
      await runSafeHealthCheck(input);
      return {};
    case "run_safe_ui_diagnostics":
      await runSafeUiDiagnostics(run, input);
      return {};
    case "create_or_update_incident":
      await createOrUpdateIncident(run, input, triggerType);
      return {};
    case "mark_provider_temporarily_degraded":
      return markProviderTemporarilyDegraded(action, policy, run, input);
    case "prefer_fallback_provider":
      return preferFallbackProvider(action, policy, run, input);
    case "disable_model_temporarily":
      return disableModelTemporarily(action, policy, run, input);
    default:
      throw new Error("Unsupported action.");
  }
}

async function notifyInApp(
  policy: ProviderRecoveryPolicy,
  run: ProviderRecoveryPolicyRun,
  input: EvaluateProviderRecoveryPoliciesInput,
  triggerType: ProviderRecoveryTriggerType
) {
  const provider = asOptionalProvider(input.provider);
  const title = `Recovery policy triggered: ${policy.name}`;
  const providerPart = provider ? ` for ${provider}` : "";
  const message = `Policy "${policy.name}" matched ${triggerType}${providerPart}. Review the recovery run for safe action details.`;
  const fingerprint = `provider_recovery_policy:${policy.id}:${run.id}`;

  await prisma.notificationEvent.upsert({
    where: {
      userId_fingerprint: {
        userId: policy.userId,
        fingerprint
      }
    },
    update: {
      title,
      message,
      severity: "warning",
      actionLabel: "Review recovery run",
      actionHref: "/settings/provider-recovery"
    },
    create: {
      userId: policy.userId,
      kind: "provider_recovery_policy",
      severity: "warning",
      title,
      message,
      provider,
      fingerprint,
      actionLabel: "Review recovery run",
      actionHref: "/settings/provider-recovery",
      metadataJson: JSON.stringify({
        source: "provider_recovery_policy",
        policyId: policy.id,
        policyRunId: run.id,
        triggerType
      })
    }
  });
}

async function runSafeHealthCheck(input: EvaluateProviderRecoveryPoliciesInput) {
  const provider = requireProvider(input.provider);
  await refreshProviderHealth(input.userId, provider);
}

async function runSafeUiDiagnostics(
  run: ProviderRecoveryPolicyRun,
  input: EvaluateProviderRecoveryPoliciesInput
) {
  const provider = requireProvider(input.provider);
  const connection = await prisma.providerConnection.findUnique({
    where: {
      userId_provider: {
        userId: input.userId,
        provider
      }
    }
  });
  const startedAt = new Date();
  let result = null;
  let errorReason: string | undefined;

  try {
    result = await runUiDiagnostics(input.userId, provider);
  } catch (error: any) {
    errorReason = safeFailureReason(error?.message);
  }

  await providerDiagnosticsHistoryService.recordDiagnosticsRun({
    userId: input.userId,
    provider,
    connectionId: connection?.id,
    incidentId: input.triggerType.startsWith("provider_incident_") ? input.triggerRefId : undefined,
    startedAt,
    completedAt: new Date(),
    result,
    source: "provider_recovery_policy",
    errorReason
  });

  if (errorReason) {
    throw new Error(errorReason);
  }
}

async function createOrUpdateIncident(
  run: ProviderRecoveryPolicyRun,
  input: EvaluateProviderRecoveryPoliciesInput,
  triggerType: ProviderRecoveryTriggerType
) {
  const provider = requireProvider(input.provider);
  const status = asOptionalStatus(input.status) ?? triggerType;
  const severity = asOptionalSeverity(input.severity) ?? "warning";
  const fingerprint = `${input.userId}:${provider}:provider_recovery_policy:${triggerType}`;
  const metadata = JSON.stringify({
    source: "provider_recovery_policy",
    policyRunId: run.id,
    triggerType
  });

  const existing = await prisma.providerHealthIncident.findFirst({
    where: {
      userId: input.userId,
      provider,
      resolvedAt: null,
      fingerprint
    },
    orderBy: { startedAt: "desc" }
  });

  if (existing) {
    await prisma.providerHealthIncident.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        occurrenceCount: { increment: 1 },
        severity,
        metadata
      }
    });
    return;
  }

  await prisma.providerHealthIncident.create({
    data: {
      userId: input.userId,
      provider,
      status,
      severity,
      reason: "Recovery policy created this incident from safe metadata.",
      fingerprint,
      metadata
    }
  });
}

async function markProviderTemporarilyDegraded(
  action: ProviderRecoveryActionView,
  policy: ProviderRecoveryPolicy,
  run: ProviderRecoveryPolicyRun,
  input: EvaluateProviderRecoveryPoliciesInput
) {
  const provider = requireProvider((action.config?.provider as string | undefined) ?? input.provider);
  const durationMinutes = actionDuration(action.config);
  const mode = action.config?.mode === "block_for_duration" ? "block_for_duration" : "avoid_if_possible";
  const reason = safeReason(action.config?.reason) ?? inputReason(input) ?? "Recovery policy marked provider temporarily degraded.";
  const override = await createRecoveryOverride({
    userId: input.userId,
    policyId: policy.id,
    policyRunId: run.id,
    actionType: "mark_provider_temporarily_degraded",
    provider,
    durationMinutes,
    reason,
    overrideState: {
      mode,
      triggerType: input.triggerType,
      triggerRefId: safeRef(input.triggerRefId)
    },
    previousState: {
      type: "virtual_override",
      provider
    }
  });
  return { overrideId: override.id };
}

async function preferFallbackProvider(
  action: ProviderRecoveryActionView,
  policy: ProviderRecoveryPolicy,
  run: ProviderRecoveryPolicyRun,
  input: EvaluateProviderRecoveryPoliciesInput
) {
  const onlyIfProvider = asOptionalProvider(action.config?.onlyIfProvider as string | undefined) ?? asOptionalProvider(input.provider);
  if (!onlyIfProvider) {
    throw new Error("Fallback preference requires a trigger provider or onlyIfProvider.");
  }

  const fallbackProviderOrder = normalizeFallbackProviderOrder(action.config?.fallbackProviderOrder);
  if (fallbackProviderOrder.length === 0) {
    throw new Error("Fallback preference requires at least one valid fallback provider.");
  }

  const health = await getProviderHealth(input.userId);
  const usable = new Set(health.filter((item) => item.isUsable).map((item) => item.provider));
  const usableFallback = fallbackProviderOrder.find((provider) => provider !== onlyIfProvider && usable.has(provider));
  if (!usableFallback) {
    throw new Error("No usable fallback provider is currently available.");
  }

  const durationMinutes = actionDuration(action.config);
  const reason = safeReason(action.config?.reason) ?? inputReason(input) ?? "Recovery policy temporarily prefers a fallback provider.";
  const override = await createRecoveryOverride({
    userId: input.userId,
    policyId: policy.id,
    policyRunId: run.id,
    actionType: "prefer_fallback_provider",
    provider: onlyIfProvider,
    durationMinutes,
    reason,
    overrideState: {
      onlyIfProvider,
      fallbackProviderOrder,
      selectedUsableFallback: usableFallback,
      triggerType: input.triggerType,
      triggerRefId: safeRef(input.triggerRefId)
    },
    previousState: {
      type: "virtual_override",
      provider: onlyIfProvider
    }
  });
  return { overrideId: override.id };
}

async function disableModelTemporarily(
  action: ProviderRecoveryActionView,
  policy: ProviderRecoveryPolicy,
  run: ProviderRecoveryPolicyRun,
  input: EvaluateProviderRecoveryPoliciesInput
) {
  const provider = asOptionalProvider((action.config?.provider as string | undefined) ?? input.provider);
  const modelId = normalizeModelId((action.config?.modelId as string | undefined) ?? (provider ? MODEL_BY_PROVIDER[provider as ProviderId] : undefined));
  if (!modelId && !provider) {
    throw new Error("Temporary model disable requires a modelId or trigger provider.");
  }

  const allowNoUsableModels = action.config?.allowNoUsableModels === true;
  if (!allowNoUsableModels) {
    const health = await getProviderHealth(input.userId);
    const disabledProvider = provider ?? providerForModel(modelId);
    const hasAlternative = health.some((item) => item.isUsable && item.provider !== disabledProvider);
    if (!hasAlternative) {
      throw new Error("Temporary disable would leave no known usable alternative.");
    }
  }

  const durationMinutes = actionDuration(action.config);
  const subModelId = normalizeModelId(action.config?.subModelId as string | undefined);
  const reason = safeReason(action.config?.reason) ?? inputReason(input) ?? "Recovery policy temporarily disabled this model.";
  const override = await createRecoveryOverride({
    userId: input.userId,
    policyId: policy.id,
    policyRunId: run.id,
    actionType: "disable_model_temporarily",
    provider,
    modelId,
    subModelId,
    durationMinutes,
    reason,
    overrideState: {
      modelId,
      subModelId,
      provider,
      allowNoUsableModels,
      triggerType: input.triggerType,
      triggerRefId: safeRef(input.triggerRefId)
    },
    previousState: {
      type: "virtual_override",
      modelId,
      subModelId,
      provider
    }
  });
  return { overrideId: override.id };
}

async function createSkippedRun(
  policy: ProviderRecoveryPolicy,
  input: EvaluateProviderRecoveryPoliciesInput,
  triggerType: ProviderRecoveryTriggerType,
  reason: string
) {
  return prisma.providerRecoveryPolicyRun.create({
    data: {
      userId: input.userId,
      policyId: policy.id,
      triggerType,
      triggerRefId: safeRef(input.triggerRefId),
      provider: asOptionalProvider(input.provider),
      severity: asOptionalSeverity(input.severity),
      status: "skipped",
      skippedReason: reason,
      actionsAttempted: jsonString([]),
      actionsSucceeded: jsonString([]),
      actionsFailed: jsonString([]),
      completedAt: new Date(),
      metadata: jsonString(sanitizeRunMetadata(input.metadata))
    },
    include: { policy: true }
  });
}

function normalizePolicyInput(input: ProviderRecoveryPolicyInput) {
  const name = sanitizeName(input.name);
  const actions = normalizeActions(input.actions);
  return {
    name,
    enabled: input.enabled ?? true,
    triggerTypes: normalizeTriggerTypes(input.triggerTypes),
    providers: normalizeOptionalProviders(input.providers),
    severities: normalizeOptionalValues(input.severities, RECOVERY_SEVERITIES, "severity"),
    statuses: normalizeOptionalValues(input.statuses, RECOVERY_STATUSES, "status"),
    actions,
    cooldownMinutes: normalizeCooldown(input.cooldownMinutes)
  };
}

function normalizePolicyPatchInput(input: ProviderRecoveryPolicyPatchInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = sanitizeName(input.name);
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.triggerTypes !== undefined) data.triggerTypes = jsonString(normalizeTriggerTypes(input.triggerTypes));
  if (input.providers !== undefined) data.providers = jsonString(normalizeOptionalProviders(input.providers));
  if (input.severities !== undefined) data.severities = jsonString(normalizeOptionalValues(input.severities, RECOVERY_SEVERITIES, "severity"));
  if (input.statuses !== undefined) data.statuses = jsonString(normalizeOptionalValues(input.statuses, RECOVERY_STATUSES, "status"));
  if (input.actions !== undefined) data.actions = jsonString(normalizeActions(input.actions));
  if (input.cooldownMinutes !== undefined) data.cooldownMinutes = normalizeCooldown(input.cooldownMinutes);
  return data;
}

function sanitizeName(input: string) {
  const value = String(input ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  if (!value) throw new Error("Policy name is required.");
  return value;
}

function normalizeTriggerTypes(values: string[]) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("At least one trigger type is required.");
  }
  return unique(values.map(parseTriggerType));
}

function normalizeOptionalProviders(values?: string[]) {
  if (!values || values.length === 0) return [];
  return unique(values.map((value) => {
    if (!(PROVIDERS as readonly string[]).includes(value)) throw new Error(`Invalid provider: ${value}`);
    return value as ProviderId;
  }));
}

function normalizeOptionalValues<T extends readonly string[]>(values: string[] | undefined, allowed: T, label: string) {
  if (!values || values.length === 0) return [];
  return unique(values.map((value) => {
    if (!(allowed as readonly string[]).includes(value)) throw new Error(`Invalid ${label}: ${value}`);
    return value;
  }));
}

function normalizeActions(actions: ProviderRecoveryActionInput[]) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("At least one action is required.");
  }
  if (actions.length > MAX_ACTIONS) {
    throw new Error(`At most ${MAX_ACTIONS} actions are allowed.`);
  }
  return actions.map((action) => {
    if ((FORBIDDEN_PROVIDER_RECOVERY_ACTION_TYPES as readonly string[]).includes(action.type)) {
      throw new Error(`Forbidden recovery action: ${action.type}`);
    }
    if (!(PROVIDER_RECOVERY_ACTION_TYPES as readonly string[]).includes(action.type)) {
      throw new Error(`Unsupported recovery action: ${action.type}`);
    }
    const type = action.type as ProviderRecoveryActionType;
    return {
      type,
      enabled: action.enabled ?? true,
      config: sanitizeActionConfig(type, action.config),
      availability: actionAvailability(type)
    };
  });
}

function normalizeCooldown(value?: number) {
  const cooldown = Number.isFinite(value) ? Math.floor(value as number) : 60;
  if (cooldown < MIN_COOLDOWN_MINUTES || cooldown > MAX_COOLDOWN_MINUTES) {
    throw new Error(`Cooldown must be between ${MIN_COOLDOWN_MINUTES} and ${MAX_COOLDOWN_MINUTES} minutes.`);
  }
  return cooldown;
}

function sanitizeActionConfig(type: ProviderRecoveryActionType, input?: Record<string, unknown>) {
  if (!input || typeof input !== "object") return {};
  const allowedKeysByType: Record<ProviderRecoveryActionType, Set<string>> = {
    notify_in_app: new Set(["note"]),
    run_safe_health_check: new Set(["note"]),
    run_safe_ui_diagnostics: new Set(["note"]),
    create_or_update_incident: new Set(["note"]),
    mark_provider_temporarily_degraded: new Set(["durationMinutes", "mode", "reason", "provider", "note"]),
    prefer_fallback_provider: new Set(["durationMinutes", "fallbackProviderOrder", "onlyIfProvider", "reason", "note"]),
    disable_model_temporarily: new Set(["durationMinutes", "modelId", "subModelId", "provider", "reason", "allowNoUsableModels", "note"])
  };
  const allowedKeys = allowedKeysByType[type];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isForbiddenConfigKey(key)) {
      throw new Error(`Forbidden recovery action config field: ${key}`);
    }
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported config field for ${type}: ${key}`);
    }
    if (key === "durationMinutes") {
      result[key] = normalizeOverrideDuration(value);
      continue;
    }
    if (key === "mode") {
      if (value !== "avoid_if_possible" && value !== "block_for_duration") {
        throw new Error("Provider degradation mode must be avoid_if_possible or block_for_duration.");
      }
      result[key] = value;
      continue;
    }
    if (key === "fallbackProviderOrder") {
      result[key] = normalizeFallbackProviderOrder(value);
      continue;
    }
    if (key === "onlyIfProvider" || key === "provider") {
      result[key] = requireProvider(String(value));
      continue;
    }
    if (key === "modelId" || key === "subModelId") {
      const normalized = normalizeModelId(String(value));
      if (normalized) result[key] = normalized;
      continue;
    }
    if (key === "reason" || key === "note") {
      const safe = safeReason(value);
      if (safe) result[key] = safe;
      continue;
    }
    if (typeof value === "boolean") result[key] = value;
  }
  validateActionConfig(type, result);
  return result;
}

function parseTriggerType(value: string): ProviderRecoveryTriggerType {
  if (!(PROVIDER_RECOVERY_TRIGGER_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Invalid trigger type: ${value}`);
  }
  return value as ProviderRecoveryTriggerType;
}

function policyMatches(
  policy: ProviderRecoveryPolicy,
  input: { triggerType: ProviderRecoveryTriggerType; provider?: string; severity?: string; status?: string }
) {
  const triggers = stringArrayFromJson(policy.triggerTypes);
  if (!triggers.includes(input.triggerType)) return false;
  if (!matchesOptionalFilter(policy.providers, input.provider)) return false;
  if (!matchesOptionalFilter(policy.severities, input.severity)) return false;
  if (!matchesOptionalFilter(policy.statuses, input.status)) return false;
  return true;
}

function matchesOptionalFilter(filterJson: unknown, value?: string) {
  const filter = stringArrayFromJson(filterJson);
  if (filter.length === 0) return true;
  if (!value) return false;
  return filter.includes(value);
}

function cooldownSkipReason(policy: ProviderRecoveryPolicy) {
  if (!policy.lastTriggeredAt) return null;
  const ageMs = Date.now() - policy.lastTriggeredAt.getTime();
  const cooldownMs = policy.cooldownMinutes * 60 * 1000;
  if (ageMs >= cooldownMs) return null;
  const remainingMinutes = Math.ceil((cooldownMs - ageMs) / 60000);
  return `Policy cooldown active for ${remainingMinutes} more minute${remainingMinutes === 1 ? "" : "s"}.`;
}

function toPolicyView(policy: ProviderRecoveryPolicy): ProviderRecoveryPolicyView {
  return {
    id: policy.id,
    name: policy.name,
    enabled: policy.enabled,
    triggerTypes: stringArrayFromJson(policy.triggerTypes) as ProviderRecoveryTriggerType[],
    providers: stringArrayFromJson(policy.providers) as ProviderId[],
    severities: stringArrayFromJson(policy.severities),
    statuses: stringArrayFromJson(policy.statuses),
    actions: actionsFromJson(policy.actions),
    cooldownMinutes: policy.cooldownMinutes,
    lastTriggeredAt: policy.lastTriggeredAt?.toISOString(),
    triggerCount: policy.triggerCount,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString()
  };
}

function toRunView(run: ProviderRecoveryPolicyRun & { policy?: ProviderRecoveryPolicy | null }): ProviderRecoveryPolicyRunView {
  return {
    id: run.id,
    policyId: run.policyId,
    policyName: run.policy?.name,
    triggerType: run.triggerType as ProviderRecoveryTriggerType,
    triggerRefId: run.triggerRefId ?? undefined,
    provider: run.provider ?? undefined,
    severity: run.severity ?? undefined,
    status: run.status as ProviderRecoveryPolicyRunView["status"],
    actionsAttempted: stringArrayFromJson(run.actionsAttempted),
    actionsSucceeded: stringArrayFromJson(run.actionsSucceeded),
    actionsFailed: failedActionsFromJson(run.actionsFailed),
    skippedReason: run.skippedReason ?? undefined,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString()
  };
}

function actionsFromJson(input: unknown): ProviderRecoveryActionView[] {
  const parsed = parseJsonValue(input);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item === "object")
    .map((item: any) => {
      const type = item.type as ProviderRecoveryActionType;
      return {
        type,
        enabled: item.enabled !== false,
        config: sanitizeStoredActionConfig(type, item.config),
        availability: actionAvailability(type)
      };
    })
    .filter((action) => (PROVIDER_RECOVERY_ACTION_TYPES as readonly string[]).includes(action.type));
}

function failedActionsFromJson(input: unknown) {
  const parsed = parseJsonValue(input);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item === "object")
    .map((item: any) => ({
      type: String(item.type ?? "unknown").slice(0, 80),
      reason: safeFailureReason(item.reason)
    }));
}

function actionAvailability(type: ProviderRecoveryActionType): ProviderRecoveryActionView["availability"] {
  if (AVAILABLE_ACTIONS.has(type)) return "available";
  return "unsupported";
}

function sanitizeStoredActionConfig(type: ProviderRecoveryActionType, input?: Record<string, unknown>) {
  try {
    return sanitizeActionConfig(type, input);
  } catch {
    return {};
  }
}

function stringArrayFromJson(input: unknown): string[] {
  const parsed = parseJsonValue(input);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((value): value is string => typeof value === "string");
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

async function findOwnedPolicy(userId: string, policyId: string) {
  const policy = await prisma.providerRecoveryPolicy.findFirst({
    where: { id: policyId, userId }
  });
  if (!policy) throw new Error("Policy not found");
  return policy;
}

function requireProvider(value?: string): ProviderId {
  if (!value || !(PROVIDERS as readonly string[]).includes(value)) {
    throw new Error("Action requires a valid provider.");
  }
  return value as ProviderId;
}

function asOptionalProvider(value?: string) {
  return value && (PROVIDERS as readonly string[]).includes(value) ? value : undefined;
}

function asOptionalSeverity(value?: string) {
  return value && (RECOVERY_SEVERITIES as readonly string[]).includes(value) ? value : undefined;
}

function asOptionalStatus(value?: string) {
  return value && (RECOVERY_STATUSES as readonly string[]).includes(value) ? value : undefined;
}

function actionDuration(config?: Record<string, unknown>) {
  return normalizeOverrideDuration(config?.durationMinutes);
}

function normalizeOverrideDuration(value: unknown) {
  const duration = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_OVERRIDE_DURATION_MINUTES;
  if (duration < MIN_OVERRIDE_DURATION_MINUTES || duration > MAX_OVERRIDE_DURATION_MINUTES) {
    throw new Error(`Override duration must be between ${MIN_OVERRIDE_DURATION_MINUTES} and ${MAX_OVERRIDE_DURATION_MINUTES} minutes.`);
  }
  return duration;
}

function normalizeFallbackProviderOrder(value: unknown): ProviderId[] {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => requireProvider(String(item))));
}

function normalizeModelId(value?: string) {
  if (!value) return undefined;
  const normalized = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._:/-]/g, "")
    .slice(0, 120);
  return normalized || undefined;
}

function providerForModel(modelId?: string): ProviderId | undefined {
  if (!modelId) return undefined;
  for (const [provider, candidate] of Object.entries(MODEL_BY_PROVIDER)) {
    if (candidate === modelId) return provider as ProviderId;
  }
  return undefined;
}

function safeReason(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/cookie|token|session|storageState|localStorage|password|secret|api key|webhook/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || undefined;
}

function inputReason(input: EvaluateProviderRecoveryPoliciesInput) {
  return safeReason(input.metadata?.status || input.metadata?.source || input.status || input.severity);
}

function isForbiddenConfigKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return [
    "cookie",
    "token",
    "session",
    "storagestate",
    "localstorage",
    "password",
    "secret",
    "apikey",
    "api_key",
    "webhook",
    "signing"
  ].some((part) => normalized.includes(part));
}

function validateActionConfig(type: ProviderRecoveryActionType, config: Record<string, unknown>) {
  if (!isRecoveryActionType(type)) return;
  if (type === "mark_provider_temporarily_degraded") {
    const mode = config.mode ?? "avoid_if_possible";
    if (mode !== "avoid_if_possible" && mode !== "block_for_duration") {
      throw new Error("Provider degradation mode must be avoid_if_possible or block_for_duration.");
    }
  }
  if (type === "prefer_fallback_provider") {
    if (!Array.isArray(config.fallbackProviderOrder) || config.fallbackProviderOrder.length === 0) {
      throw new Error("Fallback provider order is required.");
    }
  }
  if (type === "disable_model_temporarily") {
    if (config.allowNoUsableModels !== undefined && typeof config.allowNoUsableModels !== "boolean") {
      throw new Error("allowNoUsableModels must be boolean.");
    }
  }
}

function safeRef(value?: string) {
  if (!value) return undefined;
  return String(value).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);
}

function safeFailureReason(value?: string) {
  return String(value || "Action failed.")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/cookie|token|session|storageState|localStorage|password|secret|api key/gi, "[redacted]")
    .slice(0, 300);
}

function sanitizeRunMetadata(input?: Record<string, unknown>) {
  if (!input || typeof input !== "object") return {};
  const allowedKeys = new Set(["source", "status", "statusCategory", "driftScore", "policySource"]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key)) continue;
    if (typeof value === "string") result[key] = value.slice(0, 120);
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}

function parseJsonValue(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function jsonString(input: unknown) {
  return JSON.stringify(input);
}
