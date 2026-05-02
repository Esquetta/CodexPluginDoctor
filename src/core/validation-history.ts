import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult } from "../domain/types.js";

export interface ValidationHistoryEntry {
  schemaVersion: "1.0.0";
  generatedAt: string;
  targetPath: string;
  status: CheckResult["status"];
  runtimeProbeEnabled: boolean;
  findingCounts: {
    fail: number;
    warn: number;
    total: number;
  };
}

function countFindings(result: CheckResult): ValidationHistoryEntry["findingCounts"] {
  return {
    fail: result.findings.filter((finding) => finding.severity === "fail").length,
    warn: result.findings.filter((finding) => finding.severity === "warn").length,
    total: result.findings.length
  };
}

export function buildValidationHistoryEntry(
  result: CheckResult,
  options: { runtimeProbeEnabled: boolean }
): ValidationHistoryEntry {
  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    targetPath: result.targetPath,
    status: result.status,
    runtimeProbeEnabled: options.runtimeProbeEnabled,
    findingCounts: countFindings(result)
  };
}

export async function appendValidationHistoryEntry(
  historyPath: string,
  result: CheckResult,
  options: { runtimeProbeEnabled: boolean }
): Promise<void> {
  const absoluteHistoryPath = path.resolve(historyPath);

  await mkdir(path.dirname(absoluteHistoryPath), { recursive: true });
  await writeFile(
    absoluteHistoryPath,
    `${JSON.stringify(buildValidationHistoryEntry(result, options))}\n`,
    { encoding: "utf8", flag: "a" }
  );
}

export async function readValidationHistory(
  historyPath: string
): Promise<ValidationHistoryEntry[]> {
  const content = await readFile(path.resolve(historyPath), "utf8");

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ValidationHistoryEntry);
}
