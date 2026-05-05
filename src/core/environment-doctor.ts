import { constants } from "node:fs";
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

export interface ClientDoctorResult {
  client: string;
  status: "pass" | "warn";
  configPath: string | null;
  configExists: boolean;
  directoryWritable: boolean;
  summary: string;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathWritable(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.W_OK);
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

function resolveHomeDirectory(env: Record<string, string | undefined>): string | null {
  return env.USERPROFILE ?? env.HOME ?? null;
}

function resolveClaudeConfigPath(terminalContext: CliTerminalContext): string | null {
  const platform = terminalContext.platform ?? process.platform;
  const homeDirectory = resolveHomeDirectory(terminalContext.env);

  if (platform === "win32") {
    return terminalContext.env.APPDATA
      ? path.join(terminalContext.env.APPDATA, "Claude", "claude_desktop_config.json")
      : null;
  }

  if (platform === "darwin" && homeDirectory) {
    return path.join(
      homeDirectory,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    );
  }

  return null;
}

function resolveClineConfigPath(env: Record<string, string | undefined>): string | null {
  const homeDirectory = resolveHomeDirectory(env);
  const clineDirectory = env.CLINE_DIR
    ? path.resolve(env.CLINE_DIR)
    : homeDirectory
      ? path.join(homeDirectory, ".cline")
      : null;

  return clineDirectory
    ? path.join(clineDirectory, "data", "settings", "cline_mcp_settings.json")
    : null;
}

function resolveClientConfigPaths(terminalContext: CliTerminalContext): Array<{
  client: string;
  configPath: string | null;
}> {
  const env = terminalContext.env;
  const homeDirectory = resolveHomeDirectory(env);

  return [
    {
      client: "Codex",
      configPath: resolveCodexHome(env)
    },
    {
      client: "Claude Desktop",
      configPath: resolveClaudeConfigPath(terminalContext)
    },
    {
      client: "Cursor",
      configPath: homeDirectory ? path.join(homeDirectory, ".cursor", "mcp.json") : null
    },
    {
      client: "Cline",
      configPath: resolveClineConfigPath(env)
    },
    {
      client: "Windsurf",
      configPath: homeDirectory
        ? path.join(homeDirectory, ".codeium", "windsurf", "mcp_config.json")
        : null
    }
  ];
}

async function inspectClientConfig(
  client: string,
  configPath: string | null
): Promise<ClientDoctorResult> {
  if (!configPath) {
    return {
      client,
      status: "warn",
      configPath,
      configExists: false,
      directoryWritable: false,
      summary: "Config path could not be resolved."
    };
  }

  const configExists = await pathExists(configPath);
  const directory = client === "Codex" ? configPath : path.dirname(configPath);
  const directoryExists = await pathExists(directory);
  const directoryWritable = directoryExists ? await pathWritable(directory) : false;

  return {
    client,
    status: configExists || directoryWritable ? "pass" : "warn",
    configPath,
    configExists,
    directoryWritable,
    summary: configExists
      ? "Config path exists."
      : directoryWritable
        ? "Config directory exists and is writable."
        : "Config path was not detected on this machine."
  };
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

export async function buildClientDoctorReport(
  terminalContext: CliTerminalContext
): Promise<ClientDoctorResult[]> {
  return Promise.all(
    resolveClientConfigPaths(terminalContext).map((item) =>
      inspectClientConfig(item.client, item.configPath)
    )
  );
}

export async function renderClientDoctor(
  terminalContext: CliTerminalContext
): Promise<string> {
  const results = await buildClientDoctorReport(terminalContext);
  const lines = [
    "Codex Plugin Doctor Clients",
    "===========================",
    ""
  ];

  for (const result of results) {
    lines.push(`${result.client}: ${result.status.toUpperCase()} - ${result.summary}`);
    lines.push(`  Config: ${result.configPath ?? "(unknown)"}`);
    lines.push(`  Exists: ${result.configExists ? "yes" : "no"}`);
    lines.push(`  Writable: ${result.directoryWritable ? "yes" : "no"}`);
  }

  return lines.join("\n");
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
