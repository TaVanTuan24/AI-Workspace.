# Release Operator Handoff: Unified AI Workspace 0.2.0

This handoff is for the final manual release operator. It is intentionally safe to copy into an operations ticket because it contains commands and checklist items only, not secrets.

Do not tag, push, sign, publish, run live provider logins, submit provider prompts, or paste `.env.staging` values while following this document unless an explicit manual release decision calls for that action.

## Current Release State

- Version: `0.2.0`.
- Release package path: `dist-release/unified-ai-workspace-0.2.0/`.
- SBOM, checksums, manifest verification, and forbidden-file scan have passed in local release readiness checks.
- Security scan passes with documented non-blocking license review items in `docs/THIRD_PARTY_LICENSE_NOTICES.md`.
- Real local Docker staging has not completed until `dist-release/unified-ai-workspace-0.2.0/staging-verification.json` exists.
- Docker daemon was last blocked locally when Docker Desktop/Linux Engine was unavailable.
- Cosign is optional for this release unless the operator chooses to sign artifacts.
- No release tag has been pushed by the release helper scripts.
- Final tagging must happen in a real Git checkout, not in a copied workspace without `.git`.

## Operator Status

Run this first to see the current blocker and next action:

```bash
corepack pnpm release:operator:status --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0
```

Use strict mode only when you expect all release gates to be complete:

```bash
corepack pnpm release:operator:status --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0 --strict --require-cosign
```

The status command does not print secrets and does not perform tag, push, sign, publish, provider login, or provider prompt actions.

## Local Staging Smoke Commands

If `.env.staging` is missing, generate it locally:

```bash
corepack pnpm release:staging:env --out .env.staging
```

Never commit `.env.staging`, never paste its values, and confirm it uses local/staging DB and Redis only.

After Docker Desktop is running and Windows operators are on Linux containers/engine, run:

```bash
docker info

corepack pnpm release:staging:local \
  --preflight-only \
  --env-file .env.staging

corepack pnpm release:staging:local \
  --env-file .env.staging \
  --expected-version 0.2.0 \
  --base-url http://localhost:4000 \
  --down

corepack pnpm release:tag:dry-run \
  --version 0.2.0 \
  --release-dir dist-release/unified-ai-workspace-0.2.0
```

Do not use production provider sessions. Do not run live provider login tests. Do not submit prompts to ChatGPT, Grok, Gemini, or any provider as part of this release smoke.

## Staging Marker Expected

Successful local staging smoke writes:

```text
dist-release/unified-ai-workspace-0.2.0/staging-verification.json
```

Expected safe fields:

- `version`
- `verifiedAt`
- `baseUrl` with credentials redacted
- `checksPassed`
- `chatSmoke: false` by default
- `liveProviderLoginTests: false`
- `envGenerated`

Do not paste the marker if it unexpectedly includes local paths, env values, tokens, provider sessions, storageState, cookies, API keys, or webhook secrets.

## Cosign Setup

Signing is optional and must be an explicit operator decision.

Check local availability:

```bash
cosign version
corepack pnpm release:sign \
  --dir dist-release/unified-ai-workspace-0.2.0 \
  --dry-run
```

For real signing only after intentional approval:

```bash
corepack pnpm release:sign \
  --dir dist-release/unified-ai-workspace-0.2.0 \
  --yes
```

Use keyless signing only if the repository workflow or operator identity is intended for this release. Do not use private key files in this release unless a later signing design explicitly adds that path. Do not paste signing secrets or private key material.

## Final Tag Dry-Run

If signing is required:

```bash
corepack pnpm release:tag:dry-run \
  --version 0.2.0 \
  --release-dir dist-release/unified-ai-workspace-0.2.0 \
  --require-cosign
```

If signing remains optional:

```bash
corepack pnpm release:tag:dry-run \
  --version 0.2.0 \
  --release-dir dist-release/unified-ai-workspace-0.2.0
```

Dry-run commands do not create tags, push tags, sign artifacts, or publish images.

## Manual Tag And Release

Run these manually only in the real Git checkout after staging marker, dry-run, and release policy are satisfied:

```bash
git status
git tag -a v0.2.0 -m "Unified AI Workspace v0.2.0"
git push origin v0.2.0
```

For the GitHub release:

- Attach the release package archive.
- Attach `checksums.sha256`.
- Attach `sbom.cyclonedx.json`.
- Attach signature/bundle files only if signing was intentionally performed.
- Use `RELEASE_NOTES.md` as release notes.

No local helper script should run these commands automatically.

## Post-Release Validation

- Verify GitHub release artifacts are downloadable.
- Verify checksum download and checksum contents.
- Verify Docker images only if image publishing was manually selected.
- Monitor `/health`, `/ready`, and `/version`.
- Confirm settings pages load:
  - provider health
  - provider recovery
  - notifications
  - models
- Do not run live provider smoke unless a human operator explicitly intends that separate manual validation.

## Safety Checklist

- [ ] `.env.staging` was not committed.
- [ ] Local preflight status files under `tmp/release/` were not committed.
- [ ] No production DB/Redis was used for local staging.
- [ ] No production provider sessions were used.
- [ ] No live provider login or prompt submission was performed.
- [ ] No CAPTCHA, challenge, paywall, anti-bot, or rate-limit bypass was attempted.
- [ ] No raw Docker logs containing env values were pasted.
- [ ] No signing secrets or private key material were pasted.
- [ ] Tag, push, signing, and publishing were performed only after explicit manual approval.
