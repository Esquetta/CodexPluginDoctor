import path from "node:path";

import { readJsonFile } from "./read-json-file.js";
import { discoverPackage } from "./discover-package.js";

export interface DoctorInspectorReport {
  schemaVersion: "1.0.0";
  generatedAt: string;
  kind: "doctor.inspector";
  targetPath: string;
  status: "pass" | "fail";
  exitCode: 0 | 1;
  mcpConfigPath: string | null;
  serverName: string | null;
  command: {
    executable: string;
    args: string[];
  } | null;
  message: string;
}

export interface BuildDoctorInspectorReportOptions {
  serverName?: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function buildFailure(targetPath: string, message: string, mcpConfigPath: string | null = null): DoctorInspectorReport {
  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    kind: "doctor.inspector",
    targetPath: path.resolve(targetPath),
    status: "fail",
    exitCode: 1,
    mcpConfigPath,
    serverName: null,
    command: null,
    message
  };
}

export async function buildDoctorInspectorReport(
  targetPath: string,
  options: BuildDoctorInspectorReportOptions = {}
): Promise<DoctorInspectorReport> {
  const discoveredPackage = await discoverPackage(targetPath);

  if (!discoveredPackage?.manifest.mcpServers) {
    return buildFailure(
      targetPath,
      "The target package does not declare an MCP server config in `.codex-plugin/plugin.json`."
    );
  }

  const mcpConfigPath = path.resolve(discoveredPackage.rootPath, discoveredPackage.manifest.mcpServers);

  if (!isPathWithinRoot(discoveredPackage.rootPath, mcpConfigPath)) {
    return buildFailure(
      discoveredPackage.rootPath,
      "The target package points the MCP server config outside the package root.",
      mcpConfigPath
    );
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = await readJsonFile<unknown>(mcpConfigPath);
  } catch {
    return buildFailure(
      discoveredPackage.rootPath,
      "The MCP server config could not be parsed as JSON.",
      mcpConfigPath
    );
  }

  if (!isPlainObject(parsedConfig) || !isPlainObject(parsedConfig.mcpServers)) {
    return buildFailure(
      discoveredPackage.rootPath,
      "The MCP server config does not contain a valid `mcpServers` object.",
      mcpConfigPath
    );
  }

  const serverNames = Object.keys(parsedConfig.mcpServers).sort();
  const selectedServerName = options.serverName ?? serverNames[0] ?? null;

  if (!selectedServerName || !serverNames.includes(selectedServerName)) {
    return buildFailure(
      discoveredPackage.rootPath,
      options.serverName
        ? `The MCP server config does not contain server \`${options.serverName}\`.`
        : "The MCP server config does not contain any server entries.",
      mcpConfigPath
    );
  }

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    kind: "doctor.inspector",
    targetPath: discoveredPackage.rootPath,
    status: "pass",
    exitCode: 0,
    mcpConfigPath,
    serverName: selectedServerName,
    command: {
      executable: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/inspector",
        "--config",
        mcpConfigPath,
        "--server",
        selectedServerName
      ]
    },
    message: "Run this command to open the MCP Inspector for the selected packaged server."
  };
}

export function renderDoctorInspectorReportJson(report: DoctorInspectorReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorInspectorReport(
  report: DoctorInspectorReport,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor MCP Inspector",
    "====================",
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Message: ${report.message}`
  ];

  if (report.mcpConfigPath) {
    lines.push(`Config: ${report.mcpConfigPath}`);
  }

  if (report.serverName) {
    lines.push(`Server: ${report.serverName}`);
  }

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  if (report.command) {
    lines.push("", "Command", "-------");
    lines.push([report.command.executable, ...report.command.args].join(" "));
  }

  return lines.join("\n");
}
