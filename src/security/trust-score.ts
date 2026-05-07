import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { discoverPackage } from "../core/discover-package.js";
import { parseJsonText } from "../core/read-json-file.js";
import type { Finding } from "../domain/types.js";
import { buildSecurityAudit } from "./security-audit.js";

export interface TrustScoreReport {
  schemaVersion: "1.0.0";
  generatedAt: string;
  targetPath: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  score: number;
  findingCounts: {
    fail: number;
    warn: number;
    total: number;
  };
  packageJson: {
    present: boolean;
    scriptsChecked: number;
    dependenciesChecked: number;
  };
  findings: Finding[];
}

const lifecycleScripts = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepare"
]);

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

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isFile();
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsRemotePipeInstall(script: string): boolean {
  const normalized = script.toLowerCase();

  return (
    /\b(curl|wget)\b[^|]*\|\s*(sh|bash)\b/.test(normalized) ||
    /\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*\|\s*(iex|invoke-expression)\b/.test(normalized) ||
    /\binvoke-expression\b/.test(normalized)
  );
}

async function readPackageJson(rootPath: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = path.join(rootPath, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  try {
    const parsed = parseJsonText<unknown>(await readFile(packageJsonPath, "utf8"));

    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function auditScripts(packageJson: Record<string, unknown>): {
  findings: Finding[];
  scriptsChecked: number;
} {
  const scripts = isPlainObject(packageJson.scripts) ? packageJson.scripts : {};
  const findings: Finding[] = [];
  let scriptsChecked = 0;

  for (const [scriptName, scriptValue] of Object.entries(scripts)) {
    if (!lifecycleScripts.has(scriptName) || typeof scriptValue !== "string") {
      continue;
    }

    scriptsChecked += 1;

    if (containsRemotePipeInstall(scriptValue)) {
      findings.push(
        buildFinding(
          "fail",
          "trust.package.remote_pipe_install",
          `The package lifecycle script \`${scriptName}\` pipes remote content into a shell.`,
          "Remote download-and-execute scripts can run unreviewed code during install or publish workflows.",
          "Replace remote pipe execution with pinned package dependencies or a checked-in reviewed setup script."
        )
      );
      continue;
    }

    findings.push(
      buildFinding(
        "warn",
        "trust.package.lifecycle_script",
        `The package defines lifecycle script \`${scriptName}\`.`,
        "Lifecycle scripts execute automatically during package manager workflows and increase supply-chain review scope.",
        "Keep lifecycle scripts minimal, documented, and covered by release review."
      )
    );
  }

  return {
    findings,
    scriptsChecked
  };
}

function dependencySections(packageJson: Record<string, unknown>): Record<string, string>[] {
  return [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies
  ].filter(isPlainObject) as Record<string, string>[];
}

function auditDependencies(packageJson: Record<string, unknown>): {
  findings: Finding[];
  dependenciesChecked: number;
} {
  const findings: Finding[] = [];
  let dependenciesChecked = 0;

  for (const dependencies of dependencySections(packageJson)) {
    for (const [dependencyName, versionSpec] of Object.entries(dependencies)) {
      if (typeof versionSpec !== "string") {
        continue;
      }

      dependenciesChecked += 1;

      if (versionSpec === "*" || versionSpec.toLowerCase() === "latest") {
        findings.push(
          buildFinding(
            "warn",
            "trust.package.unpinned_dependency",
            `The dependency \`${dependencyName}\` uses broad version spec \`${versionSpec}\`.`,
            "Broad dependency ranges make package resolution less reproducible across installs and releases.",
            "Pin the dependency to a specific compatible range or exact version."
          )
        );
      }

      if (/^(git\+|github:|http:\/\/|https:\/\/)/i.test(versionSpec)) {
        findings.push(
          buildFinding(
            "warn",
            "trust.package.remote_dependency",
            `The dependency \`${dependencyName}\` resolves from remote spec \`${versionSpec}\`.`,
            "Remote dependency specs can change outside the npm registry's normal version and integrity workflow.",
            "Prefer registry-published dependencies with pinned semver ranges."
          )
        );
      }
    }
  }

  return {
    findings,
    dependenciesChecked
  };
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

function scoreFindings(findings: Finding[]): number {
  const failCount = findings.filter((finding) => finding.severity === "fail").length;
  const warnCount = findings.filter((finding) => finding.severity === "warn").length;

  return Math.max(0, 100 - (failCount * 35) - (warnCount * 10));
}

export async function buildTrustScore(targetPath: string): Promise<TrustScoreReport> {
  const rootPath = path.resolve(targetPath);
  const packageJson = await readPackageJson(rootPath);
  const scriptAudit = packageJson
    ? auditScripts(packageJson)
    : { findings: [], scriptsChecked: 0 };
  const dependencyAudit = packageJson
    ? auditDependencies(packageJson)
    : { findings: [], dependenciesChecked: 0 };
  const discoveredPackage = await discoverPackage(rootPath);
  const securityAudit = discoveredPackage
    ? await buildSecurityAudit(rootPath)
    : null;
  const findings = dedupeFindings([
    ...scriptAudit.findings,
    ...dependencyAudit.findings,
    ...(securityAudit?.findings ?? [])
  ]);
  const fail = findings.filter((finding) => finding.severity === "fail").length;
  const warn = findings.filter((finding) => finding.severity === "warn").length;
  const score = scoreFindings(findings);
  const status = fail > 0
    ? "fail"
    : warn > 0
      ? "warn"
      : "pass";

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    targetPath: rootPath,
    status,
    exitCode: status === "fail" ? 1 : 0,
    score,
    findingCounts: {
      fail,
      warn,
      total: findings.length
    },
    packageJson: {
      present: packageJson !== null,
      scriptsChecked: scriptAudit.scriptsChecked,
      dependenciesChecked: dependencyAudit.dependenciesChecked
    },
    findings
  };
}

export function renderTrustScoreJson(report: TrustScoreReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderTrustScore(report: TrustScoreReport): string {
  const lines = [
    "Doctor Trust Score",
    "==================",
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Score: ${report.score}/100`,
    `Summary: ${report.findingCounts.fail} fail, ${report.findingCounts.warn} warn, ${report.findingCounts.total} total`
  ];

  if (report.findings.length === 0) {
    lines.push("", "No trust findings.");
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

  appendSection("Failures", report.findings.filter((finding) => finding.severity === "fail"), "x");
  appendSection("Warnings", report.findings.filter((finding) => finding.severity === "warn"), "!");

  return lines.join("\n");
}
