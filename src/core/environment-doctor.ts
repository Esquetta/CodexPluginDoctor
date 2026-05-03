import { access } from "node:fs/promises";
import path from "node:path";

import type { CliTerminalContext } from "../run-cli.js";
import { packageVersion } from "../version.js";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveCodexHome(env: Record<string, string | undefined>): string | null {
  if (env.CODEX_HOME) {
    return path.resolve(env.CODEX_HOME);
  }

  if (env.USERPROFILE) {
    return path.join(env.USERPROFILE, ".codex");
  }

  if (env.HOME) {
    return path.join(env.HOME, ".codex");
  }

  return null;
}

export async function renderEnvironmentDoctor(
  terminalContext: CliTerminalContext
): Promise<string> {
  const codexHome = resolveCodexHome(terminalContext.env);
  const codexHomeExists = codexHome ? await pathExists(codexHome) : false;
  const pluginCache = codexHome ? path.join(codexHome, "plugins", "cache") : null;
  const pluginCacheExists = pluginCache ? await pathExists(pluginCache) : false;
  const npmPrefix = terminalContext.env.npm_config_prefix ?? "(unknown)";

  return [
    "Codex Plugin Doctor Environment",
    "===============================",
    `Version: ${packageVersion}`,
    `Platform: ${terminalContext.platform ?? process.platform}`,
    `Node: ${process.version}`,
    `npm global prefix: ${npmPrefix}`,
    `Codex home: ${codexHomeExists ? "PASS" : "WARN"}${codexHome ? ` (${codexHome})` : ""}`,
    `Codex plugin cache: ${pluginCacheExists ? "PASS" : "WARN"}${pluginCache ? ` (${pluginCache})` : ""}`
  ].join("\n");
}
