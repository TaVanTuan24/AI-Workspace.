"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  KeyRound,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type { ProviderId } from "@uaiw/shared/types/provider";
import {
  apiCreateApiKey,
  apiGetApiKeys,
  apiGetModelPreferences,
  apiUpdateModelPreferences,
  connectProvider,
  getOnboardingStatus,
  getProviderHealth,
  markOnboardingComplete,
  refreshProviderHealth,
  skipOnboarding,
  testOpenAIModelsEndpoint,
  updateOnboardingStatus,
  type ApiKey,
  type ModelPreferenceView,
  type OnboardingStatus,
  type ProviderHealth
} from "../../lib/api";

type StepId = "welcome" | "connect_provider" | "choose_model" | "create_api_key" | "test_endpoint" | "backup" | "finish";

const steps: Array<{ id: StepId; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "connect_provider", label: "Connect" },
  { id: "choose_model", label: "Model" },
  { id: "create_api_key", label: "API Key" },
  { id: "test_endpoint", label: "Test" },
  { id: "backup", label: "Backups" },
  { id: "finish", label: "Finish" }
];

const stepFromRecommendation: Record<OnboardingStatus["recommendedNextStep"], StepId> = {
  connect_provider: "connect_provider",
  choose_model: "choose_model",
  create_api_key: "create_api_key",
  test_endpoint: "test_endpoint",
  backup: "backup",
  done: "finish"
};

export default function OnboardingPage() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [healths, setHealths] = useState<ProviderHealth[]>([]);
  const [models, setModels] = useState<ModelPreferenceView[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [currentStep, setCurrentStep] = useState<StepId>("welcome");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rawKey, setRawKey] = useState("");
  const [newKeyName, setNewKeyName] = useState("Onboarding key");
  const [testResult, setTestResult] = useState("");

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      setLoading(true);
      setError("");
      const [statusRes, healthRes, modelsRes, keysRes] = await Promise.all([
        getOnboardingStatus(),
        getProviderHealth(),
        apiGetModelPreferences(),
        apiGetApiKeys()
      ]);
      setStatus(statusRes);
      setHealths(healthRes.data);
      setModels(modelsRes.models);
      setApiKeys(keysRes.keys);
      const saved = statusRes.lastStep && isStep(statusRes.lastStep) ? statusRes.lastStep : stepFromRecommendation[statusRes.recommendedNextStep];
      setCurrentStep(saved === "finish" && !statusRes.completed ? "finish" : saved);
    } catch (err: any) {
      setError(err.message || "Failed to load onboarding");
    } finally {
      setLoading(false);
    }
  }

  async function goToStep(step: StepId) {
    setCurrentStep(step);
    setError("");
    setStatus(await updateOnboardingStatus({ lastStep: step }));
  }

  async function nextStep() {
    const index = steps.findIndex((step) => step.id === currentStep);
    const next = steps[Math.min(index + 1, steps.length - 1)].id;
    await goToStep(next);
  }

  async function handleSkip() {
    setBusy("skip");
    try {
      setStatus(await skipOnboarding());
      setCurrentStep("finish");
    } finally {
      setBusy("");
    }
  }

  async function handleComplete() {
    setBusy("complete");
    try {
      setStatus(await markOnboardingComplete());
      setCurrentStep("finish");
    } finally {
      setBusy("");
    }
  }

  async function handleConnect(provider: ProviderId) {
    setBusy(`connect-${provider}`);
    setError("");
    try {
      await connectProvider(provider);
      await loadAll();
    } catch (err: any) {
      setError(err.message || `Failed to start ${provider} connection`);
    } finally {
      setBusy("");
    }
  }

  async function handleValidate(provider: string) {
    setBusy(`validate-${provider}`);
    setError("");
    try {
      const updated = await refreshProviderHealth(provider);
      setHealths((current) => current.map((item) => item.provider === provider ? updated : item));
      setStatus(await getOnboardingStatus());
    } catch (err: any) {
      setError(err.message || `Failed to validate ${provider}`);
    } finally {
      setBusy("");
    }
  }

  async function handleDefaultModel(modelId: string) {
    setBusy("model");
    setError("");
    try {
      const updated = await apiUpdateModelPreferences({
        autoSelectFirstUsable: true,
        models: models.map((model) => ({
          modelId: model.modelId,
          enabled: model.enabled || model.modelId === modelId,
          isDefault: model.modelId === modelId,
          priority: model.priority,
          selectedSubModelId: model.selectedSubModelId
        }))
      });
      setModels(updated.models);
      setStatus(await getOnboardingStatus());
    } catch (err: any) {
      setError(err.message || "Failed to save default model");
    } finally {
      setBusy("");
    }
  }

  async function handleCreateApiKey() {
    const defaultModel = models.find((model) => model.isDefault) ?? models.find((model) => model.isUsable);
    setBusy("key");
    setError("");
    try {
      const result = await apiCreateApiKey(
        newKeyName.trim() || "Onboarding key",
        defaultModel ? [defaultModel.modelId] : undefined,
        undefined
      );
      setRawKey(result.rawKey);
      const keysRes = await apiGetApiKeys();
      setApiKeys(keysRes.keys);
      setStatus(await getOnboardingStatus());
    } catch (err: any) {
      setError(err.message || "Failed to create API key");
    } finally {
      setBusy("");
    }
  }

  async function handleTestModels() {
    if (!rawKey) return;
    setBusy("test");
    setError("");
    setTestResult("");
    try {
      const result = await testOpenAIModelsEndpoint(rawKey);
      setTestResult(`Success: ${Array.isArray(result.data) ? result.data.length : 0} model records returned.`);
      setStatus(await getOnboardingStatus());
    } catch (err: any) {
      setError(err.message || "Failed to test /v1/models");
    } finally {
      setBusy("");
    }
  }

  const activeKeys = apiKeys.filter((key) => key.status === "active");
  const usableModels = models.filter((model) => model.enabled && model.isUsable);
  const defaultModel = models.find((model) => model.isDefault);
  const curl = `curl http://localhost:4000/v1/models \\\n  -H "Authorization: Bearer ${rawKey || "<your-api-key>"}"`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-md bg-surface px-2 py-1 text-xs text-muted">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            First-run setup
          </div>
          <h1 className="mt-3 text-3xl font-semibold">Onboarding Wizard</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Connect your own provider sessions, choose a default model, create an internal API key, and test `/v1/models`.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy === "skip"}
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface disabled:opacity-50"
        >
          {busy === "skip" ? "Skipping..." : "Skip for now"}
        </button>
      </header>

      <nav className="grid gap-2 md:grid-cols-7">
        {steps.map((step, index) => {
          const active = step.id === currentStep;
          const currentIndex = steps.findIndex((item) => item.id === currentStep);
          const done = index < currentIndex;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => void goToStep(step.id)}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                active
                  ? "border-accent bg-accent text-white"
                  : done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                    : "border-border bg-panel text-muted hover:bg-surface"
              }`}
            >
              <span className="block font-medium">{step.label}</span>
            </button>
          );
        })}
      </nav>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</div>
      ) : null}

      {loading || !status ? (
        <div className="rounded-lg border border-border bg-panel p-8 text-muted">Loading onboarding...</div>
      ) : (
        <section className="rounded-lg border border-border bg-panel p-6">
          {currentStep === "welcome" ? (
            <WelcomeStep status={status} onStart={() => void goToStep("connect_provider")} />
          ) : null}

          {currentStep === "connect_provider" ? (
            <ConnectStep
              healths={healths}
              busy={busy}
              onConnect={handleConnect}
              onValidate={handleValidate}
            />
          ) : null}

          {currentStep === "choose_model" ? (
            <ModelStep
              models={models}
              defaultModelId={defaultModel?.modelId ?? ""}
              busy={busy === "model"}
              onSave={handleDefaultModel}
            />
          ) : null}

          {currentStep === "create_api_key" ? (
            <ApiKeyStep
              activeKeyCount={activeKeys.length}
              keyName={newKeyName}
              rawKey={rawKey}
              defaultModel={defaultModel ?? usableModels[0]}
              busy={busy === "key"}
              onKeyNameChange={setNewKeyName}
              onCreate={handleCreateApiKey}
              onClearRawKey={() => setRawKey("")}
            />
          ) : null}

          {currentStep === "test_endpoint" ? (
            <TestStep
              rawKey={rawKey}
              curl={curl}
              testResult={testResult}
              busy={busy === "test"}
              onTest={handleTestModels}
            />
          ) : null}

          {currentStep === "backup" ? <BackupStep /> : null}

          {currentStep === "finish" ? (
            <FinishStep status={status} busy={busy === "complete"} onComplete={handleComplete} />
          ) : null}

          <div className="mt-8 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Checklist status={status} />
            <div className="flex gap-2">
              <Link href="/settings" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface">
                Settings
              </Link>
              {currentStep !== "finish" ? (
                <button
                  type="button"
                  onClick={() => void nextStep()}
                  className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <Link href="/chat" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">
                  Go to Chat
                </Link>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function WelcomeStep({ status, onStart }: { status: OnboardingStatus; onStart: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <h2 className="text-2xl font-semibold">Set up your local AI workspace</h2>
        <p className="mt-3 text-muted">
          Unified AI Workspace uses your own ChatGPT, Gemini, and Claude sessions through direct provider login. It does not ask for provider passwords or bypass challenges.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Feature icon={ShieldCheck} title="Private sessions" text="Provider sessions stay encrypted at rest." />
          <Feature icon={KeyRound} title="Internal API" text="Create a local OpenAI-compatible key." />
          <Feature icon={Play} title="Prompt-safe test" text="The default endpoint test reads /v1/models only." />
        </div>
        <button
          type="button"
          onClick={onStart}
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Start setup
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <StatusPanel status={status} />
    </div>
  );
}

function ConnectStep({
  healths,
  busy,
  onConnect,
  onValidate
}: {
  healths: ProviderHealth[];
  busy: string;
  onConnect: (provider: ProviderId) => Promise<void>;
  onValidate: (provider: string) => Promise<void>;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold">Connect at least one provider</h2>
      <p className="mt-2 text-sm text-muted">
        Connect opens the official provider login flow. Validate only runs when you press the button.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {healths.map((health) => (
          <article key={health.provider} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{health.displayName}</h3>
              <span className="rounded-md bg-surface px-2 py-1 text-xs text-muted">{health.connectionStatus}</span>
            </div>
            <p className="mt-3 text-sm text-muted">
              {health.isUsable ? "Ready for chat and API routing." : "Connect or validate this provider before using it."}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void onConnect(health.provider as ProviderId)}
                disabled={busy === `connect-${health.provider}`}
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === `connect-${health.provider}` ? "Opening..." : health.connectionStatus === "connected" ? "Reconnect" : "Connect"}
              </button>
              <button
                type="button"
                onClick={() => void onValidate(health.provider)}
                disabled={busy === `validate-${health.provider}` || health.connectionStatus === "not_connected"}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface disabled:opacity-50"
              >
                {busy === `validate-${health.provider}` ? "Validating..." : "Validate"}
              </button>
            </div>
          </article>
        ))}
      </div>
      <Link href="/connections" className="mt-5 inline-flex text-sm font-medium text-accent underline">
        Open full Connections page
      </Link>
    </div>
  );
}

function ModelStep({
  models,
  defaultModelId,
  busy,
  onSave
}: {
  models: ModelPreferenceView[];
  defaultModelId: string;
  busy: boolean;
  onSave: (modelId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(defaultModelId || models.find((model) => model.isUsable)?.modelId || models[0]?.modelId || "");

  useEffect(() => {
    if (defaultModelId) setSelected(defaultModelId);
  }, [defaultModelId]);

  return (
    <div>
      <h2 className="text-2xl font-semibold">Choose a default model</h2>
      <p className="mt-2 text-sm text-muted">
        The default model is used by chat and internal routing. Prefer a usable connected provider.
      </p>
      <div className="mt-5 max-w-xl">
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
        >
          {models.map((model) => (
            <option key={model.modelId} value={model.modelId}>
              {model.displayName} {model.isUsable ? "" : "(not usable)"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void onSave(selected)}
          disabled={!selected || busy}
          className="mt-3 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save default model"}
        </button>
      </div>
      <Link href="/settings/models" className="mt-5 inline-flex text-sm font-medium text-accent underline">
        Open full Model Preferences
      </Link>
    </div>
  );
}

function ApiKeyStep({
  activeKeyCount,
  keyName,
  rawKey,
  defaultModel,
  busy,
  onKeyNameChange,
  onCreate,
  onClearRawKey
}: {
  activeKeyCount: number;
  keyName: string;
  rawKey: string;
  defaultModel?: ModelPreferenceView;
  busy: boolean;
  onKeyNameChange: (value: string) => void;
  onCreate: () => Promise<void>;
  onClearRawKey: () => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold">Create an internal API key</h2>
      <p className="mt-2 text-sm text-muted">
        API keys let external tools call this local OpenAI-compatible endpoint. The raw key is shown once.
      </p>
      {activeKeyCount > 0 ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          You already have {activeKeyCount} active API key{activeKeyCount === 1 ? "" : "s"}.
        </div>
      ) : null}
      <div className="mt-5 max-w-xl space-y-3">
        <input
          value={keyName}
          onChange={(event) => onKeyNameChange(event.target.value)}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
          placeholder="Onboarding key"
        />
        <div className="text-xs text-muted">
          Scope: {defaultModel ? defaultModel.displayName : "all enabled models if no default is available"}
        </div>
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create API key"}
        </button>
      </div>
      {rawKey ? (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <div className="font-medium">Save this key now. It will not be shown again.</div>
          <code className="mt-3 block break-all rounded-md bg-white p-3 text-xs">{rawKey}</code>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(rawKey)}
              className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
            >
              <Clipboard className="h-4 w-4" aria-hidden="true" />
              Copy
            </button>
            <button
              type="button"
              onClick={onClearRawKey}
              className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
            >
              I saved it, hide key
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TestStep({
  rawKey,
  curl,
  testResult,
  busy,
  onTest
}: {
  rawKey: string;
  curl: string;
  testResult: string;
  busy: boolean;
  onTest: () => Promise<void>;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold">Test the OpenAI-compatible endpoint</h2>
      <p className="mt-2 text-sm text-muted">
        The default test calls `/v1/models`. It does not send a prompt or create a chat job.
      </p>
      <pre className="mt-5 overflow-x-auto rounded-lg border border-border bg-surface p-4 text-sm">{curl}</pre>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(curl)}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface"
        >
          <Clipboard className="h-4 w-4" aria-hidden="true" />
          Copy curl
        </button>
        <button
          type="button"
          onClick={() => void onTest()}
          disabled={!rawKey || busy}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          Test /v1/models
        </button>
      </div>
      {!rawKey ? (
        <p className="mt-3 text-sm text-muted">Create a key in the previous step to run the browser test here.</p>
      ) : null}
      {testResult ? <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">{testResult}</div> : null}
    </div>
  );
}

function BackupStep() {
  return (
    <div>
      <h2 className="text-2xl font-semibold">Plan your backups</h2>
      <p className="mt-2 text-sm text-muted">
        Conversation export/import is available from settings. Encrypted backups are recommended for sensitive history.
      </p>
      <div className="mt-5 rounded-lg border border-border p-4">
        <div className="font-medium">Backup reminder</div>
        <p className="mt-2 text-sm text-muted">
          The wizard does not collect or store backup passphrases. Export only when you explicitly open the backup page.
        </p>
        <Link href="/settings/conversations" className="mt-4 inline-flex rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">
          Open conversation backups
        </Link>
      </div>
    </div>
  );
}

function FinishStep({ status, busy, onComplete }: { status: OnboardingStatus; busy: boolean; onComplete: () => Promise<void> }) {
  return (
    <div>
      <h2 className="text-2xl font-semibold">{status.completed ? "Setup complete" : "Finish setup"}</h2>
      <p className="mt-2 text-sm text-muted">
        Review the checklist, then mark onboarding complete when the workspace is ready for your daily flow.
      </p>
      <div className="mt-5">
        <Checklist status={status} />
      </div>
      {!status.completed ? (
        <button
          type="button"
          onClick={() => void onComplete()}
          disabled={busy}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {busy ? "Saving..." : "Mark onboarding complete"}
        </button>
      ) : null}
    </div>
  );
}

function StatusPanel({ status }: { status: OnboardingStatus }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="font-medium">Recommended next step</div>
      <div className="mt-2 rounded-md bg-white px-3 py-2 text-sm">{status.recommendedNextStep.replace(/_/g, " ")}</div>
      <div className="mt-4">
        <Checklist status={status} />
      </div>
    </div>
  );
}

function Checklist({ status }: { status: OnboardingStatus }) {
  const items = [
    ["Provider connected", status.checklist.hasConnectedProvider],
    ["Usable model", status.checklist.hasUsableModel],
    ["Default model", status.checklist.hasDefaultModel],
    ["Active API key", status.checklist.hasActiveApiKey],
    ["Endpoint tested", status.checklist.hasUsage]
  ] as const;

  return (
    <div className="grid gap-2 text-xs sm:grid-cols-5">
      {items.map(([label, done]) => (
        <div key={label} className={`rounded-md border px-2 py-1 ${done ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-border bg-white text-muted"}`}>
          {done ? "Done" : "Pending"}: {label}
        </div>
      ))}
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: typeof ShieldCheck; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
      <div className="mt-3 font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </div>
  );
}

function isStep(step: string): step is StepId {
  return steps.some((item) => item.id === step);
}
