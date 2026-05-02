import type { ValidationHistoryEntry } from "../core/validation-history.js";

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function renderHistorySummary(entries: ValidationHistoryEntry[]): string {
  if (entries.length === 0) {
    throw new Error("No validation history entries found.");
  }

  const latest = entries[entries.length - 1];
  const previous = entries.length > 1 ? entries[entries.length - 2] : null;
  const lines = [
    "Validation History",
    "==================",
    `Runs: ${entries.length}`,
    `Latest: ${latest.status.toUpperCase()}`,
    `Target: ${latest.targetPath}`,
    `Generated: ${latest.generatedAt}`,
    `Fail findings: ${latest.findingCounts.fail}`,
    `Warn findings: ${latest.findingCounts.warn}`
  ];

  if (previous) {
    lines.push(
      "",
      `Previous: ${previous.status.toUpperCase()}`,
      `Fail findings: ${formatDelta(latest.findingCounts.fail - previous.findingCounts.fail)}`,
      `Warn findings: ${formatDelta(latest.findingCounts.warn - previous.findingCounts.warn)}`
    );
  }

  return lines.join("\n");
}
