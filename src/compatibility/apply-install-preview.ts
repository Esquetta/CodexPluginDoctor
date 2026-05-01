import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface McpInstallPreviewLike {
  targetPath: string;
  configPath: string;
  snippet: {
    mcpServers: Record<string, unknown>;
  };
}

export interface ApplyInstallResult {
  client: string;
  configPath: string;
  backupPath: string | null;
  appliedServers: string[];
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildBackupPath(configPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${configPath}.${timestamp}.bak`;
}

export async function applyInstallPreview(
  client: string,
  preview: McpInstallPreviewLike
): Promise<ApplyInstallResult> {
  await mkdir(path.dirname(preview.configPath), { recursive: true });

  const configExists = await fileExists(preview.configPath);
  const currentConfig = configExists
    ? JSON.parse(await readFile(preview.configPath, "utf8")) as Record<string, unknown>
    : {};

  if (!isRecord(currentConfig)) {
    throw new Error(`${client} MCP config must be a JSON object.`);
  }

  const currentServers = currentConfig.mcpServers;

  if (currentServers !== undefined && !isRecord(currentServers)) {
    throw new Error(`${client} MCP config has an invalid \`mcpServers\` shape.`);
  }

  const existingServers = currentServers ?? {};
  const incomingServers = preview.snippet.mcpServers;
  const duplicateServers = Object.keys(incomingServers).filter((serverName) =>
    Object.prototype.hasOwnProperty.call(existingServers, serverName)
  );

  if (duplicateServers.length > 0) {
    throw new Error(
      `Refusing to overwrite existing MCP server names: ${duplicateServers.join(", ")}`
    );
  }

  const backupPath = configExists ? buildBackupPath(preview.configPath) : null;

  if (backupPath) {
    await copyFile(preview.configPath, backupPath);
  }

  const nextConfig = {
    ...currentConfig,
    mcpServers: {
      ...existingServers,
      ...incomingServers
    }
  };

  await writeFile(preview.configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  return {
    client,
    configPath: preview.configPath,
    backupPath,
    appliedServers: Object.keys(incomingServers)
  };
}

export function renderApplyInstallResult(result: ApplyInstallResult): string {
  const lines = [
    `Applied ${result.client} MCP config`,
    "==============================",
    `Config: ${result.configPath}`,
    `Backup: ${result.backupPath ?? "No existing config file was present."}`,
    "",
    "Applied servers:"
  ];

  for (const serverName of result.appliedServers) {
    lines.push(`- ${serverName}`);
  }

  return lines.join("\n");
}
