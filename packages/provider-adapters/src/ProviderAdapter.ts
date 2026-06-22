import type { BrowserContext } from "playwright";
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

  abstract sendMessage(
    context: BrowserContext,
    input: PromptInput
  ): AsyncIterable<ProviderEvent>;

  async newChat(_context: BrowserContext): Promise<void> {
    // Provider-specific implementations should navigate using visible UI only.
  }

  async stopGeneration(_context: BrowserContext): Promise<void> {
    // Best-effort only. Do not force provider internals or bypass UI controls.
  }

  async exportSession(context: BrowserContext): Promise<unknown> {
    return context.storageState();
  }

  async importSession(_context: BrowserContext, _sessionState: unknown): Promise<void> {
    // Playwright storageState should normally be provided when creating context.
  }

  protected async firstPage(context: BrowserContext) {
    const [existing] = context.pages();
    return existing ?? context.newPage();
  }

  async detectLiveSubModels(_context: BrowserContext): Promise<LiveSubModelDetectionResult> {
    return {
      provider: this.providerId,
      status: "error",
      errorCode: "not_implemented",
      detectedAt: new Date().toISOString(),
      subModels: [],
      warnings: ["Adapter does not implement live sub-model detection"]
    };
  }
}
