import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { discoverPackage } from "../core/discover-package.js";
import { readJsonFile } from "../core/read-json-file.js";
import { validatePlugin } from "../core/validate-plugin.js";
import type { DiscoveredPackage, Finding, FindingEvidence } from "../domain/types.js";
import {
  formatFindingFingerprintLine,
  withFindingFingerprints
} from "../reporting/finding-fingerprint.js";
import { formatFindingEvidenceLine } from "../reporting/format-finding-evidence.js";

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

function relativePackagePath(rootPath: string, targetPath: string): string {
  return path.relative(rootPath, targetPath).replace(/\\/g, "/") || ".";
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

const pathLikeArgFlags = new Set([
  "--config",
  "--config-path",
  "--cwd",
  "--dir",
  "--directory",
  "--file",
  "--import",
  "--loader",
  "--path",
  "--project",
  "--require",
  "--root",
  "--script",
  "--tsconfig",
  "--workspace"
]);

const codeLoadingEnvKeys = new Set([
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES"
]);

const modulePathEnvKeys = new Set([
  "NODE_PATH",
  "PYTHONPATH",
  "RUBYLIB"
]);

function looksLikeEnvReference(value: string): boolean {
  return /^\$\{?[A-Z0-9_]+\}?$/i.test(value.trim());
}

function looksLikePathValue(value: string): boolean {
  const trimmed = value.trim();

  return (
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.startsWith(".") ||
    trimmed.startsWith("~") ||
    path.isAbsolute(trimmed)
  );
}

function isEscapingPathValue(rootPath: string, value: string): boolean {
  const trimmed = value.trim();

  if (
    !trimmed ||
    looksLikeEnvReference(trimmed) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ||
    !looksLikePathValue(trimmed)
  ) {
    return false;
  }

  return !isPathWithinRoot(rootPath, path.resolve(rootPath, trimmed));
}

function collectEscapingPathArgs(
  rootPath: string,
  args: unknown
): Array<{ flag: string; value: string; resolvedPath: string }> {
  if (!Array.isArray(args)) {
    return [];
  }

  const stringArgs = args.filter((arg): arg is string => typeof arg === "string");
  const findings: Array<{ flag: string; value: string; resolvedPath: string }> = [];

  for (let index = 0; index < stringArgs.length; index += 1) {
    const arg = stringArgs[index];
    const equalsIndex = arg.indexOf("=");

    if (equalsIndex > 0) {
      const flag = arg.slice(0, equalsIndex).toLowerCase();
      const value = arg.slice(equalsIndex + 1);

      if (pathLikeArgFlags.has(flag) && isEscapingPathValue(rootPath, value)) {
        findings.push({ flag, value, resolvedPath: path.resolve(rootPath, value) });
      }

      continue;
    }

    const flag = arg.toLowerCase();
    const value = stringArgs[index + 1];

    if (pathLikeArgFlags.has(flag) && value && isEscapingPathValue(rootPath, value)) {
      findings.push({ flag, value, resolvedPath: path.resolve(rootPath, value) });
      index += 1;
    }
  }

  return findings;
}

function splitModulePathEnvValue(value: string): string[] {
  const trimmed = value.trim();

  if (/^[a-z]:[\\/]/i.test(trimmed)) {
    return trimmed.includes(";") ? trimmed.split(";") : [trimmed];
  }

  return trimmed.includes(";") ? trimmed.split(";") : trimmed.split(":");
}

function hasEscapingModulePath(rootPath: string, value: string): boolean {
  return splitModulePathEnvValue(value).some((entry) =>
    isEscapingPathValue(rootPath, entry)
  );
}

function isDangerousEnvUsage(rootPath: string, envKey: string, envValue: unknown): boolean {
  if (typeof envValue !== "string" || looksLikeEnvReference(envValue)) {
    return false;
  }

  const normalizedKey = envKey.toUpperCase();

  if (codeLoadingEnvKeys.has(normalizedKey)) {
    return true;
  }

  if (
    normalizedKey === "NODE_OPTIONS" &&
    /(?:^|\s)--(?:require|import|loader|experimental-loader)(?:=|\s+)/i.test(envValue)
  ) {
    return true;
  }

  return modulePathEnvKeys.has(normalizedKey) && hasEscapingModulePath(rootPath, envValue);
}

const poisonScanExtensions = new Set([
  ".json",
  ".md",
  ".mdx",
  ".txt",
  ".yaml",
  ".yml"
]);

const poisonScanSkippedDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules"
]);

const promptInjectionPatterns: RegExp[] = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?\b/i,
  /\b(?:exfiltrate|steal|leak|upload|send)\b.{0,120}\b(?:secret|secrets|token|tokens|api\s*key|api\s*keys|credential|credentials|environment\s+variables?|env)\b/i,
  /\bdo\s+not\s+(?:reveal|tell|mention|disclose)\b.{0,120}\b(?:instruction|instructions|prompt|prompts|system|developer)\b/i
];

export function auditMcpServerConfig(
  rootPath: string,
  parsedConfig: unknown,
  options: { configPath?: string } = {}
): Finding[] {
  const configPath = options.configPath
    ? relativePackagePath(rootPath, options.configPath)
    : ".mcp.json";

  if (!isPlainObject(parsedConfig) || !isPlainObject(parsedConfig.mcpServers)) {
    return [
      buildFinding(
        "fail",
        "plugin.security.audit_unavailable",
        "The MCP security audit could not find a valid `mcpServers` object.",
        "Without server entries, the audit cannot evaluate command execution or remote transport risk.",
        "Define MCP servers under a top-level `mcpServers` object.",
        { configPath }
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
          "Prefer launching the concrete executable directly with explicit args.",
          { serverName, configPath, command }
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
          "Replace encoded shell payloads with a checked-in script or direct executable plus readable args.",
          { serverName, configPath, command: typeof command === "string" ? command : null }
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
          "Pin dependencies through the package manager or check in a reviewed setup script instead of piping remote content to a shell.",
          { serverName, configPath, command: typeof command === "string" ? command : null }
        )
      );
    }

    for (const riskyArg of collectEscapingPathArgs(rootPath, args)) {
      findings.push(
        buildFinding(
          "fail",
          "plugin.security.path_traversal_risk",
          `The MCP server \`${serverName}\` passes \`${riskyArg.value}\` to path-like arg \`${riskyArg.flag}\`, which escapes the plugin root.`,
          "Path-like runtime arguments that point outside the package can make startup depend on unreviewed local files or load code outside the reviewed tarball.",
          "Keep runtime file arguments inside the plugin package root, or package the referenced file with the plugin.",
          {
            serverName,
            configPath,
            argFlag: riskyArg.flag,
            argValue: riskyArg.value,
            resolvedPath: riskyArg.resolvedPath
          }
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
            "Keep MCP server `cwd` inside the plugin package root or remove it.",
            {
              serverName,
              configPath,
              cwd,
              resolvedPath: cwdPath
            }
          )
        );
      }
    }

    if (isPlainObject(serverConfig.env)) {
      for (const [envKey, envValue] of Object.entries(serverConfig.env)) {
        if (!isDangerousEnvUsage(rootPath, envKey, envValue)) {
          continue;
        }

        findings.push(
          buildFinding(
            "fail",
            "plugin.security.dangerous_env_usage",
            `The MCP server \`${serverName}\` sets dangerous code-loading env variable \`${envKey}\`.`,
            "Environment variables that alter module lookup, preload native libraries, or inject runtime imports can execute code outside the reviewed package.",
            "Remove code-loading environment overrides, or keep referenced modules and preload files inside the reviewed plugin package.",
            {
              serverName,
              configPath,
              envKey,
              envValue: typeof envValue === "string" ? envValue : null
            }
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
          "Use HTTPS for remote MCP servers; reserve HTTP for explicit localhost development endpoints.",
          { serverName, configPath, url }
        )
      );
    }

    if (typeof url === "string" && /\/\/0\.0\.0\.0[:/]/i.test(url)) {
      findings.push(
        buildFinding(
          "warn",
          "plugin.security.mcp_binds_all_interfaces",
          `The MCP server \`${serverName}\` URL binds to \`0.0.0.0\`.`,
          "Servers that listen on all interfaces can accept connections from external hosts, which is rarely intended for local MCP development.",
          "Use `127.0.0.1` or `localhost` instead of `0.0.0.0` unless external access is explicitly required.",
          { serverName, configPath, url }
        )
      );
    }
  }

  return findings;
}

async function collectPromptPoisoningScanFiles(
  rootPath: string,
  currentPath = rootPath
): Promise<string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (poisonScanSkippedDirectories.has(entry.name)) {
        continue;
      }

      filePaths.push(...(await collectPromptPoisoningScanFiles(rootPath, entryPath)));
      continue;
    }

    if (!entry.isFile() || !poisonScanExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const details = await stat(entryPath);

    if (details.size <= 256 * 1024) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

function containsPromptInjectionText(content: string): boolean {
  return promptInjectionPatterns.some((pattern) => pattern.test(content));
}

async function auditPromptPoisoningSurface(rootPath: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const filePath of await collectPromptPoisoningScanFiles(rootPath)) {
    const content = await readFile(filePath, "utf8");

    if (!containsPromptInjectionText(content)) {
      continue;
    }

    const relativeFilePath = path.relative(rootPath, filePath).replace(/\\/g, "/");

    findings.push(
      buildFinding(
        "fail",
        "plugin.security.prompt_injection_text",
        `The packaged text file \`${relativeFilePath}\` contains prompt-injection or secret-exfiltration style instructions.`,
        "Malicious or poisoned tool, prompt, resource, or skill text can instruct an agent to ignore higher-priority instructions or leak secrets when loaded into context.",
        "Remove hidden override or exfiltration instructions, then keep tool/prompt/resource descriptions scoped to the legitimate user-facing behavior.",
        { filePath: relativeFilePath }
      )
    );
  }

  return findings;
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
        "Fix the `.mcp.json` syntax, then rerun `codex-plugin-doctor security <path>`.",
        { configPath: relativePackagePath(rootPath, mcpConfigPath) }
      )
    ];
  }

  return auditMcpServerConfig(rootPath, parsedConfig, { configPath: mcpConfigPath });
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

export function buildSecurityAuditFromFindings(
  targetPath: string,
  findings: Finding[]
): SecurityAudit {
  const rootPath = path.resolve(targetPath);
  const fingerprintedFindings = withFindingFingerprints(
    dedupeFindings(findings),
    rootPath
  );
  const findingCounts = buildFindingCounts(fingerprintedFindings);
  const status = findingCounts.fail > 0
    ? "fail"
    : findingCounts.warn > 0
      ? "warn"
      : "pass";

  return {
    targetPath: rootPath,
    status,
    score: scoreSecurityAudit(findingCounts),
    findingCounts,
    findings: fingerprintedFindings
  };
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
        "Run the audit against a Codex plugin package root.",
        { manifestPath: ".codex-plugin/plugin.json" }
      )
    ];
    return buildSecurityAuditFromFindings(targetPath, findings);
  }

  const validationResult = await validatePlugin(discoveredPackage.rootPath);
  const validationSecurityFindings = validationResult.findings.filter((finding) =>
    finding.id.startsWith("plugin.security.")
  );
  const findings = [
    ...validationSecurityFindings,
    ...(await auditMcpCommandSurface(discoveredPackage)),
    ...(await auditPromptPoisoningSurface(discoveredPackage.rootPath))
  ];

  return buildSecurityAuditFromFindings(discoveredPackage.rootPath, findings);
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

      const fingerprint = formatFindingFingerprintLine(finding);

      if (fingerprint) {
        lines.push(`  Fingerprint: ${fingerprint}`);
      }

      const evidence = formatFindingEvidenceLine(finding);

      if (evidence) {
        lines.push(`  Evidence: ${evidence}`);
      }
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
