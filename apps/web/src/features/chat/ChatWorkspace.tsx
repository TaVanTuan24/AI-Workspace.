"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Download, MessageSquare, Paperclip, Pencil, Plus, RotateCcw, Send, Square, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import type { ProviderConnectionSummary, ProviderEvent, ProviderId } from "@uaiw/shared/types/provider";
import {
  apiGetProviders,
  apiExportThread,
  cancelChatJob,
  postChat,
  postMultiChat,
  retryChatJob,
  streamUrl,
  apiGetModelPreferences,
  getWorkspaceNotifications,
  uploadChatAttachment,
  listConversationThreads,
  getConversationThread,
  renameConversationThread,
  deleteConversationThread,
  saveDiscussionToHistory,
  type ChatAttachmentView,
  type ConversationThreadSummary
} from "../../lib/api";
import { filterVisibleNotifications, readDismissedNotifications, type DismissedNotificationMap } from "../../lib/notificationDismissals";

export type Mode = "single" | "compare" | "discussion";
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

type Turn = {
  id: string;
  prompt: string;
  attachments: ChatAttachmentView[];
  cards: Record<string, ResponseCardState>;
};

// One speaking turn in a sequential multi-AI discussion.
type DiscussionEntry = {
  id: string;
  round: number;
  provider: ProviderId;
  displayName: string;
  status: CardStatus;
  text: string;
  message?: string;
};

function newTurnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `turn_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

export function buildDiscussionPrompt(
  topic: string,
  transcript: Array<{ speaker: string; text: string }>,
  speakerName: string
): string {
  if (transcript.length === 0) {
    return [
      `You are ${speakerName}, taking part in a structured discussion between several AI assistants.`,
      "",
      "Topic:",
      `"""${topic}"""`,
      "",
      "You are speaking first. Open the discussion with your perspective in a few concise paragraphs."
    ].join("\n");
  }
  const history = transcript.map((entry) => `### ${entry.speaker}\n${entry.text}`).join("\n\n");
  return [
    `You are ${speakerName}, taking part in a structured discussion between several AI assistants.`,
    "",
    "Topic:",
    `"""${topic}"""`,
    "",
    "Discussion so far:",
    "",
    history,
    "",
    `As ${speakerName}, continue the discussion: respond to and build on the points above, add new insight, and note where you agree or disagree. Be concise and do not repeat what was already said.`
  ].join("\n");
}

export function ChatWorkspace() {
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: apiGetProviders
  });
  const threadsQuery = useQuery({
    queryKey: ["conversationThreads"],
    queryFn: () => listConversationThreads({ limit: 100 })
  });
  const [historyError, setHistoryError] = useState("");
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());
  const [mode, setMode] = useState<Mode>("single");
  const [selectedSingle, setSelectedSingle] = useState<ProviderId>("gemini");
  const [selectedCompare, setSelectedCompare] = useState<ProviderId[]>(["gemini", "chatgpt", "claude"]);
  // Discussion mode: ordered participants (order = speaking order), round count,
  // the running transcript, and a run/abort flag.
  const [selectedDiscussion, setSelectedDiscussion] = useState<ProviderId[]>(["gemini", "chatgpt", "claude"]);
  const [discussionRounds, setDiscussionRounds] = useState(2);
  const [discussionTopic, setDiscussionTopic] = useState("");
  const [discussionEntries, setDiscussionEntries] = useState<DiscussionEntry[]>([]);
  const [discussionRunning, setDiscussionRunning] = useState(false);
  const [discussionError, setDiscussionError] = useState("");
  const [discussionNotice, setDiscussionNotice] = useState("");
  const [savingDiscussion, setSavingDiscussion] = useState(false);
  const discussionAbortRef = useRef(false);
  // Lets stopDiscussion force-resolve the in-flight step even if the worker
  // never emits a terminal event (e.g. it is down), so the loop can unwind.
  const activeStreamRef = useRef<{ finish: (status: CardStatus, message?: string) => void } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [saveHistory, setSaveHistory] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachmentView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Close any open SSE streams when the chat view unmounts (e.g. navigating
  // away mid-stream), so connections and listeners are not leaked.
  useEffect(() => {
    const sources = sourcesRef.current;
    return () => {
      for (const source of sources.values()) source.close();
      sources.clear();
    };
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
  const running = turns.some((turn) =>
    Object.values(turn.cards).some(
      (card) => card.status === "queued" || card.status === "started" || card.status === "streaming"
    )
  );

  function updateTurnCard(
    turnId: string,
    provider: ProviderId | string,
    update: (existing: ResponseCardState) => ResponseCardState
  ) {
    setTurns((prev) =>
      prev.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              cards: {
                ...turn.cards,
                [provider]: update(
                  turn.cards[provider] ?? initialCard(provider as ProviderId, byProvider.get(provider as ProviderId))
                )
              }
            }
          : turn
      )
    );
  }
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

    const turnId = newTurnId();
    const turnPrompt = prompt.trim();
    const turnAttachments = attachments;
    const attachmentIds = attachments.map((a) => a.id);
    setPrompt("");
    setAttachments([]);
    setUploadError("");

    if (mode === "single") {
      const definition = byProvider.get(selectedSingle);
      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          prompt: turnPrompt,
          attachments: turnAttachments,
          cards: { [selectedSingle]: initialCard(selectedSingle, definition) }
        }
      ]);

      try {
        const result = await postChat({
          provider: selectedSingle,
          prompt: turnPrompt,
          saveHistory,
          threadId: threadId ?? undefined,
          attachmentIds: attachmentIds.length ? attachmentIds : undefined
        });
        if (result.threadId) {
          const isNewThread = !threadId;
          setThreadId(result.threadId);
          if (isNewThread) void queryClient.invalidateQueries({ queryKey: ["conversationThreads"] });
        }
        attachStream(turnId, selectedSingle, result.jobId, result.streamUrl);
      } catch (error) {
        updateTurnCard(turnId, selectedSingle, () => ({
          ...initialCard(selectedSingle, definition),
          status: errorMessage(error).includes("chat-ready") ? "provider_not_ready" : "requires_login",
          message: errorMessage(error)
        }));
      }
      return;
    }

    const selected: ProviderId[] = selectedCompare.length ? selectedCompare : ["gemini"];
    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        prompt: turnPrompt,
        attachments: turnAttachments,
        cards: Object.fromEntries(selected.map((provider) => [provider, initialCard(provider, byProvider.get(provider))]))
      }
    ]);

    try {
      const result = await postMultiChat({
        providers: selected,
        prompt: turnPrompt,
        saveHistory,
        threadId: threadId ?? undefined,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined
      });
      if (result.threadId) {
        const isNewThread = !threadId;
        setThreadId(result.threadId);
        if (isNewThread) void queryClient.invalidateQueries({ queryKey: ["conversationThreads"] });
      }

      for (const error of result.errors) {
        updateTurnCard(turnId, error.provider, () => ({
          ...initialCard(error.provider as ProviderId, byProvider.get(error.provider as ProviderId)),
          status: error.errorCode === "PROVIDER_NOT_READY" ? "provider_not_ready" : "requires_login",
          message: error.message
        }));
      }
      for (const job of result.jobs) {
        updateTurnCard(turnId, job.provider, () => ({
          ...initialCard(job.provider, byProvider.get(job.provider)),
          jobId: job.jobId,
          status: "queued"
        }));
        attachStream(turnId, job.provider, job.jobId, job.streamUrl);
      }
    } catch (error) {
      updateTurnCard(turnId, "system", () => ({
        provider: "system",
        displayName: "System",
        status: "error",
        text: "",
        message: errorMessage(error)
      }));
    }
  }

  function startNewConversation() {
    closeAllStreams();
    setTurns([]);
    setThreadId(null);
    setAttachments([]);
    setUploadError("");
    setHistoryError("");
  }

  // Send one prompt to a single provider and resolve once the turn ends,
  // streaming live updates via onUpdate. Used by the discussion orchestrator
  // to run providers strictly one after another.
  function streamPrompt(
    provider: ProviderId,
    promptText: string,
    onUpdate: (text: string, status: CardStatus) => void
  ): Promise<{ status: CardStatus; text: string; message?: string }> {
    return new Promise((resolve) => {
      void (async () => {
        let started;
        try {
          started = await postChat({ provider, prompt: promptText, saveHistory: false });
        } catch (error) {
          resolve({ status: "requires_login", text: "", message: errorMessage(error) });
          return;
        }
        const { jobId, streamUrl: path } = started;
        const source = new EventSource(streamUrl(path));
        sourcesRef.current.set(jobId, source);

        let text = "";
        let settled = false;
        const finish = (status: CardStatus, message?: string) => {
          if (settled) return;
          settled = true;
          activeStreamRef.current = null;
          closeStream(jobId);
          resolve({ status, text, message });
        };
        activeStreamRef.current = { finish };

        const handleEvent = (event: MessageEvent) => {
          let parsed: ProviderEvent;
          try {
            parsed = JSON.parse(event.data) as ProviderEvent;
          } catch {
            return;
          }
          switch (parsed.type) {
            case "started":
              onUpdate(text, "started");
              break;
            case "message_delta":
              text += parsed.text;
              onUpdate(text, "streaming");
              break;
            case "message_complete":
              text = parsed.text;
              onUpdate(text, "completed");
              finish("completed");
              break;
            case "requires_login":
            case "manual_action_required":
            case "rate_limited":
            case "timeout":
            case "cancelled":
            case "error":
              finish(parsed.type, parsed.message);
              break;
            case "done":
              finish(text ? "completed" : "error", text ? undefined : "No response was produced.");
              break;
            default:
              break;
          }
        };

        [
          "started",
          "message_delta",
          "message_complete",
          "requires_login",
          "manual_action_required",
          "rate_limited",
          "cancelled",
          "timeout",
          "error",
          "done"
        ].forEach((type) => source.addEventListener(type, handleEvent));

        source.onerror = () => {
          if (text) finish("completed");
          else finish("error", "The stream disconnected before the provider finished responding.");
        };
      })();
    });
  }

  async function runDiscussion() {
    const topic = prompt.trim();
    const participants = selectedDiscussion;
    if (!topic || discussionRunning || participants.length === 0) return;

    const rounds = Math.min(Math.max(Math.trunc(discussionRounds) || 1, 1), 10);
    discussionAbortRef.current = false;
    setDiscussionError("");
    setDiscussionNotice("");
    setDiscussionRunning(true);
    setDiscussionEntries([]);
    setDiscussionTopic(topic);
    setPrompt("");

    const transcript: Array<{ speaker: string; text: string }> = [];

    try {
      for (let round = 1; round <= rounds; round += 1) {
        for (const provider of participants) {
          if (discussionAbortRef.current) return;

          const displayName = byProvider.get(provider)?.displayName ?? provider;
          const entryId = newTurnId();
          setDiscussionEntries((prev) => [
            ...prev,
            { id: entryId, round, provider, displayName, status: "queued", text: "" }
          ]);

          const updateEntry = (patch: Partial<DiscussionEntry>) =>
            setDiscussionEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));

          const stepPrompt = buildDiscussionPrompt(topic, transcript, displayName);
          const result = await streamPrompt(provider, stepPrompt, (text, status) =>
            updateEntry({ text, status })
          );

          updateEntry({ status: result.status, text: result.text, message: result.message });

          if (result.status === "completed" && result.text.trim()) {
            transcript.push({ speaker: displayName, text: result.text.trim() });
          }
          // Non-fatal: a provider that fails is skipped; the discussion continues.
        }
      }
    } catch (error) {
      setDiscussionError(errorMessage(error));
    } finally {
      setDiscussionRunning(false);
    }
  }

  async function stopDiscussion() {
    discussionAbortRef.current = true;
    // Best-effort: cancel any in-flight jobs server-side.
    for (const [jobId] of sourcesRef.current) {
      await cancelChatJob(jobId).catch(() => {});
    }
    // Force-resolve the awaited step so runDiscussion's loop unwinds even if the
    // worker never sends a terminal event; finish() also closes the stream.
    activeStreamRef.current?.finish("cancelled", "Discussion stopped.");
    closeAllStreams();
    setDiscussionRunning(false);
    setDiscussionEntries((prev) =>
      prev.map((e) =>
        e.status === "queued" || e.status === "started" || e.status === "streaming"
          ? { ...e, status: "cancelled", message: "Discussion stopped." }
          : e
      )
    );
  }

  function exportDiscussion() {
    if (discussionEntries.length === 0) return;
    const lines: string[] = [`# Discussion: ${discussionTopic}`, ""];
    let lastRound = 0;
    for (const entry of discussionEntries) {
      if (entry.round !== lastRound) {
        lines.push(`## Round ${entry.round}`, "");
        lastRound = entry.round;
      }
      lines.push(`### ${entry.displayName}`, "", entry.text || "_(no response)_", "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `discussion-${Date.now()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function saveDiscussionHistory() {
    if (savingDiscussion) return;
    const entries = discussionEntries
      .filter((entry) => entry.status === "completed" && entry.text.trim())
      .map((entry) => ({ round: entry.round, provider: entry.provider, text: entry.text }));
    if (entries.length === 0) {
      setDiscussionError("Nothing to save yet — let at least one turn complete.");
      return;
    }
    setSavingDiscussion(true);
    setDiscussionError("");
    setDiscussionNotice("");
    try {
      await saveDiscussionToHistory(discussionTopic, entries);
      setDiscussionNotice("Saved to history.");
      void queryClient.invalidateQueries({ queryKey: ["conversationThreads"] });
    } catch (error) {
      setDiscussionError(errorMessage(error));
    } finally {
      setSavingDiscussion(false);
    }
  }

  async function openThread(id: string) {
    setHistoryError("");
    try {
      const detail = await getConversationThread(id);
      closeAllStreams();

      // A saved discussion replays into the discussion transcript, not the
      // single/compare turn view.
      if (detail.kind === "discussion") {
        const topicMessage = detail.messages.find((message) => message.role === "user");
        const entries: DiscussionEntry[] = detail.messages
          .filter((message) => message.role !== "user")
          .map((message) => {
            const provider = (message.provider ?? "assistant") as ProviderId;
            return {
              id: message.id,
              round: message.round ?? 1,
              provider,
              displayName: byProvider.get(provider)?.displayName ?? provider,
              status: "completed" as CardStatus,
              text: message.content
            };
          });
        startNewConversation();
        setMode("discussion");
        setDiscussionTopic(topicMessage?.content ?? detail.title ?? "");
        setDiscussionEntries(entries);
        setDiscussionError("");
        setDiscussionNotice("");
        return;
      }

      const hydrated: Turn[] = [];
      let current: Turn | null = null;
      for (const message of detail.messages) {
        if (message.role === "user") {
          current = { id: message.id, prompt: message.content, attachments: [], cards: {} };
          hydrated.push(current);
        } else {
          if (!current) {
            current = { id: message.id, prompt: "", attachments: [], cards: {} };
            hydrated.push(current);
          }
          const provider = message.provider ?? "assistant";
          current.cards[provider] = {
            provider,
            displayName: byProvider.get(provider as ProviderId)?.displayName ?? provider,
            status: message.role === "error" ? "error" : "completed",
            text: message.content,
            message: message.role === "error" ? message.content : undefined
          };
        }
      }
      setMode((prev) => (prev === "discussion" ? "single" : prev));
      setTurns(hydrated);
      setThreadId(detail.id);
      setAttachments([]);
      setUploadError("");
      const threadProviders = detail.providers.filter(isProvider);
      if (threadProviders.length === 1) {
        setMode("single");
        setSelectedSingle(threadProviders[0]);
      } else if (threadProviders.length > 1) {
        setMode("compare");
        setSelectedCompare(threadProviders);
      }
    } catch (error) {
      setHistoryError(errorMessage(error));
    }
  }

  async function handleDeleteThread(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this conversation? This cannot be undone.")) {
      return;
    }
    setHistoryError("");
    try {
      await deleteConversationThread(id);
      if (threadId === id) startNewConversation();
      void queryClient.invalidateQueries({ queryKey: ["conversationThreads"] });
    } catch (error) {
      setHistoryError(errorMessage(error));
    }
  }

  async function handleRenameThread(id: string, title: string) {
    setHistoryError("");
    try {
      await renameConversationThread(id, title);
      void queryClient.invalidateQueries({ queryKey: ["conversationThreads"] });
    } catch (error) {
      setHistoryError(errorMessage(error));
    }
  }

  async function handleExportThread(id: string) {
    setHistoryError("");
    try {
      const blob = await apiExportThread(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `conversation-${id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setHistoryError(errorMessage(error));
    }
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError("");
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        if (attachments.length >= 6) {
          setUploadError("Up to 6 attachments per message.");
          break;
        }
        const uploaded = await uploadChatAttachment(file);
        setAttachments((prev) => (prev.length >= 6 ? prev : [...prev, uploaded]));
      }
    } catch (error) {
      setUploadError(errorMessage(error));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  function attachStream(turnId: string, provider: ProviderId, jobId: string, path: string) {
    const source = new EventSource(streamUrl(path));
    sourcesRef.current.set(jobId, source);

    const handleEvent = (event: MessageEvent) => {
      let parsed: ProviderEvent;
      try {
        parsed = JSON.parse(event.data) as ProviderEvent;
      } catch {
        // Ignore frames that are not valid JSON (keep-alives, partial/empty
        // payloads). A malformed frame must never crash the stream handler.
        return;
      }
      updateTurnCard(turnId, provider, (existing) => {
        if (parsed.type === "started") {
          return { ...existing, jobId, status: "started" };
        }
        if (parsed.type === "message_delta") {
          return { ...existing, jobId, status: "streaming", text: existing.text + parsed.text };
        }
        if (parsed.type === "message_complete") {
          return { ...existing, jobId, status: "completed", text: parsed.text };
        }
        if (parsed.type === "queued") {
          return { ...existing, jobId, status: "queued" };
        }
        if (parsed.type === "requires_login" || parsed.type === "manual_action_required") {
          closeStream(jobId);
          return {
            ...existing,
            jobId,
            status: parsed.type === "manual_action_required" ? "manual_action_required" : "requires_login",
            message: parsed.message
          };
        }
        if (parsed.type === "cancelled") {
          closeStream(jobId);
          return { ...existing, jobId, status: "cancelled", message: parsed.message };
        }
        if (parsed.type === "rate_limited") {
          closeStream(jobId);
          return { ...existing, jobId, status: "rate_limited", message: parsed.message };
        }
        if (parsed.type === "timeout") {
          closeStream(jobId);
          return { ...existing, jobId, status: "timeout", message: parsed.message };
        }
        if (parsed.type === "retrying") {
          return { ...existing, jobId, status: "queued", message: `Retrying ${parsed.retryOfJobId}` };
        }
        if (parsed.type === "error") {
          closeStream(jobId);
          return { ...existing, jobId, status: "error", message: parsed.message };
        }
        if (parsed.type === "done") {
          closeStream(jobId);
          return {
            ...existing,
            jobId,
            status: existing.status === "cancelled" || existing.status === "timeout" ? existing.status : "completed"
          };
        }
        return existing;
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
      updateTurnCard(turnId, provider, (existing) =>
        existing.status === "completed"
          ? existing
          : {
              ...existing,
              status: "error",
              message: "The stream disconnected before the provider finished responding."
            }
      );
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

  async function cancelCardJob(turnId: string, provider: ProviderId | string, jobId: string) {
    try {
      await cancelChatJob(jobId);
      closeStream(jobId);
      updateTurnCard(turnId, provider, (existing) => ({
        ...existing,
        status: "cancelled",
        message: "Job was cancelled."
      }));
    } catch (error) {
      updateTurnCard(turnId, provider, (existing) => ({
        ...existing,
        status: "error",
        message: errorMessage(error)
      }));
    }
  }

  async function retryCardJob(turnId: string, provider: ProviderId | string, jobId: string) {
    if (!isProvider(provider)) return;
    try {
      const result = await retryChatJob(jobId);
      updateTurnCard(turnId, provider, () => ({
        ...initialCard(provider, byProvider.get(provider)),
        jobId: result.jobId,
        status: "queued",
        message: `Retrying ${jobId}`
      }));
      attachStream(turnId, provider, result.jobId, result.streamUrl);
    } catch (error) {
      updateTurnCard(turnId, provider, (existing) => ({
        ...existing,
        status: "error",
        message: errorMessage(error)
      }));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr] xl:grid-cols-[260px_360px_1fr]">
      <HistorySidebar
        threads={threadsQuery.data?.threads ?? []}
        loading={threadsQuery.isLoading}
        activeThreadId={threadId}
        error={historyError}
        onNew={startNewConversation}
        onOpen={(id) => void openThread(id)}
        onRename={(id, title) => void handleRenameThread(id, title)}
        onDelete={(id) => void handleDeleteThread(id)}
        onExport={(id) => void handleExportThread(id)}
      />
      <aside className="rounded-md border border-border bg-panel p-4">
        <h1 className="text-lg font-semibold">Chat</h1>

        <div className="mt-4 grid grid-cols-3 rounded-md border border-border p-1 text-sm">
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
          <button
            className={`rounded px-3 py-2 ${mode === "discussion" ? "bg-accent text-white" : "text-muted"}`}
            onClick={() => setMode("discussion")}
            type="button"
          >
            Discuss
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {providerList.map((provider) => {
            if (mode === "single") {
              return (
                <ProviderRow
                  key={provider.provider}
                  provider={provider}
                  model={modelsByProvider.get(provider.provider)}
                  checked={selectedSingle === provider.provider}
                  type="radio"
                  onChange={() => setSelectedSingle(provider.provider)}
                />
              );
            }
            if (mode === "compare") {
              return (
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
              );
            }
            const order = selectedDiscussion.indexOf(provider.provider);
            return (
              <ProviderRow
                key={provider.provider}
                provider={provider}
                model={modelsByProvider.get(provider.provider)}
                checked={order >= 0}
                type="checkbox"
                orderLabel={order >= 0 ? String(order + 1) : undefined}
                disabled={discussionRunning}
                onChange={() =>
                  setSelectedDiscussion((current) =>
                    current.includes(provider.provider)
                      ? current.filter((item) => item !== provider.provider)
                      : [...current, provider.provider]
                  )
                }
              />
            );
          })}
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

        {threadId && turns.length > 0 ? (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
            <span>Continuing this conversation. Follow-ups stay in the same provider chat.</span>
            <button type="button" className="font-medium text-accent hover:underline" onClick={startNewConversation}>
              New
            </button>
          </div>
        ) : null}

        <textarea
          className="mt-4 min-h-44 w-full resize-y rounded-md border border-border p-3 text-sm outline-none focus:border-accent"
          placeholder={
            mode === "discussion"
              ? "Enter a topic for the AIs to discuss…"
              : threadId && turns.length > 0
                ? "Continue the conversation…"
                : "Say hello in one short sentence."
          }
          value={prompt}
          maxLength={20_000}
          disabled={discussionRunning}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl/Cmd+Enter sends (or starts a discussion) without leaving the box.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (mode === "discussion") void runDiscussion();
              else void submit();
            }
          }}
        />

        {mode === "discussion" ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <label className="text-muted" htmlFor="discussion-rounds">Rounds</label>
              <input
                id="discussion-rounds"
                type="number"
                min={1}
                max={10}
                value={discussionRounds}
                disabled={discussionRunning}
                onChange={(event) => setDiscussionRounds(Number(event.target.value))}
                className="h-9 w-20 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-accent disabled:opacity-50"
              />
              <span className="text-xs text-muted">
                {selectedDiscussion.length} participant{selectedDiscussion.length === 1 ? "" : "s"}, in the numbered order
              </span>
            </div>
            {discussionError ? <div className="mt-2 text-xs text-red-500">{discussionError}</div> : null}
            {discussionNotice ? <div className="mt-2 text-xs text-emerald-600">{discussionNotice}</div> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {discussionRunning ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface"
                  onClick={() => void stopDiscussion()}
                >
                  <Square className="h-4 w-4" />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={!prompt.trim() || selectedDiscussion.length === 0}
                  onClick={() => void runDiscussion()}
                >
                  <Send className="h-4 w-4" />
                  Start discussion
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface disabled:opacity-50"
                disabled={savingDiscussion || discussionRunning || discussionEntries.length === 0}
                onClick={() => void saveDiscussionHistory()}
              >
                <Check className="h-4 w-4" />
                {savingDiscussion ? "Saving…" : "Save to history"}
              </button>
              <button
                title="Export discussion as Markdown"
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
                disabled={discussionEntries.length === 0}
                onClick={exportDiscussion}
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                title="Clear discussion"
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
                disabled={discussionRunning || discussionEntries.length === 0}
                onClick={() => {
                  setDiscussionEntries([]);
                  setDiscussionError("");
                  setDiscussionNotice("");
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          <>
        {attachments.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map((file) => (
              <span
                key={file.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                title={`${file.filename} · ${(file.sizeBytes / 1024).toFixed(0)} KB`}
              >
                <Paperclip className="h-3 w-3 text-muted" />
                <span className="max-w-[140px] truncate">{file.filename}</span>
                <button
                  type="button"
                  className="text-muted hover:text-foreground"
                  onClick={() => removeAttachment(file.id)}
                  aria-label={`Remove ${file.filename}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {uploadError ? <div className="mt-2 text-xs text-red-500">{uploadError}</div> : null}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json,.doc,.docx,.xlsx"
          onChange={(event) => void handleFilesSelected(event.target.files)}
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
            title="Attach files"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
            type="button"
            disabled={uploading || attachments.length >= 6}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
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
            title="New conversation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface disabled:opacity-50"
            type="button"
            disabled={turns.length === 0 && !threadId}
            onClick={startNewConversation}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
          </>
        )}
      </aside>

      <section className="space-y-6">
        {mode === "discussion" ? (
          <DiscussionTranscript entries={discussionEntries} running={discussionRunning} />
        ) : turns.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
            Send a prompt to start. Follow-up messages continue the same provider conversation.
          </div>
        ) : (
          turns.map((turn) => {
            const cards = Object.values(turn.cards);
            return (
              <div key={turn.id} className="space-y-3">
                <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">You</div>
                  <div className="whitespace-pre-wrap">{turn.prompt}</div>
                  {turn.attachments.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {turn.attachments.map((file) => (
                        <span
                          key={file.id}
                          className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-xs text-muted"
                        >
                          <Paperclip className="h-3 w-3" />
                          <span className="max-w-[160px] truncate">{file.filename}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className={`grid gap-4 ${cards.length > 1 ? "xl:grid-cols-3" : ""}`}>
                  {cards.map((card) => (
                    <StreamingResponseCard
                      key={card.provider}
                      response={card}
                      onCancel={card.jobId ? () => void cancelCardJob(turn.id, card.provider, card.jobId!) : undefined}
                      onRetry={card.jobId ? () => void retryCardJob(turn.id, card.provider, card.jobId!) : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
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
  onChange,
  orderLabel,
  disabled = false
}: {
  provider: ProviderConnectionSummary;
  model?: Awaited<ReturnType<typeof apiGetModelPreferences>>["models"][number];
  checked: boolean;
  type: "radio" | "checkbox";
  onChange: () => void;
  orderLabel?: string;
  disabled?: boolean;
}) {
  const chatReady = provider.capabilities.includes("send_message") && provider.readiness === "ready";
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <span className="flex items-center gap-2">
        {orderLabel ? (
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
            {orderLabel}
          </span>
        ) : null}
        <span>
          <span className="block font-medium">{provider.displayName}</span>
          <span className="text-xs text-muted">
            {provider.status} · {chatReady ? "chat-ready" : provider.readiness}
          </span>
        </span>
      </span>
      <input type={type} checked={checked} onChange={onChange} disabled={disabled} />
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
        <CopyButton text={response.text} />
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

function HistorySidebar({
  threads,
  loading,
  activeThreadId,
  error,
  onNew,
  onOpen,
  onRename,
  onDelete,
  onExport
}: {
  threads: ConversationThreadSummary[];
  loading: boolean;
  activeThreadId: string | null;
  error: string;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}) {
  return (
    <aside className="flex max-h-[calc(100vh-7rem)] flex-col rounded-md border border-border bg-panel p-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-muted" />
          History
        </h2>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>

      {error ? <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-600">{error}</div> : null}

      <div className="mt-3 flex-1 space-y-1 overflow-y-auto">
        {loading ? (
          <div className="px-2 py-3 text-xs text-muted">Loading conversations…</div>
        ) : threads.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted">No conversations yet. Send a prompt to start one.</div>
        ) : (
          threads.map((thread) => (
            <HistoryRow
              key={thread.id}
              thread={thread}
              active={thread.id === activeThreadId}
              onOpen={onOpen}
              onRename={onRename}
              onDelete={onDelete}
              onExport={onExport}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function HistoryRow({
  thread,
  active,
  onOpen,
  onRename,
  onDelete,
  onExport
}: {
  thread: ConversationThreadSummary;
  active: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title ?? "");

  function submitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== thread.title) onRename(thread.id, trimmed);
    setEditing(false);
  }

  const updated = new Date(thread.updatedAt).toLocaleDateString();

  return (
    <div
      className={`group rounded-md border px-2 py-2 text-sm ${
        active ? "border-accent bg-surface" : "border-transparent hover:border-border hover:bg-surface"
      }`}
    >
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitRename();
              if (event.key === "Escape") setEditing(false);
            }}
            className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <button type="button" className="text-muted hover:text-foreground" onClick={submitRename} aria-label="Save title">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="text-muted hover:text-foreground" onClick={() => setEditing(false)} aria-label="Cancel rename">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          <button type="button" className="block w-full text-left" onClick={() => onOpen(thread.id)}>
            <span className="flex items-center gap-1.5">
              {thread.kind === "discussion" ? (
                <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  Discuss
                </span>
              ) : null}
              <span className="truncate font-medium">{thread.title || "Untitled conversation"}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {thread.providers.length ? `${thread.providers.join(", ")} · ` : ""}
              {thread.messageCount} msg{thread.messageCount === 1 ? "" : "s"} · {updated}
            </span>
          </button>
          <div className="mt-1 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <button type="button" className="text-muted hover:text-foreground" onClick={() => { setDraft(thread.title ?? ""); setEditing(true); }} aria-label="Rename conversation">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="text-muted hover:text-foreground" onClick={() => onExport(thread.id)} aria-label="Export conversation">
              <Download className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="text-muted hover:text-red-600" onClick={() => onDelete(thread.id)} aria-label="Delete conversation">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DiscussionTranscript({ entries, running }: { entries: DiscussionEntry[]; running: boolean }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
        Enter a topic, pick participants (they speak in the numbered order), set the number of rounds, then
        <span className="font-medium"> Start discussion</span>. Each AI sees the previous replies and builds on them.
      </div>
    );
  }
  let lastRound = 0;
  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const showRound = entry.round !== lastRound;
        lastRound = entry.round;
        return (
          <div key={entry.id} className="space-y-2">
            {showRound ? (
              <div className="flex items-center gap-3 pt-2 text-xs font-medium uppercase tracking-wide text-muted">
                <span className="h-px flex-1 bg-border" />
                Round {entry.round}
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <article className="rounded-md border border-border bg-panel p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{entry.displayName}</h2>
                <div className="flex items-center gap-2">
                  <CopyButton text={entry.text} />
                  <span className="rounded-md bg-surface px-2 py-1 text-xs text-muted">{entry.status}</span>
                </div>
              </div>
              {entry.message ? (
                <div className="mt-3 rounded-md border border-warn/40 bg-amber-50 p-3 text-sm text-amber-950">
                  {entry.message}
                </div>
              ) : null}
              <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                {entry.text ||
                  (entry.status === "queued"
                    ? "Waiting…"
                    : entry.status === "started" || entry.status === "streaming"
                      ? "…"
                      : "No response yet.")}
              </pre>
            </article>
          </div>
        );
      })}
      {running ? <div className="text-center text-xs text-muted">Discussion in progress…</div> : null}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      title="Copy response"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — ignore */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function isProvider(value: string): value is ProviderId {
  return value === "gemini" || value === "chatgpt" || value === "claude";
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
