# Operator Handoff & Sign-off for Release 0.3.0

This document tracks the final checks required before tagging and publishing the 0.3.0 release. **Do not tag or push the release until all items are explicitly checked by an operator.**

## Prerequisites

- [ ] Ensure all 387 API unit and integration tests pass cleanly (`pnpm test`).
- [ ] Verify the cross-workspace isolation tests succeed.
- [ ] Ensure the Governance Backfill script dry-run succeeds on a local dataset (`pnpm workspace:governance:backfill --dry-run`).
- [ ] Prisma migrations have been successfully tested for rollback and deployment.

## Release Hygiene

- [ ] Run `pnpm release:check` to verify no secret files (`.env`, `storageState`, `.db`) are bundled.
- [ ] Verify SBOM generation produces a valid `bom.json`.
- [ ] Verify `checksums.sha256` correctly maps release artifacts.
- [ ] Ensure the `package.json` versions are strictly set to `0.3.0` across the monorepo.
- [ ] The newly added `assertSafeSerializedPayload` confirms no `tokenHash` or `apiKey` data leaks through the staging smoke tests.

## Security Validations

- [ ] Confirm no live provider login tests run by default in CI.
- [ ] Confirm no real SMTP emails are sent during the test suite.
- [ ] Confirm workspace context (ID checking) acts as the primary access boundary across all new admin routes.

## Deployment Handoff

Once the operator has verified the above:
1. Commit the version bumps and updated changelog.
2. Manually tag the commit with `v0.3.0`.
3. Push the tag to trigger the GitHub Actions release workflow.
4. Verify the published Docker Images do not contain `.env.staging` or `var/` content.
