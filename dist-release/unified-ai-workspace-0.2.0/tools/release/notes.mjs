#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { getReleaseInfo, root } from "./lib.mjs";

const stdout = process.argv.includes("--stdout");
const releaseInfo = await getReleaseInfo();
const content = buildNotes(releaseInfo);

if (stdout) {
  console.log(content);
} else {
  const outputPath = path.join(root, "RELEASE_NOTES.md");
  await fs.writeFile(outputPath, content, "utf8");
  console.log(`Wrote RELEASE_NOTES.md for ${releaseInfo.name} v${releaseInfo.version}`);
}

function buildNotes(info) {
  const migrations = info.migrations.length
    ? info.migrations.map((migration) => `- ${migration}`).join("\n")
    : "- None detected.";

  return `# Unified AI Workspace v${info.version}

## Highlights

- Provider reliability now includes incidents, runbooks, diagnostics history, baselines, drift alerts, recovery policies, temporary overrides, expiry scheduling, and scheduler observability.
- Notification delivery now includes DLQ handling, webhook retry/failover, multiple destinations, routing, payload templates, and signed payloads.
- Release readiness now includes SBOM, checksums, forbidden-file verification, optional signing, vulnerability/license scanning, and quieter tests.

## Security & Supply Chain

- SBOM generation, release manifest verification, and checksums are available through release tooling.
- Optional Cosign/Sigstore signing remains opt-in and can be validated with a dry run.
- Security scan blocks critical vulnerabilities and denied licenses by default.

## Notification Delivery Reliability

- Notification DLQ dashboard and cleanup flows.
- Webhook retry/failover, multiple destinations, routing by kind/severity/priority, and destination-level signing.
- Payload templates for UAIW default, minimal, Slack-compatible, and custom allowlist formats.

## Provider Reliability

- Provider health incident timeline, recovery runbooks, safe health checks, and safe UI diagnostics.
- Diagnostics history, baselines, drift alerts, provider recovery policies, recovery overrides, and scheduler status.

## Settings & UI

- Provider recovery settings, scheduler status card, recovery override badges, diagnostics history/drift UI, and improved notification/provider health views.
- Onboarding, settings hub polish, session expiration notifications, provider limit analytics, and provider limit spike alerts.

## Test & CI

- Test isolation helper, DB cleanup guardrails, raw SQL guardrails, Redis warning cleanup, and scoped expected-log capture.
- CI/release checks cover typecheck, tests, isolation, security scan, Docker compose config, release packaging, SBOM, and verification.

## Breaking / Behavior Changes

- \`/v1/models\` may include safe \`metadata.recovery\` fields.
- \`/v1/chat/completions\` may return \`model_temporarily_disabled\`.
- New Prisma migrations are required before starting ${info.version} services.
- New notification, webhook, diagnostics, scheduler, recovery, and supply-chain environment settings are available.

## Migrations

${migrations}

## Docker Images

- API: \`${info.dockerImages.api}\`
- Worker: \`${info.dockerImages.worker}\`
- Web: \`${info.dockerImages.web}\`

## Upgrade Notes

See \`docs/UPGRADE-${info.version}.md\` if present. Minimum upgrade steps:

1. Back up your database and provider session data.
2. Review \`.env.example\` and add any new environment variables.
3. Run \`corepack pnpm prisma migrate deploy\`.
4. Restart API, worker, and web.
5. Confirm \`/ready\`, \`/health/details\`, and \`/version\`.

## Verification

- [ ] \`corepack pnpm typecheck\`
- [ ] \`corepack pnpm test:isolation\`
- [ ] \`corepack pnpm test\`
- [ ] \`corepack pnpm security:scan\`
- [ ] \`corepack pnpm release:verify --require-sbom\`
- [ ] \`/ready\`
- [ ] \`/health/details\`
- [ ] \`/version\`

## Rollback Notes

- DB migrations may not be automatically reversible. Restore from a pre-upgrade database backup if schema rollback is required.
- Temporary recovery overrides can be rolled back in the UI. Recovery policies and webhook destinations can be disabled.
`;
}
