import {
  summarizeValidationHistory,
  type ValidationHistoryEntry
} from "../core/validation-history.js";

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function renderHistorySummary(entries: ValidationHistoryEntry[]): string {
  const summary = summarizeValidationHistory(entries);
  const { latest, previous } = summary;
  const lines = [
    "Validation History",
    "==================",
    `Runs: ${summary.runs}`,
    `Latest: ${latest.status.toUpperCase()}`,
    `Target: ${latest.targetPath}`,
    `Generated: ${latest.generatedAt}`,
    `Fail findings: ${latest.findingCounts.fail}`,
    `Warn findings: ${latest.findingCounts.warn}`,
    `Regression: ${summary.regression ? "YES" : "NO"}`
  ];

  if (previous) {
    lines.push(
      "",
      `Previous: ${previous.status.toUpperCase()}`,
      `Fail findings: ${formatDelta(summary.delta.fail)}`,
      `Warn findings: ${formatDelta(summary.delta.warn)}`
    );
  }

  return lines.join("\n");
}
