import { createHash } from "node:crypto";
import path from "node:path";

import { packageVersion } from "../version.js";
import { discoverPackage } from "./discover-package.js";
import { readJsonFile } from "./read-json-file.js";
import {
  buildSecurityAudit,
  type SecurityAudit
} from "../security/security-audit.js";
import type { Finding } from "../domain/types.js";

type RuntimePlanStatus = "pass" | "warn" | "fail";
type RuntimePlanRiskLevel = "low" | "medium" | "high";
type RuntimePlanTransport = "stdio" | "http";

export interface RuntimePlanServer {
  name: string;
  transport: RuntimePlanTransport;
  command: string | null;
  args: string[];
  cwd: string | null;
  url: string | null;
  probeMethods: string[];
  riskLevel: RuntimePlanRiskLevel;
  riskReasons: string[];
}

export interface DoctorRuntimePlan {
  schemaVersion: "1.0.0";
  kind: "doctor.runtime.plan";
  generatedAt: string;
  version: string;
  targetPath: string;
  status: RuntimePlanStatus;
  exitCode: 0 | 1;
  runtimeExecution: "not_started";
  digest: string;
  summary: {
    serverCount: number;
    executableServerCount: number;
    highRiskServerCount: number;
    findings: SecurityAudit["findingCounts"];
  };
  servers: RuntimePlanServer[];
  findings: Finding[];
}

export interface RuntimeApprovalReport {
  required: boolean;
  status: "approved" | "missing" | "mismatch" | "not_required";
  planDigest: string;
  approvedDigest: string | null;
  message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeCwd(rootPath: string, cwd: unknown): string | null {
  if (typeof cwd !== "string") {
    return ".";
  }

  const resolvedCwd = path.resolve(rootPath, cwd);
  const relativeCwd = path.relative(rootPath, resolvedCwd).replace(/\\/g, "/");

  return relativeCwd.length === 0 ? "." : relativeCwd;
}

function buildRisk(
  serverName: string,
  serverConfig: Record<string, unknown>,
  findings: Finding[]
): { riskLevel: RuntimePlanRiskLevel; riskReasons: string[] } {
  const matchingFindings = findings.filter((finding) =>
    finding.message.includes(`\`${serverName}\``)
  );
  const riskReasons = matchingFindings.map((finding) => finding.id);
  const hasFail = matchingFindings.some((finding) => finding.severity === "fail");
  const hasWarn = matchingFindings.some((finding) => finding.severity === "warn");

  if (typeof serverConfig.command === "string") {
    riskReasons.push("runtime.executes_local_command");
  }

  if (typeof serverConfig.url === "string") {
    riskReasons.push("runtime.connects_remote_server");
  }

  return {
    riskLevel: hasFail ? "high" : hasWarn ? "medium" : "low",
    riskReasons: [...new Set(riskReasons)]
  };
}

function planDigestPayload(plan: Omit<DoctorRuntimePlan, "generatedAt" | "digest">): unknown {
  return {
    schemaVersion: plan.schemaVersion,
    kind: "doctor.runtime.plan.digest.v1",
    version: plan.version,
    status: plan.status,
    summary: plan.summary,
    servers: plan.servers,
    findings: plan.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      message: finding.message
    }))
  };
}

function buildRuntimePlanDigest(
  plan: Omit<DoctorRuntimePlan, "generatedAt" | "digest">
): string {
  return sha256(stableStringify(planDigestPayload(plan)));
}

export async function buildDoctorRuntimePlan(
  targetPath: string,
  generatedAt = new Date().toISOString()
): Promise<DoctorRuntimePlan> {
  const rootPath = path.resolve(targetPath);
  const discoveredPackage = await discoverPackage(rootPath);
  const security = await buildSecurityAudit(rootPath);

  if (!discoveredPackage?.manifest.mcpServers) {
    const partialPlan = {
      schemaVersion: "1.0.0" as const,
      kind: "doctor.runtime.plan" as const,
      version: packageVersion,
      targetPath: rootPath,
      status: security.status,
      exitCode: (security.status === "fail" ? 1 : 0) as 0 | 1,
      runtimeExecution: "not_started" as const,
      summary: {
        serverCount: 0,
        executableServerCount: 0,
        highRiskServerCount: 0,
        findings: security.findingCounts
      },
      servers: [],
      findings: security.findings
    };

    return {
      ...partialPlan,
      generatedAt,
      digest: buildRuntimePlanDigest(partialPlan)
    };
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = await readJsonFile<unknown>(
      path.resolve(discoveredPackage.rootPath, discoveredPackage.manifest.mcpServers)
    );
  } catch {
    parsedConfig = {};
  }

  const serverEntries = isPlainObject(parsedConfig) && isPlainObject(parsedConfig.mcpServers)
    ? Object.entries(parsedConfig.mcpServers)
    : [];
  const servers = serverEntries
    .filter((entry): entry is [string, Record<string, unknown>] => isPlainObject(entry[1]))
    .map(([serverName, serverConfig]) => {
      const command = typeof serverConfig.command === "string" ? serverConfig.command : null;
      const url = typeof serverConfig.url === "string" ? serverConfig.url : null;
      const { riskLevel, riskReasons } = buildRisk(serverName, serverConfig, security.findings);

      return {
        name: serverName,
        transport: command ? "stdio" as const : "http" as const,
        command,
        args: Array.isArray(serverConfig.args)
          ? serverConfig.args.filter((arg): arg is string => typeof arg === "string")
          : [],
        cwd: command ? normalizeCwd(discoveredPackage.rootPath, serverConfig.cwd) : null,
        url,
        probeMethods: command
          ? [
              "initialize",
              "tools/list",
              "tools/call:safe-only",
              "resources/list",
              "resources/read:first-resource-only",
              "resources/templates/list",
              "prompts/list",
              "prompts/get:first-prompt-only"
            ]
          : [],
        riskLevel,
        riskReasons
      };
    });
  const highRiskServerCount = servers.filter((server) => server.riskLevel === "high").length;
  const partialPlan = {
    schemaVersion: "1.0.0" as const,
    kind: "doctor.runtime.plan" as const,
    version: packageVersion,
    targetPath: discoveredPackage.rootPath,
    status: highRiskServerCount > 0
      ? "fail" as const
      : security.status === "warn"
        ? "warn" as const
        : "pass" as const,
    exitCode: (highRiskServerCount > 0 ? 1 : 0) as 0 | 1,
    runtimeExecution: "not_started" as const,
    summary: {
      serverCount: servers.length,
      executableServerCount: servers.filter((server) => server.command).length,
      highRiskServerCount,
      findings: security.findingCounts
    },
    servers,
    findings: security.findings
  };

  return {
    ...partialPlan,
    generatedAt,
    digest: buildRuntimePlanDigest(partialPlan)
  };
}

export function evaluateRuntimeApproval(
  plan: DoctorRuntimePlan,
  options: {
    required: boolean;
    approvedDigest?: string | null;
  }
): RuntimeApprovalReport {
  if (!options.required) {
    return {
      required: false,
      status: "not_required",
      planDigest: plan.digest,
      approvedDigest: options.approvedDigest ?? null,
      message: "Runtime approval was not required for this run."
    };
  }

  if (!options.approvedDigest) {
    return {
      required: true,
      status: "missing",
      planDigest: plan.digest,
      approvedDigest: null,
      message: "Runtime approval was required, but no approved plan digest was provided."
    };
  }

  if (options.approvedDigest !== plan.digest) {
    return {
      required: true,
      status: "mismatch",
      planDigest: plan.digest,
      approvedDigest: options.approvedDigest,
      message: "Runtime approval digest does not match the current runtime plan."
    };
  }

  return {
    required: true,
    status: "approved",
    planDigest: plan.digest,
    approvedDigest: options.approvedDigest,
    message: "Runtime approval digest matches the current runtime plan."
  };
}

export function runtimeApprovalPassed(approval: RuntimeApprovalReport): boolean {
  return approval.status === "approved" || approval.status === "not_required";
}

export function renderDoctorRuntimePlanJson(plan: DoctorRuntimePlan): string {
  return JSON.stringify(plan, null, 2);
}

function markdownList(items: string[], emptyValue: string): string {
  if (items.length === 0) {
    return `- ${emptyValue}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderDoctorRuntimePlanMarkdown(plan: DoctorRuntimePlan): string {
  const lines = [
    "# Doctor Runtime Review Plan",
    "",
    "This artifact records the intended MCP runtime probe boundary before any package-local server is started.",
    "",
    "## Summary",
    "",
    `- Target: \`${plan.targetPath}\``,
    `- Status: **${plan.status.toUpperCase()}**`,
    `- Runtime execution: \`${plan.runtimeExecution}\``,
    `- Approval digest: \`${plan.digest}\``,
    `- Servers: ${plan.summary.serverCount}`,
    `- Executable servers: ${plan.summary.executableServerCount}`,
    `- High-risk servers: ${plan.summary.highRiskServerCount}`,
    `- Findings: ${plan.summary.findings.fail} fail, ${plan.summary.findings.warn} warn, ${plan.summary.findings.total} total`,
    "",
    "## Execution Boundary",
    "",
    "- This plan is non-executing.",
    "- Runtime probes require explicit operator approval before local MCP servers are started.",
    "- The approval digest changes when command, args, cwd, probe methods, risk reasons, or findings change.",
    "- Runtime approval is a review gate, not an OS, VM, or container sandbox.",
    "",
    "## Review Checklist",
    "",
    "- Confirm every command, argument, and working directory is expected.",
    "- Confirm remote URLs and network expectations are acceptable for the task.",
    "- Confirm high-risk findings are resolved or intentionally accepted before runtime probing.",
    "- Use the approval digest with `check --runtime --require-runtime-approval --runtime-approval-digest <digest>`.",
    "- Preserve this artifact with release evidence when runtime execution is part of the release gate."
  ];

  if (plan.servers.length === 0) {
    lines.push("", "## Servers", "", "No MCP runtime servers found.");
  } else {
    lines.push(
      "",
      "## Servers",
      "",
      "| Risk | Name | Transport | Command or URL | Cwd |",
      "| --- | --- | --- | --- | --- |"
    );

    for (const server of plan.servers) {
      lines.push(
        `| ${server.riskLevel.toUpperCase()} | ${markdownEscape(server.name)} | ${server.transport} | ${markdownEscape(server.command ?? server.url ?? "not executable by runtime probe")} | ${markdownEscape(server.cwd ?? "n/a")} |`
      );
    }

    for (const server of plan.servers) {
      lines.push(
        "",
        `### ${server.name}`,
        "",
        "**Probe methods**",
        "",
        markdownList(server.probeMethods, "none"),
        "",
        "**Risk reasons**",
        "",
        markdownList(server.riskReasons, "none")
      );
    }
  }

  if (plan.findings.length > 0) {
    lines.push("", "## Findings", "");

    for (const finding of plan.findings) {
      lines.push(
        `- **${finding.severity.toUpperCase()}** \`${finding.id}\`: ${finding.message}`
      );
    }
  }

  return lines.join("\n");
}

export function renderDoctorRuntimePlan(plan: DoctorRuntimePlan): string {
  const lines = [
    "Doctor Runtime Plan",
    "===================",
    `Target: ${plan.targetPath}`,
    `Status: ${plan.status.toUpperCase()}`,
    `Runtime execution: ${plan.runtimeExecution}`,
    `Digest: ${plan.digest}`,
    `Servers: ${plan.summary.serverCount}`,
    `Executable servers: ${plan.summary.executableServerCount}`,
    `High-risk servers: ${plan.summary.highRiskServerCount}`
  ];

  if (plan.servers.length === 0) {
    lines.push("", "No MCP runtime servers found.");
    return lines.join("\n");
  }

  lines.push("", "Servers", "-------");

  for (const server of plan.servers) {
    lines.push(`${server.riskLevel.toUpperCase()} ${server.name}`);
    lines.push(`  Transport: ${server.transport}`);
    lines.push(`  Command: ${server.command ?? server.url ?? "not executable by runtime probe"}`);
    lines.push(`  Cwd: ${server.cwd ?? "n/a"}`);
    lines.push(`  Probes: ${server.probeMethods.length > 0 ? server.probeMethods.join(", ") : "none"}`);
    lines.push(`  Risk reasons: ${server.riskReasons.length > 0 ? server.riskReasons.join(", ") : "none"}`);
  }

  return lines.join("\n");
}
