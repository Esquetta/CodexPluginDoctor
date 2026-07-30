import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildMcpRegistryReadiness,
  type McpRegistryFinding
} from "./mcp-registry.js";
import type { BoundedHttpRequestOptions, BoundedHttpResponse } from "./bounded-http-client.js";

type PreflightStatus = "pass" | "warn" | "fail";
type RegistryRequest = (
  url: string,
  options?: BoundedHttpRequestOptions
) => Promise<BoundedHttpResponse>;

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
  status: PreflightStatus;
  localReadiness: PreflightStatus;
  packagePublication: "pass" | "fail" | "skipped" | "unknown";
  registryVersionAvailability: "available-first-publication" | "available-new-version" | "already-published" | "unknown";
  publisherPlan: {
    executable: false;
    steps: Array<{
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

function statusFromFindings(findings: McpRegistryPublicationPreflightFinding[]): PreflightStatus {
  if (findings.some((finding) => finding.severity === "fail")) {
    return "fail";
  }
  return findings.some((finding) => finding.severity === "warn") ? "warn" : "pass";
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
        command: "mcp-publisher login github",
        purpose: "Authenticate with GitHub for Registry publication."
      },
      {
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

  const localReadiness = statusFromFindings(findings);
  const packagePublication = declarations.length === 0
    ? "skipped"
    : localReadiness === "fail" ? "fail" : "unknown";
  const registryVersionAvailability = "unknown" as const;

  if (localReadiness !== "fail") {
    findings.push({
      id: "registry.preflight.network-unverified",
      severity: "warn",
      message: "Package publication and Registry version availability require explicit network verification."
    });
  }

  return {
    schemaVersion: "1.0.0",
    kind: "mcp-registry-publication-preflight",
    generatedAt: new Date().toISOString(),
    target: "server.json",
    ...(readiness.serverName ? { serverName: readiness.serverName } : {}),
    ...(readiness.serverVersion ? { serverVersion: readiness.serverVersion } : {}),
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
