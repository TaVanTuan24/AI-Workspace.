import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootPackage = require("../../../package.json") as { name?: string; version?: string };

export interface AppVersionInfo {
  name: string;
  version: string;
  commitSha?: string;
  buildTime?: string;
  buildSource: "local" | "ci" | "unknown";
}

export function getAppVersionInfo(): AppVersionInfo {
  return {
    name: rootPackage.name ?? "unified-ai-workspace",
    version: process.env.APP_VERSION || rootPackage.version || "0.0.0-dev",
    commitSha: optionalValue(process.env.GIT_SHA),
    buildTime: optionalValue(process.env.BUILD_TIME),
    buildSource: parseBuildSource(process.env.BUILD_SOURCE)
  };
}

function parseBuildSource(value: string | undefined): AppVersionInfo["buildSource"] {
  if (value === "local" || value === "ci" || value === "unknown") return value;
  if (process.env.CI) return "ci";
  return "local";
}

function optionalValue(value: string | undefined): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}
