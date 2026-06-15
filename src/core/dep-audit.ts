import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface DepAuditVulnerability {
  name: string;
  severity: "critical" | "high" | "moderate" | "low";
  isDirect: boolean;
  fixAvailable: boolean;
  via: string[];
}

export interface DepAuditReport {
  targetPath: string;
  status: "pass" | "warn" | "fail";
  vulnerabilities: DepAuditVulnerability[];
  totalVulnerabilities: number;
  auditJson: unknown;
}

function resolvePackageJson(targetPath: string): string {
  return path.resolve(targetPath, "package.json");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch {
    return false;
  }
}

async function runNpmAudit(cwd: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "npm", "audit", "--json"]
      : ["audit", "--json"];

    execFile(
      command,
      args,
      { cwd, timeout: 120_000 },
      (error, stdout, stderr) => {
        const parsed = ((): unknown => {
          try {
            return JSON.parse(stdout);
          } catch {
            return null;
          }
        })();

        if (parsed) {
          resolve(parsed);
        } else {
          reject(new Error(stderr.trim() || error?.message || "npm audit failed"));
        }
      }
    );
  });
}

function extractVulnerabilities(auditJson: unknown): DepAuditVulnerability[] {
  const result: DepAuditVulnerability[] = [];

  if (!auditJson || typeof auditJson !== "object") {
    return result;
  }

  const data = auditJson as Record<string, unknown>;
  const vulns = data.vulnerabilities as Record<string, unknown> | undefined;

  if (!vulns) {
    return result;
  }

  for (const [name, entry] of Object.entries(vulns)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const vuln = entry as Record<string, unknown>;
    const severity = vuln.severity as string | undefined;
    const isDirect = Boolean(vuln.isDirect);
    const fixAvailable = Boolean(vuln.fixAvailable);
    const via = Array.isArray(vuln.via) ? vuln.via.map((v) => (typeof v === "string" ? v : "unknown")) : [];

    if (severity === "critical" || severity === "high" || severity === "moderate" || severity === "low") {
      result.push({
        name,
        severity,
        isDirect,
        fixAvailable,
        via
      });
    }
  }

  return result;
}

function computeStatus(vulnerabilities: DepAuditVulnerability[]): DepAuditReport["status"] {
  if (vulnerabilities.length === 0) {
    return "pass";
  }

  const hasCritical = vulnerabilities.some((v) => v.severity === "critical");
  const hasHigh = vulnerabilities.some((v) => v.severity === "high");

  if (hasCritical) {
    return "fail";
  }

  if (hasHigh) {
    return "fail";
  }

  return "warn";
}

export async function buildDepAudit(targetPath: string): Promise<DepAuditReport> {
  const resolvedPath = path.resolve(targetPath);
  const packageJsonPath = resolvePackageJson(resolvedPath);

  if (!(await fileExists(packageJsonPath))) {
    return {
      targetPath: resolvedPath,
      status: "pass",
      vulnerabilities: [],
      totalVulnerabilities: 0,
      auditJson: null
    };
  }

  let pkg: Record<string, unknown>;

  try {
    pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    return {
      targetPath: resolvedPath,
      status: "warn",
      vulnerabilities: [],
      totalVulnerabilities: 0,
      auditJson: { error: "Failed to parse package.json" }
    };
  }

  const hasDeps = pkg.dependencies || pkg.devDependencies;

  if (!hasDeps) {
    return {
      targetPath: resolvedPath,
      status: "pass",
      vulnerabilities: [],
      totalVulnerabilities: 0,
      auditJson: { message: "No runtime dependencies to audit" }
    };
  }

  let auditJson: unknown;

  try {
    auditJson = await runNpmAudit(resolvedPath);
  } catch (error) {
    return {
      targetPath: resolvedPath,
      status: "warn",
      vulnerabilities: [],
      totalVulnerabilities: 0,
      auditJson: { error: (error as Error).message }
    };
  }

  const vulnerabilities = extractVulnerabilities(auditJson);
  const status = computeStatus(vulnerabilities);

  return {
    targetPath: resolvedPath,
    status,
    vulnerabilities,
    totalVulnerabilities: vulnerabilities.length,
    auditJson
  };
}

export function renderDepAudit(report: DepAuditReport): string {
  const lines = [
    "Dependency Vulnerability Audit",
    "=============================",
    `Path: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Vulnerabilities: ${report.totalVulnerabilities}`,
    ""
  ];

  if (report.vulnerabilities.length === 0) {
    lines.push("No known vulnerabilities found.");
    return lines.join("\n");
  }

  for (const vuln of report.vulnerabilities) {
    const tag = vuln.severity === "critical" ? "CRITICAL" :
      vuln.severity === "high" ? "HIGH" :
        vuln.severity === "moderate" ? "MODERATE" : "LOW";

    lines.push(
      `${tag.padEnd(10)} ${vuln.name}`,
      `          Direct: ${vuln.isDirect ? "yes" : "no"}`,
      `          Fix available: ${vuln.fixAvailable ? "yes" : "no"}`,
      vuln.via.length > 0 ? `          Via: ${vuln.via.join(", ")}` : "",
      ""
    );
  }

  return lines.join("\n");
}

export function renderDepAuditJson(report: DepAuditReport): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      targetPath: report.targetPath,
      status: report.status,
      totalVulnerabilities: report.totalVulnerabilities,
      vulnerabilities: report.vulnerabilities,
      audit: report.auditJson
    },
    null,
    2
  );
}
