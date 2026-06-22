# Unified AI Workspace

Local-first/self-host MVP for using personal ChatGPT, Grok, and Gemini accounts from one workspace through browser automation. Users log in directly on each provider's official website. The app never asks for provider passwords, never bypasses CAPTCHA/2FA/challenges, and never logs cookies, tokens, localStorage, sessionStorage, storageState, or login screenshots.

## 1. Architecture Overview

The MVP is split into explicit trust boundaries:

- `apps/web`: Next.js UI for login, connections, chat, security settings, and streaming comparison views.
- `apps/api`: Fastify API for app auth, provider metadata, chat job creation, SSE streaming, and audit metadata.
- `apps/worker`: BullMQ worker that owns Playwright browser execution, decrypts sessions only in memory, and publishes provider events.
- `packages/shared`: Provider IDs, statuses, events, prompt input, and safe error codes.
- `packages/session-vault`: AES-256-GCM encryption boundary for browser session state.
- `packages/provider-adapters`: Provider adapter contract plus ChatGPT, Grok, and Gemini browser UI adapters.
- `prisma`: SQLite-first schema designed to move to PostgreSQL.

Request flow:

```txt
Web UI -> API -> BullMQ/Redis -> Worker -> Playwright -> Official provider website
                         ^          |
                         |          v
                    SSE endpoint <- Redis pub/sub ProviderEvent
```

Security posture:

- One session per `user_id + provider`.
- No provider password collection.
- Encrypted session state at rest.
- Worker decrypts sessions only in memory.
- No session blobs sent to frontend.
- Provider challenges require user action.
- One active job per `user_id + provider`.
- Disconnect deletes encrypted session metadata and browser profile references.

## 2. Monorepo Structure

```txt
unified-ai-workspace/
  apps/
    web/
      src/app/
      src/components/
      src/features/
      src/lib/
      src/styles/
    api/
      src/routes/
      src/modules/
      src/services/
      src/middleware/
      src/config/
      src/server.ts
    worker/
      src/processors/
      src/browser/
      src/providers/
      src/queues/
      src/worker.ts
  packages/
    shared/src/types/
    session-vault/src/
    provider-adapters/src/
  prisma/schema.prisma
  docker/
  docker-compose.yml
```

## 3. Database Schema

Implemented in `prisma/schema.prisma`.

Core models:

- `User`: local app identity, kept even in single-user MVP for Phase 2 migration.
- `ProviderConnection`: status and encrypted session reference for one user/provider pair.
- `ChatThread`: conversation container.
- `Message`: user/assistant/system/tool messages.
- `AutomationJob`: queue-backed provider execution record.
- `AuditLog`: safe metadata only.

Provider connection states:

- `not_connected`
- `connecting`
- `connected`
- `requires_login`
- `expired`
- `error`
- `disconnected`

Job states:

- `queued`
- `running`
- `streaming`
- `completed`
- `failed`
- `cancelled`
- `requires_login`
- `manual_action_required`

## 4. API Contracts

Auth:

- `POST /auth/login`

Providers:

- `GET /providers`
- `POST /providers/:provider/connect/start`
- `GET /providers/:provider/connect/status?connectSessionId=...`
- `POST /providers/:provider/test`
- `POST /providers/:provider/disconnect`

Chat:

- `POST /chat`
- `POST /chat/multi`
- `GET /chat/:jobId/stream`

All provider endpoints validate `provider` as `chatgpt | grok | gemini`. No endpoint returns encrypted or decrypted session blobs.

## 5. Provider Adapter Design

`ProviderAdapter` standardizes login detection, validation, prompt sending, session import/export, and stop/new-chat operations.

Adapters intentionally use MVP-grade selectors and conservative fallbacks. They do not use stealth plugins, CAPTCHA bypass, 2FA bypass, rate-limit evasion, or hidden credential capture.

Provider implementation order for real MVP work:

1. Gemini, ChatGPT, and Grok are implemented with MVP-grade browser UI adapters.
2. Provider selectors remain intentionally conservative and should be smoke-tested after provider UI changes.

## 6. Session Vault Design

`packages/session-vault` encrypts browser session state with AES-256-GCM.

Encrypted blob:

```ts
{
  version: 1,
  algorithm: "AES-256-GCM",
  keyId: "local-v1",
  iv: "base64",
  authTag: "base64",
  ciphertext: "base64",
  createdAt: "iso"
}
```

The local MVP uses `SESSION_MASTER_KEY` from `.env`. The class accepts a key provider so Phase 2 can move to KMS/Vault without changing API/worker code.

Required tests to add in M3:

- encrypt/decrypt round trip.
- tampered ciphertext fails.
- wrong key fails.
- empty session rejected.

## 7. Browser Worker Design

Worker execution flow:

1. Receive BullMQ job.
2. Validate job ownership.
3. Load `ProviderConnection` by `user_id + provider`.
4. Emit `requires_login` if not connected.
5. Load encrypted session blob.
6. Decrypt with SessionVault in worker memory.
7. Create isolated Playwright browser context.
8. Import session state.
9. Run `adapter.validateSession()`.
10. Emit `requires_login` and update status if expired.
11. Run `adapter.sendMessage()`.
12. Publish `ProviderEvent` to `job:{jobId}`.
13. Save messages if `saveHistory = true`.
14. Update job status.
15. Cleanup context.

Timeouts:

- login flow timeout.
- prompt send timeout.
- response idle timeout.
- total job timeout.
- context cleanup timeout.

## 8. Streaming Design

MVP streaming uses SSE:

```txt
Worker -> Redis publish job:{jobId}
API /chat/:jobId/stream -> Redis subscribe job:{jobId}
Frontend EventSource -> response cards
```

SSE event types:

- `started`
- `message_delta`
- `message_complete`
- `requires_login`
- `manual_action_required`
- `rate_limited`
- `error`
- `done`

## 9. Frontend Design

Pages:

- `/login`
- `/dashboard`
- `/connections`
- `/chat`
- `/settings/security`

Components:

- `ProviderStatusCard`
- `ProviderConnectButton`
- `ProviderDisconnectButton`
- `UnifiedPromptComposer`
- `ProviderSelector`
- `MultiProviderSelector`
- `StreamingResponseCard`
- `ComparisonView`
- `SessionWarningBanner`
- `AuditLogTable`
- `SecuritySettingsPanel`

The first usable screen should be the workspace, not marketing content.

## 10. Docker Compose

`docker-compose.yml` starts:

- `web`
- `api`
- `worker`
- `redis`
- optional `postgres` profile

SQLite is the default MVP database through a local volume.

## 11. Milestone Plan

### M1 - Project Skeleton

Tasks:

- Setup monorepo.
- Setup TypeScript.
- Setup Next.js web.
- Setup Fastify API.
- Setup worker package.
- Setup shared package.
- Setup Prisma schema.
- Setup Docker Compose.

Acceptance criteria:

- `pnpm dev` starts web and API.
- API health check works.
- Prisma migration can run.
- Docker Compose boots Redis and optional DB.

### M2 - Auth + Provider Metadata

Tasks:

- Local auth.
- User table.
- ProviderConnection table.
- `GET /providers`.
- Basic dashboard and status cards.

Acceptance criteria:

- Local user can log in.
- Dashboard shows ChatGPT/Grok/Gemini status.
- Provider status comes from DB.

### M3 - Session Vault

Tasks:

- AES-256-GCM vault.
- Encrypted blob storage.
- Tests.
- Log redaction middleware.

Acceptance criteria:

- Round trip works.
- Tampering fails.
- Logs do not contain plaintext session data.

### M4 - Browser Worker Login Flow For 1 Provider

Tasks:

- BrowserManager.
- First real adapter.
- Connect start/status flow.
- Save encrypted session.

Acceptance criteria:

- Connect opens official provider login.
- User completes login manually.
- Session is saved encrypted.
- Disconnect deletes session.

### M5 - Single Provider Chat

Tasks:

- `POST /chat`.
- BullMQ job.
- Worker session load/decrypt.
- Adapter send message.
- SSE streaming.

Acceptance criteria:

- Prompt streams to UI.
- History saves when enabled.
- Expired session asks user to reconnect.

### M6 - Multi-provider Mode

Tasks:

- `POST /chat/multi`.
- Parallel jobs.
- Multi response cards.
- Partial failure handling.

Acceptance criteria:

- One prompt can target multiple providers.
- One provider failure does not break others.

### M7 - Provider Browser UI Adapters

Tasks:

- Implement real selectors iteratively for Gemini, ChatGPT, and Grok.
- Provider-specific error mapping.

Acceptance criteria:

- Connect/test per provider.
- Basic prompt flow per provider.
- Clear error states.

### M8 - Hardening Local Release

Tasks:

- Timeouts.
- Cleanup.
- Concurrency lock.
- Audit metadata.
- Disconnect/delete.
- Security checklist.

Acceptance criteria:

- No secret logging.
- One job per `user_id + provider`.
- Real disconnect.
- Local deployment README is complete.

## 12. OpenAI-compatible Internal Endpoint

This workspace provides an internal, OpenAI-compatible API endpoint designed for self-hosted integrations (e.g., OpenWebUI, n8n, Dify, Flowise).

> **WARNING:** This is not an official OpenAI API. It is a local compatibility layer that bridges OpenAI formats to browser automation providers. It should never be exposed publicly, and relies on pseudo-streaming by polling visible assistant text from the browser.

### Setup

1. Generate a random API key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. Add the key and configurations to your `.env` file:
   ```env
   INTERNAL_API_KEY=your_generated_key
   INTERNAL_API_SAVE_HISTORY=true
   OPENAI_COMPAT_NONSTREAM_TIMEOUT_MS=240000
   INTERNAL_API_RATE_LIMIT_PER_MINUTE=30
   ```
3. Connect providers in `/connections`.
4. Ensure Redis, API, and Worker processes are running.

### Using with External Tools (OpenWebUI, n8n)

- **Base URL:** `http://localhost:4000/v1`
- **API Key:** The value of your `INTERNAL_API_KEY`
- **Available Models:** `chatgpt-web`, `gemini-web`, `grok-web`

### Example: Streaming Response
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chatgpt-web",
    "messages": [{"role":"user","content":"Say hello in one sentence."}],
    "stream": true
  }'
```

### Example: Non-streaming Response
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-web",
    "messages": [{"role":"user","content":"Say hello in one sentence."}],
    "stream": false
  }'
```

### Limitations

- No tools or function calling.
- No vision or file upload support.
- No exact token usage tracking.
- Pseudo-streaming only (emulated chunks from the browser).
- Can break if the provider web UI changes.
- A valid, active browser session must be connected.

## 13. API Key Management

For local quick start, you can use `.env INTERNAL_API_KEY`. However, for normal use, you should enable DB-backed API keys.

1. Enable DB keys in `.env`:
   ```env
   ENABLE_DB_API_KEYS=true
   API_KEY_HASH_SECRET=your_secure_hash_secret_here
   ```
2. Run database migration:
   ```bash
   corepack pnpm exec prisma migrate dev --name internal_api_keys
   ```
3. Open `http://localhost:3000/settings/api-keys` to manage keys.
4. You can create keys, rotate them, or revoke them. Raw keys are never stored in the database, only their fast HMAC-SHA256 hashes are stored.

> **Security Note:** Raw keys are shown only once upon creation. If a key is leaked, revoke it immediately from the UI. Do not commit your `API_KEY_HASH_SECRET` or any raw API keys to source control.

## 14. API Usage Analytics

The workspace provides built-in usage analytics to monitor your OpenAI-compatible endpoint.

- **Data Privacy**: Usage analytics track strictly operational metadata (provider, model, token/char counts, duration, status). They **do not** store any prompt or response content, nor raw API keys or session configurations.
- **UI Dashboard**: View analytics at `http://localhost:3000/settings/api-usage`.
- **Retention**: Configurable via `API_USAGE_RETENTION_DAYS` (defaults to 30 days).

> **Security Note:** Usage analytics are designed for operational visibility, not content logging. Prompt and response content are intentionally excluded.

## 15. Provider Health and Model Readiness

The workspace provides advanced health validation and readiness caching for provider integrations. This ensures you always know which models are currently usable without needing to send an actual prompt.

- **`GET /v1/models` Readiness Metadata**: 
  The models endpoint includes detailed metadata (e.g. `isUsable`, `healthStatus`, `capabilities`, `requiresLogin`) alongside the standard OpenAI-compatible format. External tools may still only use the `id`, but advanced interfaces can leverage this metadata to show real-time provider applicability.

- **Health Dashboard**: 
  View and force-refresh validations at `/settings/provider-health`.

- **Security Boundaries**:
  - Refreshing health **does not send prompts**. It strictly validates the current encrypted browser session.
  - Active browser contexts are only spawned momentarily and securely cleaned up after status evaluation.

- **Time-to-Live Configuration**:
  Configurable caching minimizes unnecessary headless browser invocations:
  - `PROVIDER_HEALTH_TTL_SECONDS` (default: 300)
  - `PROVIDER_HEALTH_TIMEOUT_MS` (default: 60000)

## 16. Model Preferences

Users can natively control which browser-backed models are active, define priorities, and configure fallback behaviors seamlessly across the Workspace.

- **Path**: `/settings/models`
- **Controls**:
  - Enable/Disable specific integrations natively.
  - Set exactly one default model to route `/chat` requests automatically.
  - Assign numeric priority mapping automatic comparison modes.
  - Toggle `Auto-select first usable provider` to safely fallback if your primary integration becomes disconnected.
- **API Impact**: 
  - `/v1/models` injects user-specific preferences natively inside metadata.
  - `/v1/chat/completions` dynamically validates payloads. Disabled models implicitly throw a safe `model_disabled` API error, keeping downstream automation pipelines fully predictable without initiating headless instances unnecessarily.
- **Security Boundary**:
  - Model preferences represent user metadata uniquely. Adjusting preferences **never** affects actual stored session vaults or authentication states explicitly.

## 16A. Settings Hub

The workspace now includes a central settings hub at `/settings`.

- **Overview cards**: Provider readiness, model availability, internal API key counts, 24h/7d usage metadata, backup state, and provider health scheduler state.
- **Navigation**: Shared settings navigation links to connections, models, API keys, API usage, provider health, conversations, and security controls.
- **Warning states**: Highlights providers needing login, no usable models, no active API keys, disabled scheduler, failed requests, and rate-limited requests.
- **Security Boundary**:
  - The hub only loads safe operational metadata from `GET /settings/overview`.
  - Opening `/settings` does not refresh provider health, start browser automation, export conversations, send prompts, or load provider pages.
  - The response excludes raw API keys, API key hashes, prompts, responses, cookies, tokens, localStorage, storageState, and encrypted session blobs.

## 16B. Session Expiration Notifications

The workspace surfaces session and provider-readiness problems before a chat or OpenAI-compatible API request fails.

- **Where they appear**: Global banner, Settings badge, `/settings`, `/chat`, `/settings/provider-health`, and API key management warnings.
- **Detected states**: `requires_login`, `expired`, `manual_action_required`, provider UI changes, provider errors, and no usable enabled models.
- **Reconnect path**: Use `/connections` to reconnect directly on the official provider website. The app does not auto-reconnect or collect provider passwords.
- **Dismissal**: Dismissible warnings are hidden locally in browser `localStorage` under `uai.dismissedNotifications.v1`. Dismissal only hides UI; it does not change provider status.
- **Notification History**: Persistent, deduplicated history of alerts is stored in the database.
  - Accessible at `/settings/notifications`.
  - Supports tracking read/unread state.
  - Global navigation badge displays the exact count of unread history events.
- **Security Boundary**:
  1. Notification history stored in `notification_events` table (safe metadata only).
2. Per-user preferences in `notification_delivery_preferences`.
3. Delivery attempts logged in `notification_delivery_attempts`.
4. Extensible providers: Currently supports `in_app` and `webhook` (with signed payloads). Email/Slack are scaffolded.

### Webhook Delivery
When configured, webhooks deliver event payloads via `POST`. The request includes an `X-UAIW-Signature` header calculated using HMAC-SHA256 over the payload body prefixed by the timestamp.

Headers included:
- `X-UAIW-Event-Id`: The event ID.
- `X-UAIW-Timestamp`: Unix timestamp.
- `X-UAIW-Signature`: `sha256=<signature>`

To verify the signature on your receiving endpoint:
```js
const timestamp = req.headers['x-uaiw-timestamp'];
const signature = req.headers['x-uaiw-signature'].split('=')[1];
const expectedSignature = crypto.createHmac('sha256', SECRET)
  .update(`${timestamp}.${req.rawBody}`)
  .digest('hex');

if (signature !== expectedSignature) {
  throw new Error("Invalid signature");
}
``` 

### Notification Delivery Scaffold

The workspace includes a scaffold for outbound notification delivery. By default, only the **In-app** channel is actively delivering notifications (which populates the Notification History).

- **Available Channels (Scaffolded):** In-app (enabled by default), Email, Slack, and Webhook.
- **Workspace Notifications & Alerts:** Real-time and persistent notification history with delivery channels.
  - Channels supported: `in_app`, `webhook` (with HMAC-SHA256 signatures).
  - Webhook URL SSRF protection and strict timeouts.
- **Provider Analytics & Quotas:** Real-time rate limiting per provider/model, logging, and metrics. "Delivery attempts" for auditing.
- **Security Boundary:** 
  - For this milestone, the Email, Slack, and Webhook channels are strictly "noop" (no operation). They do not make any external network requests, even when enabled.
  - Enabling a noop channel records a `skipped_not_configured` attempt when an event occurs, ensuring testing does not expose data.
  - No secrets (e.g. SMTP passwords, Webhook URLs, Slack tokens) are stored or accessed in this milestone.

## User-Scoped API Keys

In addition to session connections, you can generate **Internal API Keys** (e.g. `sk-uaiw-...`) from the `/settings` hub.  - Critical no-usable-model warnings are not dismissible.

## 16C. First-run Onboarding

The workspace includes a first-run setup wizard at `/onboarding`.

- **Flow**: Welcome, connect providers, choose default model, create an API key, test `/v1/models`, review backup guidance, and finish.
- **Settings integration**: `/settings` shows a setup CTA while onboarding is incomplete or skipped. The top navigation also shows a subtle setup badge.
- **State**: Completion, skip state, and last step are stored per user in `UserSettings`.
- **Endpoint test**:
  - The default wizard test calls `GET /v1/models`.
  - It does not send prompts or create chat jobs.
  - A real chat test remains outside this wizard.
- **Security Boundary**:
  - The wizard never asks for provider passwords.
  - Provider connect still opens the official provider login flow.
  - Provider health validation only runs after an explicit user click.
  - API keys are never created automatically. Raw keys are shown only once after user confirmation.
  - Backup passphrases are not collected or stored in onboarding.
  - No cookies, tokens, storage state, encrypted session blobs, API key hashes, prompts, or responses are exposed.

## 17. Per-Key Model Scopes

You can aggressively isolate capabilities by defining Model Scopes uniquely restricted per-API-key natively.

- **Path**: `/settings/api-keys`
- **Controls**:
  - Assign arbitrary names and uniquely define allowed model integrations dynamically.
  - Leave scopes empty to grant universal access against all globally enabled Models seamlessly.
  - Additive Restrictions: Globally disabling a model naturally overrides Key boundaries ensuring a secure source of truth explicitly.
- **API Impact**: 
  - `GET /v1/models` natively evaluates the Key signature safely masking explicitly disallowed endpoints securely out of view.
  - `POST /v1/chat/completions` explicitly fires `isModelAllowedForApiKey()` cleanly dropping payloads utilizing `model_not_allowed_for_key` seamlessly.
- **Testing via Curl**:
  ```bash
  curl http://localhost:4000/v1/models \
    -H "Authorization: Bearer uai_live_YOUR_KEY"
  ```
  Only endpoints specifically authorized under your API Key scope will seamlessly render inherently.

## 18. Usage log cleanup

By default, the unified workspace stores API execution trails enabling comprehensive diagnostics efficiently.

- **Retention Threshold**: Defined cleanly utilizing `API_USAGE_RETENTION_DAYS` (Defaulting logically avoiding infinite DB bloating explicitly).

## 19. Provider Sub-model Selection

Users can select explicitly available provider variants directly within the `/settings/models` interface dynamically mapping:
- **Current / Provider Default**: Native provider model variants implicitly matching the active Session states natively.
- **Fast / Lightweight**: Optimized executions targeting faster execution footprints natively explicitly avoiding Paywall locks.
- **Reasoning**: Advanced logic traces explicitly prioritizing logic sequences dynamically leveraging explicit native capabilities properly.

Selection applies organically across:
- **Web Chat** instances inherently mapped reliably.
- **Compare Mode** executions projecting parallel execution payloads explicitly safely.
- **OpenAI-compatible Endpoints** smoothly projecting `selectedSubModelLabel` contexts strictly implicitly validating Payload mapping structures correctly.

*Note: Base IDs (`chatgpt-web`, `gemini-web`, `grok-web`) structurally remain natively unaffected accurately protecting underlying architectures gracefully. Availability heavily depends upon active Paywalls explicitly failing back smoothly towards `current` states gracefully.*

## 20. Conversation Export/Import

Users can seamlessly backup and restore chat history dynamically isolating pure textual representations cleanly.

- **Path**: `/settings/conversations`
- **Exporting Options**:
  - Export purely unencrypted `.json` archives mapping full Chat Threads securely.
  - Generates Explicit `unified-ai-workspace.conversations` formats natively dropping internal constraints inherently.
- **Security Boundaries**:
  - **Included**: Titles, Chat Threads, Messages, Timestamps, and strictly Safe Metadata (`finishReason`, `provider`, `model`, `durationMs`).
  - **Excluded**: Provider sessions, Browser caches, Environment configurations, encrypted Blobs, and Auth configurations. 
- **Importing Protocols**:
  - Initiates explicit Zod Validation Previews naturally avoiding oversaturation (`Max File: 10MB`, `Max Messages: 50000`).
  - **Conflict Strategy**: Operations rigidly map `create_new` paradigms dynamically avoiding data-merge collisions natively appending `[Imported]` prefixes securely. 
  - Unique internal UUID allocations explicitly regenerate seamlessly ensuring pure ownership strictly coupled toward the active User correctly.

### Encrypted Conversation Backups

Users have the option to export an encrypted backup of their conversations.

- **Path**: `/settings/conversations`
- **Security Boundaries**:
  - **Included**: Conversations, messages, and safe metadata.
  - **Excluded**: Provider sessions, browser cookies/tokens, API keys, and encrypted session blobs.
- **Cryptography**:
  - Derives key from passphrase using `scrypt`.
  - Encrypts payload using `AES-256-GCM`.
  - Employs random salt and initialization vector (IV) per file.
- **Passphrase**:
  - The passphrase is **never stored** and **never logged**.
  - **Cannot be recovered**. If lost, the backup is permanently unreadable.
- **Importing Protocols**:
  - Requires the correct passphrase to decrypt.
  - Decrypts purely in-memory before passing through standard import schema validation.
Usage logs store safe metadata only (latency, provider, model, success/failure). To keep the database lean over time, you can purge old usage logs. 

- **Retention Config**:
  - `API_USAGE_RETENTION_DAYS`: Set threshold dynamically avoiding payload inflation securely. (Default: 30 days)

## 21. Selector diagnostics

Use the safe DOM diagnostic engine when provider UI layouts actively change. The engine automatically identifies candidates for broken selectors gracefully, while securely redacting user credentials natively.

### Commands
```bash
corepack pnpm smoke:chatgpt:diagnose
corepack pnpm smoke:gemini:diagnose
corepack pnpm smoke:grok:diagnose
```

### Safety Guarantees
- No screenshots captured.
- No raw HTML payloads exported.
- No cookies/tokens/sessions logged.
- No prompts executed dynamically.
- Text instances longer than 80 chars are truncated accurately. Redactions target emails, JWTs, and UUIDs specifically.

### Usage Protocol
- JSON Reports actively save into `./var/smoke-reports/`.
- Review `missingKinds` and explicitly vet `topCandidates`.
- If confidence aligns natively, manually inject mapped selectors into `<provider>/selectors.ts`.
- Run active Provider validations (`detect-ui` / `diagnose-ui`) ensuring operational synchronization.

## 22. Per-key Rate Limits
The API natively provisions customizable request throttling per API Key independent of global workspace constraints, securing backend environments completely mapping operational load limits statically.

### Configuration
- **Access Route**: Configuration lives actively inside `/settings/api-keys`.
- **Options**:
  - `Workspace Default`: Derives operational throughput directly coupled from global configuration securely.
  - `Custom Requests/Minute`: Dynamically isolates bounded requests targeting strict quota allocations explicitly (e.g. 10/min, 60/min) per-key statically mapping loads efficiently.

### Environment Control Limits
```env
INTERNAL_API_RATE_LIMIT_PER_MINUTE=30
INTERNAL_API_RATE_LIMIT_MAX_PER_MINUTE=300
```

### Rate Limit Exhaustion Responses
Exceeding configured minute-bounds naturally drops responses explicitly triggering HTTP 429 validations securely returning:
```json
{
  "error": {
    "message": "Rate limit exceeded.",
    "type": "rate_limit_error",
    "code": "rate_limit_exceeded"
  }
}
```

- Operational metrics including rate-limited exclusions trigger natively into `/settings/api-usage` tracking effectively providing complete observational fidelity natively.

## 23. Provider-specific Rate Limits

Provider-specific limits cap browser automation work per user and provider before a chat job is created or enqueued. They are separate from internal API key throttles:

- Per-key limiter runs first on `/v1/*` requests.
- Provider limiter runs after model/provider resolution and before queue enqueue.
- Redis keys use `provider-rate:{userId}:{provider}:{minuteBucket}` and never include raw API keys, cookies, tokens, prompts, or session data.
- Open settings at `/settings/provider-rate-limits` to customize or reset ChatGPT, Gemini, and Grok limits.

### Environment Defaults

```env
PROVIDER_RATE_LIMIT_DEFAULT_PER_MINUTE=30
PROVIDER_RATE_LIMIT_MAX_PER_MINUTE=300
PROVIDER_RATE_LIMIT_CHATGPT_PER_MINUTE=20
PROVIDER_RATE_LIMIT_GEMINI_PER_MINUTE=30
PROVIDER_RATE_LIMIT_GROK_PER_MINUTE=10
```

### OpenAI-compatible 429 Response

```json
{
  "error": {
    "message": "Provider rate limit exceeded.",
    "type": "rate_limit_error",
    "code": "provider_rate_limit_exceeded",
    "provider": "chatgpt"
  }
}
```

Provider limit hits are recorded in API usage with `status=rate_limited` and `errorCode=provider_rate_limit_exceeded`.

## 24. Provider Limit Analytics

Provider limit analytics show which browser-automation provider is hitting its configured cap most often. The dashboard is available in:

- `/settings/api-usage`
- `/settings/provider-rate-limits`

The analytics track only aggregate, operational metadata:

- Provider and model IDs.
- Safe API key display data such as key name and prefix.
- Time range buckets for the last 24h and last 7d.
- Recent provider-limit event metadata capped to a small list.

They do not log or expose prompts, responses, raw API keys, key hashes, cookies, tokens, session state, encrypted session blobs, provider account identity, or raw request bodies.

Use these metrics to tune:

```env
PROVIDER_RATE_LIMIT_CHATGPT_PER_MINUTE=20
PROVIDER_RATE_LIMIT_GEMINI_PER_MINUTE=30
PROVIDER_RATE_LIMIT_GROK_PER_MINUTE=10
```

If a provider has frequent hits, review upstream client traffic and per-key limits before raising the provider cap.

## 25. Notification Preferences

In-app operational alerts can be configured at:

```txt
/settings/notifications
```

Preferences are stored per user and control:

- Provider session issue alerts: expired sessions, reconnect required, manual actions, UI changes, and unusable providers.
- No usable model alerts.
- Provider rate-limit spike alerts.
- The provider spike threshold, measured as hits in the last 24h.

Provider limit spike alerts use safe aggregate analytics only. They do not send prompts, trigger provider health refreshes, read provider sessions, expose raw API keys, expose key hashes, or include cookies/tokens/session state. Dismissal remains local UI state in the browser and is keyed by notification fingerprint.

## 26. Internal Provider-limit Logging

Provider-level rate-limit failures are logged as safe usage metadata for:

- OpenAI-compatible API requests.
- Internal single-provider chat requests.
- Internal compare/multi chat requests.
- Internal auto-retries.

Each limits hit records:
- Provider ID
- Model ID
- Global workspace threshold
- Source route
- API key prefix (if applicable)

## 27. Settings Hub

The Settings Hub is the central configuration panel for workspace administrators to control all platform modules.

- **Access:** Direct via UI navigation to `/settings/overview`
- **Security Context:** Configurations update global database states while persisting provider constraints securely.

### Modules Available

- **Connections** (`/settings/connections`): Add, validate, or remove browser-automation provider profiles.
- **Models** (`/settings/models`): Toggle model availability, set fallback priorities, set default models, and view provider connection readiness. Manually refresh provider health from this page without risking account lockouts.
- **API Keys** (`/settings/api-keys`): Issue internal routing API keys with scoped capabilities.
- **Provider Rate Limits** (`/settings/provider-rate-limits`): Set granular request throttling bounds before hitting automation browsers.
- **API Usage** (`/settings/api-usage`): High-level operational throughput monitoring and metrics validation.
- **Provider Limit Analytics** (`/settings/provider-limit-analytics`): Monitor provider rate-limit spikes dynamically. Shows aggregated hit counts, trend indicators, top hit models, and sources to optimize your workflow.
- **Notifications** (`/settings/notifications`): View workspace notifications, active alerts, configure delivery preferences across channels, and manage alert history securely.
- **Conversations** (`/settings/conversations`): Create encrypted conversation exports ensuring absolute local data protection securely.

### User Workflows
- Check the hub to immediately understand offline provider causes and limits preventing request fulfillment.
- Validate `missingKinds` and health statuses instantly before relying on internal automated retries.
- Review limits and current usage logs to optimize multi-agent orchestration.

## 28. Publishing Docker images

The project includes a GitHub Actions workflow (`Publish Docker Images`) to build and push Docker images for the API, Worker, and Web services to a container registry.

### Features
- **Dry-run by default:** The workflow runs with `push=false` by default to test builds without publishing.
- **Security:**
  - No `.env` files, browser profiles, provider sessions, or database files are baked into the images.
  - Runtime secrets are supplied strictly at deploy time via environment variables.
- **Tags:** Images are automatically tagged with the specified version, the Git SHA, and optionally the `latest` tag (if explicitly requested).

### Running the Workflow
Trigger the `Publish Docker Images` workflow manually in the GitHub Actions tab.

Example GHCR Inputs:
```txt
version: 0.1.0
registry: ghcr.io
image_namespace: your-org/unified-ai-workspace
push: true
tag_latest: false
```

### Required Secrets
- For **GHCR** (`ghcr.io`): `GITHUB_TOKEN` is automatically used and sufficient.
- For **Other Registries**: Ensure `REGISTRY_USERNAME` and `REGISTRY_PASSWORD` are set in your repository secrets.

### Generated Images
When `push=true`, the following images are published:
- `ghcr.io/<namespace>/api:<tag>`
- `ghcr.io/<namespace>/worker:<tag>`
- `ghcr.io/<namespace>/web:<tag>`

### Using Published Images with Compose
You can run the workspace using your published images with `docker-compose` by providing environment variables:

```bash
UAIW_API_IMAGE=ghcr.io/your-org/unified-ai-workspace/api:0.1.0 \
UAIW_WORKER_IMAGE=ghcr.io/your-org/unified-ai-workspace/worker:0.1.0 \
UAIW_WEB_IMAGE=ghcr.io/your-org/unified-ai-workspace/web:0.1.0 \
docker compose up -d
- `internal_multi_chat`
- `internal_retry`

Logged metadata is limited to provider, model ID, source, provider limit, limit type, status, timestamp, and safe API-key display data when applicable. Internal chat entries use `apiKeyId=null`.

The logger does not store prompts, responses, full messages, browser DOM, screenshots, provider session data, cookies, tokens, storage state, encrypted session blobs, raw API keys, or key hashes.

- **Commands**:
  ```bash
  # Dry-run using default retention config (shows what would be deleted without deleting anything)
  corepack pnpm api-usage:cleanup -- --dry-run
  
  # Run cleanup using default retention config
  corepack pnpm api-usage:cleanup
  
  # Delete logs older than 7 days (overrides env config)
  corepack pnpm api-usage:cleanup -- --older-than-days 7
  
  # Delete logs before a specific date
  corepack pnpm api-usage:cleanup -- --before 2026-06-01
  ```

- **Safety Guarantee**:
  This command **only** deletes `InternalApiUsageLog` entries. It **does not** delete chat history, API keys, provider sessions, or audit logs.

- **Cron Automation**:
  You can run this manually, or schedule it via cron on your host machine:
  ```bash
  0 3 * * * cd /path/to/unified-ai-workspace && corepack pnpm api-usage:cleanup
  ```

## 23. Scheduled Provider Health Checks

The workspace can proactively schedule session checks in the background identifying session/provider interruptions quickly automatically. 
*   This mode executes `refreshAllProviderHealth` specifically scanning unique users carrying live connected sessions. 
*   **Security Standard:** Operations are entirely prompt-less securing native encryption rules naturally and never exposing sessions or generating redundant challenges. 

### Configurations
Disabled natively providing clean environments out of the box dynamically mapping constraints manually otherwise.
```env
PROVIDER_HEALTH_SCHEDULER_ENABLED=true
PROVIDER_HEALTH_SCHEDULER_INTERVAL_SECONDS=900
PROVIDER_HEALTH_SCHEDULER_JITTER_SECONDS=60
PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS=840
PROVIDER_HEALTH_SCHEDULER_MAX_USERS_PER_RUN=50
```

### Constraints & Limitations
*   Distributed deployments rely tightly against Redis acquiring operational lock-boundaries statically preventing request floods effectively.
*   Background checks leverage Chromium sessions potentially allocating increased memory bounds conditionally.
*   Provider challenges requiring interactive validations actively push `requires_login` statuses natively updating dependent metadata reliably.

### Manual Executions
Injected explicit executions optionally generating standard JSON telemetry streams naturally isolating operational triggers reliably:
```bash
corepack pnpm provider-health:run-once -- --json
```

## 19. Code Skeleton

See the TypeScript files in `apps/*` and `packages/*`. The implementation is intentionally conservative: provider selectors are MVP-grade and smoke-tested manually, session state is never logged, and browser automation requires direct user login on official provider pages.

## Local Setup

Install dependencies:

```bash
corepack pnpm install
```

Create `.env` from `.env.example` and set a local session key:

```bash
copy .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the generated value into `SESSION_MASTER_KEY`. The key must decode to exactly 32 bytes. Base64 and 64-character hex keys are supported.

Generate Prisma client and create the SQLite database:

```bash
corepack pnpm exec prisma generate
corepack pnpm exec prisma migrate dev --name init
```

Run local services in separate terminals:

```bash
docker compose up redis
corepack pnpm dev:api
corepack pnpm dev:worker
corepack pnpm dev:web
```

Or run API, worker, and web together after Redis is running:

```bash
corepack pnpm dev
```

## Test Gemini Connection Flow

The first implemented provider login flow is Gemini.

1. Set `BROWSER_HEADLESS=false`, `BROWSER_CHANNEL=chromium`, and `LOCAL_BROWSER_MODE=true` in `.env`.
2. Run API and web locally, outside Docker, so Playwright can open a visible browser window.
3. Open `http://localhost:3000/connections`.
4. Click the Connect button on Gemini.
5. Complete login directly in the browser window that opens on `https://gemini.google.com/app`.
6. Return to the app and click Check status, or wait for polling.
7. When login is detected, the API exports Playwright storage state, encrypts it with AES-256-GCM, stores only the encrypted blob in SQLite, and closes the login context.
8. Click Disconnect to delete the encrypted session blob and reset provider status.

Current limitations:

- The app does not bypass CAPTCHA, 2FA, login challenges, anti-bot checks, or rate limits.
- Provider UI selectors are MVP-grade and can break when providers change their web UI.
- Docker headful browser usage may require additional host display setup. Prefer local non-Docker for provider login during MVP.
- Gemini chat uses MVP pseudo-streaming by polling visible response text. It is not token-native streaming.

## Send A Gemini Prompt

After Gemini is connected:

1. Open `http://localhost:3000/chat`.
2. Confirm Gemini shows `connected`.
3. Enter a short prompt such as `Say hello in one short sentence.`
4. Leave `Save history` enabled if you want the prompt and assistant response stored in SQLite.
5. Click Send.
6. The API creates a BullMQ job. The worker decrypts the saved Gemini session only in memory, opens a Playwright context, sends the prompt through the Gemini UI, publishes safe events through Redis, and the API streams those events back over SSE.

Troubleshooting:

- `Please reconnect Gemini.`: go to `/connections`, reconnect Gemini, then retry.
- Browser does not open during connect: run API locally outside Docker with `BROWSER_HEADLESS=false`.
- `Gemini UI may have changed`: provider selectors need updating.
- Response does not stream: Gemini may have changed response markup or may still be generating; retry with a short prompt.
- Session expired: disconnect/reconnect Gemini. The app does not bypass account challenges.

Security notes for chat:

- The app does not store provider passwords.
- Saved provider session state is encrypted at rest.
- Session state is decrypted only in API process memory while the job runs.
- Cookies, tokens, localStorage, sessionStorage, and encrypted session blobs are not logged.
- Browser context is closed after each chat job.
- CAPTCHA, 2FA, login challenges, anti-bot controls, and rate limits are not bypassed.
- Gemini chat requires Redis, API, worker, and web to be running.

## Provider Readiness

| Provider | Readiness | Chat | Notes |
| --- | --- | --- | --- |
| Gemini | `ready` | Yes | Connection, validation, pseudo-stream chat, and compare-shell support are implemented. |
| ChatGPT | `ready` | Yes | Connection, validation, MVP pseudo-stream chat, and compare-shell support are implemented. |
| Grok | `ready` | Yes | Connection, validation, MVP pseudo-stream chat, fallback URL navigation, and compare-shell support are implemented. |

## ChatGPT Provider

ChatGPT uses the same local-first connection and worker path as Gemini.

1. Open `http://localhost:3000/connections`.
2. Click Connect on ChatGPT.
3. Complete login directly on `https://chatgpt.com` in the browser window.
4. Return to the app and check connection status.
5. Use `/chat` in single mode with ChatGPT, or compare mode with Gemini + ChatGPT.

Safety and limitations:

- The app never asks for a ChatGPT password.
- The user logs in only on the official ChatGPT website.
- Saved ChatGPT session state is encrypted at rest and never sent to the frontend.
- Worker decrypts the session only in memory while a job runs.
- CAPTCHA, 2FA, passkey, account challenge, anti-bot controls, and rate limits are not bypassed.
- ChatGPT selectors are MVP-grade and may need updates when the provider UI changes.
- Streaming is pseudo-streaming by polling visible assistant text, not token-native streaming.
- File upload, voice, tools, and detailed model selection are not implemented yet.

Smoke tests:

```bash
corepack pnpm smoke:chatgpt:validate
corepack pnpm smoke:chatgpt:ui
corepack pnpm smoke:chatgpt:full-safe
corepack pnpm smoke:chatgpt:send
```

Troubleshooting:

- `REQUIRES_LOGIN`: reconnect ChatGPT in `/connections`.
- `MANUAL_ACTION_REQUIRED`: complete verification in the opened browser.
- `PROVIDER_UI_CHANGED`: update `packages/provider-adapters/src/chatgpt/selectors.ts`.
- `PROVIDER_RATE_LIMITED`: wait and retry later.
- `PROVIDER_TIMEOUT`: retry or increase `--timeout-ms`.

## Grok Provider

Grok uses the same local-first connection and worker path as Gemini and ChatGPT. The adapter starts at `https://grok.com` and can fall back to `https://grok.com/chat` or `https://x.com/i/grok` when the visible UI requires it.

1. Open `http://localhost:3000/connections`.
2. Click Connect on Grok.
3. Complete login directly on the official Grok/X page in the browser window.
4. Return to the app and check connection status.
5. Use `/chat` in single mode with Grok, or compare mode with Gemini + ChatGPT + Grok.

Safety and limitations:

- The app never asks for a Grok/X password.
- The user logs in only on the official Grok/X website.
- Saved Grok session state is encrypted at rest and never sent to the frontend.
- Worker decrypts the session only in memory while a job runs.
- CAPTCHA, 2FA, passkey, account challenge, anti-bot controls, and rate limits are not bypassed.
- Grok may redirect through X login flows.
- Grok selectors are MVP-grade and may need updates when the provider UI changes.
- Streaming is pseudo-streaming by polling visible assistant text, not token-native streaming.
- Image/file upload, tools, and detailed model selection are not implemented yet.

Smoke tests:

```bash
corepack pnpm smoke:grok:validate
corepack pnpm smoke:grok:ui
corepack pnpm smoke:grok:full-safe
corepack pnpm smoke:grok:send
```

Troubleshooting:

- `REQUIRES_LOGIN`: reconnect Grok in `/connections`.
- `MANUAL_ACTION_REQUIRED`: complete verification in the opened browser.
- `PROVIDER_UI_CHANGED`: update `packages/provider-adapters/src/grok/selectors.ts`.
- `PROVIDER_RATE_LIMITED`: wait and retry later.
- `PROVIDER_TIMEOUT`: retry or increase `--timeout-ms`.

## Compare Mode

The `/chat` page now has:

- Single mode: sends one prompt to one selected provider.
- Compare mode: accepts multiple providers and calls `/chat/multi`.
- Item-level errors: each selected provider reports its own connection/readiness errors while other providers can still run.

Persistence strategy:

- Single mode saves one user message and one assistant message when history is enabled.
- Compare mode creates one thread, saves one user message, and saves separate assistant messages per provider job.
- Chat execution now runs through BullMQ and the worker process. The API no longer directly runs provider browser automation for chat.

Troubleshooting worker path:

- If chat stays queued, confirm `corepack pnpm dev:worker` is running.
- If SSE connects but no events arrive, confirm Redis is reachable via `REDIS_URL`.
- If provider busy appears, wait for the current provider job to finish or for lock TTL cleanup.
- If browser does not open in the worker environment, run the worker locally outside Docker or configure a display for headful browser use.

## Job Controls

Chat jobs now support lifecycle controls:

- `GET /chat/:jobId/status` returns safe job metadata, DB status, and optional BullMQ state.
- `POST /chat/:jobId/cancel` requests cancellation for queued/running/streaming jobs.
- `POST /chat/:jobId/retry` creates a new job id for retryable jobs.

Cancel behavior:

- Queued jobs are removed from BullMQ when possible.
- Running jobs receive a Redis cancellation signal at `cancel:job:{jobId}`.
- Worker checks cancellation before browser launch, during provider execution checkpoints, and before persistence.
- Running browser cancellation is best-effort; closing the Playwright context is the final cleanup.

Retry behavior:

- Retry creates a new job id and a new SSE stream.
- Retry is allowed for `failed`, `cancelled`, `timeout`, `requires_login`, and `manual_action_required`.
- If the provider requires login, reconnect it before retrying.

Timeout behavior:

- `CHAT_JOB_TIMEOUT_MS` controls worker job timeout checks.
- Timeout publishes a safe `timeout` event and marks DB status as `timeout`.
- Worker stalled events are marked failed/timeout safely when BullMQ reports them.

Security:

- Queue payloads never include session blobs, cookies, tokens, localStorage, or decrypted session data.
- Redis cancellation keys contain only job metadata.
- Status responses do not include prompt text or session data.

## Provider Smoke Tests

The provider smoke harness validates a saved provider session and checks adapter behavior from a local CLI. It is intended for QA and platform checks after a provider connection has already been created in `/connections`.

Example commands:

```bash
corepack pnpm smoke:provider --provider gemini --mode validate-session
corepack pnpm smoke:provider --provider gemini --mode detect-ui
corepack pnpm smoke:provider --provider gemini --mode full --no-send
corepack pnpm smoke:provider --provider gemini --mode send-message --prompt "Say hello in one short sentence." --yes
```

Useful flags:

- `--user-id <id>` selects a specific local user. Without it, the first local user is used.
- `--headless true|false` controls Playwright browser visibility.
- `--timeout-ms <ms>` overrides the send-message timeout.
- `--json` prints a machine-readable safe report.
- `--show-response` prints only a short response preview, never provider session data.
- `--include-stop` adds the best-effort stop-generation check to `full` mode.
- `--report-file <path>` writes the same safe JSON report to disk and creates directories as needed.
- `--fail-on-warn true|false` makes `warn` exit with code `1` when true.
- `--no-send` only works with `full` mode and skips the real prompt send.
- `--yes` is required for `send-message`, `stop-generation`, and `full` without `--no-send`.

Exit codes:

- `0`: pass, or warn when `--fail-on-warn` is false.
- `1`: smoke failed, unexpected internal failure, or warn with `--fail-on-warn true`.
- `2`: invalid CLI arguments.

Gemini live smoke QA:

1. Start Redis, API, worker, and web locally.
2. Open `http://localhost:3000/connections`.
3. Connect Gemini and complete login directly on the official Gemini/Google page.
4. Run safe smoke checks:

```bash
corepack pnpm smoke:gemini:validate
corepack pnpm smoke:gemini:ui
corepack pnpm smoke:gemini:full-safe
corepack pnpm smoke:chatgpt:validate
corepack pnpm smoke:chatgpt:ui
corepack pnpm smoke:chatgpt:full-safe
corepack pnpm smoke:grok:validate
corepack pnpm smoke:grok:ui
corepack pnpm smoke:grok:full-safe
```

5. Optionally send a real prompt:

```bash
corepack pnpm smoke:gemini:send
```

Reports are written to:

```txt
var/smoke-reports/
```

Interpretation:

- `PASS`: saved session and checked adapter surface look healthy.
- `WARN`: partial issue; inspect the check messages before using the provider.
- `FAIL`: action required, usually reconnect, decrypt-key mismatch, provider UI change, or timeout.

For machine-readable output with fewer pnpm wrapper lines, prefer:

```bash
corepack pnpm --silent smoke:gemini:full-safe
```

Expected failure codes:

- `REQUIRES_LOGIN`: reconnect the provider in `/connections`.
- `SESSION_DECRYPT_FAILED`: the saved encrypted session cannot be decrypted with the current `SESSION_MASTER_KEY`.
- `PROVIDER_UI_CHANGED`: provider selectors likely need updating.
- `PROVIDER_TIMEOUT`: provider did not finish within the configured timeout.
- `PROVIDER_NOT_READY`: provider is registered but does not yet support chat execution.
- `USER_NOT_FOUND`: start the app and create or login the local user first.

Security rules:

- The harness never asks for provider passwords.
- The user must log in directly on the official provider website through the app connection flow.
- It does not bypass CAPTCHA, 2FA, account challenges, anti-bot controls, or rate limits.
- Reports do not include cookies, tokens, localStorage, sessionStorage, Playwright storage state, encrypted session blobs, screenshots, or HTML dumps.
- `full --no-send` does not send a prompt.
- `send-message` and unsafe `full` require `--yes` because they send a real prompt to Gemini.
- Reports are safe local metadata, but they are ignored by git and should not be committed.

## Verification

Useful checks:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm exec prisma generate
```

## CI Deployment Checks

The repository includes CI scripts that can run locally or from any CI provider.

Local full check:

```bash
corepack pnpm ci:check
```

If Docker Desktop or the Docker daemon is unavailable:

```bash
corepack pnpm ci:check -- --skip-docker
```

Readiness smoke with an ephemeral Redis container:

```bash
corepack pnpm ci:smoke:ready
```

Readiness smoke against an already-running Redis instance:

```bash
corepack pnpm ci:smoke:ready -- --use-existing-redis --redis-url redis://127.0.0.1:6379
```

What CI runs:

- Frozen pnpm install.
- Prisma client generation and schema validation.
- Typecheck and tests.
- API, worker, and web production builds.
- Docker Compose config validation.
- API readiness smoke with temporary SQLite DB and Redis.

GitHub Actions:

- `.github/workflows/ci.yml` runs typecheck, tests, builds, Docker Compose config validation, and readiness smoke.
- Docker image builds run on `main` and manual `workflow_dispatch` only to keep pull request checks lighter.
- Readiness smoke uses generated CI secrets, a temporary SQLite DB, and a Redis service container.

Security boundaries:

- CI does not run live provider login tests.
- CI does not use real provider sessions or provider accounts.
- CI does not send prompts to ChatGPT, Grok, or Gemini.
- Provider health scheduler is disabled in CI.
- Generated CI secrets are passed through environment variables and are not printed.

Troubleshooting:

- `docker compose config` and default `ci:smoke:ready` require a running Docker daemon.
- Use `--skip-docker` for local checks without Docker.
- Use `--use-existing-redis --redis-url ...` when CI already provides Redis.
- `/ready` requires both SQLite DB setup and Redis availability; `/health` only verifies API liveness.

## Release Packaging

Release packaging creates a safe source bundle with docs, config, migrations, Docker files, CI workflows, source code, and a checksum manifest. It does not publish to GitHub Releases or push Docker images.

Commands:

```bash
corepack pnpm release:check
corepack pnpm release:notes
corepack pnpm release:package
```

Optional build metadata for CI/manual releases:

```bash
APP_VERSION=0.1.0
GIT_SHA=<commit-sha>
BUILD_TIME=<iso-time>
BUILD_SOURCE=ci
```

The API exposes safe version metadata:

- `GET /version`
- `GET /health/details`

Docker image tag convention:

```txt
unified-ai-workspace-api:<version>
unified-ai-workspace-worker:<version>
unified-ai-workspace-web:<version>
```

Release package layout:

```txt
dist-release/
  unified-ai-workspace-<version>/
    README.md
    CHANGELOG.md
    RELEASE_NOTES.md
    docker-compose.yml
    .env.example
    release-manifest.json
```

The bundle intentionally excludes:

- `.env` and `.env.*` except `.env.example`.
- SQLite databases and journal files.
- `node_modules`, build output, coverage output, and `.next`.
- `.data`, browser profiles, provider sessions, storage state, and smoke reports.
- `.git`, `.gemini`, `.cursor`, and local temp artifacts.

Upgrade checklist:

1. Back up the database and `.data` volume before replacing files.
2. Review `.env.example` and generate any new required secrets locally.
3. Run Prisma migrations or `prisma migrate deploy`.
4. Restart API, Worker, and Web.
5. Check `/health`, `/ready`, and `/health/details`.

Manual GitHub workflow:

- `.github/workflows/release.yml` can be run with `workflow_dispatch`.
- It runs CI checks, release checks, release notes generation, and package creation.
- Docker image build is optional and does not push to a registry.

## Production Deployment Hardening

This project is still local-first/self-host oriented. Treat browser sessions and internal API keys as sensitive production secrets even on a private host.

### Required production configuration

1. Copy `.env.example` to `.env`.
2. Set `NODE_ENV=production`.
3. Set `DATABASE_URL` explicitly. PostgreSQL is recommended for multi-user/private beta deployments.
4. Set `REDIS_URL` explicitly.
5. Generate `SESSION_MASTER_KEY` as a 32-byte base64 or 64-character hex key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
6. Prefer DB-backed internal API keys:
   ```env
   ENABLE_DB_API_KEYS=true
   API_KEY_HASH_SECRET=<long random secret>
   ```
   If DB keys are disabled, production requires a long random `INTERNAL_API_KEY`.
7. Keep `LOCAL_SINGLE_USER_MODE=true` for local/self-host MVP unless you have audited user isolation for your deployment.

### Startup and readiness

The API exposes deployment-safe health endpoints:

- `GET /health`: process liveness only.
- `GET /ready`: dependency readiness for database and Redis; returns `503` when unavailable.
- `GET /health/details`: safe operational metadata, feature flags, and dependency checks.

The worker fails fast if database, Redis, or Playwright Chromium is unavailable. API and worker both handle `SIGTERM`/`SIGINT` and respect `SHUTDOWN_TIMEOUT_MS`.

### Docker Compose

Build and run the self-host stack:

```bash
docker compose up --build
```

With PostgreSQL:

```bash
docker compose --profile postgres up --build
```

Before switching an existing deployment to PostgreSQL, run the appropriate Prisma migration workflow and backup the current SQLite database/session data. The compose file includes Redis, API, web, and PostgreSQL healthchecks plus graceful stop windows.

### Security checklist

- Do not expose `/v1` or the API port publicly without a private network, VPN, or reverse proxy access control.
- Terminate TLS at a trusted reverse proxy if any endpoint leaves localhost.
- Do not log request bodies, cookies, tokens, Playwright storage state, encrypted session blobs, raw API keys, API key hashes, or backup passphrases.
- Back up the database and `.data` volumes together. Losing `SESSION_MASTER_KEY` makes saved provider sessions undecryptable.
- Rotate `SESSION_MASTER_KEY`, `API_KEY_HASH_SECRET`, and internal API keys if host access is suspected.
- Use `POST /providers/:provider/disconnect` or the UI disconnect action to delete provider session data.

### Deployment verification

```bash
corepack pnpm exec prisma generate
corepack pnpm typecheck
corepack pnpm test
curl -f http://localhost:4000/health
curl -f http://localhost:4000/ready
```

## 29. SBOM and release signing

This project scaffolds supply-chain security enhancements including Software Bill of Materials (SBOM) generation, release checksum verification, and opt-in Cosign signature integration.

### Generating and Verifying Releases

When preparing a local release package or validating artifacts, you can utilize the `tools/release` helper scripts:

```bash
corepack pnpm release:package
corepack pnpm release:sbom
corepack pnpm release:verify
corepack pnpm release:sign -- --dry-run
```

- **SBOM format:** The `release:sbom` script leverages `@cyclonedx/cyclonedx-npm` to produce a CycloneDX standard `sbom.cyclonedx.json` detailing the dependencies packaged in the release.
- **Checksum verification:** The `release:verify` script confirms that `checksums.sha256` strictly matches the filesystem state of the generated `dist-release` output.
- **Forbidden files are excluded:** Verification explicitly fails if `.env`, SQLite DB files, `.data` directories, or `browser-profiles` are inadvertently present in the release package.
- **Cosign signing is optional:** The signing scaffold runs smoothly without strict constraints. You can initiate a dry-run securely without having Cosign installed.
- **GitHub keyless signing uses OIDC:** When triggered via GitHub Actions (`.github/workflows/supply-chain.yml`), Cosign employs Sigstore keyless OIDC signing using the GitHub token environment.
- **No runtime secrets included:** None of the build artifacts nor the SBOM embeds workspace runtime secrets, sessions, or API keys.
- **Images can be signed after publishing:** Docker image signing is cleanly detached from file signing. You can manually run `cosign sign ghcr.io/<org>/<image>:<tag>` post-publish as defined in the deployment strategy.
