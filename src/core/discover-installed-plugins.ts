import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface InstalledPlugin {
  name: string;
  version?: string;
  rootPath: string;
  manifestPath: string;
  relativePath: string;
}

export interface InstalledPluginDiscoveryOptions {
  env?: Record<string, string | undefined>;
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isDirectory();
  } catch {
    return false;
  }
}

function getCodexHomeCandidates(
  env: Record<string, string | undefined>
): string[] {
  const candidates = env.CODEX_HOME
    ? [env.CODEX_HOME]
    : [path.join(os.homedir(), ".codex")];

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

async function findManifestPaths(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const manifestPaths: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === ".codex-plugin") {
        manifestPaths.push(path.join(entryPath, "plugin.json"));
        continue;
      }

      manifestPaths.push(...(await findManifestPaths(entryPath)));
    }
  }

  return manifestPaths;
}

export async function discoverInstalledPlugins(
  options: InstalledPluginDiscoveryOptions = {}
): Promise<InstalledPlugin[]> {
  const env = options.env ?? process.env;
  const plugins: InstalledPlugin[] = [];

  for (const codexHome of getCodexHomeCandidates(env)) {
    const cacheRoot = path.join(codexHome, "plugins", "cache");

    if (!(await directoryExists(cacheRoot))) {
      continue;
    }

    for (const manifestPath of await findManifestPaths(cacheRoot)) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          name?: unknown;
          version?: unknown;
        };
        const rootPath = path.dirname(path.dirname(manifestPath));
        const relativePath = path.relative(cacheRoot, rootPath);

        plugins.push({
          name: typeof manifest.name === "string" ? manifest.name : path.basename(rootPath),
          version: typeof manifest.version === "string" ? manifest.version : undefined,
          rootPath,
          manifestPath,
          relativePath
        });
      } catch {
        continue;
      }
    }
  }

  return plugins.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

export function filterInstalledPlugins(
  plugins: InstalledPlugin[],
  query: string | null
): InstalledPlugin[] {
  if (!query) {
    return plugins;
  }

  const normalizedQuery = query.toLowerCase();

  return plugins.filter((plugin) =>
    [plugin.name, plugin.relativePath, plugin.rootPath]
      .some((value) => value.toLowerCase().includes(normalizedQuery))
  );
}
