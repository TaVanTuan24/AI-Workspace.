"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw, Send, Square, X } from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import type { ProviderConnectionSummary, ProviderEvent, ProviderId } from "@uaiw/shared/types/provider";
import {
  apiGetProviders,
  cancelChatJob,
  postChat,
  postMultiChat,
  retryChatJob,
  streamUrl,
  apiGetModelPreferences,
  getWorkspaceNotifications
} from "../../lib/api";
import { filterVisibleNotifications, readDismissedNotifications, type DismissedNotificationMap } from "../../lib/notificationDismissals";

export type Mode = "single" | "compare";
type CardStatus =
  | "queued"
  | "started"
  | "streaming"
  | "completed"
  | "cancelled"
  | "timeout"
  | "requires_login"
  | "manual_action_required"
  | "rate_limited"
  | "provider_not_ready"
  | "error"
  | "idle";

type ResponseCardState = {
  provider: ProviderId | string;
  displayName: string;
  jobId?: string;
  status: CardStatus;
  text: string;
  message?: string;
};

export function ChatWorkspace() {
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: apiGetProviders
  });
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());
  const [mode, setMode] = useState<Mode>("single");
  const [selectedSingle, setSelectedSingle] = useState<ProviderId>("gemini");
  const [selectedCompare, setSelectedCompare] = useState<ProviderId[]>(["gemini", "chatgpt", "grok"]);
  const [prompt, setPrompt] = useState("");
  const [saveHistory, setSaveHistory] = useState(true);
  const [cards, setCards] = useState<Record<string, ResponseCardState>>({});
  const [fallbackNotice, setFallbackNotice] = useState("");
  const [dismissedNotifications, setDismissedNotifications] = useState<DismissedNotificationMap>({});
  
  const prefsQuery = useQuery({
    queryKey: ["modelPreferences"],
    queryFn: apiGetModelPreferences
  });

  const notificationQuery = useQuery({
    queryKey: ["workspaceNotifications"],
    queryFn: getWorkspaceNotifications,
    refetchInterval: 60_000
  });

  useEffect(() => {
    setDismissedNotifications(readDismissedNotifications());
  }, []);

  useEffect(() => {
    if (prefsQuery.data) {
      const { models, autoSelectFirstUsable } = prefsQuery.data;
      const enabled = models.filter(m => m.enabled);
      
      if (enabled.length > 0) {
        // Single Mode selection
        const defaultModel = enabled.find(m => m.isDefault);
        if (defaultModel) {
          if (defaultModel.isUsable || !autoSelectFirstUsable) {
            setSelectedSingle(defaultModel.provider as ProviderId);
            setFallbackNotice("");
          } else {
            // Auto fallback
            const usable = enabled.slice().sort((a, b) => a.priority - b.priority).find(m => m.isUsable);
            setSelectedSingle((usable?.provider || defaultModel.provider) as ProviderId);
            setFallbackNotice(
              usable
                ? `${defaultModel.displayName} is unavailable; using ${usable.displayName} instead.`
                : ""
            );
          }
        } else {
          setSelectedSingle(enabled.sort((a, b) => a.priority - b.priority)[0].provider as ProviderId);
          setFallbackNotice("");
        }

        // Compare Mode selection (pre-select enabled & usable up to top 3)
        const usableEnabled = enabled.filter(m => m.isUsable).sort((a, b) => a.priority - b.priority);
        if (usableEnabled.length > 0) {
          setSelectedCompare(usableEnabled.slice(0, 3).map(m => m.provider as ProviderId));
        } else {
          setSelectedCompare(enabled.slice(0, 3).map(m => m.provider as ProviderId));
        }
      }
    }
  }, [prefsQuery.data]);

  const providerList = providers.data?.providers ?? [];
  const byProvider = useMemo(
    () => new Map(providerList.map((provider) => [provider.provider, provider])),
    [providerList]
  );
  const modelsByProvider = useMemo(
    () => new Map((prefsQuery.data?.models ?? []).map((model) => [model.provider, model])),
    [prefsQuery.data?.models]
  );
  const visibleNotifications = useMemo(
    () => filterVisibleNotifications(notificationQuery.data?.notifications ?? [], dismissedNotifications),
    [notificationQuery.data?.notifications, dismissedNotifications]
  );
  const notificationsByProvider = useMemo(() => {
    const map = new Map<string, (typeof visibleNotifications)[number]>();
    for (const notification of visibleNotifications) {
      if (notification.provider) map.set(notification.provider, notification);
    }
    return map;
  }, [visibleNotifications]);
  const running = Object.values(cards).some(
    (card) => card.status === "queued" || card.status === "started" || card.status === "streaming"
  );
  const selectedSingleModel = modelsByProvider.get(selectedSingle);
  const selectedSingleNotification = notificationsByProvider.get(selectedSingle);
  const selectedCompareModels = selectedCompare.map((provider) => modelsByProvider.get(provider)).filter(Boolean);
  const selectedCompareUsableCount = selectedCompareModels.filter((model) => model?.isUsable).length;
  const selectedCompareNotifications = selectedCompare
    .map((provider) => notificationsByProvider.get(provider))
    .filter(Boolean);
  const sendBlocked =
    isSendBlockedForState({
      mode,
      selectedSingleModel,
      selectedCompareCount: selectedCompare.length,
      selectedCompareUsableCount
    });

  async function submit() {
    if (!prompt.trim() || running || sendBlocked) return;
    closeAllStreams();

    if (mode === "single") {
      const definition = byProvider.get(selectedSingle);
      setCards({
        [selectedSingle]: initialCard(selectedSingle, definition)
      });

      try {
        const result = await postChat({
          provider: selectedSingle,
          prompt,
          saveHistory
        });
        attachStream(selectedSingle, result.jobId, result.streamUrl);
      } catch (error) {
        setCards({
          [selectedSingle]: {
            ...initialCard(selectedSingle, definition),
            status: errorMessage(error).includes("chat-ready") ? "provider_not_ready" : "requires_login",
            message: errorMessage(error)
          }
        });
      }
      return;
    }

    const selected: ProviderId[] = selectedCompare.length ? selectedCompare : ["gemini"];
    setCards(Object.fromEntries(selected.map((provider) => [provider, initialCard(provider, byProvider.get(provider))])));

    try {
      const result = await postMultiChat({
        providers: selected,
        prompt,
        saveHistory
      });

      setCards((current) => {
        const next = { ...current };
        for (const error of result.errors) {
          const provider = error.provider;
          next[provider] = {
            ...initialCard(provider, byProvider.get(provider as ProviderId)),
            status: error.errorCode === "PROVIDER_NOT_READY" ? "provider_not_ready" : "requires_login",
            message: error.message
          };
        }
        for (const job of result.jobs) {
          next[job.provider] = {
            ...initialCard(job.provider, byProvider.get(job.provider)),
            jobId: job.jobId,
            status: "queued"
          };
        }
        return next;
      });

      for (const job of result.jobs) {
        attachStream(job.provider, job.jobId, job.streamUrl);
      }
    } catch (error) {
      setCards({
        system: {
          provider: "system",
          displayName: "System",
          status: "error",
          text: "",
          message: errorMessage(error)
        }
      });
    }
  }

  function attachStream(provider: ProviderId, jobId: string, path: string) {
    const source = new EventSource(streamUrl(path));
    sourcesRef.current.set(jobId, source);

    const handleEvent = (event: MessageEvent) => {
      const parsed = JSON.parse(event.data) as ProviderEvent;
      setCards((current) => {
        const existing = current[provider] ?? initialCard(provider, byProvider.get(provider));
        if (parsed.type === "started") {
          return { ...current, [provider]: { ...existing, jobId, status: "started" } };
        }
        if (parsed.type === "message_delta") {
          return {
            ...current,
            [provider]: { ...existing, jobId, status: "streaming", text: existing.text + parsed.text }
          };
        }
        if (parsed.type === "message_complete") {
          return { ...current, [provider]: { ...existing, jobId, status: "completed", text: parsed.text } };
        }
        if (parsed.type === "queued") {
          return { ...current, [provider]: { ...existing, jobId, status: "queued" } };
        }
        if (parsed.type === "requires_login" || parsed.type === "manual_action_required") {
          closeStream(jobId);
          return {
            ...current,
            [provider]: {
              ...existing,
              jobId,
              status: parsed.type === "manual_action_required" ? "manual_action_required" : "requires_login",
              message: parsed.message
            }
          };
        }
        if (parsed.type === "cancelled") {
          closeStream(jobId);
          return {
            ...current,
            [provider]: { ...existing, jobId, status: "cancelled", message: parsed.message }
          };
        }
        if (parsed.type === "rate_limited") {
          closeStream(jobId);
          return {
            ...current,
            [provider]: { ...existing, jobId, status: "rate_limited", message: parsed.message }
          };
        }
        if (parsed.type === "timeout") {
          closeStream(jobId);
          return {
            ...current,
            [provider]: { ...existing, jobId, status: "timeout", message: parsed.message }
          };
        }
        if (parsed.type === "retrying") {
          return {
            ...current,
            [provider]: { ...existing, jobId, status: "queued", message: `Retrying ${parsed.retryOfJobId}` }
          };
        }
        if (parsed.type === "error") {
          closeStream(jobId);
          return {
            ...current,
            [provider]: { ...existing, jobId, status: "error", message: parsed.message }
          };
        }
        if (parsed.type === "done") {
          closeStream(jobId);
          return {
            ...current,
            [provider]: {
              ...existing,
              jobId,
              status: existing.status === "cancelled" || existing.status === "timeout" ? existing.status : "completed"
            }
          };
        }
        return current;
      });
    };

    [
      "queued",
      "started",
      "message_delta",
      "message_complete",
      "requires_login",
      "manual_action_required",
      "rate_limited",
      "cancelled",
      "retrying",
      "timeout",
      "error",
      "done"
    ].forEach((type) => source.addEventListener(type, handleEvent));

    source.onerror = () => {
      closeStream(jobId);
      setCards((current) => {
        const existing = current[provider] ?? initialCard(provider, byProvider.get(provider));
        return existing.status === "completed"
          ? current
          : {
              ...current,
              [provider]: {
                ...existing,
                status: "error",
                message: "The stream disconnected before the provider finished responding."
              }
            };
      });
    };
  }

  function closeStream(jobId: string) {
    sourcesRef.current.get(jobId)?.close();
    sourcesRef.current.delete(jobId);
  }

  function closeAllStreams() {
    for (const source of sourcesRef.current.values()) source.close();
    sourcesRef.current.clear();
  }

  async function cancelCardJob(provider: ProviderId | string, jobId: string) {
    try {
      await cancelChatJob(jobId);
      closeStream(jobId);
      setCards((current) => ({
        ...current,
        [provider]: {
          ...current[provider],
          provider,
          displayName: current[provider]?.displayName ?? provider,
          status: "cancelled",
          text: current[provider]?.text ?? "",
          message: "Job was cancelled."
        }
      }));
    } catch (error) {
      setCards((current) => ({
        ...current,
        [provider]: {
          ...current[provider],
          provider,
          displayName: current[provider]?.displayName ?? provider,
          status: "error",
          text: current[provider]?.text ?? "",
          message: errorMessage(error)
        }
      }));
    }
  }

  async function retryCardJob(provider: ProviderId | string, jobId: string) {
    if (!isProvider(provider)) return;
    try {
      const result = await retryChatJob(jobId);
      setCards((current) => ({
        ...current,
        [provider]: {
          ...initialCard(provider, byProvider.get(provider)),
          jobId: result.jobId,
          status: "queued",
          message: `Retrying ${jobId}`
        }
      }));
      attachStream(provider, result.jobId, result.streamUrl);
    } catch (error) {
      setCards((current) => ({
        ...current,
        [provider]: {
          ...current[provider],
          provider,
          displayName: current[provider]?.displayName ?? provider,
          status: "error",
          text: current[provider]?.text ?? "",
          message: errorMessage(error)
        }
      }));
    }
  }

  const visibleCards = Object.values(cards);

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <aside className="rounded-md border border-border bg-panel p-4">
        <h1 className="text-lg font-semibold">Chat</h1>

        <div className="mt-4 grid grid-cols-2 rounded-md border border-border p-1 text-sm">
          <button
            className={`rounded px-3 py-2 ${mode === "single" ? "bg-accent text-white" : "text-muted"}`}
            onClick={() => setMode("single")}
            type="button"
          >
            Single
          </button>
          <button
            className={`rounded px-3 py-2 ${mode === "compare" ? "bg-accent text-white" : "text-muted"}`}
            onClick={() => setMode("compare")}
            type="button"
          >
            Compare
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {providerList.map((provider) =>
            mode === "single" ? (
              <ProviderRow
                key={provider.provider}
                provider={provider}
                model={modelsByProvider.get(provider.provider)}
                checked={selectedSingle === provider.provider}
                type="radio"
                onChange={() => setSelectedSingle(provider.provider)}
              />
            ) : (
              <ProviderRow
                key={provider.provider}
                provider={provider}
                model={modelsByProvider.get(provider.provider)}
                checked={selectedCompare.includes(provider.provider)}
                type="checkbox"
                onChange={() =>
                  setSelectedCompare((current) =>
                    current.includes(provider.provider)
                      ? current.filter((item) => item !== provider.provider)
                      : [...current, provider.provider]
                  )
                }
              />
            )
          )}
        </div>

        {fallbackNotice ? (
          <div className="mt-4 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">
            {fallbackNotice}
          </div>
        ) : null}

        {mode === "single" && selectedSingleModel && !selectedSingleModel.isUsable ? (
          <ProviderWarning
            title={selectedSingleNotification?.title ?? `${selectedSingleModel.displayName} is unavailable`}
            message={
              selectedSingleNotification?.message ??
              `${selectedSingleModel.displayName} cannot receive prompts right now. Reconnect or choose a usable provider.`
            }
            actionHref={selectedSingleNotification?.action?.href ?? "/connections"}
            actionLabel={selectedSingleNotification?.action?.label ?? "Reconnect"}
          />
        ) : null}

        {mode === "single" && selectedSingleModel?.recovery?.providerDegraded && selectedSingleModel.recovery.degradedMode !== "block_for_duration" ? (
          <ProviderWarning
            title={`${selectedSingleModel.displayName} is temporarily degraded`}
            message={selectedSingleModel.recovery.degradedReason ?? "A recovery policy recommends using a fallback provider if possible."}
            actionHref="/settings/provider-recovery"
            actionLabel="Review overrides"
          />
        ) : null}

        {mode === "compare" && selectedCompareNotifications.length > 0 ? (
          <ProviderWarning
            title={
              sendBlocked
                ? "No selected providers are usable"
                : `${selectedCompareNotifications.length} selected provider${selectedCompareNotifications.length === 1 ? "" : "s"} need attention`
            }
            message={
              sendBlocked
                ? "Reconnect a provider or choose a usable model before sending."
                : "The usable selected providers can still run; unavailable providers may return item-level errors."
            }
            actionHref="/connections"
            actionLabel="Open connections"
          />
        ) : null}

        <textarea
          className="mt-4 min-h-44 w-full resize-y rounded-md border border-border p-3 text-sm outline-none focus:border-accent"
          placeholder="Say hello in one short sentence."
          value={prompt}
          maxLength={20_000}
          onChange={(event) => setPrompt(event.target.value)}
        />

        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={saveHistory}
            onChange={(event) => setSaveHistory(event.target.checked)}
          />
          Save history
        </label>

        <div className="mt-3 flex gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!prompt.trim() || running || sendBlocked}
            onClick={submit}
          >
            <Send className="h-4 w-4" />
            Send
          </button>
          <button
            title="Stop streams"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
            type="button"
            disabled={!running}
            onClick={closeAllStreams}
          >
            <Square className="h-4 w-4" />
          </button>
          <button
            title="Clear responses"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface"
            type="button"
            onClick={() => setCards({})}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <section className="grid gap-4 xl:grid-cols-3">
        {(visibleCards.length ? visibleCards : [initialCard("gemini", byProvider.get("gemini"))]).map((card) => (
          <StreamingResponseCard
            key={card.provider}
            response={card}
            onCancel={card.jobId ? () => void cancelCardJob(card.provider, card.jobId!) : undefined}
            onRetry={card.jobId ? () => void retryCardJob(card.provider, card.jobId!) : undefined}
          />
        ))}
      </section>
    </div>
  );
}

export function isSendBlockedForState({
  mode,
  selectedSingleModel,
  selectedCompareCount,
  selectedCompareUsableCount
}: {
  mode: Mode;
  selectedSingleModel?: Awaited<ReturnType<typeof apiGetModelPreferences>>["models"][number];
  selectedCompareCount: number;
  selectedCompareUsableCount: number;
}) {
  return mode === "single"
    ? Boolean(selectedSingleModel && !selectedSingleModel.isUsable)
    : selectedCompareCount === 0 || selectedCompareUsableCount === 0;
}

export function ProviderWarning({
  title,
  message,
  actionHref,
  actionLabel
}: {
  title: string;
  message: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-1 text-amber-800">{message}</div>
          <Link
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium"
            href={actionHref}
          >
            <RotateCcw className="h-3 w-3" />
            {actionLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ProviderRow({
  provider,
  model,
  checked,
  type,
  onChange
}: {
  provider: ProviderConnectionSummary;
  model?: Awaited<ReturnType<typeof apiGetModelPreferences>>["models"][number];
  checked: boolean;
  type: "radio" | "checkbox";
  onChange: () => void;
}) {
  const chatReady = provider.capabilities.includes("send_message") && provider.readiness === "ready";
  const recoveryLabel = model?.recovery?.temporarilyDisabled
    ? "temporarily disabled"
    : model?.recovery?.providerDegraded
      ? model.recovery.degradedMode === "block_for_duration" ? "recovery blocked" : "degraded"
      : null;
  const disabledByRecovery = Boolean(model?.recovery?.temporarilyDisabled || model?.recovery?.degradedMode === "block_for_duration");
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
      <span>
        <span className="block font-medium">{provider.displayName}</span>
        <span className="text-xs text-muted">
          {provider.status} · {chatReady ? "chat-ready" : provider.readiness}
        </span>
      </span>
      {recoveryLabel ? <span className="text-xs text-amber-600">{recoveryLabel}</span> : null}
      <input type={type} checked={checked} onChange={onChange} disabled={disabledByRecovery} />
    </label>
  );
}

function StreamingResponseCard({
  response,
  onCancel,
  onRetry
}: {
  response: ResponseCardState;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const cancellable = response.jobId && ["queued", "started", "streaming"].includes(response.status);
  const retryable =
    response.jobId &&
    ["error", "cancelled", "timeout", "requires_login", "manual_action_required", "rate_limited"].includes(response.status);
  return (
    <article className="min-h-96 rounded-md border border-border bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{response.displayName}</h2>
        <span className="rounded-md bg-surface px-2 py-1 text-xs text-muted">{response.status}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
          disabled={!cancellable}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
          disabled={!retryable}
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      </div>
      {response.message ? (
        <div className="mt-4 rounded-md border border-warn/40 bg-amber-50 p-3 text-sm text-amber-950">
          {response.message}
          {response.status === "requires_login" ? (
            <Link
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs"
              href="/connections"
            >
              <RotateCcw className="h-3 w-3" />
              Reconnect
            </Link>
          ) : null}
        </div>
      ) : null}
      <pre className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">
        {response.text || "No response yet."}
      </pre>
    </article>
  );
}

function isProvider(value: string): value is ProviderId {
  return value === "gemini" || value === "chatgpt" || value === "grok";
}

function initialCard(provider: ProviderId | string, definition?: ProviderConnectionSummary): ResponseCardState {
  return {
    provider,
    displayName: definition?.displayName ?? provider,
    status: "queued",
    text: ""
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected provider error.";
}
