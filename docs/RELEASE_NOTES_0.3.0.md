# Release 0.3.0 (Workspace Governance & Admin Observability)

This major release solidifies the multi-tenant architecture with a comprehensive suite of Workspace Quotas, Admin Observability tools, and Security Hardening mechanisms. It completes the transition to a fully governed workspace environment suitable for team and enterprise deployments.

## Highlights

### 1. Workspace Quotas & Enforcement
- **Comprehensive Limits:** Added deep quota enforcement for Invites, Memberships, API Keys, Provider Connections, Webhook Destinations, and Recovery Policies.
- **Provider API Quotas:** Strict usage limits applied to Internal Chat, Multi-Chat, and the OpenAI-compatible `/v1/chat/completions` endpoint.
- **Email Delivery Quotas:** Monthly constraints placed on outbound SMTP operations to prevent abuse.
- **Quota UX & Presets:** Visual progress bars, exceeded event states, and configurable Quota Presets available directly from the Workspace Settings.

### 2. Admin Observability & Fleet Management
- **Unified Activity Timeline:** A centralized, paginated timeline (`/settings/activity`) aggregating membership changes, invite lifecycles, quota alerts, and scheduler executions into a single, safe metadata stream.
- **Admin Overview v2:** High-level dashboard (`/settings/workspace-overview`) providing instant visibility into member counts, provider health, notification volumes, and delivery diagnostics.
- **Scheduler Fleet Status:** Real-time visibility into all background automation jobs (Quota Alerts, Invite Expiry, Provider Health) with execution history and failure tracking (`/settings/schedulers`).

### 3. Migration Safety & Backfill
- **Safe Backfill Scripts:** Introduced the `pnpm workspace:governance:backfill` script to retroactively assign default memberships, initialize missing quota rows, and map orphaned records, ensuring seamless upgrades from 0.2.0.
- **Audit Consistency:** All major write operations now strictly require explicit `workspaceId` enforcement tied to an `active` membership role.

### 4. Security Hardening
- **Cross-Workspace Isolation:** Implementation of a strict test suite (`workspaceIsolation.test.ts`) guaranteeing that queries and data access strictly adhere to cross-tenant boundaries.
- **Serialization Safety Guard:** Global recursive payload scanner (`assertSafeSerializedPayload`) preventing accidental leakage of `tokenHash`, `apiKey`, session `storageState`, or `prompt` contents in any Admin Export or Activity API.
- **Safe Admin Export:** A consolidated JSON export bundle for admins that gathers holistic workspace metadata without exposing user secrets or conversations.
- **SMTP & Test Hygiene:** Explicit constraints ensure live provider login tests and real SMTP sends are disabled by default and guarded against accidental execution in CI environments.

## Operator Notes

Please review `UPGRADE-0.3.0.md` for specific migration steps, including running the backfill script safely. Ensure `pnpm release:check` and staging verification tests are passing before enabling automated CI publishing.
