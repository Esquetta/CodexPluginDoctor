import { readFile, stat } from "node:fs/promises";
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

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isFile();
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

export async function buildCompatibilityMatrix(
  targetPath: string
): Promise<CompatibilityMatrix> {
  const rootPath = path.resolve(targetPath);
  const codexResult = await validatePlugin(rootPath);
  const codexStatus = statusFromCheckResult(codexResult);
  const results: CompatibilityResult[] = [
    {
      client: "Codex",
      status: codexStatus,
      summary:
        codexStatus === "pass"
          ? "Codex plugin package validation passed."
          : "Codex plugin package validation produced findings.",
      details: codexResult.findings.map((finding) => finding.id)
    },
    await checkGenericMcp(rootPath),
    {
      client: "Claude Desktop",
      status: "skipped",
      summary: "Client-specific package adapter is not implemented yet.",
      details: ["Planned adapter after generic MCP compatibility is stable."]
    },
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
