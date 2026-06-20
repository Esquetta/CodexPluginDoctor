import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CheckResult,
  Finding,
  FindingEvidence,
  SuppressedFinding,
  SuppressionSummary
} from "../domain/types.js";
import { withFindingFingerprint } from "../reporting/finding-fingerprint.js";

export interface DoctorConfig {
  ignoreRules: string[];
  failOnWarnings: boolean;
  suppressions: unknown[];
}

const defaultConfig: DoctorConfig = {
  ignoreRules: [],
  failOnWarnings: false,
  suppressions: []
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function loadDoctorConfig(
  targetPath: string,
  explicitConfigPath?: string | null
): Promise<DoctorConfig> {
  const configPath = explicitConfigPath
    ? path.resolve(explicitConfigPath)
    : path.join(path.resolve(targetPath), ".codex-doctor.json");

  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
      ignoreRules?: unknown;
      failOnWarnings?: unknown;
      suppressions?: unknown;
    };

    return {
      ignoreRules: isStringArray(parsed.ignoreRules)
        ? parsed.ignoreRules
        : defaultConfig.ignoreRules,
      failOnWarnings:
        typeof parsed.failOnWarnings === "boolean"
          ? parsed.failOnWarnings
          : defaultConfig.failOnWarnings,
      suppressions: Array.isArray(parsed.suppressions)
        ? parsed.suppressions
        : defaultConfig.suppressions
    };
  } catch {
    return defaultConfig;
  }
}

export function applyDoctorConfig(
  result: CheckResult,
  config: DoctorConfig,
  options: { now?: Date } = {}
): CheckResult {
  const configuredFindings = result.findings.filter(
    (finding) => !config.ignoreRules.includes(finding.id)
  );
  const now = options.now ?? new Date();
  const activeSuppressions = new Map<string, {
    reason: string;
    expiresAt: string;
  }>();
  const governanceWarnings: Finding[] = [];
  const summary: SuppressionSummary = {
    applied: 0,
    expired: 0,
    invalid: 0
  };

  for (const [index, suppression] of config.suppressions.entries()) {
    const validation = validateSuppression(suppression);

    if (!validation.valid) {
      summary.invalid += 1;
      governanceWarnings.push(
        buildGovernanceWarning(
          result.targetPath,
          "suppression.invalid",
          "A targeted suppression record is invalid and was not applied.",
          "Invalid suppression records can create false confidence because they do not match or expire as intended.",
          "Fix or remove the invalid suppression record in `.codex-doctor.json`.",
          {
            suppressionIndex: index,
            field: validation.field
          }
        )
      );
      continue;
    }

    if (isExpired(validation.expiresAt, now)) {
      summary.expired += 1;
      governanceWarnings.push(
        buildGovernanceWarning(
          result.targetPath,
          "suppression.expired",
          "A targeted suppression has expired and was not applied.",
          "Expired risk acceptance must be reviewed again before the finding can be suppressed.",
          "Remove the expired suppression or replace it with a newly reviewed expiration date.",
          {
            suppressionIndex: index,
            fingerprint: validation.fingerprint,
            expiresAt: validation.expiresAt
          }
        )
      );
      continue;
    }

    if (!activeSuppressions.has(validation.fingerprint)) {
      activeSuppressions.set(validation.fingerprint, {
        reason: validation.reason,
        expiresAt: validation.expiresAt
      });
    }
  }

  const findings: Finding[] = [];
  const suppressedFindings: SuppressedFinding[] = [];

  for (const finding of configuredFindings) {
    const suppression = finding.fingerprint
      ? activeSuppressions.get(finding.fingerprint)
      : undefined;

    if (!suppression) {
      findings.push(finding);
      continue;
    }

    summary.applied += 1;
    suppressedFindings.push({
      ...finding,
      suppression
    });
  }

  findings.push(...governanceWarnings);
  const hasFailures = findings.some((finding) => finding.severity === "fail");
  const hasWarnings = findings.some((finding) => finding.severity === "warn");
  const warningFailure = config.failOnWarnings && hasWarnings;
  const status = hasFailures || warningFailure
    ? "fail"
    : hasWarnings
      ? "warn"
      : "pass";

  return {
    ...result,
    status,
    exitCode: status === "fail" ? 1 : 0,
    findings,
    ...(config.suppressions.length > 0
      ? {
          suppressedFindings,
          suppressionSummary: summary
        }
      : {})
  };
}

type ValidSuppression = {
  valid: true;
  fingerprint: string;
  reason: string;
  expiresAt: string;
};

type InvalidSuppression = {
  valid: false;
  field: "record" | "fingerprint" | "reason" | "expiresAt";
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateSuppression(
  value: unknown
): ValidSuppression | InvalidSuppression {
  if (!isPlainObject(value)) {
    return { valid: false, field: "record" };
  }

  if (
    typeof value.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint)
  ) {
    return { valid: false, field: "fingerprint" };
  }

  if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
    return { valid: false, field: "reason" };
  }

  if (typeof value.expiresAt !== "string" || !isRealDate(value.expiresAt)) {
    return { valid: false, field: "expiresAt" };
  }

  return {
    valid: true,
    fingerprint: value.fingerprint,
    reason: value.reason.trim(),
    expiresAt: value.expiresAt
  };
}

function isExpired(expiresAt: string, now: Date): boolean {
  const expirationBoundary = Date.parse(`${expiresAt}T00:00:00.000Z`) + 86_400_000;
  return now.getTime() >= expirationBoundary;
}

function buildGovernanceWarning(
  targetPath: string,
  id: string,
  message: string,
  impact: string,
  suggestedFix: string,
  evidence: FindingEvidence
): Finding {
  return withFindingFingerprint(
    {
      id,
      severity: "warn",
      message,
      impact,
      suggestedFix,
      evidence
    },
    targetPath
  );
}
