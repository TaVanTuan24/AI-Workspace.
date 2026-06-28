import { prisma } from "./prisma.js";
import { providerDiagnosticsBaselineService, DiagnosticsDriftEvaluation } from "./providerDiagnosticsBaselineService.js";
import { createHash } from "crypto";

export class ProviderDiagnosticsDriftAlertService {
  async evaluateAfterDiagnosticsRun(params: { userId: string; runId: string }) {
    const evaluation = await providerDiagnosticsBaselineService.evaluateDrift(params);
    
    if (evaluation.shouldAlert && evaluation.baselineId) {
      // Create or update drift alert
      const alertFingerprintInput = {
        baselineId: evaluation.baselineId,
        provider: evaluation.provider,
        removedDetected: evaluation.removedDetectedCapabilities,
        addedMissing: evaluation.addedMissingCapabilities,
      };
      
      const driftSummaryHash = createHash("sha256").update(JSON.stringify(alertFingerprintInput)).digest("hex");

      // Idempotency: find open alert for this baseline and provider
      const existingAlert = await prisma.providerDiagnosticsDriftAlert.findFirst({
        where: {
          userId: params.userId,
          provider: evaluation.provider,
          baselineId: evaluation.baselineId,
          status: "open"
        }
      });

      if (existingAlert) {
        // Update existing
        return prisma.providerDiagnosticsDriftAlert.update({
          where: { id: existingAlert.id },
          data: {
            diagnosticsRunId: params.runId,
            severity: evaluation.severity,
            driftScore: evaluation.driftScore,
            summary: evaluation.summary,
            addedDetectedCapabilitiesJson: JSON.stringify(evaluation.addedDetectedCapabilities),
            removedDetectedCapabilitiesJson: JSON.stringify(evaluation.removedDetectedCapabilities),
            addedMissingCapabilitiesJson: JSON.stringify(evaluation.addedMissingCapabilities),
            removedMissingCapabilitiesJson: JSON.stringify(evaluation.removedMissingCapabilities),
            changedSelectorHintsJson: JSON.stringify(evaluation.changedSelectorHints),
            metadataJson: JSON.stringify({ driftSummaryHash })
          }
        });
      } else {
        // Create new
        const created = await prisma.providerDiagnosticsDriftAlert.create({
          data: {
            userId: params.userId,
            provider: evaluation.provider,
            baselineId: evaluation.baselineId,
            diagnosticsRunId: params.runId,
            severity: evaluation.severity,
            status: "open",
            driftScore: evaluation.driftScore,
            summary: evaluation.summary,
            addedDetectedCapabilitiesJson: JSON.stringify(evaluation.addedDetectedCapabilities),
            removedDetectedCapabilitiesJson: JSON.stringify(evaluation.removedDetectedCapabilities),
            addedMissingCapabilitiesJson: JSON.stringify(evaluation.addedMissingCapabilities),
            removedMissingCapabilitiesJson: JSON.stringify(evaluation.removedMissingCapabilities),
            changedSelectorHintsJson: JSON.stringify(evaluation.changedSelectorHints),
            metadataJson: JSON.stringify({ driftSummaryHash })
          }
        });
        return created;
      }
    } else if (evaluation.driftScore < 25 && evaluation.baselineId) {
      // Auto-resolve if score drops below threshold (e.g. run matches baseline)
      const existingAlerts = await prisma.providerDiagnosticsDriftAlert.findMany({
        where: {
          userId: params.userId,
          provider: evaluation.provider,
          baselineId: evaluation.baselineId,
          status: "open"
        }
      });

      for (const alert of existingAlerts) {
        await prisma.providerDiagnosticsDriftAlert.update({
          where: { id: alert.id },
          data: {
            status: "resolved",
            resolvedAt: new Date(),
            summary: `Auto-resolved: Drift score dropped to ${evaluation.driftScore}.`
          }
        });
      }
    }

    return null;
  }

  async listDriftAlerts(params: { userId: string; provider?: string; status?: string; severity?: string; limit?: number }) {
    const alerts = await prisma.providerDiagnosticsDriftAlert.findMany({
      where: {
        userId: params.userId,
        ...(params.provider && { provider: params.provider }),
        ...(params.status && params.status !== "all" && { status: params.status }),
        ...(params.severity && { severity: params.severity })
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 50
    });

    return alerts.map(a => this.toDto(a));
  }

  async getDriftAlertDetail(params: { userId: string; alertId: string }) {
    const alert = await prisma.providerDiagnosticsDriftAlert.findUnique({ where: { id: params.alertId } });
    if (!alert || alert.userId !== params.userId) return null;
    return this.toDto(alert);
  }

  async resolveAlert(params: { userId: string; alertId: string; resolution: string; note?: string }) {
    const alert = await prisma.providerDiagnosticsDriftAlert.findUnique({ where: { id: params.alertId } });
    if (!alert || alert.userId !== params.userId) throw new Error("Alert not found");
    if (alert.status === "resolved") throw new Error("Alert already resolved");

    const safeNote = params.note?.substring(0, 500);

    const updated = await prisma.providerDiagnosticsDriftAlert.update({
      where: { id: alert.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
        metadataJson: JSON.stringify({
          ...(alert.metadataJson ? JSON.parse(alert.metadataJson) : {}),
          resolution: params.resolution,
          resolutionNote: safeNote
        })
      }
    });

    return this.toDto(updated);
  }

  private toDto(alert: any) {
    return {
      id: alert.id,
      provider: alert.provider,
      connectionId: alert.connectionId,
      baselineId: alert.baselineId,
      diagnosticsRunId: alert.diagnosticsRunId,
      severity: alert.severity,
      status: alert.status,
      driftScore: alert.driftScore,
      summary: alert.summary,
      addedDetectedCapabilities: alert.addedDetectedCapabilitiesJson ? JSON.parse(alert.addedDetectedCapabilitiesJson) : [],
      removedDetectedCapabilities: alert.removedDetectedCapabilitiesJson ? JSON.parse(alert.removedDetectedCapabilitiesJson) : [],
      addedMissingCapabilities: alert.addedMissingCapabilitiesJson ? JSON.parse(alert.addedMissingCapabilitiesJson) : [],
      removedMissingCapabilities: alert.removedMissingCapabilitiesJson ? JSON.parse(alert.removedMissingCapabilitiesJson) : [],
      changedSelectorHints: alert.changedSelectorHintsJson ? JSON.parse(alert.changedSelectorHintsJson) : [],
      metadata: alert.metadataJson ? JSON.parse(alert.metadataJson) : {},
      createdAt: alert.createdAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
    };
  }
}

export const providerDiagnosticsDriftAlertService = new ProviderDiagnosticsDriftAlertService();
