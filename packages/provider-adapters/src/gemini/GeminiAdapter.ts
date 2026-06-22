import type { BrowserContext, Page } from "playwright";
import type { PromptInput, ProviderAuthStatus, ProviderEvent, ProviderUiDiagnosis } from "@uaiw/shared/types/provider.js";
import { BaseProviderAdapter, type ProviderUiInspection } from "../ProviderAdapter.js";
import { runSafeDomDiagnostics } from "../diagnostics/safeDomDiagnostics.js";
import { detectModelOptionsFromPage } from "../diagnostics/liveSubModelDetection.js";
import type { LiveSubModelDetectionResult } from "@uaiw/shared/types/provider.js";
import { GEMINI_SELECTORS } from "./selectors.js";

const NAVIGATION_TIMEOUT_MS = 45_000;
const COMPOSER_TIMEOUT_MS = 15_000;
const RESPONSE_TOTAL_TIMEOUT_MS = 120_000;
const RESPONSE_IDLE_TIMEOUT_MS = 4_500;
const RESPONSE_POLL_INTERVAL_MS = 750;

export class GeminiAdapter extends BaseProviderAdapter {
  providerId = "gemini" as const;
  loginUrl = "https://gemini.google.com/app";

  async detectLoggedIn(context: BrowserContext): Promise<ProviderAuthStatus> {
    const page = await this.firstPage(context);
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const url = page.url();
    if (/accounts\.google\.com|ServiceLogin|signin/i.test(url)) {
      return "requires_login";
    }

    const composer = this.composerLocator(page);
    const signIn = page.getByRole("link", { name: /sign in/i });
    const accountChooser = page.getByText(/choose an account|use another account|verify/i).first();

    if (await composer.isVisible({ timeout: 5000 }).catch(() => false)) {
      return "connected";
    }

    if (await signIn.isVisible({ timeout: 1000 }).catch(() => false)) {
      return "requires_login";
    }

    if (await accountChooser.isVisible({ timeout: 1000 }).catch(() => false)) {
      return "manual_action_required";
    }

    return "manual_action_required";
  }

  async validateSession(context: BrowserContext): Promise<ProviderAuthStatus> {
    return this.detectLoggedIn(context);
  }

  async exportSession(context: BrowserContext): Promise<unknown> {
    return context.storageState();
  }

  async importSession(_context: BrowserContext, _sessionState: unknown): Promise<void> {
    // Storage state is supplied when the browser context is created.
  }

  async inspectUi(context: BrowserContext): Promise<ProviderUiInspection> {
    const page = await this.firstPage(context);
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const composerFound = await this.firstVisible(page, GEMINI_SELECTORS.composerCandidates, 5000);
    const sendButtonFound = await this.firstVisible(page, GEMINI_SELECTORS.sendButtonCandidates, 1500);
    const responseContainerFound = await this.firstVisible(page, GEMINI_SELECTORS.responseCandidates, 1500);
    const stopButtonFound = await this.firstVisible(page, GEMINI_SELECTORS.stopButtonCandidates, 500);

    return {
      composerFound,
      sendButtonFound,
      responseContainerFound,
      stopButtonFound: stopButtonFound || undefined,
      notes: composerFound ? [] : ["Gemini composer was not visible."]
    };
  }

  async *sendMessage(
    context: BrowserContext,
    input: PromptInput
  ): AsyncIterable<ProviderEvent> {
    const page = await this.firstPage(context);
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const status = await this.detectLoggedIn(context);
    if (status !== "connected") {
      yield {
        type: status === "manual_action_required" ? "manual_action_required" : "requires_login",
        provider: this.providerId,
        jobId: input.jobId,
        message: "Please complete Gemini login or verification in the browser window."
      };
      return;
    }

    const composer = this.composerLocator(page);
    if (!(await composer.isVisible({ timeout: COMPOSER_TIMEOUT_MS }).catch(() => false))) {
      yield {
        type: "error",
        provider: this.providerId,
        jobId: input.jobId,
        errorCode: "PROVIDER_UI_CHANGED",
        message: "Gemini composer was not found. The provider UI may have changed."
      };
      return;
    }

    yield { type: "started", provider: this.providerId, jobId: input.jobId };

    await composer.click({ timeout: 5000 });
    await composer.fill(input.prompt).catch(async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.insertText(input.prompt);
    });

    const beforeResponseText = await this.latestResponseText(page);
    const sent = await this.clickSend(page);
    if (!sent) {
      await page.keyboard.press("Enter");
    }

    let lastText = "";
    let lastChangeAt = Date.now();
    const startedAt = Date.now();

    while (Date.now() - startedAt < RESPONSE_TOTAL_TIMEOUT_MS) {
      await page.waitForTimeout(RESPONSE_POLL_INTERVAL_MS);
      const current = await this.latestResponseText(page);
      const normalizedCurrent = this.normalizeResponseText(current);

      if (
        normalizedCurrent &&
        normalizedCurrent !== beforeResponseText &&
        normalizedCurrent !== lastText
      ) {
        const delta = normalizedCurrent.startsWith(lastText)
          ? normalizedCurrent.slice(lastText.length)
          : normalizedCurrent;

        lastText = normalizedCurrent;
        lastChangeAt = Date.now();

        if (delta) {
          yield {
            type: "message_delta",
            provider: this.providerId,
            jobId: input.jobId,
            text: delta
          };
        }
      }

      if (lastText && Date.now() - lastChangeAt >= RESPONSE_IDLE_TIMEOUT_MS) {
        yield {
          type: "message_complete",
          provider: this.providerId,
          jobId: input.jobId,
          text: lastText
        };
        return;
      }
    }

    if (lastText) {
      yield {
        type: "message_complete",
        provider: this.providerId,
        jobId: input.jobId,
        text: lastText
      };
      return;
    }

    yield {
      type: "error",
      provider: this.providerId,
      jobId: input.jobId,
      errorCode: "PROVIDER_TIMEOUT",
      message: "Gemini did not finish response in time."
    };
  }

  async newChat(context: BrowserContext): Promise<void> {
    const page = await this.firstPage(context);
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" });
  }

  async stopGeneration(context: BrowserContext): Promise<void> {
    const page = await this.firstPage(context);
    for (const selector of GEMINI_SELECTORS.stopButtonCandidates) {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
        await button.click({ timeout: 1000 }).catch(() => {});
        return;
      }
    }
  }

  private composerLocator(page: Page) {
    return page.locator(GEMINI_SELECTORS.composerCandidates.join(", ")).first();
  }

  private async clickSend(page: Page): Promise<boolean> {
    for (const selector of GEMINI_SELECTORS.sendButtonCandidates) {
      const button = page.locator(selector).last();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        await button.click({ timeout: 3000 }).catch(() => {});
        return true;
      }
    }

    return false;
  }

  private async latestResponseText(page: Page): Promise<string> {
    for (const selector of GEMINI_SELECTORS.responseCandidates) {
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

  private async firstVisible(page: Page, selectors: readonly string[], timeoutMs: number): Promise<boolean> {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: timeoutMs }).catch(() => false)) return true;
    }
    return false;
  }

  private normalizeResponseText(text: string): string {
    return text
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private isLikelyChromeText(text: string): boolean {
    return /new chat|recent|settings|gemini can make mistakes|google apps/i.test(text) && text.length < 240;
  }

  async diagnoseUi(context: BrowserContext): Promise<ProviderUiDiagnosis> {
    const page = await context.newPage();
    try {
      await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
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
      await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      const authStatus = await this.detectLoggedIn(context);

      if (authStatus === "requires_login") {
        return { provider: this.providerId, status: "requires_login", detectedAt: new Date().toISOString(), subModels: [], warnings: [] };
      }
      if (authStatus === "manual_action_required") {
        return { provider: this.providerId, status: "manual_action_required", detectedAt: new Date().toISOString(), subModels: [], warnings: [] };
      }

      await page.waitForTimeout(2000);

      const pickerCandidates = [
        `button[aria-haspopup="menu"]:has-text("Gemini")`,
        `div[role="button"]:has-text("Advanced")`,
        `button[aria-label*="model" i]`
      ];

      let clicked = false;
      for (const sel of pickerCandidates) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click({ timeout: 1000 }).catch(() => {});
          await page.waitForTimeout(1000);
          clicked = true;
          break;
        }
      }

      const subModels = await detectModelOptionsFromPage(page, this.providerId);

      if (clicked) {
        await page.keyboard.press("Escape").catch(() => {});
      }

      if (subModels.length === 0) {
         return {
           provider: this.providerId,
           status: "ui_changed",
           detectedAt: new Date().toISOString(),
           subModels: [],
           warnings: ["No sub-models detected. UI may have changed."]
         };
      }

      return {
        provider: this.providerId,
        status: "ok",
        detectedAt: new Date().toISOString(),
        subModels,
        warnings: []
      };
    } catch (err: any) {
      return { provider: this.providerId, status: "error", errorCode: "UNKNOWN_SAFE_ERROR", detectedAt: new Date().toISOString(), subModels: [], warnings: [err.message] };
    } finally {
      await page.close().catch(() => {});
    }
  }
}
