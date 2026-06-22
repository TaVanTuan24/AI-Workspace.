"use client";

import type { ProviderId } from "@uaiw/shared/types/provider";
import { PROVIDERS } from "@uaiw/shared/types/provider";

export function ProviderSelector({
  value,
  onChange
}: {
  value: ProviderId;
  onChange: (provider: ProviderId) => void;
}) {
  return (
    <select
      className="w-full rounded-md border border-border bg-white p-2 text-sm capitalize"
      value={value}
      onChange={(event) => onChange(event.target.value as ProviderId)}
    >
      {PROVIDERS.map((provider) => (
        <option key={provider} value={provider}>
          {provider}
        </option>
      ))}
    </select>
  );
}
