import type { BrowserContext } from "playwright";
import type { PromptInput, ProviderAuthStatus, ProviderEvent } from "@uaiw/shared/types/provider.js";
import {
  BaseProviderAdapter,
  type ProviderSelectors,
  NAVIGATION_TIMEOUT_MS,
  RESPONSE_TOTAL_TIMEOUT_MS,
  RESPONSE_IDLE_TIMEOUT_MS,
  RESPONSE_POLL_INTERVAL_MS
} from "../ProviderAdapter.js";
import { GEMINI_SELECTORS } from "./selectors.js";

export class GeminiAdapter extends BaseProviderAdapter {
  providerId = "gemini" as const;
  loginUrl = "https://gemini.google.com/app";
  protected readonly selectors: ProviderSelectors = GEMINI_SELECTORS;
  protected readonly providerLabel = "Gemini";
  protected readonly modelPickerCandidates = [
    `button[aria-haspopup="menu"]:has-text("Gemini")`,
    `div[role="button"]:has-text("Advanced")`,
    `button[aria-label*="model" i]`
  ];

  protected isLikelyChromeText(text: string): boolean {
    return /new chat|recent|settings|gemini can make mistakes|google apps/i.test(text) && text.length < 240;
  }

  async detectLoggedIn(context: BrowserContext): Promise<ProviderAuthStatus> {
    const page = await this.firstPage(context);
    let url = page.url();
    if (!url.includes("gemini.google.com") && !/accounts\.google\.com|ServiceLogin|signin/i.test(url)) {
      await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
      url = page.url();
    }

    if (/accounts\.google\.com|ServiceLogin|signin/i.test(url)) {
      return "requires_login";
    }

    const composer = await this.getVisibleComposer(page);
    const signIn = page.getByRole("link", { name: /sign in/i });
    const accountChooser = page.getByText(/choose an account|use another account|verify/i).first();

    if (await signIn.isVisible({ timeout: 1000 }).catch(() => false)) {
      return "requires_login";
    }

    if (composer) {
      return "connected";
    }

    if (await accountChooser.isVisible({ timeout: 1000 }).catch(() => false)) {
      return "manual_action_required";
    }

    return "manual_action_required";
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

    const composer = await this.getVisibleComposer(page);
    if (!composer) {
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
}
