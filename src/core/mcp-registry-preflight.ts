import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildMcpRegistryReadiness,
  type McpRegistryFinding
} from "./mcp-registry.js";
import {
  requestBoundedHttp,
  type BoundedHttpRequestOptions,
  type BoundedHttpResponse
} from "./bounded-http-client.js";

export type McpRegistryPublicationPreflightStatus = "pass" | "warn" | "fail";
type RegistryRequest = (
  url: string,
  options?: BoundedHttpRequestOptions
) => Promise<BoundedHttpResponse>;
const SERVER_NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const VERSION_RANGE_PATTERN = /^(?:latest|[~^]|[<>]=?)|(?:\s+\|\|\s+)|(?:^|[.\s])[x*](?:$|[.\s])/i;
const OFFICIAL_SCHEMA_PATTERN = /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/;
const NPM_IDENTIFIER_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/;
const INTEGRITY_PATTERN = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]*={0,2})$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NPM_REGISTRY = "https://registry.npmjs.org";
const MCP_REGISTRY = "https://registry.modelcontextprotocol.io";
const REQUEST_OPTIONS: BoundedHttpRequestOptions = {
  method: "GET",
  headers: {
    accept: "application/json",
    "user-agent": "codex-plugin-doctor"
  }
};

export interface McpRegistryPublicationPreflightFinding {
  id: string;
  severity: "warn" | "fail";
  message: string;
}

export interface McpRegistryPublicationPreflightReport {
  schemaVersion: "1.0.0";
  kind: "mcp-registry-publication-preflight";
  generatedAt: string;
  target: "server.json";
  serverName?: string;
  serverVersion?: string;
  status: McpRegistryPublicationPreflightStatus;
  localReadiness: McpRegistryPublicationPreflightStatus;
  packagePublication: "pass" | "fail" | "skipped" | "unknown";
  registryVersionAvailability: "available-first-publication" | "available-new-version" | "already-published" | "unknown";
  publisherPlan: {
    executable: false;
    steps: Array<{
      order: number;
      command: "mcp-publisher login github" | "mcp-publisher publish";
      purpose: string;
    }>;
  };
  findings: McpRegistryPublicationPreflightFinding[];
}

export interface BuildMcpRegistryPublicationPreflightOptions {
  allowNetwork?: boolean;
  request?: RegistryRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicFinding(finding: McpRegistryFinding): McpRegistryPublicationPreflightFinding {
  return {
    id: finding.id,
    severity: finding.severity,
    message: finding.message
  };
}

function statusFromFindings(findings: McpRegistryPublicationPreflightFinding[]): McpRegistryPublicationPreflightStatus {
  if (findings.some((finding) => finding.severity === "fail")) {
    return "fail";
  }
  return findings.some((finding) => finding.severity === "warn") ? "warn" : "pass";
}

function isSafeServerName(value: string | undefined): value is string {
  return value !== undefined && value.length >= 3 && value.length <= 200 && SERVER_NAME_PATTERN.test(value);
}

function isSafeServerVersion(value: string | undefined): value is string {
  return value !== undefined && value.length >= 1 && value.length <= 255
    && !/[\\/\u0000-\u001F\u007F]/.test(value) && !VERSION_RANGE_PATTERN.test(value);
}

function isSafeNpmIdentifier(value: unknown): value is string {
  return typeof value === "string" && NPM_IDENTIFIER_PATTERN.test(value);
}

function isIntegrity(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = INTEGRITY_PATTERN.exec(value);
  if (!match || match[2].length % 4 !== 0) {
    return false;
  }
  const digest = Buffer.from(match[2], "base64");
  const expectedBytes = match[1] === "sha256" ? 32 : match[1] === "sha384" ? 48 : 64;
  return digest.length === expectedBytes && digest.toString("base64") === match[2];
}

function responseJson(response: BoundedHttpResponse): unknown | null {
  try {
    return JSON.parse(response.body.toString("utf8"));
  } catch {
    return null;
  }
}

function validNotFound(response: BoundedHttpResponse): boolean {
  const payload = responseJson(response);
  return response.statusCode === 404
    && isRecord(payload)
    && typeof payload.error === "string"
    && payload.error.trim().length > 0;
}

function hasValidHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value.replace(/\{[^{}]+\}/g, "template-value"));
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function hasValidPackageShape(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.registryType !== "string" || value.registryType.length === 0
    || typeof value.identifier !== "string" || value.identifier.length === 0
    || !isRecord(value.transport)
    || !["stdio", "streamable-http", "sse"].includes(value.transport.type as string)) {
    return false;
  }
  if (/^https?:\/\//i.test(value.identifier) && !hasValidHttpUrl(value.identifier)) {
    return false;
  }
  if (typeof value.version === "string" && VERSION_RANGE_PATTERN.test(value.version)) {
    return false;
  }
  return value.registryType !== "mcpb" || (typeof value.fileSha256 === "string" && SHA256_PATTERN.test(value.fileSha256));
}

function hasValidRemoteShape(value: unknown): boolean {
  return isRecord(value)
    && (value.type === "streamable-http" || value.type === "sse")
    && hasValidHttpUrl(value.url);
}

function hasValidRegistryServerShape(server: Record<string, unknown>): boolean {
  return typeof server.$schema === "string"
    && OFFICIAL_SCHEMA_PATTERN.test(server.$schema)
    && isSafeServerName(typeof server.name === "string" ? server.name : undefined)
    && isSafeServerVersion(typeof server.version === "string" ? server.version : undefined)
    && typeof server.description === "string"
    && server.description.length >= 1
    && server.description.length <= 100
    && (server.packages === undefined || (Array.isArray(server.packages) && server.packages.every(hasValidPackageShape)))
    && (server.remotes === undefined || (Array.isArray(server.remotes) && server.remotes.every(hasValidRemoteShape)));
}

function matchingRegistryServer(
  response: BoundedHttpResponse,
  serverName: string,
  serverVersion?: string
): boolean {
  const payload = responseJson(response);
  if (response.statusCode !== 200 || !isRecord(payload) || !isRecord(payload.server)) {
    return false;
  }

  const server = payload.server;
  return hasValidRegistryServerShape(server)
    && server.name === serverName
    && (serverVersion === undefined || server.version === serverVersion);
}

function matchingNpmPackument(
  response: BoundedHttpResponse,
  packageName: string,
  packageVersion: string,
  serverName: string
): boolean {
  const payload = responseJson(response);
  if (response.statusCode !== 200 || !isRecord(payload) || payload.name !== packageName || !isRecord(payload.versions)) {
    return false;
  }

  const version = payload.versions[packageVersion];
  return isRecord(version)
    && version.name === packageName
    && version.version === packageVersion
    && version.mcpName === serverName
    && isRecord(version.dist)
    && isIntegrity(version.dist.integrity);
}

function addFinding(
  findings: McpRegistryPublicationPreflightFinding[],
  id: string,
  message: string
): void {
  findings.push({ id, severity: "fail", message });
}

async function resolveServerJsonPath(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  try {
    return (await stat(resolved)).isDirectory() ? path.join(resolved, "server.json") : resolved;
  } catch {
    return resolved.endsWith(".json") ? resolved : path.join(resolved, "server.json");
  }
}

async function readJson(pathname: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(pathname, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function npmDeclarations(server: Record<string, unknown> | null): Array<Record<string, unknown>> {
  return Array.isArray(server?.packages)
    ? server.packages.filter((entry): entry is Record<string, unknown> =>
      isRecord(entry) && entry.registryType === "npm")
    : [];
}

function publisherPlan(): McpRegistryPublicationPreflightReport["publisherPlan"] {
  return {
    executable: false,
    steps: [
      {
        order: 1,
        command: "mcp-publisher login github",
        purpose: "Authenticate with GitHub for Registry publication."
      },
      {
        order: 2,
        command: "mcp-publisher publish",
        purpose: "Publish the validated Registry metadata."
      }
    ]
  };
}

export async function buildMcpRegistryPublicationPreflight(
  targetPath: string,
  options: BuildMcpRegistryPublicationPreflightOptions = {}
): Promise<McpRegistryPublicationPreflightReport> {
  void options;

  const readiness = await buildMcpRegistryReadiness(targetPath);
  const findings = readiness.findings.map(publicFinding);
  const serverJsonPath = await resolveServerJsonPath(targetPath);
  const server = await readJson(serverJsonPath);
  const declarations = npmDeclarations(server);
  const packageJson = await readJson(path.join(path.dirname(serverJsonPath), "package.json"));

  if (declarations.length > 1) {
    findings.push({
      id: "registry.preflight.package.multiple-npm-declarations",
      severity: "fail",
      message: "Publication evidence supports exactly one npm package declaration."
    });
  } else if (declarations.length === 1
    && typeof declarations[0].identifier === "string"
    && packageJson
    && packageJson.name !== declarations[0].identifier) {
    findings.push({
      id: "registry.preflight.package.local-name-mismatch",
      severity: "fail",
      message: "package.json name must match the declared npm package identifier."
    });
  }

  if (declarations.length === 1 && !isSafeNpmIdentifier(declarations[0].identifier)) {
    findings.push({
      id: "registry.preflight.package.invalid-npm-identifier",
      severity: "fail",
      message: "The declared npm package identifier is not valid for public registry verification."
    });
  }

  const localReadiness = statusFromFindings(findings);
  let packagePublication: McpRegistryPublicationPreflightReport["packagePublication"] = declarations.length === 0
    ? "skipped"
    : localReadiness === "fail" ? "fail" : "unknown";
  let registryVersionAvailability: McpRegistryPublicationPreflightReport["registryVersionAvailability"] = "unknown";
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  const serverName = isSafeServerName(readiness.serverName) ? readiness.serverName : undefined;
  const serverVersion = isSafeServerVersion(readiness.serverVersion) ? readiness.serverVersion : undefined;
  const packageName = isSafeNpmIdentifier(declaration?.identifier) ? declaration.identifier : undefined;
  const declarationVersion = typeof declaration?.version === "string" ? declaration.version : undefined;
  const packageVersion = isSafeServerVersion(declarationVersion)
    ? declarationVersion
    : undefined;
  const canVerifyNetwork = options.allowNetwork === true
    && localReadiness === "pass"
    && declaration !== undefined
    && serverName !== undefined
    && serverVersion !== undefined
    && packageName !== undefined
    && packageVersion !== undefined;

  if (!canVerifyNetwork && localReadiness !== "fail") {
    findings.push({
      id: "registry.preflight.network-unverified",
      severity: "warn",
      message: "Package publication and Registry version availability require explicit network verification."
    });
  }

  if (canVerifyNetwork && packageName && packageVersion && serverName && serverVersion) {
    const request = options.request ?? requestBoundedHttp;
    let npmResponse: BoundedHttpResponse;
    try {
      npmResponse = await request(`${NPM_REGISTRY}/${encodeURIComponent(packageName)}`, REQUEST_OPTIONS);
    } catch {
      addFinding(findings, "registry.preflight.npm.request", "Public npm metadata could not be verified.");
      packagePublication = "unknown";
      return buildReport(readiness, localReadiness, packagePublication, registryVersionAvailability, findings);
    }

    if (npmResponse.statusCode !== 200 && npmResponse.statusCode !== 404) {
      addFinding(findings, "registry.preflight.npm.response", "Public npm metadata could not prove package publication.");
      packagePublication = "unknown";
      return buildReport(readiness, localReadiness, packagePublication, registryVersionAvailability, findings);
    }

    if (!matchingNpmPackument(npmResponse, packageName, packageVersion, serverName)) {
      addFinding(findings, "registry.preflight.npm.metadata", "Published npm metadata does not match the declared package version.");
      packagePublication = "fail";
      return buildReport(readiness, localReadiness, packagePublication, registryVersionAvailability, findings);
    }
    packagePublication = "pass";

    let exactResponse: BoundedHttpResponse;
    try {
      exactResponse = await request(
        `${MCP_REGISTRY}/v0.1/servers/${encodeURIComponent(serverName)}/versions/${encodeURIComponent(serverVersion)}`,
        REQUEST_OPTIONS
      );
    } catch {
      addFinding(findings, "registry.preflight.registry.exact-request", "Exact Registry version availability could not be verified.");
      return buildReport(readiness, localReadiness, packagePublication, registryVersionAvailability, findings);
    }

    if (matchingRegistryServer(exactResponse, serverName, serverVersion)) {
      registryVersionAvailability = "already-published";
      addFinding(findings, "registry.preflight.registry.already-published", "The exact Registry version is already published and cannot be overwritten.");
    } else if (validNotFound(exactResponse)) {
      let latestResponse: BoundedHttpResponse;
      try {
        latestResponse = await request(
          `${MCP_REGISTRY}/v0.1/servers/${encodeURIComponent(serverName)}/versions/latest`,
          REQUEST_OPTIONS
        );
      } catch {
        addFinding(findings, "registry.preflight.registry.latest-request", "Latest Registry version availability could not be verified.");
        return buildReport(readiness, localReadiness, packagePublication, registryVersionAvailability, findings);
      }

      if (validNotFound(latestResponse)) {
        registryVersionAvailability = "available-first-publication";
      } else if (matchingRegistryServer(latestResponse, serverName) && responseJson(latestResponse) !== null) {
        const payload = responseJson(latestResponse) as Record<string, unknown>;
        const latestVersion = (payload.server as Record<string, unknown>).version;
        if (latestVersion !== serverVersion) {
          registryVersionAvailability = "available-new-version";
        } else {
          addFinding(findings, "registry.preflight.registry.latest-response", "Latest Registry metadata did not prove a different published version.");
        }
      } else {
        addFinding(findings, "registry.preflight.registry.latest-response", "Latest Registry metadata could not prove version availability.");
      }
    } else {
      addFinding(findings, "registry.preflight.registry.exact-response", "Exact Registry metadata could not prove version availability.");
    }
  }

  return buildReport(readiness, localReadiness, packagePublication, registryVersionAvailability, findings);
}

function buildReport(
  readiness: Awaited<ReturnType<typeof buildMcpRegistryReadiness>>,
  localReadiness: McpRegistryPublicationPreflightStatus,
  packagePublication: McpRegistryPublicationPreflightReport["packagePublication"],
  registryVersionAvailability: McpRegistryPublicationPreflightReport["registryVersionAvailability"],
  findings: McpRegistryPublicationPreflightFinding[]
): McpRegistryPublicationPreflightReport {
  return {
    schemaVersion: "1.0.0",
    kind: "mcp-registry-publication-preflight",
    generatedAt: new Date().toISOString(),
    target: "server.json",
    ...(isSafeServerName(readiness.serverName) ? { serverName: readiness.serverName } : {}),
    ...(isSafeServerVersion(readiness.serverVersion) ? { serverVersion: readiness.serverVersion } : {}),
    status: statusFromFindings(findings),
    localReadiness,
    packagePublication,
    registryVersionAvailability,
    publisherPlan: publisherPlan(),
    findings
  };
}

export function renderMcpRegistryPublicationPreflightJson(
  report: McpRegistryPublicationPreflightReport
): string {
  return JSON.stringify(report, null, 2);
}

export function renderMcpRegistryPublicationPreflight(
  report: McpRegistryPublicationPreflightReport
): string {
  const networkVerification = report.findings.some((finding) => finding.id === "registry.preflight.network-unverified")
    ? "NOT REQUESTED"
    : report.packagePublication === "pass" && report.registryVersionAvailability !== "unknown"
      ? "COMPLETED"
      : report.localReadiness === "fail"
      ? "NOT AVAILABLE"
      : "INCOMPLETE";
  const lines = [
    `Registry publication preflight: ${report.status.toUpperCase()}`,
    `Target: ${report.target}`,
    report.serverName ? `Server: ${report.serverName}@${report.serverVersion ?? "unknown"}` : null,
    `Local readiness: ${report.localReadiness.toUpperCase()}`,
    `Package publication: ${report.packagePublication.toUpperCase()}`,
    `Registry version availability: ${report.registryVersionAvailability.toUpperCase()}`,
    `Network verification: ${networkVerification}`
  ].filter((line): line is string => line !== null);

  if (report.findings.length > 0) {
    lines.push("", "Findings", "--------");
    for (const finding of report.findings) {
      lines.push(`${finding.severity.toUpperCase()} ${finding.id}: ${finding.message}`);
    }
  }
  return lines.join("\n");
}

export function registryPublicationPreflightExitCode(
  report: McpRegistryPublicationPreflightReport,
  requirePublishReady = false
): 0 | 1 {
  return report.status === "fail" || (requirePublishReady && report.status !== "pass") ? 1 : 0;
}
