import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { discoverPackage } from "../core/discover-package.js";
import { normalizeMcpConfig } from "../core/mcp-config-normalizer.js";
import { readJsonFile } from "../core/read-json-file.js";
import { inspectRemoteMcpUrl } from "../core/remote-url-policy.js";
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

function remoteUrlIssueFindingId(issue: string): string {
  return issue === "insecure_non_loopback"
    ? "plugin.security.insecure_http_url"
    : `plugin.security.remote_mcp_url.${issue}`;
}

function remoteUrlIssueMessage(issue: string): string {
  return issue === "insecure_non_loopback"
    ? "uses an insecure public HTTP URL"
    : `uses a remote MCP URL with ${issue.replaceAll("_", " ")}`;
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

function relativeSourcePath(rootPath: string, sourcePath: string): string {
  return relativePackagePath(rootPath, path.resolve(rootPath, sourcePath));
}

export function auditHookCommand(
  rootPath: string,
  sourcePath: string,
  event: string,
  field: string,
  command: string
): Finding[] {
  const evidence = { sourcePath: relativeSourcePath(rootPath, sourcePath), event, field };
  const findings: Finding[] = [];

  if (/(?:^|\s)[/-]enc(?:odedcommand)?(?=\s|$)/i.test(command)) {
    findings.push(buildFinding(
      "fail",
      "plugin.security.encoded_command",
      "A plugin lifecycle hook uses an encoded shell command flag.",
      "Encoded command payloads hide the executed script from reviewers and increase supply-chain risk.",
      "Replace encoded shell payloads with a checked-in script or readable direct command.",
      evidence
    ));
  }

  if (containsHookRemotePipeInstaller(command)) {
    findings.push(buildFinding(
      "fail",
      "plugin.security.remote_pipe_install",
      "A plugin lifecycle hook appears to pipe remote content into a shell.",
      "Download-and-execute patterns can run unreviewed remote code when a host invokes the hook.",
      "Pin dependencies through the package manager or use a reviewed local script instead of piping remote content to a shell.",
      evidence
    ));
  }

  if (/^\s*(?:cmd(?:\.exe)?\s+\/c|(?:powershell|pwsh)(?:\.exe)?\s+-(?:command|c)\b)/i.test(command)) {
    findings.push(buildFinding(
      "warn",
      "plugin.security.command_shell_wrapper",
      "A plugin lifecycle hook starts through a shell wrapper.",
      "Shell wrappers expand quoting, pipes, aliases, and platform-specific behavior, which makes the execution path harder to audit.",
      "Prefer a concrete executable or checked-in script with explicit arguments.",
      evidence
    ));
  }

  return findings;
}

function containsHookRemotePipeInstaller(command: string): boolean {
  const firstPipeIndex = command.indexOf("|");
  if (firstPipeIndex === -1) return false;

  const leftHandSide = command.slice(0, firstPipeIndex);
  const rightHandSide = command.slice(firstPipeIndex + 1).trim();
  const interpreter = /^(?:\/(?:[^/\s|]+\/)*(?:sh|bash)\b|(?:sh|bash)\b|(?:powershell|pwsh)(?:\.exe)?\s+-(?:command|c)\s+-\s*(?:$|[;&|])|(?:iex|invoke-expression)\b)/i;

  return isInvokedHookDownloader(leftHandSide) && interpreter.test(rightHandSide);
}

function isInvokedHookDownloader(command: string): boolean {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  let wrapperCount = 0;

  while (index < tokens.length && wrapperCount < 4) {
    const token = tokens[index].toLowerCase();

    if (token === "env") {
      wrapperCount += 1;
      index += 1;

      while (index < tokens.length) {
        const envToken = tokens[index];

        if (envToken === "--") {
          index += 1;
          break;
        }

        if (envToken === "-i" || envToken === "--ignore-environment") {
          index += 1;
          continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(envToken)) {
          index += 1;
          continue;
        }

        break;
      }
      continue;
    }

    if (token === "command") {
      wrapperCount += 1;
      index += 1;

      if (tokens[index] === "-p" || tokens[index]?.toLowerCase() === "--default-search-path") {
        index += 1;
      }
      if (tokens[index] === "--") {
        index += 1;
      }
      continue;
    }

    break;
  }

  const downloader = normalizeCommandName(tokens[index] ?? "");

  if (new Set(["curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"]).has(downloader)) {
    return true;
  }

  const shell = normalizeCommandName(tokens[index] ?? "");

  return (
    (shell === "powershell" || shell === "pwsh") &&
    /^-(?:command|c)$/i.test(tokens[index + 1] ?? "") &&
    new Set(["curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"])
      .has(normalizeCommandName(tokens[index + 2] ?? ""))
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
  "node_modules",
  "release-candidate",
  "tests"
]);

const promptInjectionPatterns: RegExp[] = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?\b/i,
  /\b(?:exfiltrate|steal|leak|upload|send)\b.{0,120}\b(?:secret|secrets|token|tokens|api\s*key|api\s*keys|credential|credentials|environment\s+variables?|env)\b/i,
  /\bdo\s+not\s+(?:reveal|tell|mention|disclose)\b.{0,120}\b(?:instruction|instructions|prompt|prompts|system|developer)\b/i
];

const childProcessScanExtensions = new Set([
  ".cjs",
  ".js",
  ".mjs",
  ".ts",
  ".tsx"
]);

function importsChildProcess(content: string): boolean {
  return (
    /\bfrom\s+["']node:child_process["']/.test(content) ||
    /\bfrom\s+["']child_process["']/.test(content) ||
    /\brequire\(\s*["'](?:node:)?child_process["']\s*\)/.test(content)
  );
}

function sourceUsesShellOption(content: string): boolean {
  return /\bshell\s*:\s*(?:true|process\.platform\s*===\s*["']win32["'])/.test(content);
}

function sourceUsesShellCommand(content: string): boolean {
  return (
    /["']cmd(?:\.exe)?["'][\s\S]{0,200}["']\/c["']/i.test(content) ||
    /["'](?:powershell|pwsh)(?:\.exe)?["'][\s\S]{0,200}["']-(?:command|encodedcommand|enc)["']/i.test(content)
  );
}

export function auditMcpServerConfig(
  rootPath: string,
  parsedConfig: unknown,
  options: { configPath?: string } = {}
): Finding[] {
  const configPath = options.configPath
    ? relativePackagePath(rootPath, options.configPath)
    : ".mcp.json";

  const normalizedConfig = normalizeMcpConfig(parsedConfig);

  if (!normalizedConfig.ok) {
    return [
      buildFinding(
        "fail",
        "plugin.security.audit_unavailable",
        "The MCP security audit could not find a valid MCP server map.",
        "Without server entries, the audit cannot evaluate command execution or remote transport risk.",
        "Use a direct server map, `mcp_servers`, or `mcpServers`.",
        { configPath }
      )
    ];
  }

  const findings: Finding[] = [];

  for (const [serverName, serverConfig] of Object.entries(normalizedConfig.servers)) {

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

    if (typeof url === "string") {
      const inspection = inspectRemoteMcpUrl(url);

      for (const issue of inspection.issues) {
        findings.push(
          buildFinding(
            "fail",
            remoteUrlIssueFindingId(issue),
            `The MCP server \`${serverName}\` ${remoteUrlIssueMessage(issue)}.`,
            "Unsafe or ambiguous remote transport configuration can expose credentials or prevent reliable MCP connectivity.",
            "Use an absolute HTTPS URL without credentials, query parameters, fragments, or numeric IP literals; HTTP is only supported for localhost development.",
            {
              serverName,
              configPath,
              url: inspection.sanitizedUrl
            }
          )
        );
      }

      if (inspection.parsedUrl?.hostname === "0.0.0.0") {
        findings.push(
          buildFinding(
            "warn",
            "plugin.security.mcp_binds_all_interfaces",
            `The MCP server \`${serverName}\` URL binds to \`0.0.0.0\`.`,
            "Servers that listen on all interfaces can accept connections from external hosts, which is rarely intended for local MCP development.",
            "Use `127.0.0.1` or `localhost` instead of `0.0.0.0` unless external access is explicitly required.",
            {
              serverName,
              configPath,
              url: inspection.sanitizedUrl
            }
          )
        );
      }
    }
  }

  return findings;
}

const externalUrlPattern = /https?:\/\/[^\s`"'<>)]+/gi;

async function auditSkillExternalReferences(
  rootPath: string,
  mcpConfigPath: string | null
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const filePath of await collectPromptPoisoningScanFiles(rootPath)) {
    if (mcpConfigPath !== null && path.resolve(filePath) === mcpConfigPath) {
      continue;
    }
    const content = await readFile(filePath, "utf8");
    const matches = content.match(externalUrlPattern);

    if (!matches) {
      continue;
    }

    const uniqueUrls = [...new Set(matches)];
    const relativeFilePath = path.relative(rootPath, filePath).replace(/\\/g, "/");

    for (const url of uniqueUrls.slice(0, 5)) {
      findings.push(
        buildFinding(
          "warn",
          "plugin.skill.external_http_reference",
          `The packaged text file \`${relativeFilePath}\` references external URL \`${url}\`.`,
          "External URLs in skill instructions can lead to link rot, phishing risk, or unauthorized telemetry when an agent follows them.",
          "Replace the external URL with a local reference, or document the link only in the plugin README where reviewers can see it.",
          { filePath: relativeFilePath, url }
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

async function collectChildProcessScanFiles(
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

      filePaths.push(...(await collectChildProcessScanFiles(rootPath, entryPath)));
      continue;
    }

    if (!entry.isFile() || !childProcessScanExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const details = await stat(entryPath);

    if (details.size <= 512 * 1024) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

export async function auditChildProcessSourceSurface(rootPath: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const filePath of await collectChildProcessScanFiles(rootPath)) {
    const content = await readFile(filePath, "utf8");

    if (!importsChildProcess(content)) {
      continue;
    }

    const relativeFilePath = relativePackagePath(rootPath, filePath);

    if (sourceUsesShellOption(content)) {
      findings.push(
        buildFinding(
          "fail",
          "plugin.security.child_process_shell",
          `The source file \`${relativeFilePath}\` enables child_process shell execution.`,
          "Shell execution expands command strings through a platform shell, which can turn quoting bugs or user-controlled args into command injection.",
          "Use `spawn` or `execFile` with an explicit executable and argument array instead of enabling `shell`.",
          { filePath: relativeFilePath }
        )
      );
    }

    if (sourceUsesShellCommand(content)) {
      findings.push(
        buildFinding(
          "fail",
          "plugin.security.child_process_shell_command",
          `The source file \`${relativeFilePath}\` appears to launch a shell command wrapper.`,
          "Explicit shell wrappers such as `cmd /c` or `powershell -Command` make command execution harder to audit and increase injection risk.",
          "Launch the concrete executable directly, or use platform-specific executable names such as `npm.cmd` on Windows.",
          { filePath: relativeFilePath }
        )
      );
    }
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
    const hookLocation = finding.evidence?.sourcePath && finding.evidence.event && finding.evidence.field
      ? `${finding.evidence.sourcePath}\n${finding.evidence.event}\n${finding.evidence.field}`
      : "";
    const key = `${finding.id}\n${finding.message}\n${hookLocation}`;

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
    ...(await auditChildProcessSourceSurface(discoveredPackage.rootPath)),
    ...(await auditPromptPoisoningSurface(discoveredPackage.rootPath)),
    ...(await auditSkillExternalReferences(
      discoveredPackage.rootPath,
      discoveredPackage.manifest.mcpServers
        ? path.resolve(discoveredPackage.rootPath, discoveredPackage.manifest.mcpServers)
        : null
    ))
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
