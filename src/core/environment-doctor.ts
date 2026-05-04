import { access } from "node:fs/promises";
import path from "node:path";

import type { CliTerminalContext } from "../run-cli.js";
import { packageVersion } from "../version.js";

export interface EnvironmentDoctorReport {
  schemaVersion: "1.0.0";
  version: string;
  platform: string;
  node: string;
  npmGlobalPrefix: string;
  codexHome: {
    status: "pass" | "warn";
    path: string | null;
  };
  codexPluginCache: {
    status: "pass" | "warn";
    path: string | null;
  };
}

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
  const report = await buildEnvironmentDoctorReport(terminalContext);

  return [
    "Codex Plugin Doctor Environment",
    "===============================",
    `Version: ${report.version}`,
    `Platform: ${report.platform}`,
    `Node: ${report.node}`,
    `npm global prefix: ${report.npmGlobalPrefix}`,
    `Codex home: ${report.codexHome.status.toUpperCase()}${report.codexHome.path ? ` (${report.codexHome.path})` : ""}`,
    `Codex plugin cache: ${report.codexPluginCache.status.toUpperCase()}${report.codexPluginCache.path ? ` (${report.codexPluginCache.path})` : ""}`,
    "",
    "Recommended next commands",
    "-------------------------",
    "codex-plugin-doctor self-test",
    "codex-plugin-doctor list --installed",
    "codex-plugin-doctor check . --runtime --explain",
    "codex-plugin-doctor compat . --all --scorecard",
    "codex-plugin-doctor init-ci ."
  ].join("\n");
}

export async function buildEnvironmentDoctorReport(
  terminalContext: CliTerminalContext
): Promise<EnvironmentDoctorReport> {
  const codexHome = resolveCodexHome(terminalContext.env);
  const codexHomeExists = codexHome ? await pathExists(codexHome) : false;
  const pluginCache = codexHome ? path.join(codexHome, "plugins", "cache") : null;
  const pluginCacheExists = pluginCache ? await pathExists(pluginCache) : false;
  const npmPrefix = terminalContext.env.npm_config_prefix ?? "(unknown)";

  return {
    schemaVersion: "1.0.0",
    version: packageVersion,
    platform: terminalContext.platform ?? process.platform,
    node: process.version,
    npmGlobalPrefix: npmPrefix,
    codexHome: {
      status: codexHomeExists ? "pass" : "warn",
      path: codexHome
    },
    codexPluginCache: {
      status: pluginCacheExists ? "pass" : "warn",
      path: pluginCache
    }
  };
}

export async function renderEnvironmentDoctorJson(
  terminalContext: CliTerminalContext
): Promise<string> {
  return JSON.stringify(await buildEnvironmentDoctorReport(terminalContext), null, 2);
}
