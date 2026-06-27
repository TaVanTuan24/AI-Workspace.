import type { BrowserContext, Page } from "playwright";
import type { PromptInput, ProviderAuthStatus, ProviderEvent } from "@uaiw/shared/types/provider.js";
import {
  BaseProviderAdapter,
  type ProviderSelectors,
  NAVIGATION_TIMEOUT_MS,
  COMPOSER_TIMEOUT_MS,
  RESPONSE_TOTAL_TIMEOUT_MS,
  RESPONSE_IDLE_TIMEOUT_MS,
  RESPONSE_POLL_INTERVAL_MS
} from "../ProviderAdapter.js";
import { GROK_SELECTORS, GROK_URLS } from "./selectors.js";

export class GrokAdapter extends BaseProviderAdapter {
  providerId = "grok" as const;
  loginUrl = GROK_URLS.primaryLoginUrl;
  protected readonly selectors: ProviderSelectors = GROK_SELECTORS;
  protected readonly providerLabel = "Grok";
  protected readonly modelPickerCandidates = [
    `button[aria-haspopup="menu"]:has-text("Grok")`,
    `button[aria-label*="model" i]`,
    `div[role="button"]:has-text("Grok")`
  ];

  protected isLikelyChromeText(text: string): boolean {
    return /home|explore|notifications|messages|premium|subscribe|what's happening|who to follow/i.test(text) && text.length < 280;
  }

  /** Grok navigates through x.com/grok.com with Cloudflare fallbacks. */
  protected async navigate(page: Page): Promise<void> {
    await this.navigateToGrok(page);
  }

  async detectLoggedIn(context: BrowserContext): Promise<ProviderAuthStatus> {
    const page = await this.firstPage(context);
    await this.navigateToGrok(page);

    // Wait for Cloudflare challenge to auto-resolve before checking anything
    await this.waitForCloudflare(page);

    const url = page.url();
    if (/x\.com\/login|x\.com\/i\/flow\/login|grok\.com\/login|signin|sign-in/i.test(url)) {
      return "requires_login";
    }

    if (await this.firstVisible(page, this.selectors.loginIndicators ?? [], 2000)) {
      return "requires_login";
    }

    if (await this.firstVisible(page, this.selectors.composerCandidates, COMPOSER_TIMEOUT_MS)) {
      return "connected";
    }

    if (await this.firstVisible(page, this.selectors.manualActionIndicators ?? [], 2000)) {
      return "manual_action_required";
    }

    return "manual_action_required";
  }

  async validateSession(context: BrowserContext): Promise<ProviderAuthStatus> {
    // Grok uses Cloudflare Turnstile which blocks all automated browsers.
    // Instead of loading the page (which triggers Cloudflare), validate by
    // checking that the authentication cookies exist and are not expired.
    // The browser-based detectLoggedIn is only used during the connect flow
    // where the user can manually solve Cloudflare in the popup.
    try {
      const cookies = await context.cookies("https://grok.com");
      const ssoCookie = cookies.find(c => c.name === "sso" || c.name === "sso-rw");
      const userIdCookie = cookies.find(c => c.name === "x-userid");

      if (!ssoCookie && !userIdCookie) {
        return "requires_login";
      }

      // Check if cookies are expired
      const now = Date.now() / 1000;
      for (const cookie of [ssoCookie, userIdCookie].filter(Boolean)) {
        if (cookie!.expires > 0 && cookie!.expires < now) {
          return "expired";
        }
      }

      return "connected";
    } catch {
      // If we can't read cookies, fall back to page-based detection
      return this.detectLoggedIn(context);
    }
  }

  async *sendMessage(
    context: BrowserContext,
    input: PromptInput
  ): AsyncIterable<ProviderEvent> {
    const page = await this.firstPage(context);
    await this.navigateToGrok(page);
    await this.waitForCloudflare(page);

    // Use cookie-based validation to avoid re-triggering Cloudflare
    const status = await this.validateSession(context);
    if (status !== "connected") {
      yield {
        type: status === "manual_action_required" ? "manual_action_required" : "requires_login",
        provider: this.providerId,
        jobId: input.jobId,
        message: "Please complete Grok login or verification in the browser window."
      };
      return;
    }

    // After Cloudflare wait, check if the page actually loaded the Grok UI
    if (await this.isCloudflareChallenge(page)) {
      yield {
        type: "error",
        provider: this.providerId,
        jobId: input.jobId,
        errorCode: "CLOUDFLARE_BLOCKED",
        message: "Grok is blocked by Cloudflare security verification. Please reconnect Grok to refresh the session."
      };
      return;
    }

    if (await this.detectRateLimit(page)) {
      yield {
        type: "rate_limited",
        provider: this.providerId,
        jobId: input.jobId,
        message: "Grok reports a rate or usage limit. Please wait and retry later."
      };
      return;
    }

    const composer = await this.getVisibleComposer(page);
    if (!composer) {
      yield {
        type: "error",
        provider: this.providerId,
        jobId: input.jobId,
        errorCode: "PROVIDER_UI_CHANGED",
        message: "Grok composer was not found. The provider UI may have changed."
      };
      return;
    }

    yield { type: "started", provider: this.providerId, jobId: input.jobId };

    await this.fillComposer(page, composer, input.prompt);
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

      if (await this.detectRateLimit(page)) {
        yield {
          type: "rate_limited",
          provider: this.providerId,
          jobId: input.jobId,
          message: "Grok reports a rate or usage limit. Please wait and retry later."
        };
        return;
      }

      if (await this.firstVisible(page, this.selectors.manualActionIndicators ?? [], 250)) {
        yield {
          type: "manual_action_required",
          provider: this.providerId,
          jobId: input.jobId,
          message: "Grok requires manual verification in the browser window."
        };
        return;
      }

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

      const stopVisible = await this.firstVisible(page, this.selectors.stopButtonCandidates, 250);
      const sendVisible = await this.firstVisible(page, this.selectors.sendButtonCandidates, 250);
      if (lastText && !stopVisible && sendVisible && Date.now() - lastChangeAt >= RESPONSE_IDLE_TIMEOUT_MS) {
        yield {
          type: "message_complete",
          provider: this.providerId,
          jobId: input.jobId,
          text: lastText
        };
        return;
      }

      if (lastText && Date.now() - lastChangeAt >= RESPONSE_IDLE_TIMEOUT_MS * 2) {
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
      message: "Grok did not finish response in time."
    };
  }

  // --- Grok-specific navigation / Cloudflare handling ----------------------

  private async waitForCloudflare(page: Page): Promise<void> {
    const CLOUDFLARE_TIMEOUT_MS = 30_000;
    const POLL_INTERVAL_MS = 1_500;
    const start = Date.now();

    while (Date.now() - start < CLOUDFLARE_TIMEOUT_MS) {
      const isCloudflare = await this.isCloudflareChallenge(page);
      if (!isCloudflare) return;

      // Still on Cloudflare — wait and retry
      await page.waitForTimeout(POLL_INTERVAL_MS).catch(() => {});
    }
    // Timed out waiting for Cloudflare — proceed anyway, detectLoggedIn will handle the result
  }

  private async isCloudflareChallenge(page: Page): Promise<boolean> {
    try {
      const frames = page.frames();
      const hasCfFrame = frames.some(f => f.url().includes("challenges.cloudflare.com"));
      if (hasCfFrame) return true;

      const bodyText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
      if (/Performing security verification|Verify you are human|Checking if the site connection is secure/i.test(bodyText)) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private async navigateToGrok(page: Page): Promise<void> {
    let url = page.url();
    if (!url.includes("grok.com") && !/x\.com\/login|x\.com\/i\/flow\/login|signin|sign-in/i.test(url)) {
      await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    }

    url = page.url();
    if (/x\.com\/login|x\.com\/i\/flow\/login|grok\.com\/login|signin|sign-in/i.test(url)) {
      return;
    }

    if (await this.firstVisible(page, this.selectors.loginIndicators ?? [], 1000)) return;
    if (await this.firstVisible(page, this.selectors.composerCandidates, 500)) return;
    if (await this.firstVisible(page, this.selectors.manualActionIndicators ?? [], 500)) return;

    for (const fallbackUrl of GROK_URLS.fallbackLoginUrls) {
      await page.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      if (await this.firstVisible(page, this.selectors.loginIndicators ?? [], 1000)) return;
      if (await this.firstVisible(page, this.selectors.composerCandidates, 500)) return;
      if (await this.firstVisible(page, this.selectors.manualActionIndicators ?? [], 500)) return;
    }
  }
}
