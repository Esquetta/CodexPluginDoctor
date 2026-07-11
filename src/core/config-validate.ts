import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface ConfigValidationFinding {
  field: string;
  message: string;
  severity: "fail" | "warn";
}

export interface ConfigValidationReport {
  configPath: string;
  status: "pass" | "fail";
  findings: ConfigValidationFinding[];
}

const knownFields = ["ignoreRules", "failOnWarnings", "suppressions"];

export async function validateConfigFile(configPath: string): Promise<ConfigValidationReport> {
  const resolvedPath = path.resolve(configPath);
  const findings: ConfigValidationFinding[] = [];

  try {
    await stat(resolvedPath);
  } catch {
    return {
      configPath: resolvedPath,
      status: "fail",
      findings: [
        { field: "file", message: `Config file not found: ${resolvedPath}`, severity: "fail" }
      ]
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(resolvedPath, "utf8"));
  } catch (error) {
    return {
      configPath: resolvedPath,
      status: "fail",
      findings: [
        { field: "json", message: `Invalid JSON: ${(error as Error).message}`, severity: "fail" }
      ]
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      configPath: resolvedPath,
      status: "fail",
      findings: [
        { field: "root", message: "Config must be a JSON object.", severity: "fail" }
      ]
    };
  }

  const config = parsed as Record<string, unknown>;

  for (const key of Object.keys(config)) {
    if (!knownFields.includes(key)) {
      findings.push({
        field: key,
        message: `Unknown field: "${key}". Known fields: ${knownFields.join(", ")}`,
        severity: "warn"
      });
    }
  }

  if ("ignoreRules" in config) {
    const ignoreRules = config.ignoreRules;

    if (!Array.isArray(ignoreRules)) {
      findings.push({ field: "ignoreRules", message: "Must be an array of strings.", severity: "fail" });
    } else if (!ignoreRules.every((r) => typeof r === "string")) {
      findings.push({ field: "ignoreRules", message: "All entries must be strings.", severity: "fail" });
    }
  }

  if ("failOnWarnings" in config) {
    if (typeof config.failOnWarnings !== "boolean") {
      findings.push({ field: "failOnWarnings", message: "Must be a boolean.", severity: "fail" });
    }
  }

  if ("suppressions" in config) {
    const suppressions = config.suppressions;

    if (!Array.isArray(suppressions)) {
      findings.push({ field: "suppressions", message: "Must be an array.", severity: "fail" });
    } else {
      for (let i = 0; i < suppressions.length; i += 1) {
        const entry = suppressions[i] as Record<string, unknown> | undefined;

        if (!entry || typeof entry !== "object") {
          findings.push({ field: `suppressions[${i}]`, message: "Must be an object.", severity: "fail" });
          continue;
        }

        if (typeof entry.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) {
          findings.push({
            field: `suppressions[${i}].fingerprint`,
            message: "Must be a 64-character lowercase hex string.",
            severity: "fail"
          });
        }

        if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
          findings.push({
            field: `suppressions[${i}].reason`,
            message: "Must be a non-empty string.",
            severity: "fail"
          });
        }

        if (typeof entry.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresAt)) {
          findings.push({
            field: `suppressions[${i}].expiresAt`,
            message: "Must be a YYYY-MM-DD date string.",
            severity: "fail"
          });
        }
      }
    }
  }

  const hasFail = findings.some((f) => f.severity === "fail");

  return {
    configPath: resolvedPath,
    status: hasFail ? "fail" : findings.length === 0 ? "pass" : "warn" as "pass" | "fail",
    findings
  };
}

export function renderConfigValidation(report: ConfigValidationReport): string {
  const lines = [
    "Codex Plugin Doctor Config Validation",
    "=====================================",
    `Path: ${report.configPath}`,
    `Status: ${report.status.toUpperCase()}`,
    ""
  ];

  if (report.findings.length === 0) {
    lines.push("Config is valid.");
    return lines.join("\n");
  }

  for (const finding of report.findings) {
    const tag = finding.severity === "fail" ? "FAIL" : "WARN";
    lines.push(`${tag}  ${finding.field}: ${finding.message}`);
  }

  return lines.join("\n");
}

export function renderConfigValidationJson(report: ConfigValidationReport): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      configPath: report.configPath,
      status: report.status,
      findings: report.findings
    },
    null,
    2
  );
}
