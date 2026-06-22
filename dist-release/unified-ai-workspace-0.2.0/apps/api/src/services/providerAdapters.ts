import type { ProviderId } from "@uaiw/shared/types/provider.js";
import type { ProviderAdapter } from "@uaiw/provider-adapters/ProviderAdapter.js";
import { providerRegistry } from "./providerRegistry.js";

export function getProviderAdapter(provider: ProviderId): ProviderAdapter {
  return providerRegistry.get(provider).adapter;
}
