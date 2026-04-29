import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult } from "../domain/types.js";

export interface DoctorConfig {
  ignoreRules: string[];
  failOnWarnings: boolean;
}

const defaultConfig: DoctorConfig = {
  ignoreRules: [],
  failOnWarnings: false
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
    };

    return {
      ignoreRules: isStringArray(parsed.ignoreRules)
        ? parsed.ignoreRules
        : defaultConfig.ignoreRules,
      failOnWarnings:
        typeof parsed.failOnWarnings === "boolean"
          ? parsed.failOnWarnings
          : defaultConfig.failOnWarnings
    };
  } catch {
    return defaultConfig;
  }
}

export function applyDoctorConfig(
  result: CheckResult,
  config: DoctorConfig
): CheckResult {
  const findings = result.findings.filter(
    (finding) => !config.ignoreRules.includes(finding.id)
  );
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
    findings
  };
}
