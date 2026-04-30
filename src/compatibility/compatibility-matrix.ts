import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CheckResult } from "../domain/types.js";
import { validatePlugin } from "../core/validate-plugin.js";

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

async function readMcpConfigPath(targetPath: string): Promise<string | null> {
  const rootPath = path.resolve(targetPath);
  const directMcpPath = path.join(rootPath, ".mcp.json");

  if (await fileExists(directMcpPath)) {
    return directMcpPath;
  }

  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");

  if (!(await fileExists(manifestPath))) {
    return null;
  }

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      mcpServers?: unknown;
    };

    return typeof manifest.mcpServers === "string"
      ? path.resolve(rootPath, manifest.mcpServers)
      : null;
  } catch {
    return null;
  }
}

async function hasCodexManifest(targetPath: string): Promise<boolean> {
  return fileExists(path.join(path.resolve(targetPath), ".codex-plugin", "plugin.json"));
}

async function checkGenericMcp(targetPath: string): Promise<CompatibilityResult> {
  const mcpConfigPath = await readMcpConfigPath(targetPath);

  if (!mcpConfigPath || !(await fileExists(mcpConfigPath))) {
    return {
      client: "Generic MCP",
      status: "skipped",
      summary: "No MCP config found.",
      details: ["Expected `.mcp.json` or manifest `mcpServers` reference."]
    };
  }

  try {
    const parsed = JSON.parse(await readFile(mcpConfigPath, "utf8")) as {
      mcpServers?: unknown;
    };
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

function getClaudeDesktopConfigPath(environment: CompatibilityEnvironment = {}): string | null {
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
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers?: unknown;
    };
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

export async function buildCompatibilityMatrix(
  targetPath: string,
  environment: CompatibilityEnvironment = {}
): Promise<CompatibilityMatrix> {
  const rootPath = path.resolve(targetPath);
  const genericMcpResult = await checkGenericMcp(rootPath);
  const claudeDesktopResult = await checkClaudeDesktop(rootPath, genericMcpResult, environment);
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
    {
      client: "Cursor",
      status: "skipped",
      summary: "Client-specific package adapter is not implemented yet.",
      details: ["Planned adapter after generic MCP compatibility is stable."]
    }
  ];

  return {
    targetPath: rootPath,
    results
  };
}

export function matrixExitCode(matrix: CompatibilityMatrix): 0 | 1 {
  return matrix.results.some((result) => result.status === "fail") ? 1 : 0;
}
