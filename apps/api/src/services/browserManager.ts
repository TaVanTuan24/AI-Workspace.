import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ProviderId } from "@uaiw/shared/types/provider.js";
import { env } from "../config/env.js";

interface ConnectSession {
  connectSessionId: string;
  userId: string;
  provider: ProviderId;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  expiresAt: number;
}

export class BrowserManager {
  private browser?: Browser;
  private readonly connectSessions = new Map<string, ConnectSession>();
  private readonly connectByUserProvider = new Map<string, string>();
  private readonly connectTtlMs = 1000 * 60 * 20;

  async launchBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    const channel = env.BROWSER_CHANNEL === "chromium" ? undefined : env.BROWSER_CHANNEL;
    this.browser = await chromium.launch({
      headless: env.BROWSER_HEADLESS,
      channel,
      args: ["--disable-dev-shm-usage"]
    });

    return this.browser;
  }

  async createLoginContext(input: {
    connectSessionId: string;
    userId: string;
    provider: ProviderId;
    loginUrl: string;
  }): Promise<ConnectSession> {
    await this.cleanupExpiredConnectSessions();
    await this.closeExistingUserProviderSession(input.userId, input.provider);

    const browser = await this.launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      recordVideo: undefined
    });
    const page = await context.newPage();
    await page.goto(input.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

    const session: ConnectSession = {
      connectSessionId: input.connectSessionId,
      userId: input.userId,
      provider: input.provider,
      context,
      page,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.connectTtlMs
    };

    this.connectSessions.set(input.connectSessionId, session);
    this.connectByUserProvider.set(this.userProviderKey(input.userId, input.provider), input.connectSessionId);
    return session;
  }

  getConnectSession(connectSessionId: string): ConnectSession | undefined {
    const session = this.connectSessions.get(connectSessionId);
    if (!session) return undefined;
    if (session.expiresAt < Date.now()) {
      void this.closeConnectSession(connectSessionId);
      return undefined;
    }
    return session;
  }

  async closeConnectSession(connectSessionId: string): Promise<void> {
    const session = this.connectSessions.get(connectSessionId);
    if (!session) return;

    this.connectSessions.delete(connectSessionId);
    this.connectByUserProvider.delete(this.userProviderKey(session.userId, session.provider));
    await session.context.close().catch(() => {});
  }

  async closeUserProviderSessions(userId: string, provider: ProviderId): Promise<void> {
    const connectSessionId = this.connectByUserProvider.get(this.userProviderKey(userId, provider));
    if (connectSessionId) {
      await this.closeConnectSession(connectSessionId);
    }
  }

  async createContextFromStorageState(input: {
    userId: string;
    provider: ProviderId;
    storageState: unknown;
  }): Promise<BrowserContext> {
    const browser = await this.launchBrowser();
    await mkdir(this.profilePath(input.userId, input.provider), { recursive: true });

    return browser.newContext({
      storageState: input.storageState as never,
      viewport: { width: 1365, height: 900 },
      recordVideo: undefined
    });
  }

  async deleteBrowserProfile(userId: string, provider: ProviderId): Promise<void> {
    await this.closeUserProviderSessions(userId, provider);
    await rm(this.profilePath(userId, provider), { recursive: true, force: true }).catch(() => {});
  }

  async cleanup(): Promise<void> {
    await Promise.all([...this.connectSessions.keys()].map((id) => this.closeConnectSession(id)));
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }

  private async cleanupExpiredConnectSessions(): Promise<void> {
    const now = Date.now();
    const expired = [...this.connectSessions.values()]
      .filter((session) => session.expiresAt < now)
      .map((session) => session.connectSessionId);

    await Promise.all(expired.map((id) => this.closeConnectSession(id)));
  }

  private async closeExistingUserProviderSession(userId: string, provider: ProviderId): Promise<void> {
    const existing = this.connectByUserProvider.get(this.userProviderKey(userId, provider));
    if (existing) {
      await this.closeConnectSession(existing);
    }
  }

  private userProviderKey(userId: string, provider: ProviderId): string {
    return `${userId}:${provider}`;
  }

  private profilePath(userId: string, provider: ProviderId): string {
    return path.join(env.BROWSER_PROFILE_ROOT, userId, provider);
  }
}

export const browserManager = new BrowserManager();
