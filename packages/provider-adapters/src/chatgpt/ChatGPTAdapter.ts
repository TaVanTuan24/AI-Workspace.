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
import { CHATGPT_SELECTORS } from "./selectors.js";

export class ChatGPTAdapter extends BaseProviderAdapter {
  providerId = "chatgpt" as const;
  loginUrl = "https://chatgpt.com";
  protected readonly selectors: ProviderSelectors = CHATGPT_SELECTORS;
  protected readonly providerLabel = "ChatGPT";
  protected readonly conversationUrlPattern = /chatgpt\.com\/(c|g\/[^/]+\/c)\/[0-9a-f-]+/i;
  protected readonly modelPickerCandidates = [
    `[data-testid="model-switcher"]`,
    `button[aria-haspopup="menu"]:has-text("GPT")`,
    `button[aria-haspopup="menu"]:has-text("ChatGPT")`,
    `button[aria-label*="model" i]`
  ];

  protected isLikelyChromeText(text: string): boolean {
    return /new chat|recent chats|upgrade plan|settings|chatgpt can make mistakes/i.test(text) && text.length < 240;
  }

  async detectLoggedIn(context: BrowserContext): Promise<ProviderAuthStatus> {
    const page = await this.firstPage(context);
    let url = page.url();
    if (!url.includes("chatgpt.com") && !/auth\.openai\.com|login|signin|sign-in/i.test(url)) {
      await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
      url = page.url();
    }
    if (/auth\.openai\.com|login|signin|sign-in/i.test(url)) {
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
    await this.navigateForPrompt(page, input);

    const status = await this.detectLoggedIn(context);
    if (status !== "connected") {
      yield {
        type: status === "manual_action_required" ? "manual_action_required" : "requires_login",
        provider: this.providerId,
        jobId: input.jobId,
        message: "Please complete ChatGPT login or verification in the browser window."
      };
      return;
    }

    if (await this.detectRateLimit(page)) {
      yield {
        type: "rate_limited",
        provider: this.providerId,
        jobId: input.jobId,
        message: "ChatGPT reports a rate or usage limit. Please wait and retry later."
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
        message: "ChatGPT composer was not found. The provider UI may have changed."
      };
      return;
    }

    yield { type: "started", provider: this.providerId, jobId: input.jobId };

    if (input.attachments && input.attachments.length > 0) {
      const attached = await this.attachFiles(page, input.attachments);
      if (!attached) {
        yield {
          type: "error",
          provider: this.providerId,
          jobId: input.jobId,
          errorCode: "PROVIDER_UI_CHANGED",
          message: "ChatGPT file attachment input was not found. The provider UI may have changed."
        };
        return;
      }
    }

    await this.fillComposer(page, composer, input.prompt);
    const beforeResponseText = await this.latestResponseText(page);
    const sent = await this.clickSend(page);
    if (!sent) {
      await page.keyboard.press("Enter");
    }

    let lastText = "";
    let lastChangeAt = Date.now();
    let sawAnyResponse = false;
    let polls = 0;
    const startedAt = Date.now();

    while (Date.now() - startedAt < RESPONSE_TOTAL_TIMEOUT_MS) {
      await page.waitForTimeout(RESPONSE_POLL_INTERVAL_MS);
      polls += 1;

      // Before any reply text appears, watch for a login wall (session expired
      // mid-request) so we fail fast with an actionable signal, not a timeout.
      if (!sawAnyResponse && polls % 8 === 0 && (await this.detectLoginWall(page))) {
        yield {
          type: "requires_login",
          provider: this.providerId,
          jobId: input.jobId,
          message: "Your ChatGPT session ended during the response. Please reconnect and try again."
        };
        return;
      }

      if (await this.detectRateLimit(page)) {
        yield {
          type: "rate_limited",
          provider: this.providerId,
          jobId: input.jobId,
          message: "ChatGPT reports a rate or usage limit. Please wait and retry later."
        };
        return;
      }

      if (await this.firstVisible(page, this.selectors.manualActionIndicators ?? [], 250)) {
        yield {
          type: "manual_action_required",
          provider: this.providerId,
          jobId: input.jobId,
          message: "ChatGPT requires manual verification in the browser window."
        };
        return;
      }

      const current = await this.latestResponseText(page);
      const normalizedCurrent = this.normalizeResponseText(current);
      if (current && current.trim()) sawAnyResponse = true;

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
      if (stopVisible) sawAnyResponse = true;
      if (lastText && !stopVisible && sendVisible && Date.now() - lastChangeAt >= RESPONSE_IDLE_TIMEOUT_MS) {
        yield {
          type: "message_complete",
          provider: this.providerId,
          jobId: input.jobId,
          text: lastText,
          conversationUrl: this.captureConversationUrl(page)
        };
        return;
      }

      if (lastText && Date.now() - lastChangeAt >= RESPONSE_IDLE_TIMEOUT_MS * 2) {
        yield {
          type: "message_complete",
          provider: this.providerId,
          jobId: input.jobId,
          text: lastText,
          conversationUrl: this.captureConversationUrl(page)
        };
        return;
      }
    }

    if (lastText) {
      yield {
        type: "message_complete",
        provider: this.providerId,
        jobId: input.jobId,
        text: lastText,
        conversationUrl: this.captureConversationUrl(page)
      };
      return;
    }

    if (!sawAnyResponse) {
      yield {
        type: "error",
        provider: this.providerId,
        jobId: input.jobId,
        errorCode: "PROVIDER_UI_CHANGED",
        message: "ChatGPT produced no visible response area. The provider UI may have changed."
      };
      return;
    }

    yield {
      type: "error",
      provider: this.providerId,
      jobId: input.jobId,
      errorCode: "PROVIDER_TIMEOUT",
      message: "ChatGPT did not finish response in time."
    };
  }
}
