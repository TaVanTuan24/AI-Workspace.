# Release Tag Checklist: Unified AI Workspace 0.2.0

No automated tag, push, publish, or signing action is part of this checklist. Each release action below requires intentional operator action.

## Pre-Tag

- [ ] Working tree is clean.
- [ ] Workspace version is `0.2.0`.
- [ ] `CHANGELOG.md`, `RELEASE_NOTES.md`, and `docs/UPGRADE-0.2.0.md` are present.
- [ ] Full CI is green.
- [ ] `corepack pnpm security:scan` passes.
- [ ] `corepack pnpm release:verify --dir dist-release/unified-ai-workspace-0.2.0 --require-sbom` passes.
- [ ] `corepack pnpm release:operator:status --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0` was reviewed.
- [ ] `docs/RELEASE_OPERATOR_HANDOFF_0.2.0.md` was reviewed by the release operator.
- [ ] `.env.staging` was generated locally with `corepack pnpm release:staging:env --out .env.staging` and was not committed.
- [ ] Generated `.env.staging` secrets were not pasted into logs, tickets, or release notes.
- [ ] `corepack pnpm release:staging:local --preflight-only --env-file .env.staging` passes.
- [ ] `corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0 --base-url http://localhost:4000 --down` passes against local staging.
- [ ] `dist-release/unified-ai-workspace-0.2.0/staging-verification.json` exists and contains no secrets.
- [ ] `corepack pnpm release:tag:dry-run --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0` passes.
- [ ] License notices in `docs/THIRD_PARTY_LICENSE_NOTICES.md` have been reviewed or explicitly accepted as non-blocking for this release.
- [ ] Cosign is installed if signing will be performed.

## Optional Signing

```bash
corepack pnpm release:sign --dir dist-release/unified-ai-workspace-0.2.0 --yes
```

- [ ] Operator intentionally chose to sign.
- [ ] Generated signature/bundle files are verified if signing support is implemented.
- [ ] Signing output is attached to the release only after verification.

Do not sign without intentional operator action.

## Docker Preflight Troubleshooting

```bash
docker info
corepack pnpm release:staging:local --preflight-only --env-file .env.staging
corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0 --base-url http://localhost:4000 --down
corepack pnpm release:tag:dry-run --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0
```

- [ ] Docker Desktop is running.
- [ ] Windows operators are using Linux containers/engine.
- [ ] `docker info` succeeds before staging smoke resumes.
- [ ] No `.env.staging` values, provider sessions, provider login attempts, provider prompts, signing material, tags, pushes, or publish actions were used during troubleshooting.

## Optional Image Publish

- [ ] Run GitHub `publish-images.yml` manually only when image publication is intended.
- [ ] Set `push=true` only when ready to publish images.
- [ ] Set `tag_latest=true` only when explicitly desired.
- [ ] Verify pushed image tags and digests after publication.

## Tag

Suggested annotated tag:

```bash
git tag -a v0.2.0 -m "Unified AI Workspace 0.2.0"
```

Release notes should include:

- `RELEASE_NOTES.md`
- Package archive
- `checksums.sha256`
- `sbom.cyclonedx.json`
- Signature/bundle files if signed

The tag can be created locally or through the GitHub release workflow after staging verification is complete.

## Post-Tag

- [ ] Release page artifacts are present.
- [ ] Checksums verify against attached artifacts.
- [ ] SBOM is attached and readable.
- [ ] Signature/bundle verification passes if artifacts were signed.
- [ ] Docker image tags are correct if images were published.
- [ ] Staging and production `/health`, `/ready`, `/health/details`, and `/version` remain healthy.
- [ ] Monitor notification delivery, provider health scheduler, recovery override expiry scheduler, and internal API usage dashboards.
