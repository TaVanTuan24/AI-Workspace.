import { parseArgs } from "node:util";

export function generateImageTags(options) {
  const { registry, namespace, version, sha, latest } = options;

  if (!version || !/^v?\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new Error(`Invalid version format: ${version}`);
  }

  if (!namespace || namespace.trim() === "") {
    throw new Error("Namespace is required");
  }

  const cleanRegistry = registry ? registry.replace(/\/$/, "") : "ghcr.io";
  const cleanNamespace = namespace.replace(/^\//, "").replace(/\/$/, "");

  const components = ["api", "worker", "web"];
  const tagsMap = {};

  for (const component of components) {
    const baseImage = `${cleanRegistry}/${cleanNamespace}/${component}`;
    const tags = [
      `${baseImage}:${version}`
    ];
    
    if (sha) {
      tags.push(`${baseImage}:${sha}`);
    }

    if (latest) {
      tags.push(`${baseImage}:latest`);
    }

    tagsMap[component] = tags;
  }

  return tagsMap;
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  try {
    const { values } = parseArgs({
      options: {
        registry: { type: "string", default: "ghcr.io" },
        namespace: { type: "string" },
        version: { type: "string" },
        sha: { type: "string" },
        latest: { type: "boolean", default: false }
      }
    });

    if (!values.namespace || !values.version) {
      console.error("Usage: node image-tags.mjs --namespace <owner/repo> --version <version> [--registry ghcr.io] [--sha <sha>] [--latest]");
      process.exit(1);
    }

    const result = generateImageTags(values);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
