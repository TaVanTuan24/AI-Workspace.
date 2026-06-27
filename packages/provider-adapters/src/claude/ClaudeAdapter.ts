import type { BrowserContext } from "playwright";
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
import { CLAUDE_SELECTORS } from "./selectors.js";

export class ClaudeAdapter extends BaseProviderAdapter {
  providerId = "claude" as const;
  loginUrl = "https://claude.ai";
  protected readonly selectors: ProviderSelectors = CLAUDE_SELECTORS;
  protected readonly providerLabel = "Claude";
  protected readonly modelPickerCandidates = [
    `[data-testid="model-selector-dropdown"]`,
    `button[aria-haspopup="menu"]:has-text("Claude")`,
    `button[aria-haspopup="menu"]:has-text("Sonnet")`,
    `button[aria-haspopup="menu"]:has-text("Opus")`,
    `button[aria-label*="model" i]`
  ];

  protected isLikelyChromeText(text: string): boolean {
    return /new chat|recent chats|starred|projects|claude can make mistakes/i.test(text) && text.length < 240;
  }

  async detectLoggedIn(context: BrowserContext): Promise<ProviderAuthStatus> {
    const page = await this.firstPage(context);
    let url = page.url();
    if (!url.includes("claude.ai") && !/login|signin|sign-in/i.test(url)) {
      await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
      url = page.url();
    }
    if (/login|signin|sign-in/i.test(url)) {
      return "requires_login";
    }

    if (await this.firstVisible(page, this.selectors.composerCandidates, COMPOSER_TIMEOUT_MS)) {
      return "connected";
    }

    if (await this.firstVisible(page, this.selectors.loginIndicators ?? [], 1000)) {
      return "requires_login";
    }

    if (await this.firstVisible(page, this.selectors.manualActionIndicators ?? [], 1000)) {
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
        message: "Please complete Claude login or verification in the browser window."
      };
      return;
    }

    if (await this.detectRateLimit(page)) {
      yield {
        type: "rate_limited",
        provider: this.providerId,
        jobId: input.jobId,
        message: "Claude reports a rate or usage limit. Please wait and retry later."
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
        message: "Claude composer was not found. The provider UI may have changed."
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
          message: "Claude reports a rate or usage limit. Please wait and retry later."
        };
        return;
      }

      if (await this.firstVisible(page, this.selectors.manualActionIndicators ?? [], 250)) {
        yield {
          type: "manual_action_required",
          provider: this.providerId,
          jobId: input.jobId,
          message: "Claude requires manual verification in the browser window."
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
      message: "Claude did not finish response in time."
    };
  }
}
