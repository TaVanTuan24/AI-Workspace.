"use client";

import type { ProviderId } from "@uaiw/shared/types/provider";
import { Cable } from "lucide-react";
import { connectProvider } from "../lib/api";

export function ProviderConnectButton({
  provider,
  onConnected
}: {
  provider: ProviderId;
  onConnected?: () => void;
}) {
  return (
    <button
      title="Connect provider"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface"
      onClick={async () => {
        const result = await connectProvider(provider);
        window.open(result.loginUrl, "_blank", "noopener,noreferrer");
        onConnected?.();
      }}
    >
      <Cable className="h-4 w-4" />
    </button>
  );
}
