import { prisma } from "./prisma.js";
import { ProviderUiDiagnosis } from "@uaiw/shared";

export function redactText(input: string): string {
  let redacted = input;
  redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted-email]");
  redacted = redacted.replace(/https?:\/\/[^\s"'<>]+/g, "[redacted-url]");
  redacted = redacted.replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[redacted-token]");
  redacted = redacted.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "[redacted-uuid]");
  redacted = redacted.replace(/\b\d{10,}\b/g, "[redacted-number]");
  return redacted;
}

export type ProviderDiagnosticsDiffView = {
  leftRunId: string;
  rightRunId: string;
  provider: string;
  changedStatus: boolean;
  addedDetectedCapabilities: string[];
  removedDetectedCapabilities: string[];
  addedMissingCapabilities: string[];
  removedMissingCapabilities: string[];
  changedSelectorHints: Array<{
    key: string;
    before?: string;
    after?: string;
  }>;
};

// Safe defaults
const MAX_SUMMARY_LENGTH = 1000;
const MAX_REASON_LENGTH = 500;
const MAX_HINT_LENGTH = 200;

function safeTruncate(text: string | null | undefined, max: number, stats?: { count: number }): string | undefined {
  if (!text) return undefined;
  const redacted = redactText(text);
  if (stats && redacted !== text) stats.count++;
  if (redacted.length <= max) return redacted;
  return redacted.slice(0, max) + "...";
}

function recursiveSanitize<T>(obj: T, stats: { count: number }, depth = 0): any {
  if (depth > 10) return undefined;
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    const originalLength = obj.length;
    const redacted = redactText(obj);
    if (redacted !== obj) stats.count++;
    if (redacted.length > 500) return redacted.slice(0, 500) + "...";
    return redacted;
  }
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => recursiveSanitize(item, stats, depth + 1));
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("cookie") ||
      lowerKey.includes("token") ||
      lowerKey.includes("jwt") ||
      lowerKey.includes("authorization") ||
      lowerKey.includes("storagestate") ||
      lowerKey.includes("session") ||
      lowerKey === "html" ||
      lowerKey === "dom" ||
      lowerKey === "screenshot" ||
      lowerKey.includes("password") ||
      lowerKey.includes("secret")
    ) {
      stats.count++;
      continue; // Skip forbidden keys
    }
    result[key] = recursiveSanitize(value, stats, depth + 1);
  }
  return result;
}

export class ProviderDiagnosticsHistoryService {
  async recordDiagnosticsRun(params: {
    userId: string;
    provider: string;
    connectionId?: string;
    incidentId?: string;
    startedAt: Date;
    completedAt?: Date;
    result: Partial<ProviderUiDiagnosis> | null;
    source: string;
    errorReason?: string;
  }) {
    const { userId, provider, connectionId, incidentId, startedAt, completedAt, result, source, errorReason } = params;

    const stats = { count: 0 };
    
    // Sanitize output
    let status = result?.status || "failed";
    const summaryText = result?.status === "ok" ? "UI diagnostics completed successfully." : result?.status === "error" ? "UI diagnostics failed." : `UI diagnostics returned: ${result?.status}`;
    const summary = safeTruncate(summaryText, MAX_SUMMARY_LENGTH, stats);
    const reason = safeTruncate(errorReason || result?.warnings?.join("; "), MAX_REASON_LENGTH, stats);
    
    // Convert to robust schema mapping
    const detectedCapabilities = result?.candidates?.map((c) => ({
      kind: c.kind,
      confidence: c.confidence,
    })) || [];
    
    const selectorHints = result?.candidates?.map((c) => ({
      kind: c.kind,
      role: safeTruncate(c.role, MAX_HINT_LENGTH, stats),
      dataTestId: safeTruncate(c.dataTestId, MAX_HINT_LENGTH, stats),
      ariaLabel: safeTruncate(c.ariaLabel, MAX_HINT_LENGTH, stats),
      placeholder: safeTruncate(c.placeholder, MAX_HINT_LENGTH, stats),
      tagName: safeTruncate(c.tagName, MAX_HINT_LENGTH, stats),
    })) || [];

    const safeDetected = recursiveSanitize(detectedCapabilities, stats);
    const safeMissing = recursiveSanitize(result?.missingKinds || [], stats);
    const safeHints = recursiveSanitize(selectorHints, stats);

    let severity = "info";
    if (status === "error" || status === "failed") severity = "error";
    if (status === "requires_login" || status === "manual_action_required" || status === "ui_changed") severity = "warning";

    const durationMs = completedAt ? completedAt.getTime() - startedAt.getTime() : undefined;

    const record = await prisma.providerDiagnosticsRun.create({
      data: {
        userId,
        provider,
        connectionId,
        incidentId,
        status,
        summary,
        reason,
        severity,
        detectedCapabilitiesJson: JSON.stringify(safeDetected),
        missingCapabilitiesJson: JSON.stringify(safeMissing),
        selectorHintsJson: JSON.stringify(safeHints),
        redactionStatsJson: JSON.stringify({ redactionsPerformed: stats.count }),
        metadataJson: JSON.stringify({ source, browserEngine: "chromium", diagnosticSchema: "uaiw.provider_diagnostics.v1" }),
        startedAt,
        completedAt,
        durationMs,
      },
    });

    return record;
  }

  async listDiagnosticsRuns(params: { userId: string; provider?: string; incidentId?: string; status?: string; limit?: number }) {
    const { userId, provider, incidentId, status, limit = 50 } = params;
    const runs = await prisma.providerDiagnosticsRun.findMany({
      where: {
        userId,
        ...(provider && { provider }),
        ...(incidentId && { incidentId }),
        ...(status && { status }),
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    return runs.map((r) => {
      const detected = r.detectedCapabilitiesJson ? JSON.parse(r.detectedCapabilitiesJson) : [];
      const missing = r.missingCapabilitiesJson ? JSON.parse(r.missingCapabilitiesJson) : [];
      const stats = r.redactionStatsJson ? JSON.parse(r.redactionStatsJson) : { redactionsPerformed: 0 };
      return {
        id: r.id,
        provider: r.provider,
        connectionId: r.connectionId,
        incidentId: r.incidentId,
        status: r.status,
        summary: r.summary,
        reason: r.reason,
        severity: r.severity,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString(),
        durationMs: r.durationMs,
        detectedCapabilityCount: Array.isArray(detected) ? detected.length : 0,
        missingCapabilityCount: Array.isArray(missing) ? missing.length : 0,
        redactionCount: stats.redactionsPerformed || 0,
      };
    });
  }

  async getDiagnosticsRunDetail(params: { userId: string; runId: string }) {
    const run = await prisma.providerDiagnosticsRun.findUnique({
      where: { id: params.runId },
    });
    if (!run || run.userId !== params.userId) return null;

    return {
      id: run.id,
      provider: run.provider,
      connectionId: run.connectionId,
      incidentId: run.incidentId,
      status: run.status,
      summary: run.summary,
      reason: run.reason,
      severity: run.severity,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString(),
      durationMs: run.durationMs,
      detectedCapabilities: run.detectedCapabilitiesJson ? JSON.parse(run.detectedCapabilitiesJson) : [],
      missingCapabilities: run.missingCapabilitiesJson ? JSON.parse(run.missingCapabilitiesJson) : [],
      selectorHints: run.selectorHintsJson ? JSON.parse(run.selectorHintsJson) : [],
      redactionStats: run.redactionStatsJson ? JSON.parse(run.redactionStatsJson) : {},
      metadata: run.metadataJson ? JSON.parse(run.metadataJson) : {},
    };
  }

  async diffDiagnosticsRuns(params: { userId: string; leftRunId: string; rightRunId: string }): Promise<ProviderDiagnosticsDiffView | null> {
    const left = await this.getDiagnosticsRunDetail({ userId: params.userId, runId: params.leftRunId });
    const right = await this.getDiagnosticsRunDetail({ userId: params.userId, runId: params.rightRunId });

    if (!left || !right) return null;
    if (left.provider !== right.provider) {
      throw new Error("Cannot diff runs from different providers");
    }

    const getKeys = (caps: any[]) => caps.map((c: any) => typeof c === "string" ? c : c.kind);
    const leftDetected = getKeys(left.detectedCapabilities);
    const rightDetected = getKeys(right.detectedCapabilities);
    const leftMissing = getKeys(left.missingCapabilities);
    const rightMissing = getKeys(right.missingCapabilities);

    const addedDetectedCapabilities = rightDetected.filter(k => !leftDetected.includes(k));
    const removedDetectedCapabilities = leftDetected.filter(k => !rightDetected.includes(k));
    
    const addedMissingCapabilities = rightMissing.filter(k => !leftMissing.includes(k));
    const removedMissingCapabilities = leftMissing.filter(k => !rightMissing.includes(k));

    const changedSelectorHints: any[] = [];
    
    const leftHints = left.selectorHints || [];
    const rightHints = right.selectorHints || [];

    const allHintKinds = new Set([...leftHints.map((h: any) => h.kind), ...rightHints.map((h: any) => h.kind)]);
    
    for (const kind of allHintKinds) {
      const lh = leftHints.find((h: any) => h.kind === kind);
      const rh = rightHints.find((h: any) => h.kind === kind);
      
      if (!lh && rh) {
        changedSelectorHints.push({ key: kind, after: JSON.stringify(rh) });
      } else if (lh && !rh) {
        changedSelectorHints.push({ key: kind, before: JSON.stringify(lh) });
      } else if (JSON.stringify(lh) !== JSON.stringify(rh)) {
        changedSelectorHints.push({ key: kind, before: JSON.stringify(lh), after: JSON.stringify(rh) });
      }
    }

    return {
      leftRunId: left.id,
      rightRunId: right.id,
      provider: left.provider,
      changedStatus: left.status !== right.status,
      addedDetectedCapabilities,
      removedDetectedCapabilities,
      addedMissingCapabilities,
      removedMissingCapabilities,
      changedSelectorHints,
    };
  }
}

export const providerDiagnosticsHistoryService = new ProviderDiagnosticsHistoryService();
