import type { BrowserContext, Locator, Page } from "playwright";
import type {
  PromptInput,
  ProviderAuthStatus,
  ProviderEvent,
  ProviderId,
  ProviderSubModel,
  SelectSubModelResult,
  ProviderUiDiagnosis,
  LiveSubModelDetectionResult
} from "@uaiw/shared/types/provider.js";
import { runSafeDomDiagnostics } from "./diagnostics/safeDomDiagnostics.js";
import { detectModelOptionsFromPage } from "./diagnostics/liveSubModelDetection.js";

export interface LoginSession {
  connectSessionId: string;
  provider: ProviderId;
  loginUrl: string;
  status: "connecting" | "manual_action_required" | "connected" | "error";
}

export interface ProviderUiInspection {
  composerFound: boolean;
  sendButtonFound: boolean;
  responseContainerFound: boolean;
  stopButtonFound?: boolean;
  notes: string[];
}

/**
 * Common selector shape shared by every provider adapter. The four
 * `*Candidates` arrays are required; the `*Indicators` arrays are optional
 * because not every provider exposes login / rate-limit / manual-action cues.
 */
export interface ProviderSelectors {
  composerCandidates: readonly string[];
  sendButtonCandidates: readonly string[];
  responseCandidates: readonly string[];
  stopButtonCandidates: readonly string[];
  loginIndicators?: readonly string[];
  manualActionIndicators?: readonly string[];
  rateLimitIndicators?: readonly string[];
}

// Shared timing budget. Identical across all providers; kept here so the
// streaming loops in each adapter read from a single source of truth.
export const NAVIGATION_TIMEOUT_MS = 45_000;
export const COMPOSER_TIMEOUT_MS = 15_000;
export const RESPONSE_TOTAL_TIMEOUT_MS = 120_000;
export const RESPONSE_IDLE_TIMEOUT_MS = 4_500;
export const RESPONSE_POLL_INTERVAL_MS = 750;

export interface ProviderAdapter {
  providerId: ProviderId;
  loginUrl: string;

  startLogin(userId: string): Promise<LoginSession>;
  detectLoggedIn(context: BrowserContext): Promise<ProviderAuthStatus>;
  validateSession(context: BrowserContext): Promise<ProviderAuthStatus>;
  sendMessage(context: BrowserContext, input: PromptInput): AsyncIterable<ProviderEvent>;
  newChat(context: BrowserContext): Promise<void>;
  stopGeneration(context: BrowserContext): Promise<void>;
  exportSession(context: BrowserContext): Promise<unknown>;
  importSession(context: BrowserContext, sessionState: unknown): Promise<void>;
  inspectUi?(context: BrowserContext): Promise<ProviderUiInspection>;

  listSubModels?(context: BrowserContext): Promise<ProviderSubModel[]>;
  selectSubModel?(context: BrowserContext, subModelId: string): Promise<SelectSubModelResult>;
  detectLiveSubModels?(context: BrowserContext): Promise<LiveSubModelDetectionResult>;
  diagnoseUi?(context: BrowserContext): Promise<ProviderUiDiagnosis>;
}

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract providerId: ProviderId;
  abstract loginUrl: string;

  /** Provider-specific DOM selectors. */
  protected abstract readonly selectors: ProviderSelectors;
  /** Human-readable provider name, used in inspection notes. */
  protected abstract readonly providerLabel: string;
  /** Candidate buttons that open the model picker, for live sub-model detection. */
  protected readonly modelPickerCandidates: readonly string[] = [];

  async startLogin(userId: string): Promise<LoginSession> {
    return {
      connectSessionId: `${this.providerId}_${userId}_${Date.now()}`,
      provider: this.providerId,
      loginUrl: this.loginUrl,
      status: "connecting"
    };
  }

  abstract detectLoggedIn(context: BrowserContext): Promise<ProviderAuthStatus>;

  async validateSession(context: BrowserContext): Promise<ProviderAuthStatus> {
    return this.detectLoggedIn(context);
  }

  abstract sendMessage(context: BrowserContext, input: PromptInput): AsyncIterable<ProviderEvent>;

  async newChat(context: BrowserContext): Promise<void> {
    const page = await this.firstPage(context);
    await this.navigate(page);
  }

  async stopGeneration(context: BrowserContext): Promise<void> {
    const page = await this.firstPage(context);
    for (const selector of this.selectors.stopButtonCandidates) {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
        await button.click({ timeout: 1000 }).catch(() => {});
        return;
      }
    }
  }

  async exportSession(context: BrowserContext): Promise<unknown> {
    return context.storageState();
  }

  async importSession(_context: BrowserContext, _sessionState: unknown): Promise<void> {
    // Playwright storageState is supplied when the browser context is created.
  }

  async inspectUi(context: BrowserContext): Promise<ProviderUiInspection> {
    const page = await this.firstPage(context);
    await this.navigate(page);

    const composerFound = await this.firstVisible(page, this.selectors.composerCandidates, 5000);
    const sendButtonFound = await this.firstVisible(page, this.selectors.sendButtonCandidates, 1500);
    const responseContainerFound = await this.firstVisible(page, this.selectors.responseCandidates, 1500);
    const stopButtonFound = await this.firstVisible(page, this.selectors.stopButtonCandidates, 500);

    return {
      composerFound,
      sendButtonFound,
      responseContainerFound,
      stopButtonFound: stopButtonFound || undefined,
      notes: composerFound ? [] : [`${this.providerLabel} composer was not visible.`]
    };
  }

  async diagnoseUi(context: BrowserContext): Promise<ProviderUiDiagnosis> {
    const page = await context.newPage();
    try {
      await this.navigate(page);
      const authStatus = await this.detectLoggedIn(context);

      if (authStatus === "requires_login") {
        return { provider: this.providerId, url: page.url(), status: "requires_login", checkedAt: new Date().toISOString(), candidates: [], missingKinds: [], warnings: ["Login required. Cannot diagnose chat UI."] };
      }
      if (authStatus === "manual_action_required") {
        return { provider: this.providerId, url: page.url(), status: "manual_action_required", checkedAt: new Date().toISOString(), candidates: [], missingKinds: [], warnings: ["Manual action required. Cannot diagnose chat UI."] };
      }

      await page.waitForTimeout(2000);
      return await runSafeDomDiagnostics(page, this.providerId);
    } catch (err: any) {
      return { provider: this.providerId, url: page.url(), status: "error", checkedAt: new Date().toISOString(), candidates: [], missingKinds: [], warnings: [err.message] };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async detectLiveSubModels(context: BrowserContext): Promise<LiveSubModelDetectionResult> {
    const page = await context.newPage();
    try {
      await this.navigate(page);
      const authStatus = await this.detectLoggedIn(context);

      if (authStatus === "requires_login") {
        return { provider: this.providerId, status: "requires_login", detectedAt: new Date().toISOString(), subModels: [], warnings: [] };
      }
      if (authStatus === "manual_action_required") {
        return { provider: this.providerId, status: "manual_action_required", detectedAt: new Date().toISOString(), subModels: [], warnings: [] };
      }

      await page.waitForTimeout(2000);

      let clicked = false;
      for (const sel of this.modelPickerCandidates) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click({ timeout: 1000 }).catch(() => {});
          await page.waitForTimeout(1000); // Wait for menu to animate in
          clicked = true;
          break;
        }
      }

      const subModels = await detectModelOptionsFromPage(page, this.providerId);

      if (clicked) {
        await page.keyboard.press("Escape").catch(() => {});
      }

      if (subModels.length === 0) {
        return { provider: this.providerId, status: "ui_changed", detectedAt: new Date().toISOString(), subModels: [], warnings: ["No sub-models detected. UI may have changed."] };
      }

      return { provider: this.providerId, status: "ok", detectedAt: new Date().toISOString(), subModels, warnings: [] };
    } catch (err: any) {
      return { provider: this.providerId, status: "error", errorCode: "UNKNOWN_SAFE_ERROR", detectedAt: new Date().toISOString(), subModels: [], warnings: [err.message] };
    } finally {
      await page.close().catch(() => {});
    }
  }

  // --- Shared helpers ------------------------------------------------------

  protected async firstPage(context: BrowserContext): Promise<Page> {
    const [existing] = context.pages();
    return existing ?? context.newPage();
  }

  /**
   * Navigate to the provider entry point. The default loads `loginUrl`;
   * providers with bespoke navigation (e.g. Grok / Cloudflare) override this.
   */
  protected async navigate(page: Page): Promise<void> {
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }

  /** Provider-specific filter for "chrome" (navigation/menu) text vs. a real reply. */
  protected isLikelyChromeText(_text: string): boolean {
    return false;
  }

  protected async getVisibleComposer(page: Page, timeoutMs: number = COMPOSER_TIMEOUT_MS): Promise<Locator | null> {
    return this.waitForFirstLocator(page, this.selectors.composerCandidates, timeoutMs);
  }

  protected async fillComposer(page: Page, composer: Locator, prompt: string): Promise<void> {
    await composer.click({ timeout: 5000 });
    await composer.fill(prompt).catch(async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.insertText(prompt);
    });
  }

  protected async clickSend(page: Page): Promise<boolean> {
    for (const selector of this.selectors.sendButtonCandidates) {
      const button = page.locator(selector).last();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        const disabled = await button.isDisabled({ timeout: 250 }).catch(() => false);
        if (!disabled) {
          await button.click({ timeout: 3000 }).catch(() => {});
          return true;
        }
      }
    }
    return false;
  }

  protected async latestResponseText(page: Page): Promise<string> {
    for (const selector of this.selectors.responseCandidates) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let index = count - 1; index >= 0; index -= 1) {
        const candidate = locator.nth(index);
        if (!(await candidate.isVisible({ timeout: 250 }).catch(() => false))) continue;
        const text = this.normalizeResponseText((await candidate.innerText().catch(() => "")) ?? "");
        if (text && !this.isLikelyChromeText(text)) {
          return text;
        }
      }
    }
    return "";
  }

  protected normalizeResponseText(text: string): string {
    return text
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  protected async detectRateLimit(page: Page): Promise<boolean> {
    return this.firstVisible(page, this.selectors.rateLimitIndicators ?? [], 250);
  }

  /** True if any of `selectors` becomes visible within `timeoutMs`. */
  protected async firstVisible(page: Page, selectors: readonly string[], timeoutMs: number): Promise<boolean> {
    return (await this.waitForFirstLocator(page, selectors, timeoutMs)) !== null;
  }

  /**
   * Race the given selectors and resolve with the first visible Locator, or
   * null on timeout. Shared by `firstVisible` and `getVisibleComposer`.
   */
  private async waitForFirstLocator(page: Page, selectors: readonly string[], timeoutMs: number): Promise<Locator | null> {
    if (selectors.length === 0) return null;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) break;

      try {
        return await Promise.any(
          selectors.map(async (selector) => {
            const loc = page.locator(selector).locator("visible=true").first();
            await loc.waitFor({ state: "visible", timeout: remaining });
            return loc;
          })
        );
      } catch (err: any) {
        if (err.name === "AggregateError" || err instanceof AggregateError) {
          if (err.errors.every((e: any) => e.message?.includes("Timeout") || e.name === "TimeoutError")) return null;
        } else if (err.message?.includes("Timeout") || err.name === "TimeoutError") {
          return null;
        }
        await page.waitForTimeout(500).catch(() => {});
      }
    }
    return null;
  }
}
