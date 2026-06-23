# Workspace Governance & Release Readiness Checklist

This document details the critical release checks for the Workspace Quota and Multi-Workspace Isolation systems (Milestones 54 & 55).

## Multi-Workspace Isolation Guarantees
- [x] All backend routes correctly use `getWorkspaceContextForRequest`
- [x] Membership checks strictly enforce `status = 'active'`
- [x] No route uses default IDs; explicit `workspaceId` is always required
- [x] Integration tests confirm user in Workspace A cannot access Workspace B data
- [x] Serialization Guard prevents token/key leaks in ALL outbound JSON payloads

## Quota Enforcement Guardrails
- [x] Quota increment checks are atomic (or properly sequenced)
- [x] `attemptedIncrement` tracking accurately logs near-limit events
- [x] Background schedulers clean up old events (Retention policies active)
- [x] Preset assignment strictly checks `quota_preset_would_exceed_usage`

## Activity & Observability
- [x] All major workspace actions trigger an `AuditLog` or `ActivityEvent`
- [x] Activity Timeline aggregates events via cursor pagination safely
- [x] Admin Overview performs parallel, isolated DB counts
- [x] Admin Export bundles full metadata state *without* user content/secrets

## Fleet & Scheduling
- [x] Fleet Status correctly aggregates both known schedules and DB run history
- [x] Missing schedules are safely flagged as 'disabled' or 'never run'
- [x] Scheduler summaries are pruned of any prompt/token data by serialization guard

## Release Status
- [ ] Final manual sweep of `workspaceId` in write operations
- [ ] E2E Multi-workspace UX manual validation
- [ ] Verify Production API base URL mappings
- [ ] Security Sign-off on `assertSafeSerializedPayload` rules
