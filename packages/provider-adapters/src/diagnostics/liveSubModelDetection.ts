import type { Page } from "playwright";
import type { ProviderId, LiveDetectedSubModel } from "@uaiw/shared/types/provider.js";

export function normalizeSubModelLabel(label: string): string {
  if (!label) return "";
  return label.replace(/\s+/g, " ").trim();
}

export function buildSubModelId(provider: ProviderId, label: string): string {
  const norm = normalizeSubModelLabel(label).toLowerCase();
  if (!norm) return `${provider}-unknown-${Date.now()}`;
  return `${provider}-${norm.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

export function redactModelOptionText(text: string): string {
  if (!text) return "";
  let redacted = text;
  
  // Redact emails
  redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]");
  
  // Hard ignore strings that are clear upgrade/upsell calls to action
  if (/(upgrade to|subscribe to|get plus|renew now|manage subscription)/i.test(redacted)) {
    return "";
  }
  
  return redacted.trim();
}

function getProviderKeywords(provider: ProviderId): RegExp[] {
  switch (provider) {
    case "chatgpt":
      return [/gpt/i, /o3/i, /o1/i, /reasoning/i, /mini/i, /alpha/i, /legacy/i];
    case "gemini":
      return [/gemini/i, /flash/i, /pro/i, /thinking/i, /experimental/i];
    case "grok":
      return [/grok/i, /think/i, /deepsearch/i, /beta/i];
    default:
      return [];
  }
}

export async function detectModelOptionsFromPage(page: Page, provider: ProviderId): Promise<LiveDetectedSubModel[]> {
  const elementsInfo = await page.evaluate(() => {
    // Look for items typically found in dropdowns or selection lists
    const candidates = Array.from(document.querySelectorAll("[role='menuitem'], [role='option'], [role='button'], li.menu-item, div.item"));
    
    return candidates.map(el => {
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== "hidden";
      const isEnabled = !(el as HTMLInputElement).disabled;
      
      return {
        tagName: el.tagName,
        role: el.getAttribute("role"),
        dataTestId: el.getAttribute("data-testid"),
        ariaLabel: el.getAttribute("aria-label"),
        innerText: (el as HTMLElement).innerText?.slice(0, 100) || "",
        isVisible,
        isEnabled
      };
    }).filter(info => info.isVisible);
  });

  const keywords = getProviderKeywords(provider);
  const detectedMap = new Map<string, LiveDetectedSubModel>();

  for (const info of elementsInfo) {
    // Extract potential label
    let rawText = info.innerText;
    if (!rawText && info.ariaLabel) {
      rawText = info.ariaLabel;
    }
    
    const redacted = redactModelOptionText(rawText);
    if (!redacted || redacted.length < 2 || redacted.length > 50) {
      continue;
    }

    const label = normalizeSubModelLabel(redacted);
    if (!label) continue;

    // Calculate confidence
    let confidence = 0.1;
    for (const kw of keywords) {
      if (kw.test(label)) {
        confidence += 0.4;
        break;
      }
    }
    
    if (info.role === "menuitem" || info.role === "option") {
      confidence += 0.3;
    }
    if (info.dataTestId && /model/i.test(info.dataTestId)) {
      confidence += 0.3;
    }

    confidence = Math.min(1.0, confidence);

    // Only accept items with some reasonable confidence to avoid picking up generic buttons
    if (confidence >= 0.4) {
      const id = buildSubModelId(provider, label);
      
      // Deduplicate: Keep highest confidence or if equal, the first one
      const existing = detectedMap.get(id);
      if (!existing || existing.confidence < confidence) {
        detectedMap.set(id, {
          id,
          label,
          provider,
          source: "live",
          confidence,
          availability: info.isEnabled ? "visible" : "disabled",
          detectedAt: new Date().toISOString(),
          hints: {
            role: info.role,
            ariaLabel: info.ariaLabel,
            dataTestId: info.dataTestId
          }
        });
      }
    }
  }

  return Array.from(detectedMap.values()).sort((a, b) => b.confidence - a.confidence);
}
