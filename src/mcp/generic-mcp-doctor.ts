import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildCompatibilityMatrix,
  type CompatibilityEnvironment,
  type CompatibilityMatrix,
  readMcpConfigPath
} from "../compatibility/compatibility-matrix.js";
import { normalizeMcpConfig } from "../core/mcp-config-normalizer.js";
import { readJsonFile } from "../core/read-json-file.js";
import { probeRuntimeConfig, remoteReliabilityGatePassed } from "../core/runtime-probe.js";
import type {
  Finding,
  FindingEvidence,
  RuntimeExecutionEvidence,
  RuntimeScorecard
} from "../domain/types.js";
import {
  formatFindingFingerprintLine,
  withFindingFingerprints
} from "../reporting/finding-fingerprint.js";
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
  runtimeScorecard?: RuntimeScorecard;
  runtimeExecution?: RuntimeExecutionEvidence;
}

export interface GenericMcpDoctorOptions {
  runtime?: boolean;
  allowNetwork?: boolean;
  allowLocalNetwork?: boolean;
  allowSessionLifecycle?: boolean;
  requireRemoteReliability?: boolean;
  runtimeStartupTimeoutMs?: number;
}

function buildFinding(
  severity: "fail" | "warn",
  id: string,
  message: string,
  impact: string,
  suggestedFix: string,
  evidence?: FindingEvidence
): Finding {
  return {
    id,
    severity,
    message,
    impact,
    suggestedFix,
    ...(evidence ? { evidence } : {})
  };
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
  configPath: string | null,
  parsedConfig: unknown
): { findings: Finding[]; serverCount: number } {
  if (!configPath) {
    return {
      serverCount: 0,
      findings: [
        buildFinding(
          "fail",
          "mcp.config.missing",
          "No MCP config was found for this target.",
          "A generic MCP package needs a `.mcp.json` file or a Codex manifest `mcpServers` reference before clients can discover servers.",
          "Add `.mcp.json` with a non-empty top-level `mcpServers` object.",
          { configPath: ".mcp.json", field: "mcpServers" }
        )
      ]
    };
  }

  const normalizedConfig = normalizeMcpConfig(parsedConfig);

  if (!normalizedConfig.ok) {
    if (normalizedConfig.field === "server" && normalizedConfig.invalidServerNames) {
      return {
        serverCount: 0,
        findings: normalizedConfig.invalidServerNames.map((serverName) =>
          buildFinding(
            "fail",
            "mcp.server.invalid",
            `The MCP server \`${serverName}\` must be configured as an object.`,
            "MCP clients cannot interpret a server entry unless it is represented as an object with server options.",
            `Change the \`${serverName}\` entry in \`${configPath}\` to an object.`,
            { configPath, serverName, field: "server" }
          )
        )
      };
    }

    return {
      serverCount: 0,
      findings: [
        buildFinding(
          "fail",
          "mcp.config.invalid_shape",
          "The MCP config must contain a valid MCP server map.",
          "Without server entries, MCP clients cannot discover any package capabilities.",
          `Use a direct server map, \`mcp_servers\`, or \`mcpServers\` in \`${configPath}\`.`,
          { configPath, field: normalizedConfig.field }
        )
      ]
    };
  }

  const servers = normalizedConfig.servers;

  const findings: Finding[] = [];

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    const command = serverConfig.command;
    const url = serverConfig.url;

    if (typeof command !== "string" && typeof url !== "string") {
      findings.push(
        buildFinding(
          "fail",
          "mcp.server.transport.missing",
          `The MCP server \`${serverName}\` must define either \`command\` or \`url\`.`,
          "MCP clients need a process command for stdio servers or a URL for remote servers.",
          `Add either \`command\` or \`url\` to the \`${serverName}\` entry in \`${configPath}\`.`,
          { configPath, serverName, field: "transport" }
        )
      );
    }

    if (typeof command === "string" && typeof url === "string") {
      findings.push(
        buildFinding(
          "fail",
          "mcp.server.transport.conflict",
          `The MCP server \`${serverName}\` must not define both \`command\` and \`url\`.`,
          "A server with two transports cannot be selected deterministically by MCP clients.",
          `Keep either \`command\` or \`url\` for the \`${serverName}\` entry in \`${configPath}\`.`,
          { configPath, serverName, field: "transport" }
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
  findings: Finding[],
  security: SecurityAudit
): "pass" | "warn" | "fail" {
  if (findings.some((finding) => finding.severity === "fail") || security.status === "fail") {
    return "fail";
  }

  if (findings.some((finding) => finding.severity === "warn") || security.status === "warn") {
    return "warn";
  }

  return "pass";
}

export async function buildGenericMcpDoctor(
  targetPath: string,
  environment: CompatibilityEnvironment = {},
  options: GenericMcpDoctorOptions = {}
): Promise<GenericMcpDoctorReport> {
  const rootPath = path.resolve(targetPath);
  const compatibility = await buildCompatibilityMatrix(rootPath, environment);
  const mcpConfigPath = await readMcpConfigPath(rootPath);
  const canonicalRootPath = await realpath(rootPath).catch(() => null);
  const canonicalMcpConfigPath = mcpConfigPath
    ? await realpath(mcpConfigPath).catch(() => null)
    : null;
  let parsedConfig: unknown = null;
  let staticFindings: Finding[] = [];
  let serverCount = 0;

  if (!mcpConfigPath || !(await fileExists(mcpConfigPath))) {
    staticFindings = buildStaticMcpFindings(null, null).findings;
  } else if (
    !canonicalRootPath ||
    !canonicalMcpConfigPath ||
    !isPathWithinRoot(canonicalRootPath, canonicalMcpConfigPath)
  ) {
    staticFindings = [
      buildFinding(
        "fail",
        "mcp.config.path_outside_root",
        "The MCP config path resolves outside the target root.",
        "A package that reads MCP configuration outside its root is harder to audit and can depend on unreviewed local files.",
        "Keep `.mcp.json` or the manifest `mcpServers` reference inside the package root.",
        {
          configPath: path.relative(rootPath, mcpConfigPath).replaceAll("\\", "/"),
          resolvedPath: canonicalMcpConfigPath ?? mcpConfigPath,
          field: "configPath"
        }
      )
    ];
  } else {
    try {
      parsedConfig = await readJsonFile<unknown>(mcpConfigPath);
      const staticResult = buildStaticMcpFindings(
        path.relative(rootPath, mcpConfigPath).replaceAll("\\", "/"),
        parsedConfig
      );
      staticFindings = staticResult.findings;
      serverCount = staticResult.serverCount;
    } catch {
      staticFindings = [
        buildFinding(
          "fail",
          "mcp.config.invalid_json",
          "The MCP config is not valid JSON.",
          "MCP clients cannot parse server configuration until the JSON syntax is valid.",
          `Fix the JSON syntax in \`${mcpConfigPath}\`.`,
          {
            configPath: path.relative(rootPath, mcpConfigPath).replaceAll("\\", "/"),
            field: "json"
          }
        )
      ];
    }
  }

  const security = buildSecurityAuditFromFindings(
    rootPath,
    mcpConfigPath && parsedConfig !== null
      ? auditMcpServerConfig(rootPath, parsedConfig, { configPath: mcpConfigPath })
      : []
  );
  const runtimeResult =
    options.runtime &&
    mcpConfigPath !== null &&
    parsedConfig !== null &&
    canonicalRootPath !== null &&
    canonicalMcpConfigPath !== null &&
    isPathWithinRoot(canonicalRootPath, canonicalMcpConfigPath) &&
    !staticFindings.some((finding) => finding.severity === "fail") &&
    security.status !== "fail"
        ? await probeRuntimeConfig(canonicalRootPath, canonicalMcpConfigPath, {
          startupTimeoutMs: options.runtimeStartupTimeoutMs,
          allowNetwork: options.allowNetwork,
          allowLocalNetwork: options.allowLocalNetwork,
          allowSessionLifecycle: options.allowSessionLifecycle
        })
      : null;
  const fingerprintedFindings = withFindingFingerprints(
    [...staticFindings, ...(runtimeResult?.findings ?? [])],
    rootPath
  );
  const status = options.requireRemoteReliability === true && !remoteReliabilityGatePassed(runtimeResult?.scorecard)
    ? "fail"
    : mergeReportStatus(fingerprintedFindings, security);

  return {
    targetPath: rootPath,
    status,
    exitCode: status === "fail" ? 1 : 0,
    mcpConfigPath,
    serverCount,
    findings: [...fingerprintedFindings, ...security.findings],
    security,
    compatibility,
    ...(runtimeResult ? { runtimeScorecard: runtimeResult.scorecard } : {}),
    ...(runtimeResult?.execution ? { runtimeExecution: runtimeResult.execution } : {})
  };
}

export function renderGenericMcpDoctorJson(report: GenericMcpDoctorReport): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      kind: "doctor.mcp.healthcheck",
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

  if (report.runtimeScorecard?.conformance) {
    lines.push(
      `Runtime conformance: ${report.runtimeScorecard.conformance.overall.toUpperCase()}`
    );
  }

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

      const fingerprint = formatFindingFingerprintLine(finding);

      if (fingerprint) {
        lines.push(`  Fingerprint: ${fingerprint}`);
      }
    }
  };

  appendFindings("Failures", failures, "x");
  appendFindings("Warnings", warnings, "!");

  return lines.join("\n");
}
