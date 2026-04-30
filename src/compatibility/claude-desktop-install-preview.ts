import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  getClaudeDesktopConfigPath,
  readMcpConfigPath,
  type CompatibilityEnvironment
} from "./compatibility-matrix.js";

export interface ClaudeDesktopInstallPreview {
  targetPath: string;
  configPath: string;
  snippet: {
    mcpServers: Record<string, unknown>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRelativeLocalPath(value: string): boolean {
  return value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\");
}

function normalizeLocalPathArgument(value: unknown, rootPath: string): unknown {
  return typeof value === "string" && isRelativeLocalPath(value)
    ? path.resolve(rootPath, value)
    : value;
}

function normalizeServerConfig(serverConfig: unknown, rootPath: string): unknown {
  if (!isRecord(serverConfig)) {
    return serverConfig;
  }

  const normalized = { ...serverConfig };

  if (typeof normalized.command === "string" && isRelativeLocalPath(normalized.command)) {
    normalized.command = path.resolve(rootPath, normalized.command);
  }

  if (Array.isArray(normalized.args)) {
    normalized.args = normalized.args.map((argument) =>
      normalizeLocalPathArgument(argument, rootPath)
    );
  }

  return normalized;
}

export async function buildClaudeDesktopInstallPreview(
  targetPath: string,
  environment: CompatibilityEnvironment = {}
): Promise<ClaudeDesktopInstallPreview> {
  const rootPath = path.resolve(targetPath);
  const configPath = getClaudeDesktopConfigPath(environment);

  if (!configPath) {
    throw new Error("Claude Desktop config path could not be resolved on this platform.");
  }

  const mcpConfigPath = await readMcpConfigPath(rootPath);

  if (!mcpConfigPath) {
    throw new Error("No MCP config found for install preview.");
  }

  const parsed = JSON.parse(await readFile(mcpConfigPath, "utf8")) as {
    mcpServers?: unknown;
  };
  const servers = parsed.mcpServers;

  if (!isRecord(servers) || Object.keys(servers).length === 0) {
    throw new Error("MCP config does not contain a non-empty `mcpServers` object.");
  }

  return {
    targetPath: rootPath,
    configPath,
    snippet: {
      mcpServers: Object.fromEntries(
        Object.entries(servers).map(([serverName, serverConfig]) => [
          serverName,
          normalizeServerConfig(serverConfig, rootPath)
        ])
      )
    }
  };
}

export function renderClaudeDesktopInstallPreview(
  preview: ClaudeDesktopInstallPreview
): string {
  return [
    "Claude Desktop Install Preview",
    "==============================",
    `Target: ${preview.targetPath}`,
    `Config: ${preview.configPath}`,
    "",
    "Add or merge this snippet into `claude_desktop_config.json`:",
    JSON.stringify(preview.snippet, null, 2),
    "",
    "No files were modified."
  ].join("\n");
}
