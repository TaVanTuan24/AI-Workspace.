import type { BrowserContext } from "playwright";
import type { ProviderAdapter } from "@uaiw/provider-adapters/ProviderAdapter.js";
import type { ProviderId } from "@uaiw/shared/types/provider.js";
import type { SmokeCheck } from "./report.js";

export interface ModeResult {
  checks: SmokeCheck[];
  responseText?: string;
}

export async function validateSessionMode(adapter: ProviderAdapter, context: BrowserContext): Promise<ModeResult> {
  const checks: SmokeCheck[] = [];
  const status = await adapter.validateSession(context);
  checks.push({
    name: "validate_session_connected",
    status: status === "connected" ? "pass" : "fail",
    message: status
  });
  return { checks };
}

export async function detectUiMode(input: {
  provider: ProviderId;
  adapter: ProviderAdapter;
  context: BrowserContext;
}): Promise<ModeResult> {
  if (!input.adapter.inspectUi) {
    return {
      checks: [{ name: "detect_ui_supported", status: "warn", message: "UI inspection is not implemented for this provider." }]
    };
  }

  const inspection = await input.adapter.inspectUi(input.context);

  return {
    checks: [
      { name: "composer_found", status: inspection.composerFound ? "pass" : "fail" },
      { name: "send_button_found", status: inspection.sendButtonFound ? "pass" : "warn" },
      { name: "response_container_found", status: inspection.responseContainerFound ? "pass" : "warn" },
      ...(inspection.stopButtonFound
        ? [{ name: "stop_button_found", status: "pass" as const }]
        : []),
      ...inspection.notes.map((note): SmokeCheck => ({ name: "ui_note", status: "warn", message: note }))
    ]
  };
}

export async function sendMessageMode(input: {
  adapter: ProviderAdapter;
  context: BrowserContext;
  provider: ProviderId;
  prompt: string;
  timeoutMs: number;
}): Promise<ModeResult> {
  const checks: SmokeCheck[] = [
    { name: "real_prompt_acknowledged", status: "pass", message: "--yes provided" }
  ];
  let started = false;
  let completed = false;
  let deltaCount = 0;
  let finalText = "";

  const deadline = Date.now() + input.timeoutMs;
  for await (const event of input.adapter.sendMessage(input.context, {
    userId: "smoke",
    jobId: `smoke_${Date.now()}`,
    prompt: input.prompt,
    saveHistory: false
  })) {
    if (Date.now() > deadline) throw new Error("PROVIDER_TIMEOUT");
    if (event.type === "started") started = true;
    if (event.type === "message_delta") {
      deltaCount += 1;
      finalText += event.text;
    }
    if (event.type === "message_complete") {
      completed = true;
      finalText = event.text;
    }
    if (event.type === "error") throw new Error(event.errorCode);
    if (event.type === "requires_login") throw new Error("REQUIRES_LOGIN");
    if (event.type === "manual_action_required") throw new Error("MANUAL_ACTION_REQUIRED");
  }

  checks.push({ name: "send_message_started", status: started ? "pass" : "fail" });
  checks.push({ name: "message_delta_count", status: deltaCount > 0 ? "pass" : "warn", message: String(deltaCount) });
  checks.push({ name: "message_complete", status: completed ? "pass" : "fail" });

  return { checks, responseText: finalText };
}

export async function stopGenerationMode(input: {
  adapter: ProviderAdapter;
  context: BrowserContext;
}): Promise<ModeResult> {
  await input.adapter.stopGeneration(input.context).catch(() => {});
  return {
    checks: [{ name: "stop_generation_no_fatal_error", status: "warn", message: "Best-effort stop attempted." }]
  };
}

export async function diagnoseUiMode(input: {
  provider: ProviderId;
  adapter: ProviderAdapter;
  context: BrowserContext;
}): Promise<ModeResult> {
  if (!input.adapter.diagnoseUi) {
    return {
      checks: [{ name: "diagnose_ui_supported", status: "warn", message: "UI diagnosis is not implemented for this provider." }]
    };
  }

  const diagnosis = await input.adapter.diagnoseUi(input.context);
  const checks: SmokeCheck[] = [];

  const safeDiagnosis = {
    missingKinds: diagnosis.missingKinds,
    candidateCounts: {
      composer: diagnosis.candidates.filter(c => c.kind === "composer").length,
      send_button: diagnosis.candidates.filter(c => c.kind === "send_button").length,
      response_container: diagnosis.candidates.filter(c => c.kind === "response_container").length,
      stop_button: diagnosis.candidates.filter(c => c.kind === "stop_button").length,
      model_picker: diagnosis.candidates.filter(c => c.kind === "model_picker").length
    },
    topCandidates: diagnosis.candidates.slice(0, 5).map(c => ({
      kind: c.kind,
      selector: c.selector,
      confidence: c.confidence,
      reason: c.reason
    }))
  };

  if (diagnosis.status === "ok") {
    checks.push({
      name: "safe-dom-diagnostics",
      status: diagnosis.missingKinds.length > 0 ? "warn" : "pass",
      message: JSON.stringify(safeDiagnosis)
    });
  } else {
    checks.push({
      name: "safe-dom-diagnostics",
      status: "fail",
      message: diagnosis.status + (diagnosis.warnings.length ? `: ${diagnosis.warnings.join(", ")}` : "")
    });
  }

  return { checks };
}
