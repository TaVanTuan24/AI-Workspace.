"use client";

import type { ProviderId } from "@uaiw/shared/types/provider";
import { Trash2 } from "lucide-react";
import { disconnectProvider } from "../lib/api";

export function ProviderDisconnectButton({
  provider,
  onDisconnected,
  disabled = false
}: {
  provider: ProviderId;
  onDisconnected?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title="Disconnect provider"
      disabled={disabled}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
      onClick={async () => {
        if (disabled) return;
        await disconnectProvider(provider);
        onDisconnected?.();
      }}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
