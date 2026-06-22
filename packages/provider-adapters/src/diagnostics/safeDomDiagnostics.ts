import type { Page } from "playwright";
import type { ProviderId, ProviderUiDiagnosis, SelectorCandidate } from "@uaiw/shared/types/provider.js";

// Basic redaction for safety
export function redactText(input: string): string {
  let redacted = input;
  // Emails
  redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted-email]");
  // URLs (very basic, we don't need perfect RFC compliance just safe masking)
  redacted = redacted.replace(/https?:\/\/[^\s"'<>]+/g, "[redacted-url]");
  // Long base64/JWT like strings
  redacted = redacted.replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[redacted-token]");
  // Long numbers/UUIDs
  redacted = redacted.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "[redacted-uuid]");
  redacted = redacted.replace(/\b\d{10,}\b/g, "[redacted-number]");
  return redacted;
}

export function truncateSafe(input: string, max = 80): string {
  if (!input) return "";
  const redacted = redactText(input);
  if (redacted.length <= max) return redacted;
  return redacted.slice(0, max) + "...";
}

interface RawElementInfo {
  tagName: string;
  role: string | null;
  dataTestId: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  innerTextPreview: string | null;
  className: string | null;
  id: string | null;
  type: string | null;
  contentEditable: string | null;
  isVisible: boolean;
  isEnabled: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

function generateSafeSelector(info: RawElementInfo): string {
  // Prefer stable, short selectors. Avoid dynamic classes.
  if (info.dataTestId) {
    return `${info.tagName.toLowerCase()}[data-testid="${info.dataTestId}"]`;
  }
  if (info.ariaLabel && info.ariaLabel.length < 30) {
    return `${info.tagName.toLowerCase()}[aria-label="${info.ariaLabel}"]`;
  }
  if (info.role && info.role !== "generic") {
    // maybe tag + role
    return `${info.tagName.toLowerCase()}[role="${info.role}"]`;
  }
  if (info.id && !/\d{5,}/.test(info.id) && info.id.length < 30) {
    return `${info.tagName.toLowerCase()}#${info.id}`;
  }
  if (info.placeholder && info.placeholder.length < 30) {
    return `${info.tagName.toLowerCase()}[placeholder="${info.placeholder}"]`;
  }
  return info.tagName.toLowerCase(); // Fallback to tag name, very weak.
}

export async function runSafeDomDiagnostics(page: Page, provider: ProviderId): Promise<ProviderUiDiagnosis> {
  const elementsInfo = await page.evaluate(() => {
    // Gather all potentially interesting elements securely.
    // We avoid capturing the entire body text.
    const candidates: RawElementInfo[] = [];
    const interactables = document.querySelectorAll("textarea, button, input, [contenteditable='true'], article, [role='textbox'], [role='button'], [role='article'], .message, .conversation");

    for (const el of interactables) {
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== "hidden";
      const isEnabled = !(el as HTMLInputElement).disabled;

      let innerTextPreview = null;
      if (el.tagName === "BUTTON" || el.tagName === "ARTICLE") {
        innerTextPreview = (el as HTMLElement).innerText?.slice(0, 200) || null;
      }

      candidates.push({
        tagName: el.tagName,
        role: el.getAttribute("role"),
        dataTestId: el.getAttribute("data-testid"),
        ariaLabel: el.getAttribute("aria-label"),
        placeholder: el.getAttribute("placeholder"),
        innerTextPreview,
        className: el.className && typeof el.className === "string" ? el.className : null,
        id: el.id,
        type: el.getAttribute("type"),
        contentEditable: el.getAttribute("contenteditable"),
        isVisible,
        isEnabled,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      });
    }

    return candidates;
  });

  const candidates: SelectorCandidate[] = [];

  for (const info of elementsInfo) {
    if (!info.isVisible) continue;

    // Composer Heuristics
    let composerScore = 0;
    if (info.tagName === "TEXTAREA" || info.contentEditable === "true" || info.role === "textbox") composerScore += 0.5;
    if (info.placeholder && /(ask|message|prompt|type)/i.test(info.placeholder)) composerScore += 0.4;
    // Usually composer is in the lower half of the viewport
    if (info.bounds && info.bounds.y > 300) composerScore += 0.1;
    if (info.isEnabled) composerScore += 0.1;

    if (composerScore > 0.6) {
      candidates.push({
        kind: "composer",
        selector: generateSafeSelector(info),
        confidence: Math.min(1, composerScore),
        reason: "Matches common composer attributes (textarea/textbox/placeholder)",
        tagName: info.tagName,
        role: info.role,
        dataTestId: info.dataTestId,
        ariaLabel: truncateSafe(info.ariaLabel || ""),
        placeholder: truncateSafe(info.placeholder || ""),
        visible: info.isVisible,
        enabled: info.isEnabled
      });
    }

    // Send Button Heuristics
    let sendScore = 0;
    if (info.tagName === "BUTTON" || info.role === "button") sendScore += 0.3;
    if (info.ariaLabel && /send/i.test(info.ariaLabel)) sendScore += 0.5;
    if (info.dataTestId && /send/i.test(info.dataTestId)) sendScore += 0.5;
    if (info.type === "submit") sendScore += 0.2;
    if (info.bounds && info.bounds.y > 300) sendScore += 0.1; // Usually near composer

    if (sendScore > 0.6) {
      candidates.push({
        kind: "send_button",
        selector: generateSafeSelector(info),
        confidence: Math.min(1, sendScore),
        reason: "Matches common send button attributes",
        tagName: info.tagName,
        role: info.role,
        dataTestId: info.dataTestId,
        ariaLabel: truncateSafe(info.ariaLabel || ""),
        textPreview: truncateSafe(info.innerTextPreview || ""),
        visible: info.isVisible,
        enabled: info.isEnabled
      });
    }

    // Stop Button Heuristics
    let stopScore = 0;
    if (info.tagName === "BUTTON" || info.role === "button") stopScore += 0.2;
    if (info.ariaLabel && /(stop|cancel)/i.test(info.ariaLabel)) stopScore += 0.6;
    if (info.dataTestId && /(stop|cancel)/i.test(info.dataTestId)) stopScore += 0.6;
    if (info.innerTextPreview && /(stop|cancel)/i.test(info.innerTextPreview)) stopScore += 0.4;

    if (stopScore > 0.6) {
      candidates.push({
        kind: "stop_button",
        selector: generateSafeSelector(info),
        confidence: Math.min(1, stopScore),
        reason: "Matches common stop button attributes",
        tagName: info.tagName,
        role: info.role,
        dataTestId: info.dataTestId,
        ariaLabel: truncateSafe(info.ariaLabel || ""),
        textPreview: truncateSafe(info.innerTextPreview || ""),
        visible: info.isVisible,
        enabled: info.isEnabled
      });
    }

    // Response Container Heuristics
    let responseScore = 0;
    if (info.role === "article" || info.tagName === "ARTICLE") responseScore += 0.4;
    if (info.className && /(message|conversation|assistant)/i.test(info.className)) responseScore += 0.3;
    if (info.dataTestId && /(message|conversation|assistant)/i.test(info.dataTestId)) responseScore += 0.4;
    // Usually not a button or input
    if (info.tagName !== "BUTTON" && info.tagName !== "INPUT" && info.tagName !== "TEXTAREA") responseScore += 0.2;

    if (responseScore > 0.6) {
      candidates.push({
        kind: "response_container",
        selector: generateSafeSelector(info),
        confidence: Math.min(1, responseScore),
        reason: "Matches common response container attributes",
        tagName: info.tagName,
        role: info.role,
        dataTestId: info.dataTestId,
        classNamePreview: info.className,
        visible: info.isVisible
      } as any); // Type cast due to classNamePreview not strictly in interface but safe
    }
    
    // Model Picker Heuristics
    let pickerScore = 0;
    if (info.tagName === "BUTTON" || info.role === "button") pickerScore += 0.3;
    if (info.bounds && info.bounds.y < 200) pickerScore += 0.2; // Usually at the top
    const textOrAria = (info.innerTextPreview || "") + " " + (info.ariaLabel || "");
    if (/(model|GPT|Gemini|Grok|Flash|Pro|reasoning)/i.test(textOrAria)) pickerScore += 0.4;
    
    if (pickerScore > 0.6) {
       candidates.push({
        kind: "model_picker",
        selector: generateSafeSelector(info),
        confidence: Math.min(1, pickerScore),
        reason: "Matches common model picker attributes",
        tagName: info.tagName,
        role: info.role,
        dataTestId: info.dataTestId,
        ariaLabel: truncateSafe(info.ariaLabel || ""),
        textPreview: truncateSafe(info.innerTextPreview || ""),
        visible: info.isVisible,
        enabled: info.isEnabled
      });
    }
  }

  // Deduplicate and sort by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);
  const topCandidates = candidates.slice(0, 20); // Keep it sane

  // Determine missing expected kinds
  const expectedKinds = ["composer", "send_button", "response_container"];
  const foundKinds = new Set(topCandidates.filter(c => c.confidence > 0.7).map(c => c.kind as string));
  const missingKinds = expectedKinds.filter(k => !foundKinds.has(k));

  return {
    provider,
    url: page.url(),
    status: "ok",
    checkedAt: new Date().toISOString(),
    candidates: topCandidates,
    missingKinds,
    warnings: missingKinds.length > 0 ? [`Missing high-confidence candidates for: ${missingKinds.join(", ")}`] : []
  };
}
