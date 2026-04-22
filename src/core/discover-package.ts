import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DiscoveredPackage, PluginManifest } from "../domain/types.js";

export async function discoverPackage(
  targetPath: string
): Promise<DiscoveredPackage | null> {
  const rootPath = path.resolve(targetPath);
  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");

  try {
    const manifestContent = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent) as PluginManifest;

    return {
      rootPath,
      manifestPath,
      manifest
    };
  } catch {
    return null;
  }
}

