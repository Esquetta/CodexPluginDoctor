import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { requestBoundedHttp, type BoundedHttpRequestOptions, type BoundedHttpResponse } from "./bounded-http-client.js";

const OFFICIAL_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const OFFICIAL_REGISTRY = "https://registry.modelcontextprotocol.io";
const SERVER_NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_RANGE_PATTERN = /^(?:latest|[~^]|[<>]=?)|(?:\s+\|\|\s+)|(?:^|[.\s])[x*](?:$|[.\s])/i;
const SECRET_NAME_PATTERN = /(?:api[_-]?key|token|secret|password|credential)/i;

type RegistryCheckStatus = "pass" | "warn" | "fail" | "skipped";
type RegistryRequest = (
  url: string,
  options?: BoundedHttpRequestOptions
) => Promise<BoundedHttpResponse>;

export interface McpRegistryFinding {
  id: string;
  severity: "warn" | "fail";
  message: string;
  path?: string;
}

export interface McpRegistryScorecard {
  metadata: RegistryCheckStatus;
  ownership: RegistryCheckStatus;
  packageIntegrity: RegistryCheckStatus;
  transportReadiness: RegistryCheckStatus;
  clientInstallability: RegistryCheckStatus;
  overall: Exclude<RegistryCheckStatus, "skipped">;
}

export interface McpRegistryInstallability {
  codex: "ready" | "manual" | "unavailable";
  packageTypes: string[];
  remoteTransports: string[];
  codexPreview?: {
    mcpServers: Record<string, {
      command?: string;
      args?: string[];
      url?: string;
    }>;
  };
}

export interface McpRegistryReadinessReport {
  schemaVersion: "1";
  kind: "mcp-registry-readiness";
  source: "file" | "registry";
  target: string;
  serverName?: string;
  serverVersion?: string;
  status: "pass" | "warn" | "fail";
  scorecard: McpRegistryScorecard;
  installability: McpRegistryInstallability;
  findings: McpRegistryFinding[];
  registry?: {
    lifecycleStatus: string;
    isLatest?: boolean;
    publishedAt?: string;
  };
}

export interface InspectMcpRegistryOptions {
  allowNetwork?: boolean;
  request?: RegistryRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusFromFindings(findings: McpRegistryFinding[]): "pass" | "warn" | "fail" {
  if (findings.some((finding) => finding.severity === "fail")) {
    return "fail";
  }
  return findings.length > 0 ? "warn" : "pass";
}

function areaStatus(
  findings: McpRegistryFinding[],
  prefix: string,
  fallback: RegistryCheckStatus = "pass"
): RegistryCheckStatus {
  const matches = findings.filter((finding) => finding.id.startsWith(prefix));
  if (matches.some((finding) => finding.severity === "fail")) {
    return "fail";
  }
  return matches.length > 0 ? "warn" : fallback;
}

function addFinding(
  findings: McpRegistryFinding[],
  id: string,
  severity: McpRegistryFinding["severity"],
  message: string,
  findingPath?: string
): void {
  findings.push({
    id,
    severity,
    message,
    ...(findingPath ? { path: findingPath } : {})
  });
}

function parseUrlTemplate(rawValue: unknown): URL | null {
  if (typeof rawValue !== "string" || rawValue.length === 0 || /\s/.test(rawValue)) {
    return null;
  }
  try {
    return new URL(rawValue.replace(/\{[^{}]+\}/g, "template-value"));
  } catch {
    return null;
  }
}

function inspectUrl(
  findings: McpRegistryFinding[],
  rawValue: unknown,
  findingPath: string,
  options: { httpsOnly?: boolean; prefix: string }
): URL | null {
  const parsed = parseUrlTemplate(rawValue);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    addFinding(findings, `${options.prefix}.url-invalid`, "fail", "URL must be an absolute HTTP or HTTPS URL.", findingPath);
    return null;
  }
  if (parsed.username || parsed.password) {
    addFinding(findings, `${options.prefix}.credentials`, "fail", "URL must not contain credentials.", findingPath);
  }
  if (options.httpsOnly && parsed.protocol !== "https:") {
    addFinding(findings, `${options.prefix}.http`, "warn", "Public Registry URLs should use HTTPS.", findingPath);
  }
  return parsed;
}

function inspectInputSecrets(
  findings: McpRegistryFinding[],
  values: unknown,
  findingPath: string
): void {
  if (!Array.isArray(values)) {
    return;
  }
  values.forEach((value, index) => {
    if (!isRecord(value)) {
      return;
    }
    const name = typeof value.name === "string" ? value.name : "";
    if (typeof value.value === "string" && value.value.length > 0
      && (value.isSecret === true || SECRET_NAME_PATTERN.test(name))) {
      addFinding(
        findings,
        "registry.secret.embedded-value",
        "fail",
        "Secret-like Registry inputs must not embed a fixed value.",
        `${findingPath}[${index}].value`
      );
    }
  });
}

function inspectArguments(
  findings: McpRegistryFinding[],
  values: unknown,
  findingPath: string
): void {
  if (!Array.isArray(values)) {
    return;
  }
  values.forEach((value, index) => {
    if (isRecord(value) && typeof value.value === "string" && /[;&|`]/.test(value.value)) {
      addFinding(
        findings,
        "registry.package.argument-shell-risk",
        "warn",
        "Fixed argument contains shell metacharacters; clients must execute without a shell.",
        `${findingPath}[${index}].value`
      );
    }
  });
}

function githubOwnerFromRepository(repository: Record<string, unknown>): string | null {
  if (repository.source !== "github" || typeof repository.url !== "string") {
    return null;
  }
  try {
    const url = new URL(repository.url);
    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function buildInstallability(
  server: Record<string, unknown>,
  validPackages: Array<Record<string, unknown>>,
  validRemotes: Array<Record<string, unknown>>
): McpRegistryInstallability {
  const packageTypes = [...new Set(validPackages
    .map((entry) => typeof entry.registryType === "string" ? entry.registryType : "")
    .filter(Boolean))];
  const remoteTransports = [...new Set(validRemotes
    .map((entry) => typeof entry.type === "string" ? entry.type : "")
    .filter(Boolean))];
  const shortName = typeof server.name === "string"
    ? server.name.split("/").at(-1) ?? "server"
    : "server";

  const remote = validRemotes.find((entry) => {
    const url = parseUrlTemplate(entry.url);
    return url?.protocol === "https:" && typeof entry.url === "string" && !entry.url.includes("{");
  });
  if (remote && typeof remote.url === "string") {
    return {
      codex: "ready",
      packageTypes,
      remoteTransports,
      codexPreview: {
        mcpServers: {
          [shortName]: { url: remote.url }
        }
      }
    };
  }

  const npmPackage = validPackages.find((entry) =>
    entry.registryType === "npm"
    && typeof entry.identifier === "string"
    && typeof entry.version === "string"
    && !VERSION_RANGE_PATTERN.test(entry.version)
    && isRecord(entry.transport)
    && entry.transport.type === "stdio"
  );
  if (npmPackage && typeof npmPackage.identifier === "string" && typeof npmPackage.version === "string") {
    return {
      codex: "ready",
      packageTypes,
      remoteTransports,
      codexPreview: {
        mcpServers: {
          [shortName]: {
            command: "npx",
            args: ["-y", `${npmPackage.identifier}@${npmPackage.version}`]
          }
        }
      }
    };
  }

  return {
    codex: validPackages.length > 0 || validRemotes.length > 0 ? "manual" : "unavailable",
    packageTypes,
    remoteTransports
  };
}

async function readOptionalPackageJson(directory: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveServerJsonPath(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  try {
    return (await stat(resolved)).isDirectory() ? path.join(resolved, "server.json") : resolved;
  } catch {
    return resolved.endsWith(".json") ? resolved : path.join(resolved, "server.json");
  }
}

async function buildReportFromServer(
  server: unknown,
  target: string,
  source: McpRegistryReadinessReport["source"],
  packageJson: Record<string, unknown> | null = null,
  extraFindings: McpRegistryFinding[] = []
): Promise<McpRegistryReadinessReport> {
  const findings = [...extraFindings];
  const validPackages: Array<Record<string, unknown>> = [];
  const validRemotes: Array<Record<string, unknown>> = [];
  let ownershipVerified = false;

  if (!isRecord(server)) {
    addFinding(findings, "registry.metadata.object", "fail", "server.json must contain a JSON object.");
    return finalizeReport({}, target, source, findings, validPackages, validRemotes, ownershipVerified);
  }

  if (server.$schema !== OFFICIAL_SCHEMA) {
    addFinding(
      findings,
      "registry.metadata.schema",
      "fail",
      `server.json must reference the current official schema: ${OFFICIAL_SCHEMA}.`,
      "$schema"
    );
  }
  if (typeof server.name !== "string" || server.name.length < 3
    || server.name.length > 200 || !SERVER_NAME_PATTERN.test(server.name)) {
    addFinding(findings, "registry.metadata.name", "fail", "Server name must use namespace/name format.", "name");
  }
  if (typeof server.description !== "string" || server.description.length < 1 || server.description.length > 100) {
    addFinding(findings, "registry.metadata.description", "fail", "Description must contain 1 to 100 characters.", "description");
  }
  if (typeof server.version !== "string" || server.version.length < 1 || server.version.length > 255
    || VERSION_RANGE_PATTERN.test(server.version)) {
    addFinding(findings, "registry.metadata.version", "fail", "Server version must be a specific version string.", "version");
  }

  if (isRecord(server.repository)) {
    inspectUrl(findings, server.repository.url, "repository.url", {
      httpsOnly: true,
      prefix: "registry.repository"
    });
    if (typeof server.repository.source !== "string" || server.repository.source.length === 0) {
      addFinding(findings, "registry.repository.source", "fail", "Repository source is required when repository metadata is present.", "repository.source");
    }
    if (typeof server.name === "string" && server.name.toLowerCase().startsWith("io.github.")) {
      const namespaceOwner = server.name.slice("io.github.".length).split("/")[0]?.toLowerCase();
      const repositoryOwner = githubOwnerFromRepository(server.repository)?.toLowerCase();
      if (repositoryOwner && namespaceOwner !== repositoryOwner) {
        addFinding(
          findings,
          "registry.ownership.github-mismatch",
          "fail",
          "GitHub repository owner does not match the io.github namespace.",
          "repository.url"
        );
      }
    }
  }

  if (typeof server.websiteUrl === "string") {
    inspectUrl(findings, server.websiteUrl, "websiteUrl", {
      httpsOnly: true,
      prefix: "registry.website"
    });
  }
  if (Array.isArray(server.icons)) {
    server.icons.forEach((icon, index) => {
      if (!isRecord(icon)) {
        addFinding(findings, "registry.icon.invalid", "fail", "Icon entry must be an object.", `icons[${index}]`);
        return;
      }
      inspectUrl(findings, icon.src, `icons[${index}].src`, {
        httpsOnly: true,
        prefix: "registry.icon"
      });
    });
  }

  if (server.packages !== undefined && !Array.isArray(server.packages)) {
    addFinding(findings, "registry.package.array", "fail", "Packages must be an array.", "packages");
  } else if (Array.isArray(server.packages)) {
    server.packages.forEach((entry, index) => {
      const packagePath = `packages[${index}]`;
      if (!isRecord(entry)) {
        addFinding(findings, "registry.package.invalid", "fail", "Package entry must be an object.", packagePath);
        return;
      }
      const type = entry.registryType;
      if (typeof type !== "string" || type.length === 0) {
        addFinding(findings, "registry.package.type", "fail", "Package registryType is required.", `${packagePath}.registryType`);
      }
      if (typeof entry.identifier !== "string" || entry.identifier.length === 0) {
        addFinding(findings, "registry.package.identifier", "fail", "Package identifier is required.", `${packagePath}.identifier`);
      } else if (/^https?:\/\//i.test(entry.identifier)) {
        inspectUrl(findings, entry.identifier, `${packagePath}.identifier`, {
          httpsOnly: true,
          prefix: "registry.package"
        });
      }
      if (!isRecord(entry.transport) || typeof entry.transport.type !== "string"
        || !["stdio", "streamable-http", "sse"].includes(entry.transport.type)) {
        addFinding(findings, "registry.package.transport", "fail", "Package transport must be stdio, streamable-http, or sse.", `${packagePath}.transport`);
      }
      if (typeof entry.version === "string" && VERSION_RANGE_PATTERN.test(entry.version)) {
        addFinding(findings, "registry.package.version-range", "fail", "Package version must be exact, not a range or latest.", `${packagePath}.version`);
      }
      if (type === "mcpb" && (typeof entry.fileSha256 !== "string" || !SHA256_PATTERN.test(entry.fileSha256))) {
        addFinding(findings, "registry.package.mcpb-hash-missing", "fail", "MCPB packages require a lowercase SHA-256 digest.", `${packagePath}.fileSha256`);
      }
      inspectInputSecrets(findings, entry.environmentVariables, `${packagePath}.environmentVariables`);
      inspectArguments(findings, entry.packageArguments, `${packagePath}.packageArguments`);
      inspectArguments(findings, entry.runtimeArguments, `${packagePath}.runtimeArguments`);
      validPackages.push(entry);
    });
  }

  if (server.remotes !== undefined && !Array.isArray(server.remotes)) {
    addFinding(findings, "registry.remote.array", "fail", "Remotes must be an array.", "remotes");
  } else if (Array.isArray(server.remotes)) {
    server.remotes.forEach((entry, index) => {
      const remotePath = `remotes[${index}]`;
      if (!isRecord(entry)) {
        addFinding(findings, "registry.remote.invalid", "fail", "Remote entry must be an object.", remotePath);
        return;
      }
      if (entry.type !== "streamable-http" && entry.type !== "sse") {
        addFinding(findings, "registry.remote.transport", "fail", "Remote transport must be streamable-http or sse.", `${remotePath}.type`);
      }
      inspectUrl(findings, entry.url, `${remotePath}.url`, {
        httpsOnly: true,
        prefix: "registry.remote"
      });
      inspectInputSecrets(findings, entry.headers, `${remotePath}.headers`);
      validRemotes.push(entry);
    });
  }

  if (validPackages.length === 0 && validRemotes.length === 0) {
    addFinding(
      findings,
      "registry.installability.missing",
      "warn",
      "Metadata is valid, but no package or remote installation channel is declared."
    );
  }

  if (packageJson && typeof server.name === "string") {
    const npmPackages = validPackages.filter((entry) => entry.registryType === "npm");
    for (const entry of npmPackages) {
      if (packageJson.name === entry.identifier) {
        if (packageJson.mcpName !== server.name) {
          addFinding(findings, "registry.ownership.npm-mcp-name", "fail", "package.json mcpName must match server.json name.", "package.json#mcpName");
        } else {
          ownershipVerified = true;
        }
        if (typeof entry.version === "string" && packageJson.version !== entry.version) {
          addFinding(findings, "registry.package.local-version-mismatch", "fail", "Local npm package version does not match server.json.", "package.json#version");
        }
      }
    }
  } else if (validPackages.some((entry) => entry.registryType === "npm")) {
    addFinding(
      findings,
      "registry.ownership.npm-unverified",
      "warn",
      "No adjacent package.json was available to verify npm mcpName ownership."
    );
  }

  return finalizeReport(server, target, source, findings, validPackages, validRemotes, ownershipVerified);
}

function finalizeReport(
  server: Record<string, unknown>,
  target: string,
  source: McpRegistryReadinessReport["source"],
  findings: McpRegistryFinding[],
  validPackages: Array<Record<string, unknown>>,
  validRemotes: Array<Record<string, unknown>>,
  ownershipVerified = false
): McpRegistryReadinessReport {
  const status = statusFromFindings(findings);
  const hasTransport = validPackages.length > 0 || validRemotes.length > 0;
  const installability = buildInstallability(server, validPackages, validRemotes);
  return {
    schemaVersion: "1",
    kind: "mcp-registry-readiness",
    source,
    target,
    ...(typeof server.name === "string" ? { serverName: server.name } : {}),
    ...(typeof server.version === "string" ? { serverVersion: server.version } : {}),
    status,
    scorecard: {
      metadata: areaStatus(findings, "registry.metadata."),
      ownership: areaStatus(findings, "registry.ownership.", ownershipVerified ? "pass" : "skipped"),
      packageIntegrity: validPackages.length > 0
        ? areaStatus(findings, "registry.package.")
        : "skipped",
      transportReadiness: hasTransport
        ? (areaStatus(findings, "registry.remote.") === "fail"
          || areaStatus(findings, "registry.package.") === "fail" ? "fail" : "pass")
        : "skipped",
      clientInstallability: installability.codex === "ready"
        ? "pass"
        : installability.codex === "manual" ? "warn" : "skipped",
      overall: status
    },
    installability,
    findings
  };
}

export async function buildMcpRegistryReadiness(targetPath: string): Promise<McpRegistryReadinessReport> {
  const serverJsonPath = await resolveServerJsonPath(targetPath);
  let server: unknown;
  try {
    server = JSON.parse(await readFile(serverJsonPath, "utf8"));
  } catch {
    return buildReportFromServer({}, serverJsonPath, "file", null, [{
      id: "registry.metadata.read",
      severity: "fail",
      message: "Unable to read a valid server.json file.",
      path: serverJsonPath
    }]);
  }
  const packageJson = await readOptionalPackageJson(path.dirname(serverJsonPath));
  return buildReportFromServer(server, serverJsonPath, "file", packageJson);
}

export async function inspectMcpRegistryServer(
  serverName: string,
  options: InspectMcpRegistryOptions = {}
): Promise<McpRegistryReadinessReport> {
  if (!options.allowNetwork) {
    throw new Error("Registry inspection requires explicit --allow-network consent.");
  }
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error("Registry server name must use namespace/name format.");
  }

  const url = `${OFFICIAL_REGISTRY}/v0.1/servers/${encodeURIComponent(serverName)}/versions/latest`;
  const response = await (options.request ?? requestBoundedHttp)(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": "codex-plugin-doctor"
    }
  });
  const findings: McpRegistryFinding[] = [];
  if (response.statusCode !== 200) {
    addFinding(findings, "registry.lookup.http", "fail", `Registry lookup returned HTTP ${response.statusCode}.`);
    return buildReportFromServer({}, serverName, "registry", null, findings);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body.toString("utf8"));
  } catch {
    addFinding(findings, "registry.lookup.json", "fail", "Registry returned invalid JSON.");
    return buildReportFromServer({}, serverName, "registry", null, findings);
  }
  if (!isRecord(payload) || !isRecord(payload.server)) {
    addFinding(findings, "registry.lookup.response", "fail", "Registry response is missing server metadata.");
    return buildReportFromServer({}, serverName, "registry", null, findings);
  }
  if (payload.server.name !== serverName) {
    addFinding(findings, "registry.lookup.name-mismatch", "fail", "Registry response server name does not match the requested exact name.");
  }

  const report = await buildReportFromServer(payload.server, serverName, "registry", null, findings);
  const officialMeta = isRecord(payload._meta)
    && isRecord(payload._meta["io.modelcontextprotocol.registry/official"])
    ? payload._meta["io.modelcontextprotocol.registry/official"]
    : null;
  const lifecycleStatus = officialMeta && typeof officialMeta.status === "string"
    ? officialMeta.status
    : "unknown";

  if (lifecycleStatus === "deprecated") {
    addFinding(report.findings, "registry.lookup.deprecated", "warn", "Registry entry is deprecated.");
  } else if (lifecycleStatus !== "active") {
    addFinding(report.findings, "registry.lookup.lifecycle", "fail", "Registry entry is not active.");
  }
  report.registry = {
    lifecycleStatus,
    ...(officialMeta && typeof officialMeta.isLatest === "boolean" ? { isLatest: officialMeta.isLatest } : {}),
    ...(officialMeta && typeof officialMeta.publishedAt === "string" ? { publishedAt: officialMeta.publishedAt } : {})
  };
  report.status = statusFromFindings(report.findings);
  report.scorecard.overall = report.status;
  return report;
}

export function registryReadinessExitCode(
  report: McpRegistryReadinessReport,
  requireReadiness = false
): 0 | 1 {
  return report.status === "fail" || (requireReadiness && report.status !== "pass") ? 1 : 0;
}

export function renderMcpRegistryReadinessJson(report: McpRegistryReadinessReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderMcpRegistryReadiness(report: McpRegistryReadinessReport): string {
  const lines = [
    `Registry readiness: ${report.status.toUpperCase()}`,
    `Source: ${report.source}`,
    `Target: ${report.target}`,
    report.serverName ? `Server: ${report.serverName}@${report.serverVersion ?? "unknown"}` : null,
    "",
    "Scorecard",
    "---------",
    `Metadata: ${report.scorecard.metadata}`,
    `Ownership: ${report.scorecard.ownership}`,
    `Package integrity: ${report.scorecard.packageIntegrity}`,
    `Transport readiness: ${report.scorecard.transportReadiness}`,
    `Codex installability: ${report.scorecard.clientInstallability}`,
    `Overall: ${report.scorecard.overall}`,
    "",
    `Codex: ${report.installability.codex}`
  ].filter((line): line is string => line !== null);

  if (report.findings.length > 0) {
    lines.push("", "Findings", "--------");
    for (const finding of report.findings) {
      lines.push(`${finding.severity.toUpperCase()} ${finding.id}: ${finding.message}${finding.path ? ` (${finding.path})` : ""}`);
    }
  }
  return lines.join("\n");
}
