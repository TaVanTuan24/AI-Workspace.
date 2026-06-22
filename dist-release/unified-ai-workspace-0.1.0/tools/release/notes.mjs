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

- 

## Added

- 

## Changed

- 

## Fixed

- 

## Security

- 

## Migrations

${migrations}

## Docker Images

- API: \`${info.dockerImages.api}\`
- Worker: \`${info.dockerImages.worker}\`
- Web: \`${info.dockerImages.web}\`

## Upgrade Notes

1. Back up your database and provider session data.
2. Review \`.env.example\` and add any new environment variables.
3. Run Prisma migrations before starting the new API/Worker/Web processes.
4. Restart API, Worker, and Web.
5. Confirm \`/health\` and \`/ready\` after startup.

## Verification

- [ ] \`corepack pnpm ci:check\`
- [ ] \`docker compose config\`
- [ ] \`/health\`
- [ ] \`/ready\`

## Rollback Notes

- 
`;
}
