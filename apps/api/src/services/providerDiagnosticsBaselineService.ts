import { prisma } from "./prisma.js";
import { providerDiagnosticsHistoryService, ProviderDiagnosticsDiffView } from "./providerDiagnosticsHistoryService.js";
import { createHash } from "crypto";

export type DiagnosticsDriftEvaluation = {
  baselineId?: string;
  runId: string;
  provider: string;
  driftScore: number;
  severity: "none" | "info" | "warning" | "error";
  summary: string;
  addedDetectedCapabilities: string[];
  removedDetectedCapabilities: string[];
  addedMissingCapabilities: string[];
  removedMissingCapabilities: string[];
  changedSelectorHints: Array<{ key: string; before?: string; after?: string }>;
  shouldAlert: boolean;
};

export class ProviderDiagnosticsBaselineService {
  async createBaselineFromRun(params: {
    userId: string;
    runId: string;
    name: string;
    setActive: boolean;
  }) {
    const run = await providerDiagnosticsHistoryService.getDiagnosticsRunDetail({ userId: params.userId, runId: params.runId });
    if (!run) throw new Error("Diagnostics run not found");

    const safeName = params.name.substring(0, 100);
    
    // Compute fingerprint
    const fingerprintInput = {
      detected: run.detectedCapabilities,
      missing: run.missingCapabilities,
      hints: run.selectorHints.map((h: any) => ({ kind: h.kind, role: h.role, tagName: h.tagName, dataTestId: h.dataTestId }))
    };
    const fingerprint = createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex");

    if (params.setActive) {
      // Deactivate others
      await prisma.providerDiagnosticsBaseline.updateMany({
        where: {
          userId: params.userId,
          provider: run.provider,
          connectionId: run.connectionId || null,
          isActive: true
        },
        data: { isActive: false }
      });
    }

    const baseline = await prisma.providerDiagnosticsBaseline.create({
      data: {
        userId: params.userId,
        provider: run.provider,
        connectionId: run.connectionId,
        name: safeName,
        sourceRunId: run.id,
        status: run.status,
        fingerprint,
        detectedCapabilitiesJson: JSON.stringify(run.detectedCapabilities),
        missingCapabilitiesJson: JSON.stringify(run.missingCapabilities),
        selectorHintsJson: JSON.stringify(run.selectorHints),
        metadataJson: JSON.stringify({
          sourceRunDate: run.startedAt,
          capabilitiesCount: run.detectedCapabilities.length
        }),
        isActive: params.setActive
      }
    });

    return baseline;
  }

  async getActiveBaseline(params: { userId: string; provider: string; connectionId?: string }) {
    return prisma.providerDiagnosticsBaseline.findFirst({
      where: {
        userId: params.userId,
        provider: params.provider,
        connectionId: params.connectionId || null,
        isActive: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async listBaselines(params: { userId: string; provider?: string; isActive?: boolean; limit?: number }) {
    return prisma.providerDiagnosticsBaseline.findMany({
      where: {
        userId: params.userId,
        ...(params.provider && { provider: params.provider }),
        ...(params.isActive !== undefined && { isActive: params.isActive })
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 50
    });
  }

  async deactivateBaseline(params: { userId: string; baselineId: string }) {
    const baseline = await prisma.providerDiagnosticsBaseline.findUnique({ where: { id: params.baselineId } });
    if (!baseline || baseline.userId !== params.userId) throw new Error("Baseline not found");

    return prisma.providerDiagnosticsBaseline.update({
      where: { id: params.baselineId },
      data: { isActive: false }
    });
  }

  async evaluateDrift(params: { userId: string; runId: string }): Promise<DiagnosticsDriftEvaluation> {
    const run = await providerDiagnosticsHistoryService.getDiagnosticsRunDetail({ userId: params.userId, runId: params.runId });
    if (!run) throw new Error("Run not found");

    const baseline = await this.getActiveBaseline({ userId: params.userId, provider: run.provider, connectionId: run.connectionId || undefined });
    
    const evaluation: DiagnosticsDriftEvaluation = {
      baselineId: baseline?.id,
      runId: run.id,
      provider: run.provider,
      driftScore: 0,
      severity: "none",
      summary: "No baseline found for comparison.",
      addedDetectedCapabilities: [],
      removedDetectedCapabilities: [],
      addedMissingCapabilities: [],
      removedMissingCapabilities: [],
      changedSelectorHints: [],
      shouldAlert: false
    };

    if (!baseline) return evaluation;

    // We can compute diff manually between baseline and run, because diffDiagnosticsRuns expects two runs in the DB
    // Since baseline is essentially a snapshot, we can use the same logic
    
    const getKeys = (caps: any[]) => caps.map((c: any) => typeof c === "string" ? c : c.kind);
    const leftDetected = getKeys(baseline.detectedCapabilitiesJson ? JSON.parse(baseline.detectedCapabilitiesJson) : []);
    const rightDetected = getKeys(run.detectedCapabilities);
    const leftMissing = getKeys(baseline.missingCapabilitiesJson ? JSON.parse(baseline.missingCapabilitiesJson) : []);
    const rightMissing = getKeys(run.missingCapabilities);

    evaluation.addedDetectedCapabilities = rightDetected.filter(k => !leftDetected.includes(k));
    evaluation.removedDetectedCapabilities = leftDetected.filter(k => !rightDetected.includes(k));
    evaluation.addedMissingCapabilities = rightMissing.filter(k => !leftMissing.includes(k));
    evaluation.removedMissingCapabilities = leftMissing.filter(k => !rightMissing.includes(k));

    const leftHints = baseline.selectorHintsJson ? JSON.parse(baseline.selectorHintsJson) : [];
    const rightHints = run.selectorHints || [];
    const allHintKinds = new Set([...leftHints.map((h: any) => h.kind), ...rightHints.map((h: any) => h.kind)]);
    
    for (const kind of allHintKinds) {
      const lh = leftHints.find((h: any) => h.kind === kind);
      const rh = rightHints.find((h: any) => h.kind === kind);
      if (!lh && rh) {
        evaluation.changedSelectorHints.push({ key: kind, after: JSON.stringify(rh) });
      } else if (lh && !rh) {
        evaluation.changedSelectorHints.push({ key: kind, before: JSON.stringify(lh) });
      } else if (JSON.stringify(lh) !== JSON.stringify(rh)) {
        evaluation.changedSelectorHints.push({ key: kind, before: JSON.stringify(lh), after: JSON.stringify(rh) });
      }
    }

    // Scoring
    let score = 0;
    score += evaluation.removedDetectedCapabilities.length * 25;
    score += evaluation.addedMissingCapabilities.length * 30;
    score += evaluation.changedSelectorHints.length * 10;
    score += evaluation.addedDetectedCapabilities.length * 5;
    
    if (baseline.status !== run.status && (run.status === "error" || run.status === "failed" || run.status === "requires_login" || run.status === "ui_changed")) {
      score += 30;
    }

    score = Math.min(score, 100);
    evaluation.driftScore = score;

    if (score === 0) evaluation.severity = "none";
    else if (score < 25) evaluation.severity = "info";
    else if (score < 60) evaluation.severity = "warning";
    else evaluation.severity = "error";

    evaluation.shouldAlert = score >= 25; // warning or error

    if (score === 0) {
      evaluation.summary = "No UI drift detected compared to active baseline.";
    } else {
      evaluation.summary = `Detected UI drift (Score: ${score}). ${evaluation.removedDetectedCapabilities.length} capabilities lost, ${evaluation.addedMissingCapabilities.length} new missing flags, ${evaluation.changedSelectorHints.length} selectors changed.`;
    }

    return evaluation;
  }
}

export const providerDiagnosticsBaselineService = new ProviderDiagnosticsBaselineService();
