import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CheckResult } from "../domain/types.js";
import { validatePlugin } from "../core/validate-plugin.js";
import { readJsonFile } from "../core/read-json-file.js";

export type CompatibilityStatus = "pass" | "warn" | "fail" | "skipped";

export interface CompatibilityResult {
  client: string;
  status: CompatibilityStatus;
  summary: string;
  details: string[];
}

export interface CompatibilityMatrix {
  targetPath: string;
  results: CompatibilityResult[];
}

export interface CompatibilityEnvironment {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homedir?: string;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isDirectory();
  } catch {
    return false;
  }
}

function statusFromCheckResult(result: CheckResult): CompatibilityStatus {
  if (result.status === "fail") {
    return "fail";
  }

  if (result.status === "warn") {
    return "warn";
  }

  return "pass";
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export async function readMcpConfigPath(targetPath: string): Promise<string | null> {
  const rootPath = path.resolve(targetPath);
  const directMcpPath = path.join(rootPath, ".mcp.json");

  if (await fileExists(directMcpPath)) {
    return directMcpPath;
  }

  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");

  if (!(await fileExists(manifestPath))) {
    return null;
  }

  let manifest: { mcpServers?: unknown };

  try {
    manifest = await readJsonFile<{ mcpServers?: unknown }>(manifestPath);
  } catch {
    return null;
  }

  if (typeof manifest.mcpServers !== "string") {
    return null;
  }

  const mcpConfigPath = path.resolve(rootPath, manifest.mcpServers);

  if (!isPathWithinRoot(rootPath, mcpConfigPath)) {
    throw new Error("Manifest MCP config path resolves outside the package root.");
  }

  return mcpConfigPath;
}

async function hasCodexManifest(targetPath: string): Promise<boolean> {
  return fileExists(path.join(path.resolve(targetPath), ".codex-plugin", "plugin.json"));
}

async function checkGenericMcp(targetPath: string): Promise<CompatibilityResult> {
  let mcpConfigPath: string | null;

  try {
    mcpConfigPath = await readMcpConfigPath(targetPath);
  } catch (error) {
    return {
      client: "Generic MCP",
      status: "fail",
      summary: error instanceof Error ? error.message : "MCP config path is unsafe.",
      details: ["Keep `.mcp.json` or manifest `mcpServers` references inside the package root."]
    };
  }

  if (!mcpConfigPath || !(await fileExists(mcpConfigPath))) {
    return {
      client: "Generic MCP",
      status: "skipped",
      summary: "No MCP config found.",
      details: ["Expected `.mcp.json` or manifest `mcpServers` reference."]
    };
  }

  try {
    const parsed = await readJsonFile<{
      mcpServers?: unknown;
    }>(mcpConfigPath);
    const servers = parsed.mcpServers;

    if (
      typeof servers !== "object" ||
      servers === null ||
      Array.isArray(servers) ||
      Object.keys(servers).length === 0
    ) {
      return {
        client: "Generic MCP",
        status: "fail",
        summary: "MCP config does not contain a non-empty `mcpServers` object.",
        details: [mcpConfigPath]
      };
    }

    return {
      client: "Generic MCP",
      status: "pass",
      summary: "MCP server config is valid.",
      details: [mcpConfigPath]
    };
  } catch {
    return {
      client: "Generic MCP",
      status: "fail",
      summary: "MCP config is not valid JSON.",
      details: [mcpConfigPath]
    };
  }
}

async function readMcpServerNames(targetPath: string): Promise<string[]> {
  const mcpConfigPath = await readMcpConfigPath(targetPath);

  if (!mcpConfigPath || !(await fileExists(mcpConfigPath))) {
    return [];
  }

  try {
    const parsed = await readJsonFile<{
      mcpServers?: unknown;
    }>(mcpConfigPath);
    const servers = parsed.mcpServers;

    return typeof servers === "object" && servers !== null && !Array.isArray(servers)
      ? Object.keys(servers)
      : [];
  } catch {
    return [];
  }
}

export function getClaudeDesktopConfigPath(environment: CompatibilityEnvironment = {}): string | null {
  const platform = environment.platform ?? process.platform;
  const env = environment.env ?? process.env;
  const homeDirectory = environment.homedir ?? os.homedir();

  if (platform === "win32") {
    const appData = env.APPDATA;
    return appData ? path.join(appData, "Claude", "claude_desktop_config.json") : null;
  }

  if (platform === "darwin") {
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

function getHomeDirectory(environment: CompatibilityEnvironment = {}): string {
  const env = environment.env ?? process.env;

  return env.USERPROFILE ?? env.HOME ?? environment.homedir ?? os.homedir();
}

export async function getCursorMcpConfigPath(
  targetPath: string,
  environment: CompatibilityEnvironment = {}
): Promise<string> {
  const rootPath = path.resolve(targetPath);
  const projectConfigPath = path.join(rootPath, ".cursor", "mcp.json");

  if (await fileExists(projectConfigPath)) {
    return projectConfigPath;
  }

  return path.join(getHomeDirectory(environment), ".cursor", "mcp.json");
}

export function getClineMcpConfigPath(
  environment: CompatibilityEnvironment = {}
): string {
  const env = environment.env ?? process.env;
  const clineDirectory = env.CLINE_DIR
    ? path.resolve(env.CLINE_DIR)
    : path.join(getHomeDirectory(environment), ".cline");

  return path.join(clineDirectory, "data", "settings", "cline_mcp_settings.json");
}

export function getWindsurfMcpConfigPath(
  environment: CompatibilityEnvironment = {}
): string {
  return path.join(getHomeDirectory(environment), ".codeium", "windsurf", "mcp_config.json");
}

async function checkClaudeDesktop(
  targetPath: string,
  genericMcpResult: CompatibilityResult,
  environment: CompatibilityEnvironment = {}
): Promise<CompatibilityResult> {
  if (genericMcpResult.status !== "pass") {
    return {
      client: "Claude Desktop",
      status: "skipped",
      summary: "No valid MCP package config is available for Claude Desktop.",
      details: ["Add a valid `.mcp.json` with a non-empty `mcpServers` object first."]
    };
  }

  const configPath = getClaudeDesktopConfigPath(environment);

  if (!configPath) {
    return {
      client: "Claude Desktop",
      status: "warn",
      summary: "Claude Desktop config path could not be resolved on this platform.",
      details: ["Claude Desktop local config detection currently supports Windows and macOS."]
    };
  }

  if (!(await fileExists(configPath))) {
    const configDirectory = path.dirname(configPath);

    return {
      client: "Claude Desktop",
      status: await directoryExists(configDirectory) ? "pass" : "warn",
      summary: await directoryExists(configDirectory)
        ? "Claude Desktop directory exists and a config file can be created."
        : "Claude Desktop was not detected on this machine.",
      details: [
        configPath,
        "Claude Desktop can add stdio MCP servers through `claude_desktop_config.json` when the app is installed."
      ]
    };
  }

  try {
    const parsed = await readJsonFile<{
      mcpServers?: unknown;
    }>(configPath);
    const servers = parsed.mcpServers;

    if (servers !== undefined && (
      typeof servers !== "object" ||
      servers === null ||
      Array.isArray(servers)
    )) {
      return {
        client: "Claude Desktop",
        status: "fail",
        summary: "Claude Desktop config has an invalid `mcpServers` shape.",
        details: [configPath, "`mcpServers` must be an object before this package can be added safely."]
      };
    }

    const packageServerNames = await readMcpServerNames(targetPath);
    const existingServerNames = typeof servers === "object" && servers !== null
      ? Object.keys(servers)
      : [];
    const duplicateServerNames = packageServerNames.filter((serverName) =>
      existingServerNames.includes(serverName)
    );

    if (duplicateServerNames.length > 0) {
      return {
        client: "Claude Desktop",
        status: "warn",
        summary: "Claude Desktop already has MCP server names from this package.",
        details: [
          configPath,
          ...duplicateServerNames.map((serverName) => `Duplicate server: ${serverName}`)
        ]
      };
    }

    return {
      client: "Claude Desktop",
      status: "pass",
      summary: "Claude Desktop config is valid and this MCP package can be added.",
      details: [
        configPath,
        `Source package: ${path.resolve(targetPath)}`
      ]
    };
  } catch {
    return {
      client: "Claude Desktop",
      status: "fail",
      summary: "Claude Desktop config is not valid JSON.",
      details: [configPath, "Repair the local Claude Desktop config before adding new MCP servers."]
    };
  }
}

async function checkCursor(
  targetPath: string,
  genericMcpResult: CompatibilityResult,
  environment: CompatibilityEnvironment = {}
): Promise<CompatibilityResult> {
  if (genericMcpResult.status !== "pass") {
    return {
      client: "Cursor",
      status: "skipped",
      summary: "No valid MCP package config is available for Cursor.",
      details: ["Add a valid `.mcp.json` with a non-empty `mcpServers` object first."]
    };
  }

  const configPath = await getCursorMcpConfigPath(targetPath, environment);

  if (!(await fileExists(configPath))) {
    const configDirectory = path.dirname(configPath);

    return {
      client: "Cursor",
      status: await directoryExists(configDirectory) ? "pass" : "warn",
      summary: await directoryExists(configDirectory)
        ? "Cursor MCP config directory exists and a config file can be created."
        : "Cursor was not detected on this machine.",
      details: [
        configPath,
        "Cursor supports project `.cursor/mcp.json` and global `~/.cursor/mcp.json` MCP configs."
      ]
    };
  }

  try {
    const parsed = await readJsonFile<{
      mcpServers?: unknown;
    }>(configPath);
    const servers = parsed.mcpServers;

    if (servers !== undefined && (
      typeof servers !== "object" ||
      servers === null ||
      Array.isArray(servers)
    )) {
      return {
        client: "Cursor",
        status: "fail",
        summary: "Cursor MCP config has an invalid `mcpServers` shape.",
        details: [configPath, "`mcpServers` must be an object before this package can be added safely."]
      };
    }

    const packageServerNames = await readMcpServerNames(targetPath);
    const existingServerNames = typeof servers === "object" && servers !== null
      ? Object.keys(servers)
      : [];
    const duplicateServerNames = packageServerNames.filter((serverName) =>
      existingServerNames.includes(serverName)
    );

    if (duplicateServerNames.length > 0) {
      return {
        client: "Cursor",
        status: "warn",
        summary: "Cursor already has MCP server names from this package.",
        details: [
          configPath,
          ...duplicateServerNames.map((serverName) => `Duplicate server: ${serverName}`)
        ]
      };
    }

    return {
      client: "Cursor",
      status: "pass",
      summary: "Cursor global MCP config is valid and this package can be added.",
      details: [
        configPath,
        `Source package: ${path.resolve(targetPath)}`
      ]
    };
  } catch {
    return {
      client: "Cursor",
      status: "fail",
      summary: "Cursor MCP config is not valid JSON.",
      details: [configPath, "Repair the local Cursor MCP config before adding new MCP servers."]
    };
  }
}

async function checkCline(
  targetPath: string,
  genericMcpResult: CompatibilityResult,
  environment: CompatibilityEnvironment = {}
): Promise<CompatibilityResult> {
  if (genericMcpResult.status !== "pass") {
    return {
      client: "Cline",
      status: "skipped",
      summary: "No valid MCP package config is available for Cline.",
      details: ["Add a valid `.mcp.json` with a non-empty `mcpServers` object first."]
    };
  }

  const configPath = getClineMcpConfigPath(environment);

  if (!(await fileExists(configPath))) {
    const configDirectory = path.dirname(configPath);

    return {
      client: "Cline",
      status: await directoryExists(configDirectory) ? "pass" : "warn",
      summary: await directoryExists(configDirectory)
        ? "Cline MCP settings directory exists and a config file can be created."
        : "Cline was not detected on this machine.",
      details: [
        configPath,
        "Cline stores MCP servers in `cline_mcp_settings.json` under its settings directory."
      ]
    };
  }

  try {
    const parsed = await readJsonFile<{
      mcpServers?: unknown;
    }>(configPath);
    const servers = parsed.mcpServers;

    if (servers !== undefined && (
      typeof servers !== "object" ||
      servers === null ||
      Array.isArray(servers)
    )) {
      return {
        client: "Cline",
        status: "fail",
        summary: "Cline MCP config has an invalid `mcpServers` shape.",
        details: [configPath, "`mcpServers` must be an object before this package can be added safely."]
      };
    }

    const packageServerNames = await readMcpServerNames(targetPath);
    const existingServerNames = typeof servers === "object" && servers !== null
      ? Object.keys(servers)
      : [];
    const duplicateServerNames = packageServerNames.filter((serverName) =>
      existingServerNames.includes(serverName)
    );

    if (duplicateServerNames.length > 0) {
      return {
        client: "Cline",
        status: "warn",
        summary: "Cline already has MCP server names from this package.",
        details: [
          configPath,
          ...duplicateServerNames.map((serverName) => `Duplicate server: ${serverName}`)
        ]
      };
    }

    return {
      client: "Cline",
      status: "pass",
      summary: "Cline MCP config is valid and this package can be added.",
      details: [
        configPath,
        `Source package: ${path.resolve(targetPath)}`
      ]
    };
  } catch {
    return {
      client: "Cline",
      status: "fail",
      summary: "Cline MCP config is not valid JSON.",
      details: [configPath, "Repair the local Cline MCP config before adding new MCP servers."]
    };
  }
}

async function checkWindsurf(
  targetPath: string,
  genericMcpResult: CompatibilityResult,
  environment: CompatibilityEnvironment = {}
): Promise<CompatibilityResult> {
  if (genericMcpResult.status !== "pass") {
    return {
      client: "Windsurf",
      status: "skipped",
      summary: "No valid MCP package config is available for Windsurf.",
      details: ["Add a valid `.mcp.json` with a non-empty `mcpServers` object first."]
    };
  }

  const configPath = getWindsurfMcpConfigPath(environment);

  if (!(await fileExists(configPath))) {
    const configDirectory = path.dirname(configPath);

    return {
      client: "Windsurf",
      status: await directoryExists(configDirectory) ? "pass" : "warn",
      summary: await directoryExists(configDirectory)
        ? "Windsurf MCP config directory exists and a config file can be created."
        : "Windsurf was not detected on this machine.",
      details: [
        configPath,
        "Windsurf stores Cascade MCP servers in `mcp_config.json` under `~/.codeium/windsurf`."
      ]
    };
  }

  try {
    const parsed = await readJsonFile<{
      mcpServers?: unknown;
    }>(configPath);
    const servers = parsed.mcpServers;

    if (servers !== undefined && (
      typeof servers !== "object" ||
      servers === null ||
      Array.isArray(servers)
    )) {
      return {
        client: "Windsurf",
        status: "fail",
        summary: "Windsurf MCP config has an invalid `mcpServers` shape.",
        details: [configPath, "`mcpServers` must be an object before this package can be added safely."]
      };
    }

    const packageServerNames = await readMcpServerNames(targetPath);
    const existingServerNames = typeof servers === "object" && servers !== null
      ? Object.keys(servers)
      : [];
    const duplicateServerNames = packageServerNames.filter((serverName) =>
      existingServerNames.includes(serverName)
    );

    if (duplicateServerNames.length > 0) {
      return {
        client: "Windsurf",
        status: "warn",
        summary: "Windsurf already has MCP server names from this package.",
        details: [
          configPath,
          ...duplicateServerNames.map((serverName) => `Duplicate server: ${serverName}`)
        ]
      };
    }

    return {
      client: "Windsurf",
      status: "pass",
      summary: "Windsurf MCP config is valid and this package can be added.",
      details: [
        configPath,
        `Source package: ${path.resolve(targetPath)}`
      ]
    };
  } catch {
    return {
      client: "Windsurf",
      status: "fail",
      summary: "Windsurf MCP config is not valid JSON.",
      details: [configPath, "Repair the local Windsurf MCP config before adding new MCP servers."]
    };
  }
}

export async function buildCompatibilityMatrix(
  targetPath: string,
  environment: CompatibilityEnvironment = {}
): Promise<CompatibilityMatrix> {
  const rootPath = path.resolve(targetPath);
  const genericMcpResult = await checkGenericMcp(rootPath);
  const claudeDesktopResult = await checkClaudeDesktop(rootPath, genericMcpResult, environment);
  const cursorResult = await checkCursor(rootPath, genericMcpResult, environment);
  const clineResult = await checkCline(rootPath, genericMcpResult, environment);
  const windsurfResult = await checkWindsurf(rootPath, genericMcpResult, environment);
  const codexResult = await validatePlugin(rootPath);
  const codexStatus = statusFromCheckResult(codexResult);
  const codexCompatibility = !await hasCodexManifest(rootPath)
    && genericMcpResult.status === "pass"
      ? {
          client: "Codex",
          status: "skipped" as const,
          summary: "No Codex plugin manifest found; treating target as a standalone MCP package.",
          details: ["Add `.codex-plugin/plugin.json` if this package should be installable as a Codex plugin."]
        }
      : {
          client: "Codex",
          status: codexStatus,
          summary:
            codexStatus === "pass"
              ? "Codex plugin package validation passed."
              : "Codex plugin package validation produced findings.",
          details: codexResult.findings.map((finding) => finding.id)
        };
  const results: CompatibilityResult[] = [
    codexCompatibility,
    genericMcpResult,
    claudeDesktopResult,
    cursorResult,
    clineResult,
    windsurfResult
  ];

  return {
    targetPath: rootPath,
    results
  };
}

export function matrixExitCode(matrix: CompatibilityMatrix): 0 | 1 {
  return matrix.results.some((result) => result.status === "fail") ? 1 : 0;
}
