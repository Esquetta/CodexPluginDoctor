import path from "node:path";

import { discoverPackage } from "../core/discover-package.js";
import { readJsonFile } from "../core/read-json-file.js";
import { validatePlugin } from "../core/validate-plugin.js";
import type { DiscoveredPackage, Finding } from "../domain/types.js";

export interface SecurityAudit {
  targetPath: string;
  status: "pass" | "warn" | "fail";
  score: number;
  findingCounts: {
    fail: number;
    warn: number;
    total: number;
  };
  findings: Finding[];
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

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function normalizeCommandName(command: string): string {
  return path.basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
}

function isShellWrapperCommand(command: string): boolean {
  return new Set(["cmd", "powershell", "pwsh", "bash", "sh"]).has(
    normalizeCommandName(command)
  );
}

function containsEncodedCommandFlag(args: unknown): boolean {
  return Array.isArray(args) && args.some((arg) =>
    typeof arg === "string" && /^[-/]enc(odedcommand)?$/i.test(arg)
  );
}

function containsPipeInstaller(args: unknown): boolean {
  if (!Array.isArray(args)) {
    return false;
  }

  const joinedArgs = args
    .filter((arg): arg is string => typeof arg === "string")
    .join(" ")
    .toLowerCase();

  return (
    /\b(curl|wget)\b[^|]*\|\s*(sh|bash)\b/.test(joinedArgs) ||
    /\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*\|\s*(iex|invoke-expression)\b/.test(joinedArgs) ||
    /\binvoke-expression\b/.test(joinedArgs)
  );
}

async function auditMcpCommandSurface(
  discoveredPackage: DiscoveredPackage
): Promise<Finding[]> {
  const { manifest, rootPath } = discoveredPackage;

  if (!manifest.mcpServers) {
    return [];
  }

  const mcpConfigPath = path.resolve(rootPath, manifest.mcpServers);

  if (!isPathWithinRoot(rootPath, mcpConfigPath)) {
    return [];
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = await readJsonFile<unknown>(mcpConfigPath);
  } catch {
    return [
      buildFinding(
        "fail",
        "plugin.security.audit_unavailable",
        "The MCP security audit could not parse the referenced MCP config.",
        "Unreadable MCP configuration prevents review of server commands, URLs, and working directories before install.",
        "Fix the `.mcp.json` syntax, then rerun `codex-plugin-doctor security <path>`."
      )
    ];
  }

  if (!isPlainObject(parsedConfig) || !isPlainObject(parsedConfig.mcpServers)) {
    return [
      buildFinding(
        "fail",
        "plugin.security.audit_unavailable",
        "The MCP security audit could not find a valid `mcpServers` object.",
        "Without server entries, the audit cannot evaluate command execution or remote transport risk.",
        "Define MCP servers under a top-level `mcpServers` object."
      )
    ];
  }

  const findings: Finding[] = [];

  for (const [serverName, serverConfig] of Object.entries(parsedConfig.mcpServers)) {
    if (!isPlainObject(serverConfig)) {
      continue;
    }

    const command = serverConfig.command;
    const args = serverConfig.args;
    const cwd = serverConfig.cwd;
    const url = serverConfig.url;

    if (typeof command === "string" && isShellWrapperCommand(command)) {
      findings.push(
        buildFinding(
          "warn",
          "plugin.security.command_shell_wrapper",
          `The MCP server \`${serverName}\` starts through shell wrapper \`${command}\`.`,
          "Shell wrappers expand quoting, pipes, aliases, and platform-specific behavior, which makes the real execution path harder to audit.",
          "Prefer launching the concrete executable directly with explicit args."
        )
      );
    }

    if (containsEncodedCommandFlag(args)) {
      findings.push(
        buildFinding(
          "fail",
          "plugin.security.encoded_command",
          `The MCP server \`${serverName}\` uses an encoded shell command flag.`,
          "Encoded command payloads hide the executed script from reviewers and increase supply-chain risk.",
          "Replace encoded shell payloads with a checked-in script or direct executable plus readable args."
        )
      );
    }

    if (containsPipeInstaller(args)) {
      findings.push(
        buildFinding(
          "fail",
          "plugin.security.remote_pipe_install",
          `The MCP server \`${serverName}\` appears to pipe remote content into a shell.`,
          "Download-and-execute install patterns can run unreviewed remote code during plugin startup.",
          "Pin dependencies through the package manager or check in a reviewed setup script instead of piping remote content to a shell."
        )
      );
    }

    if (typeof cwd === "string") {
      const cwdPath = path.resolve(rootPath, cwd);

      if (!isPathWithinRoot(rootPath, cwdPath)) {
        findings.push(
          buildFinding(
            "fail",
            "plugin.security.cwd_outside_root",
            `The MCP server \`${serverName}\` sets cwd outside the plugin root.`,
            "A working directory outside the package root can make server startup depend on unreviewed local files.",
            "Keep MCP server `cwd` inside the plugin package root or remove it."
          )
        );
      }
    }

    if (typeof url === "string" && /^http:\/\//i.test(url)) {
      findings.push(
        buildFinding(
          "warn",
          "plugin.security.insecure_http_url",
          `The MCP server \`${serverName}\` uses an insecure HTTP URL.`,
          "Plain HTTP transports can expose MCP traffic on non-local networks and make endpoint identity harder to verify.",
          "Use HTTPS for remote MCP servers; reserve HTTP for explicit localhost development endpoints."
        )
      );
    }
  }

  return findings;
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();

  return findings.filter((finding) => {
    const key = `${finding.id}\n${finding.message}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildFindingCounts(findings: Finding[]): SecurityAudit["findingCounts"] {
  const fail = findings.filter((finding) => finding.severity === "fail").length;
  const warn = findings.filter((finding) => finding.severity === "warn").length;

  return {
    fail,
    warn,
    total: findings.length
  };
}

function scoreSecurityAudit(findingCounts: SecurityAudit["findingCounts"]): number {
  return Math.max(0, 100 - (findingCounts.fail * 35) - (findingCounts.warn * 10));
}

export async function buildSecurityAudit(targetPath: string): Promise<SecurityAudit> {
  const discoveredPackage = await discoverPackage(targetPath);

  if (!discoveredPackage) {
    const findings = [
      buildFinding(
        "fail",
        "plugin.security.audit_unavailable",
        "The target directory is missing `.codex-plugin/plugin.json`, so the package security audit cannot run.",
        "Without a Codex plugin manifest, the audit cannot resolve packaged skills or MCP server configuration safely.",
        "Run the audit against a Codex plugin package root."
      )
    ];
    const findingCounts = buildFindingCounts(findings);

    return {
      targetPath: path.resolve(targetPath),
      status: "fail",
      score: scoreSecurityAudit(findingCounts),
      findingCounts,
      findings
    };
  }

  const validationResult = await validatePlugin(discoveredPackage.rootPath);
  const validationSecurityFindings = validationResult.findings.filter((finding) =>
    finding.id.startsWith("plugin.security.")
  );
  const findings = dedupeFindings([
    ...validationSecurityFindings,
    ...(await auditMcpCommandSurface(discoveredPackage))
  ]);
  const findingCounts = buildFindingCounts(findings);
  const status = findingCounts.fail > 0
    ? "fail"
    : findingCounts.warn > 0
      ? "warn"
      : "pass";

  return {
    targetPath: discoveredPackage.rootPath,
    status,
    score: scoreSecurityAudit(findingCounts),
    findingCounts,
    findings
  };
}

export function renderSecurityAuditJson(audit: SecurityAudit): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      ...audit
    },
    null,
    2
  );
}

export function renderSecurityScorecard(
  audit: SecurityAudit,
  options: { includeFindings?: boolean } = {}
): string {
  const lines = [
    "Security Scorecard",
    "==================",
    `Target: ${audit.targetPath}`,
    `Status: ${audit.status.toUpperCase()}`,
    `Score: ${audit.score}/100`,
    `Summary: ${audit.findingCounts.fail} fail, ${audit.findingCounts.warn} warn, ${audit.findingCounts.total} total`
  ];

  if (audit.findings.length === 0) {
    lines.push("", "No security findings.");
    return lines.join("\n");
  }

  if (options.includeFindings === false) {
    return lines.join("\n");
  }

  const appendSection = (title: string, findings: Finding[], marker: string) => {
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

  appendSection(
    "Failures",
    audit.findings.filter((finding) => finding.severity === "fail"),
    "x"
  );
  appendSection(
    "Warnings",
    audit.findings.filter((finding) => finding.severity === "warn"),
    "!"
  );

  return lines.join("\n");
}
