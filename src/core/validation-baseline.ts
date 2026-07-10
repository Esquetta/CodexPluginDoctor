import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult, Finding, FindingSeverity } from "../domain/types.js";

export interface ValidationBaselineFinding {
  id: string;
  severity: FindingSeverity;
  fingerprint: string;
}

export interface ValidationBaseline {
  schemaVersion: "1.0.0";
  generatedAt: string;
  findings: ValidationBaselineFinding[];
}

const fingerprintPattern = /^[a-f0-9]{64}$/;

export function buildValidationBaseline(result: CheckResult): ValidationBaseline {
  const findings = new Map<string, ValidationBaselineFinding>();

  for (const finding of result.findings) {
    if (finding.fingerprint && !findings.has(finding.fingerprint)) {
      findings.set(finding.fingerprint, {
        id: finding.id,
        severity: finding.severity,
        fingerprint: finding.fingerprint
      });
    }
  }

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    findings: [...findings.values()]
  };
}

export async function writeValidationBaseline(
  baselinePath: string,
  baseline: ValidationBaseline
): Promise<void> {
  const absolutePath = path.resolve(baselinePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(baseline, null, 2), "utf8");
}

export async function readValidationBaseline(baselinePath: string): Promise<ValidationBaseline> {
  const value = JSON.parse(await readFile(path.resolve(baselinePath), "utf8")) as unknown;

  if (!isValidationBaseline(value)) {
    throw new Error("expected schemaVersion 1.0.0 and valid fingerprinted findings");
  }

  return value;
}

export function applyValidationBaseline(
  result: CheckResult,
  baseline: ValidationBaseline,
  options: { failOnWarnings: boolean }
): CheckResult {
  const baselineFingerprints = new Set(baseline.findings.map((finding) => finding.fingerprint));
  const currentFingerprints = new Set(
    result.findings.flatMap((finding) => finding.fingerprint ? [finding.fingerprint] : [])
  );
  const baselinedFindings: Finding[] = [];
  const findings: Finding[] = [];

  for (const finding of result.findings) {
    if (finding.fingerprint && baselineFingerprints.has(finding.fingerprint)) {
      baselinedFindings.push(finding);
    } else {
      findings.push(finding);
    }
  }

  const hasFailures = findings.some((finding) => finding.severity === "fail");
  const hasWarnings = findings.some((finding) => finding.severity === "warn");
  const status = hasFailures || (options.failOnWarnings && hasWarnings)
    ? "fail"
    : hasWarnings
      ? "warn"
      : "pass";

  return {
    ...result,
    status,
    exitCode: status === "fail" ? 1 : 0,
    findings,
    baselinedFindings,
    baselineSummary: {
      matched: baselinedFindings.length,
      new: findings.length,
      resolved: baseline.findings.filter(
        (finding) => !currentFingerprints.has(finding.fingerprint)
      ).length
    }
  };
}

function isValidationBaseline(value: unknown): value is ValidationBaseline {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ValidationBaseline>;

  return candidate.schemaVersion === "1.0.0"
    && typeof candidate.generatedAt === "string"
    && !Number.isNaN(Date.parse(candidate.generatedAt))
    && Array.isArray(candidate.findings)
    && candidate.findings.every((finding) =>
      finding
      && typeof finding.id === "string"
      && finding.id.length > 0
      && (finding.severity === "warn" || finding.severity === "fail")
      && typeof finding.fingerprint === "string"
      && fingerprintPattern.test(finding.fingerprint)
    )
    && new Set(candidate.findings.map((finding) => finding.fingerprint)).size
      === candidate.findings.length;
}
