"use client";

import type { ProviderId } from "@uaiw/shared/types/provider";
import { PROVIDERS } from "@uaiw/shared/types/provider";

export function MultiProviderSelector({
  value,
  onChange
}: {
  value: ProviderId[];
  onChange: (providers: ProviderId[]) => void;
}) {
  const selected = new Set(value);
  return (
    <div className="space-y-2">
      {PROVIDERS.map((provider) => (
        <label key={provider} className="flex items-center gap-2 text-sm capitalize">
          <input
            type="checkbox"
            checked={selected.has(provider)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, provider]
                  : value.filter((item) => item !== provider)
              )
            }
          />
          {provider}
        </label>
      ))}
    </div>
  );
}
