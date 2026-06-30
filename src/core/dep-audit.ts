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

export interface DepAuditRecommendation {
  packageName: string;
  priority: "critical" | "high" | "moderate" | "low";
  action: "upgrade_direct" | "replace_direct" | "update_parent" | "review_transitive";
  summary: string;
  breakingChangeRisk: "low" | "medium" | "high" | "unknown";
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

function severityRank(severity: DepAuditVulnerability["severity"]): number {
  return severity === "critical" ? 0 :
    severity === "high" ? 1 :
      severity === "moderate" ? 2 : 3;
}

function remediationRank(vulnerability: DepAuditVulnerability): number {
  if (vulnerability.isDirect && vulnerability.fixAvailable) {
    return 0;
  }

  if (vulnerability.isDirect) {
    return 1;
  }

  return vulnerability.fixAvailable ? 2 : 3;
}

export function buildDepAuditRecommendations(
  vulnerabilities: DepAuditVulnerability[]
): DepAuditRecommendation[] {
  return [...vulnerabilities]
    .sort((left, right) => {
      const remediationDelta = remediationRank(left) - remediationRank(right);

      if (remediationDelta !== 0) {
        return remediationDelta;
      }

      return severityRank(left.severity) - severityRank(right.severity);
    })
    .map((vuln) => {
      if (vuln.isDirect && vuln.fixAvailable) {
        return {
          packageName: vuln.name,
          priority: vuln.severity,
          action: "upgrade_direct",
          summary: `Upgrade direct dependency \`${vuln.name}\` with \`npm update ${vuln.name}\` or an explicit package upgrade.`,
          breakingChangeRisk: vuln.severity === "critical" ? "high" : "medium"
        };
      }

      if (vuln.isDirect) {
        return {
          packageName: vuln.name,
          priority: vuln.severity,
          action: "replace_direct",
          summary: `Replace or pin direct dependency \`${vuln.name}\`; npm did not report an automatic fix.`,
          breakingChangeRisk: "high"
        };
      }

      if (vuln.fixAvailable) {
        return {
          packageName: vuln.name,
          priority: vuln.severity,
          action: "update_parent",
          summary: `Update the parent dependency for transitive package \`${vuln.name}\`.`,
          breakingChangeRisk: "medium"
        };
      }

      return {
        packageName: vuln.name,
        priority: vuln.severity,
        action: "review_transitive",
        summary: `Review transitive package \`${vuln.name}\`; npm did not report an automatic fix.`,
        breakingChangeRisk: "unknown"
      };
    });
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

export function renderDepAudit(
  report: DepAuditReport,
  options: { recommendations?: boolean } = {}
): string {
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

  if (options.recommendations) {
    const recommendations = buildDepAuditRecommendations(report.vulnerabilities);

    lines.push("Next actions", "------------");

    if (recommendations.length === 0) {
      lines.push("No remediation actions needed.");
    }

    for (const [index, recommendation] of recommendations.entries()) {
      lines.push(`${index + 1}. ${recommendation.summary}`);
    }
  }

  return lines.join("\n");
}

export function renderDepAuditJson(
  report: DepAuditReport,
  options: { recommendations?: boolean } = {}
): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      targetPath: report.targetPath,
      status: report.status,
      totalVulnerabilities: report.totalVulnerabilities,
      vulnerabilities: report.vulnerabilities,
      ...(options.recommendations
        ? { recommendations: buildDepAuditRecommendations(report.vulnerabilities) }
        : {}),
      audit: report.auditJson
    },
    null,
    2
  );
}

export function renderDepAuditSarif(report: DepAuditReport): string {
  const rules = report.vulnerabilities.map((vuln) => ({
    id: `dep-audit.${vuln.name}`,
    name: vuln.name,
    shortDescription: {
      text: `${vuln.severity} severity vulnerability in ${vuln.name}${vuln.fixAvailable ? " (fix available)" : ""}`
    },
    help: {
      text: vuln.via.length > 0 ? `Via: ${vuln.via.join(", ")}` : "No additional information."
    }
  }));

  const results = report.vulnerabilities.map((vuln, index) => ({
    ruleId: `dep-audit.${vuln.name}`,
    ruleIndex: index,
    level: vuln.severity === "critical" || vuln.severity === "high" ? "error" : "warning",
    message: {
      text: `${vuln.severity}: ${vuln.name} ${vuln.fixAvailable ? "(fix available)" : "(no fix available)"}`
    }
  }));

  const sarif = {
    version: "2.1.0",
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "codex-plugin-doctor (dep-audit)",
            informationUri: "https://github.com/Esquetta/CodexPluginDoctor",
            rules
          }
        },
        results
      }
    ]
  };

  return JSON.stringify(sarif, null, 2);
}
