import { stat } from "node:fs/promises";
import path from "node:path";

import {
  buildCompatibilityMatrix,
  type CompatibilityEnvironment,
  type CompatibilityMatrix,
  readMcpConfigPath
} from "../compatibility/compatibility-matrix.js";
import { readJsonFile } from "../core/read-json-file.js";
import type { Finding } from "../domain/types.js";
import {
  auditMcpServerConfig,
  buildSecurityAuditFromFindings,
  type SecurityAudit
} from "../security/security-audit.js";

export interface GenericMcpDoctorReport {
  targetPath: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  mcpConfigPath: string | null;
  serverCount: number;
  findings: Finding[];
  security: SecurityAudit;
  compatibility: CompatibilityMatrix;
}

function buildFinding(
  severity: "fail" | "warn",
  id: string,
  message: string,
  impact: string,
  suggestedFix: string
): Finding {
  return {
    id,
    severity,
    message,
    impact,
    suggestedFix
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isFile();
  } catch {
    return false;
  }
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function buildStaticMcpFindings(
  mcpConfigPath: string | null,
  parsedConfig: unknown
): { findings: Finding[]; serverCount: number } {
  if (!mcpConfigPath) {
    return {
      serverCount: 0,
      findings: [
        buildFinding(
          "fail",
          "mcp.config.missing",
          "No MCP config was found for this target.",
          "A generic MCP package needs a `.mcp.json` file or a Codex manifest `mcpServers` reference before clients can discover servers.",
          "Add `.mcp.json` with a non-empty top-level `mcpServers` object."
        )
      ]
    };
  }

  if (!isPlainObject(parsedConfig)) {
    return {
      serverCount: 0,
      findings: [
        buildFinding(
          "fail",
          "mcp.config.invalid_shape",
          "The MCP config must be a JSON object.",
          "MCP clients expect object-shaped configuration so server entries can be resolved deterministically.",
          `Wrap the MCP config in a top-level object inside \`${mcpConfigPath}\`.`
        )
      ]
    };
  }

  const servers = parsedConfig.mcpServers;

  if (!isPlainObject(servers) || Object.keys(servers).length === 0) {
    return {
      serverCount: 0,
      findings: [
        buildFinding(
          "fail",
          "mcp.config.invalid_shape",
          "The MCP config must contain a non-empty `mcpServers` object.",
          "Without server entries, MCP clients cannot discover any package capabilities.",
          `Define MCP servers under \`mcpServers\` in \`${mcpConfigPath}\`.`
        )
      ]
    };
  }

  const findings: Finding[] = [];

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    if (!isPlainObject(serverConfig)) {
      findings.push(
        buildFinding(
          "fail",
          "mcp.server.invalid",
          `The MCP server \`${serverName}\` must be configured as an object.`,
          "MCP clients cannot interpret a server entry unless it is represented as an object with server options.",
          `Change the \`${serverName}\` entry in \`${mcpConfigPath}\` to an object.`
        )
      );
      continue;
    }

    if (typeof serverConfig.command !== "string" && typeof serverConfig.url !== "string") {
      findings.push(
        buildFinding(
          "fail",
          "mcp.server.transport.missing",
          `The MCP server \`${serverName}\` must define either \`command\` or \`url\`.`,
          "MCP clients need a process command for stdio servers or a URL for remote servers.",
          `Add either \`command\` or \`url\` to the \`${serverName}\` entry in \`${mcpConfigPath}\`.`
        )
      );
    }
  }

  return {
    serverCount: Object.keys(servers).length,
    findings
  };
}

function mergeReportStatus(
  staticFindings: Finding[],
  security: SecurityAudit
): "pass" | "warn" | "fail" {
  if (staticFindings.some((finding) => finding.severity === "fail") || security.status === "fail") {
    return "fail";
  }

  if (staticFindings.some((finding) => finding.severity === "warn") || security.status === "warn") {
    return "warn";
  }

  return "pass";
}

export async function buildGenericMcpDoctor(
  targetPath: string,
  environment: CompatibilityEnvironment = {}
): Promise<GenericMcpDoctorReport> {
  const rootPath = path.resolve(targetPath);
  const compatibility = await buildCompatibilityMatrix(rootPath, environment);
  const mcpConfigPath = await readMcpConfigPath(rootPath);
  let parsedConfig: unknown = null;
  let staticFindings: Finding[] = [];
  let serverCount = 0;

  if (!mcpConfigPath || !(await fileExists(mcpConfigPath))) {
    staticFindings = buildStaticMcpFindings(null, null).findings;
  } else if (!isPathWithinRoot(rootPath, mcpConfigPath)) {
    staticFindings = [
      buildFinding(
        "fail",
        "mcp.config.path_outside_root",
        "The MCP config path resolves outside the target root.",
        "A package that reads MCP configuration outside its root is harder to audit and can depend on unreviewed local files.",
        "Keep `.mcp.json` or the manifest `mcpServers` reference inside the package root."
      )
    ];
  } else {
    try {
      parsedConfig = await readJsonFile<unknown>(mcpConfigPath);
      const staticResult = buildStaticMcpFindings(mcpConfigPath, parsedConfig);
      staticFindings = staticResult.findings;
      serverCount = staticResult.serverCount;
    } catch {
      staticFindings = [
        buildFinding(
          "fail",
          "mcp.config.invalid_json",
          "The MCP config is not valid JSON.",
          "MCP clients cannot parse server configuration until the JSON syntax is valid.",
          `Fix the JSON syntax in \`${mcpConfigPath}\`.`
        )
      ];
    }
  }

  const security = buildSecurityAuditFromFindings(
    rootPath,
    mcpConfigPath && parsedConfig !== null
      ? auditMcpServerConfig(rootPath, parsedConfig)
      : []
  );
  const status = mergeReportStatus(staticFindings, security);

  return {
    targetPath: rootPath,
    status,
    exitCode: status === "fail" ? 1 : 0,
    mcpConfigPath,
    serverCount,
    findings: [...staticFindings, ...security.findings],
    security,
    compatibility
  };
}

export function renderGenericMcpDoctorJson(report: GenericMcpDoctorReport): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      ...report
    },
    null,
    2
  );
}

export function renderGenericMcpDoctor(report: GenericMcpDoctorReport): string {
  const lines = [
    "Generic MCP Doctor",
    "==================",
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `MCP config: ${report.mcpConfigPath ?? "not found"}`,
    `Servers: ${report.serverCount}`,
    `Security: ${report.security.status.toUpperCase()} (${report.security.score}/100)`,
    `Compatibility: ${report.compatibility.results
      .map((result) => `${result.client}=${result.status}`)
      .join(", ")}`
  ];

  if (report.findings.length === 0) {
    lines.push("", "No findings.");
    return lines.join("\n");
  }

  const failures = report.findings.filter((finding) => finding.severity === "fail");
  const warnings = report.findings.filter((finding) => finding.severity === "warn");

  const appendFindings = (title: string, findings: Finding[], marker: string) => {
    if (findings.length === 0) {
      return;
    }

    lines.push("", title, "--------");

    for (const finding of findings) {
      lines.push(`${marker} ${finding.id}`);
      lines.push(`  Message: ${finding.message}`);
      lines.push(`  Impact: ${finding.impact}`);
      lines.push(`  Suggested fix: ${finding.suggestedFix}`);
    }
  };

  appendFindings("Failures", failures, "x");
  appendFindings("Warnings", warnings, "!");

  return lines.join("\n");
}
