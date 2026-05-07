import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  EcosystemAuditPluginResult
} from "./ecosystem-audit.js";
import type { InstalledPlugin } from "../core/discover-installed-plugins.js";

export interface EcosystemAuditCacheEntry {
  fingerprint: string;
  cachedAt: string;
  result: EcosystemAuditPluginResult;
}

export interface EcosystemAuditCacheFile {
  schemaVersion: "1.0.0";
  entries: Record<string, EcosystemAuditCacheEntry>;
}

const skippedDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "validation-artifacts-local",
  "validation-sessions"
]);

export function resolveEcosystemAuditCachePath(
  env: Record<string, string | undefined> = process.env,
  cachePath?: string | null
): string {
  if (cachePath) {
    return path.resolve(cachePath);
  }

  const codexHome = env.CODEX_HOME
    ? path.resolve(env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");

  return path.join(codexHome, "plugin-doctor", "audit-cache.json");
}

export async function loadEcosystemAuditCache(
  cachePath: string
): Promise<EcosystemAuditCacheFile> {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as Partial<EcosystemAuditCacheFile>;

    if (parsed.schemaVersion === "1.0.0" && parsed.entries && typeof parsed.entries === "object") {
      return {
        schemaVersion: "1.0.0",
        entries: parsed.entries
      };
    }
  } catch {
    // Invalid or missing cache files are treated as cold caches.
  }

  return {
    schemaVersion: "1.0.0",
    entries: {}
  };
}

export async function writeEcosystemAuditCache(
  cachePath: string,
  cache: EcosystemAuditCacheFile
): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

async function walkFingerprintEntries(rootPath: string, currentPath = rootPath): Promise<string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const fingerprintEntries: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) {
        continue;
      }

      fingerprintEntries.push(...(await walkFingerprintEntries(rootPath, entryPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const details = await stat(entryPath);
    const relativePath = path.relative(rootPath, entryPath).replace(/\\/g, "/");

    fingerprintEntries.push(`${relativePath}\t${details.size}\t${Math.trunc(details.mtimeMs)}`);
  }

  return fingerprintEntries;
}

export async function fingerprintInstalledPlugin(plugin: InstalledPlugin): Promise<string> {
  const hash = createHash("sha256");

  hash.update(plugin.name);
  hash.update("\n");
  hash.update(plugin.version ?? "");
  hash.update("\n");
  hash.update(plugin.relativePath);
  hash.update("\n");

  for (const entry of await walkFingerprintEntries(plugin.rootPath)) {
    hash.update(entry);
    hash.update("\n");
  }

  return hash.digest("hex");
}
