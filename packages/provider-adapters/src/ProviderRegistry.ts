import type {
  ProviderCapability,
  ProviderDefinition,
  ProviderId
} from "@uaiw/shared/types/provider.js";
import type { ProviderAdapter } from "./ProviderAdapter.js";
import { ChatGPTAdapter } from "./chatgpt/ChatGPTAdapter.js";
import { GeminiAdapter } from "./gemini/GeminiAdapter.js";
import { ClaudeAdapter } from "./claude/ClaudeAdapter.js";

export interface RegisteredProvider {
  definition: ProviderDefinition;
  adapter: ProviderAdapter;
}

export class ProviderCapabilityError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly capability: ProviderCapability
  ) {
    super("PROVIDER_NOT_READY");
  }
}

export class UnknownProviderError extends Error {
  constructor(readonly provider: string) {
    super("UNKNOWN_PROVIDER");
  }
}

export class ProviderRegistry {
  private readonly providers: Map<ProviderId, RegisteredProvider>;

  constructor(providers: RegisteredProvider[] = defaultProviders()) {
    this.providers = new Map(providers.map((provider) => [provider.definition.id, provider]));
  }

  list(): ProviderDefinition[] {
    return [...this.providers.values()].map((provider) => provider.definition);
  }

  get(provider: ProviderId): RegisteredProvider {
    const registered = this.providers.get(provider);
    if (!registered) {
      throw new UnknownProviderError(provider);
    }
    return registered;
  }

  hasCapability(provider: ProviderId, capability: ProviderCapability): boolean {
    return this.get(provider).definition.capabilities.includes(capability);
  }

  assertCapability(provider: ProviderId, capability: ProviderCapability): void {
    if (!this.hasCapability(provider, capability)) {
      throw new ProviderCapabilityError(provider, capability);
    }
  }

  isReady(provider: ProviderId): boolean {
    return this.get(provider).definition.readiness === "ready";
  }
}

export function defaultProviders(): RegisteredProvider[] {
  const gemini = new GeminiAdapter();
  const chatgpt = new ChatGPTAdapter();
  const claude = new ClaudeAdapter();

  return [
    {
      definition: {
        id: "gemini",
        displayName: "Gemini",
        loginUrl: gemini.loginUrl,
        capabilities: ["connect", "validate_session", "send_message", "pseudo_stream", "multi_provider"],
        readiness: "ready",
        defaultEnabled: true,
        subModels: [
          { id: "current", label: "Current / Provider default", available: true },
          { id: "pro", label: "Pro/Advanced if available", available: "detect" },
          { id: "flash", label: "Flash/Fast if available", available: "detect" }
        ]
      },
      adapter: gemini
    },
    {
      definition: {
        id: "chatgpt",
        displayName: "ChatGPT",
        loginUrl: chatgpt.loginUrl,
        capabilities: ["connect", "validate_session", "send_message", "pseudo_stream", "multi_provider"],
        readiness: "ready",
        defaultEnabled: true,
        subModels: [
          { id: "current", label: "Current / Provider default", available: true },
          { id: "gpt-4o", label: "GPT-4o visible option", available: "detect" },
          { id: "reasoning", label: "Reasoning visible option", available: "detect" }
        ]
      },
      adapter: chatgpt
    },
    {
      definition: {
        id: "claude",
        displayName: "Claude",
        loginUrl: claude.loginUrl,
        capabilities: ["connect", "validate_session", "send_message", "pseudo_stream", "multi_provider"],
        readiness: "ready",
        defaultEnabled: true,
        subModels: [
          { id: "current", label: "Current / Provider default", available: true },
          { id: "opus", label: "Opus if available", available: "detect" },
          { id: "sonnet", label: "Sonnet if available", available: "detect" }
        ]
      },
      adapter: claude
    }
  ];
}

export const providerRegistry = new ProviderRegistry();
