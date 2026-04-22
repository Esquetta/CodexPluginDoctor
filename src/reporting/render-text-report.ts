import type { CheckResult } from "../domain/types.js";

export function renderTextReport(result: CheckResult): string {
  const header = [
    `Target: ${result.targetPath}`,
    `Status: ${result.status.toUpperCase()}`
  ];

  if (result.findings.length === 0) {
    return [...header, "", "No findings."].join("\n");
  }

  const findings = result.findings.map((finding) =>
    [
      `${finding.severity.toUpperCase()}  ${finding.id}`,
      `  Message: ${finding.message}`,
      `  Impact: ${finding.impact}`,
      `  Suggested fix: ${finding.suggestedFix}`
    ].join("\n")
  );

  return [...header, "", ...findings].join("\n");
}

