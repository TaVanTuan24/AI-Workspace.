"use client";

import type { ProviderConnectionSummary, ProviderId } from "@uaiw/shared/types/provider";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, CircleOff, Loader2, Trash2, Cable, RefreshCw, Stethoscope } from "lucide-react";
import { checkProviderConnectStatus, connectProvider, disconnectProvider, testProviderConnection } from "../lib/api";

const statusCopy: Record<string, string> = {
  not_connected: "Not connected",
  connecting: "Connecting",
  connected: "Connected",
  requires_login: "Needs login",
  manual_action_required: "Manual action",
  expired: "Expired",
  error: "Error",
  disconnected: "Disconnected"
};

export function ProviderStatusCard({
  provider,
  onChanged,
  canWriteConnections = true
}: {
  provider: ProviderConnectionSummary;
  onChanged?: () => void;
  canWriteConnections?: boolean;
}) {
  const [connectSessionId, setConnectSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const connected = provider.status === "connected";
  const pending = provider.status === "connecting" || Boolean(connectSessionId);
  // A session only exists to validate once the provider is past not_connected.
  const hasSession = provider.status !== "not_connected" && provider.status !== "disconnected";

  async function testConnection() {
    if (!canWriteConnections) {
      setMessage("You don't have permission to perform this action.");
      return;
    }
    setTesting(true);
    try {
      const health = await testProviderConnection(provider.provider as ProviderId);
      setMessage(
        health.isUsable
          ? "Session is valid and ready to chat."
          : health.errorMessage ?? `Session is not usable (status: ${health.connectionStatus}).`
      );
      onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to test connection.");
    } finally {
      setTesting(false);
    }
  }

  async function checkStatus() {
    if (!connectSessionId) return;
    setChecking(true);
    try {
      const result = await checkProviderConnectStatus(provider.provider as ProviderId, connectSessionId);
      setMessage(result.message ?? null);
      if (result.status === "connected") {
        setConnectSessionId(null);
        onChanged?.();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to check connection status.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!connectSessionId) return;
    const id = window.setInterval(() => {
      void checkStatus();
    }, 5000);
    return () => window.clearInterval(id);
  }, [connectSessionId]);

  return (
    <section className="rounded-md border border-border bg-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold capitalize">{provider.provider}</h2>
          <div className="mt-2 flex items-center gap-2 text-sm text-muted">
            <StatusIcon status={provider.status} />
            <span>{statusCopy[provider.status]}</span>
          </div>
          {provider.errorMessageSafe ? (
            <p className="mt-2 text-sm text-danger">{provider.errorMessageSafe}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            title="Connect"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
            disabled={pending || !canWriteConnections}
            onClick={async () => {
              if (!canWriteConnections) {
                setMessage("You don't have permission to perform this action.");
                return;
              }
              const result = await connectProvider(provider.provider as ProviderId);
              setConnectSessionId(result.connectSessionId);
              setMessage(result.message ?? "A browser window has opened. Please complete login there.");
              onChanged?.();
            }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cable className="h-4 w-4" />}
          </button>
          <button
            title="Test connection (validate saved session)"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
            disabled={!hasSession || pending || testing || !canWriteConnections}
            onClick={testConnection}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
          </button>
          <button
            title="Check login status"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
            disabled={!connectSessionId || checking || !canWriteConnections}
            onClick={checkStatus}
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <button
            title="Disconnect and delete data"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
            disabled={(!connected && provider.status === "not_connected") || !canWriteConnections}
            onClick={async () => {
              if (!canWriteConnections) {
                setMessage("You don't have permission to perform this action.");
                return;
              }
              await disconnectProvider(provider.provider as ProviderId);
              setConnectSessionId(null);
              setMessage(null);
              onChanged?.();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {message ? (
        <p className="mt-3 rounded-md border border-border bg-surface p-3 text-sm text-muted">
          {message}
        </p>
      ) : null}
      <dl className="mt-4 grid grid-cols-1 gap-2 text-xs text-muted sm:grid-cols-3">
        <div>
          <dt>Last connected</dt>
          <dd>{provider.lastConnectedAt ?? "Never"}</dd>
        </div>
        <div>
          <dt>Last used</dt>
          <dd>{provider.lastUsedAt ?? "Never"}</dd>
        </div>
        <div>
          <dt>Last validated</dt>
          <dd>{provider.lastValidatedAt ?? "Never"}</dd>
        </div>
      </dl>
    </section>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "connected") return <CheckCircle2 className="h-4 w-4 text-accent" />;
  if (status === "connecting") return <Loader2 className="h-4 w-4 animate-spin text-muted" />;
  if (status === "error" || status === "expired") return <CircleAlert className="h-4 w-4 text-danger" />;
  return <CircleOff className="h-4 w-4 text-muted" />;
}
