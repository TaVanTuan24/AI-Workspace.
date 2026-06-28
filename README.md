# Unified AI Workspace

Local-first / self-hosted workspace for using your **personal ChatGPT, Claude, and Gemini accounts** from one place, through browser automation. You log in directly on each provider's official website.

The app **never** asks for provider passwords, **never** bypasses CAPTCHA / 2FA / account challenges / anti-bot controls / rate limits, and **never** logs cookies, tokens, localStorage, sessionStorage, Playwright storage state, or login screenshots. Saved session state is encrypted at rest and decrypted only in worker memory while a job runs.

> Status: `0.3.0`. Provider selectors are MVP-grade and may need updates when a provider changes its web UI.

---

## 1. Architecture

The system is split into explicit trust boundaries:

| Package | Role |
|---|---|
| `apps/web` | Next.js UI: login, connections, chat, settings, streaming/compare views. |
| `apps/api` | Fastify API: app auth, provider metadata, chat job creation, SSE streaming, settings, audit metadata. |
| `apps/worker` | BullMQ worker that owns Playwright execution, decrypts sessions only in memory, publishes provider events. |
| `packages/shared` | Provider IDs, statuses, events, prompt input, safe error codes. |
| `packages/session-vault` | AES-256-GCM encryption boundary for browser session state. |
| `packages/provider-adapters` | Adapter contract + ChatGPT, Claude, and Gemini browser UI adapters. |
| `prisma` | SQLite-first schema, designed to migrate to PostgreSQL. |

Request flow:

```txt
Web UI -> API -> BullMQ/Redis -> Worker -> Playwright -> Official provider website
                       ^            |
                       |            v
                  SSE endpoint <- Redis pub/sub (ProviderEvent)
```

Security posture:

- One session per `user_id + provider`; one active job per `user_id + provider`.
- No provider password collection; encrypted session state at rest.
- Worker decrypts sessions only in memory; no session blobs reach the frontend.
- Provider challenges always require manual user action.
- Disconnect deletes the encrypted session and browser profile references.

---

## 2. Quick start

Requires Node 20+, `corepack`, and a local Redis (via Docker).

```bash
corepack pnpm install

# Create .env and generate a 32-byte session key
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Paste the value into SESSION_MASTER_KEY (must decode to exactly 32 bytes)

corepack pnpm exec prisma generate
corepack pnpm exec prisma migrate dev --name init
```

Run services (Redis must be up first):

```bash
docker compose up redis
corepack pnpm dev        # runs web + api + worker together
# or individually: dev:api, dev:worker, dev:web
```

Default URLs: web `http://localhost:3000`, API `http://localhost:4000`.

For provider login you need a **visible** browser, so run the worker locally (outside Docker) with `BROWSER_HEADLESS=false`, `BROWSER_CHANNEL=chromium`, `LOCAL_BROWSER_MODE=true`.

---

## 3. Connecting a provider

1. Open `http://localhost:3000/connections`.
2. Click **Connect** on ChatGPT, Claude, or Gemini.
3. Complete login directly on the official provider site in the opened browser window
   (`chatgpt.com`, `claude.ai`, or the Google/Gemini page).
4. Return to the app and check the connection status.

The app never asks for the provider password and never bypasses verification. Use the disconnect action (or `POST /providers/:provider/disconnect`) to delete saved session data.

---

## 4. Chat

The `/chat` page supports two modes:

- **Single mode** — one prompt to one provider (`POST /chat`).
- **Compare mode** — one prompt to multiple providers in parallel (`POST /chat/multi`). Each provider reports its own errors; one failure does not break the others.

Chat runs through BullMQ and the worker; the API does not run browser automation directly. Responses stream to the UI over SSE (`GET /chat/:jobId/stream`).

Persistence (when history is enabled): single mode saves one user + one assistant message; compare mode creates one thread, one user message, and one assistant message per provider job.

### Job controls

- `GET /chat/:jobId/status` — safe job metadata + DB status (+ optional BullMQ state).
- `POST /chat/:jobId/cancel` — cancels queued/running/streaming jobs (best-effort for running browsers).
- `POST /chat/:jobId/retry` — new job id + SSE stream; allowed for `failed`, `cancelled`, `timeout`, `requires_login`, `manual_action_required`.

`CHAT_JOB_TIMEOUT_MS` bounds job execution; timeouts publish a safe `timeout` event. Queue payloads, cancellation keys, and status responses never contain prompts, session blobs, cookies, or tokens.

---

## 5. OpenAI-compatible endpoint

An internal, OpenAI-compatible API for self-hosted integrations (OpenWebUI, n8n, Dify, Flowise).

> **This is not the official OpenAI API.** It is a local compatibility layer over browser automation. Do not expose it publicly. Streaming is pseudo-streaming (emulated from visible assistant text).

- **Base URL:** `http://localhost:4000/v1`
- **API key:** your `INTERNAL_API_KEY` (or a DB-backed key — see §6)
- **Models:** `chatgpt-web`, `gemini-web`, `claude-web`

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

`GET /v1/models` returns the standard OpenAI shape plus readiness metadata (`isUsable`, `healthStatus`, `capabilities`, `requiresLogin`) that advanced clients can use.

**Limitations:** no tools/function calling, no vision/file upload, no exact token accounting, pseudo-streaming only, and a valid connected session is required. Breaks if the provider web UI changes.

---

## 6. API keys, scopes, and rate limits

For quick local use you can set a single `INTERNAL_API_KEY` in `.env`. For normal use, enable DB-backed keys:

```env
ENABLE_DB_API_KEYS=true
API_KEY_HASH_SECRET=your_secure_hash_secret
```

Then run `prisma migrate dev` and manage keys at `/settings/api-keys`. Raw keys are shown once on creation; only HMAC-SHA256 hashes are stored. Keys can be created, rotated, and revoked.

- **Per-key model scopes** — restrict a key to specific models. Empty scope = all globally enabled models. A globally disabled model overrides any key scope. Disallowed models are hidden from `GET /v1/models` and rejected with `model_not_allowed_for_key`.
- **Per-key rate limits** — set a custom requests/minute or inherit the workspace default at `/settings/api-keys`.
- **Provider rate limits** — cap browser automation per user/provider before a job is enqueued, configurable at `/settings/provider-rate-limits`. Exceeding any limit returns HTTP 429 with an OpenAI-compatible `rate_limit_exceeded` error.

Key env defaults:

```env
INTERNAL_API_RATE_LIMIT_PER_MINUTE=30
INTERNAL_API_RATE_LIMIT_MAX_PER_MINUTE=300
PROVIDER_RATE_LIMIT_DEFAULT_PER_MINUTE=30
PROVIDER_RATE_LIMIT_CHATGPT_PER_MINUTE=20
PROVIDER_RATE_LIMIT_GEMINI_PER_MINUTE=30
PROVIDER_RATE_LIMIT_CLAUDE_PER_MINUTE=10
```

---

## 7. Settings hub

Central configuration at `/settings`, with overview cards (provider readiness, model availability, API key counts, usage metadata, scheduler state) and links to:

| Page | Purpose |
|---|---|
| `/settings/connections` | Add, validate, or remove provider sessions. |
| `/settings/models` | Enable/disable models, set the default and priorities, pick sub-model variants, manual health refresh. |
| `/settings/api-keys` | Issue, scope, rate-limit, rotate, and revoke internal API keys. |
| `/settings/api-usage` | Operational usage metrics (safe metadata only). |
| `/settings/provider-health` | View and force-refresh session/provider readiness. |
| `/settings/provider-rate-limits` | Per-provider request throttles. |
| `/settings/notifications` | Alert preferences, history, and delivery channels. |
| `/settings/conversations` | Export/import chat history (plain or encrypted). |
| `/settings/quota` | Workspace quota configuration and events. |
| `/settings/activity` | Workspace activity log. |
| `/settings/schedulers` | Background scheduler status. |
| `/settings/users` | Local users and roles (owner only for role changes). |
| `/settings/security` | Security controls. |

The hub loads only safe operational metadata. Opening it does not start browser automation, refresh health, send prompts, or expose secrets/sessions.

A first-run wizard at `/onboarding` walks through connecting providers, choosing a default model, creating an API key, and testing `GET /v1/models`. It never sends prompts, never creates keys automatically, and never asks for provider passwords.

---

## 8. Models and sub-model selection

At `/settings/models` you control which browser-backed models are active, set exactly one default for `/chat` routing, assign priorities for compare mode, and toggle auto-select of the first usable provider.

Each base model (`chatgpt-web`, `gemini-web`, `claude-web`) can target a sub-model variant: **Current/Default**, **Fast/Lightweight**, or **Reasoning**. The selection applies across web chat, compare mode, and the OpenAI-compatible endpoint. Availability depends on the active account/paywall; unavailable variants fall back to `current`. Base IDs are never changed.

Disabled models are rejected with a safe `model_disabled` error without launching a browser.

---

## 9. Provider health and diagnostics

- **Health/readiness** — `GET /v1/models` and `/settings/provider-health` report whether each model is usable. Health validation checks the encrypted session only; it never sends prompts. Results are cached (`PROVIDER_HEALTH_TTL_SECONDS`, default 300).
- **Scheduled health checks** — optional background validation (`PROVIDER_HEALTH_SCHEDULER_ENABLED`, off by default), using a Redis lock so replicas don't overlap. Run once manually: `corepack pnpm provider-health:run-once -- --json`.
- **Incidents and UI diagnostics** — provider health incidents are tracked per user, and safe DOM diagnostics (no screenshots, no raw HTML, no prompts) detect selector drift when a provider UI changes. Diagnostics actions are available from `/settings/provider-health`.

---

## 10. Notifications

Session and readiness problems surface before a chat/API request fails — via a global banner, settings badges, and the relevant pages. Detected states: `requires_login`, `expired`, `manual_action_required`, provider UI changes, provider errors, and no usable models. The reconnect path is always `/connections` on the official provider site.

- **History** — persistent, deduplicated alerts in the `notification_events` table (safe metadata only), with read/unread tracking and an unread-count nav badge.
- **Preferences** — per-user, at `/settings/notifications`: provider session alerts, no-usable-model alerts, and provider rate-limit spike alerts (with a configurable 24h threshold).
- **Delivery channels** — in-app (default). Webhook delivery posts signed payloads (`X-UAIW-Signature: sha256=…` over `timestamp.body`), with SSRF protection, strict timeouts, and retry/dead-letter handling. Email/Slack are scaffolded.

Critical no-usable-model warnings are not dismissible. Dismissal is local UI state only and never changes provider status.

---

## 11. Conversation export / import

At `/settings/conversations`:

- **Plain export** — `.json` archive of threads, messages, timestamps, and safe metadata (`finishReason`, `provider`, `model`, `durationMs`).
- **Encrypted export** — passphrase-derived key (scrypt) + AES-256-GCM, random salt/IV per file. The passphrase is never stored, never logged, and cannot be recovered.
- **Import** — Zod-validated preview (max 10 MB, max 50,000 messages). Conflict strategy is `create_new`: imports get fresh UUIDs and an `[Imported]` prefix; nothing is merged.

**Never included** in any export: provider sessions, cookies/tokens, API keys, or encrypted session blobs.

---

## 12. Workspaces, roles, and invites

The app runs single-workspace by default; the default Local Workspace handles users without an explicit assignment. Multi-workspace support is available:

- **Roles** (`User.role`): `owner` and `admin` (full admin), `member` (read-oriented), `viewer` (read-only). Existing/local users default to `owner`. Backend permission guards are the source of truth; the UI only mirrors them. Denials return `{ "error": "permission_denied" }`.
- **User management** (`/settings/users`) — owners can list users, review role-audit events, and change roles. The last owner cannot be demoted. User lists and audit events expose only safe fields (id, email, role, timestamps).
- **Workspace switching/creation** — new workspaces start empty; no data is copied (no sessions, keys, webhooks, or policies). Switching reloads the UI to prevent cross-workspace leakage.
- **Invites** — owner-only. Tokens are SHA-256 hashed at rest and shown once; they expire after 7 days with scheduled cleanup. Email delivery (`WORKSPACE_INVITE_EMAIL_PROVIDER`: `noop` / `console_dry_run` / `smtp`) is dry-run by default; real SMTP send requires explicit opt-in and is hard-blocked in tests.

---

## 13. Smoke tests and selector diagnostics

The provider smoke harness validates a saved session and adapter behavior from the CLI (after connecting in `/connections`):

```bash
corepack pnpm smoke:provider --provider gemini --mode validate-session
corepack pnpm smoke:provider --provider gemini --mode detect-ui
corepack pnpm smoke:provider --provider gemini --mode full --no-send
corepack pnpm smoke:provider --provider gemini --mode send-message --prompt "Say hello." --yes
```

Convenience scripts exist per provider, e.g. `smoke:chatgpt:validate`, `smoke:claude:full-safe`, `smoke:gemini:send`. Useful flags: `--user-id`, `--headless`, `--timeout-ms`, `--json`, `--report-file`, `--show-response`, `--fail-on-warn`. Reports are written to `var/smoke-reports/` and contain only safe metadata.

When a provider UI changes, run the safe DOM diagnostic engine to find candidate selectors (no screenshots, no raw HTML, no prompts; emails/JWTs/UUIDs redacted):

```bash
corepack pnpm smoke:chatgpt:diagnose
corepack pnpm smoke:gemini:diagnose
corepack pnpm smoke:claude:diagnose
```

Review `missingKinds` and `topCandidates`, then update `packages/provider-adapters/src/<provider>/selectors.ts`.

Common failure codes: `REQUIRES_LOGIN` (reconnect), `SESSION_DECRYPT_FAILED` (wrong `SESSION_MASTER_KEY`), `PROVIDER_UI_CHANGED` (update selectors), `PROVIDER_RATE_LIMITED` / `PROVIDER_TIMEOUT` (retry later), `MANUAL_ACTION_REQUIRED` (finish verification in the browser).

---

## 14. Session vault

`packages/session-vault` encrypts browser session state with AES-256-GCM. The encrypted blob stores `version`, `algorithm`, `keyId`, `iv`, `authTag`, `ciphertext`, and `createdAt`.

The local MVP uses `SESSION_MASTER_KEY` from `.env`. The class accepts a key provider so a future phase can move to KMS/Vault without changing API/worker code. Losing `SESSION_MASTER_KEY` makes all saved sessions undecryptable — back up the database and `.data` volumes together.

---

## 15. Docker

`docker-compose.yml` starts `web`, `api`, `worker`, `redis`, and an optional `postgres` profile. SQLite is the default via a local volume.

Browser login needs a visible browser, so the **worker is best run locally** (outside Docker) for connect flows; the rest can run in Compose.

Published images can be built via the `Publish Docker Images` GitHub Actions workflow (dry-run by default). No `.env`, sessions, profiles, or DB files are baked into images; runtime secrets are supplied at deploy time. Run published images with:

```bash
UAIW_API_IMAGE=ghcr.io/<ns>/api:<tag> \
UAIW_WORKER_IMAGE=ghcr.io/<ns>/worker:<tag> \
UAIW_WEB_IMAGE=ghcr.io/<ns>/web:<tag> \
docker compose up -d
```

---

## 16. Security scanning and releases

```bash
corepack pnpm security:audit       # vulnerabilities
corepack pnpm security:licenses    # license policy (tools/security/policy.json)
corepack pnpm security:scan        # combined; add --strict to fail on >= high / review licenses
```

Reports land in `dist-security/` (no secrets/session data). CI fails on critical vulnerabilities, denied licenses, or scan errors; strict mode also fails on high severity and review/unknown licenses.

Release packaging is source-based with supply-chain artifacts (`release-manifest.json`, `checksums.sha256`, `sbom.cyclonedx.json`, changelog/notes):

```bash
corepack pnpm release:package
corepack pnpm release:sbom
corepack pnpm release:verify
corepack pnpm release:sign -- --dry-run
```

Verification fails if `.env`, DB files, `.data`, or `browser-profiles` are present in the package. Cosign signing and image publishing are manual and opt-in; GitHub Actions uses Sigstore keyless OIDC. See `docs/UPGRADE-0.3.0.md` and `docs/RELEASE_OPERATOR_HANDOFF_0.3.0.md`.

---

## 17. Testing conventions

Vitest runs test files in parallel against a shared SQLite DB, so isolation rules apply:

- Use a **unique `userId` per test file**; never hardcode shared static IDs.
- No global `deleteMany({})` / `updateMany({})`; no raw SQL (`$executeRaw`, `$queryRaw`, `TRUNCATE`, `DROP`).
- Use `withTestUserScope` / `cleanupTestUserData` from `apps/api/src/test/testIsolation.ts`.
- Capture intentional failure logs with `apps/api/src/test/logCapture.ts`.

`corepack pnpm test:isolation` enforces these in CI. To bypass for a real reason, add `// test-isolation-allow-global-cleanup: <reason>` or `// test-isolation-allow-raw-sql: <reason>` (≥10 chars).

Deployment verification:

```bash
corepack pnpm exec prisma generate
corepack pnpm typecheck
corepack pnpm test
curl -f http://localhost:4000/health
curl -f http://localhost:4000/ready
```

---

## 18. Known limitations

- Provider selectors are MVP-grade and break when a provider changes its web UI.
- Streaming is pseudo-streaming (polling visible text), not token-native.
- No file upload, vision, voice, tools, or function calling.
- No exact token-usage accounting.
- A valid, connected browser session is required for any chat.
- CAPTCHA, 2FA, passkeys, account challenges, anti-bot controls, and rate limits are never bypassed — they require manual user action.
