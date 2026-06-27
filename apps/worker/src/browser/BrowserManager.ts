import { chromium, type Browser, type BrowserContext } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import type { ProviderId } from "@uaiw/shared/types/provider.js";

export class BrowserManager {
  private browser?: Browser;

  async launchBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    this.browser = await chromium.launch({
      headless: env.BROWSER_HEADLESS,
      args: ["--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"]
    });

    return this.browser;
  }

  private async getNonHeadlessUserAgent(browser: Browser): Promise<string> {
    const dummyContext = await browser.newContext();
    const dummyPage = await dummyContext.newPage();
    const ua = await dummyPage.evaluate(() => navigator.userAgent);
    await dummyContext.close();
    return ua.replace("HeadlessChrome", "Chrome");
  }

  async createContextForUserProvider(input: {
    userId: string;
    provider: ProviderId;
    storageState?: unknown;
  }): Promise<BrowserContext> {
    const browser = await this.launchBrowser();
    const profileDir = path.join(env.BROWSER_PROFILE_ROOT, input.userId, input.provider);
    await mkdir(profileDir, { recursive: true });

    const userAgent = await this.getNonHeadlessUserAgent(browser);
    const context = await browser.newContext({
      storageState: input.storageState as never,
      viewport: { width: 1365, height: 900 },
      userAgent,
      recordVideo: undefined
    });

    return context;
  }

  async closeContext(context: BrowserContext): Promise<void> {
    await context.close().catch(() => {});
  }

  async cleanup(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}
