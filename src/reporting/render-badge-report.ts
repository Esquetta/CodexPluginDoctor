import type { CheckResult } from "../domain/types.js";

export interface BadgeReport {
  schemaVersion: 1;
  label: "doctor";
  message: "PASS" | "WARN" | "FAIL";
  color: "brightgreen" | "yellow" | "red";
}

function badgeForStatus(status: CheckResult["status"]): Omit<BadgeReport, "schemaVersion" | "label"> {
  if (status === "pass") {
    return {
      message: "PASS",
      color: "brightgreen"
    };
  }

  if (status === "warn") {
    return {
      message: "WARN",
      color: "yellow"
    };
  }

  return {
    message: "FAIL",
    color: "red"
  };
}

export function buildBadgeReport(result: CheckResult): BadgeReport {
  return {
    schemaVersion: 1,
    label: "doctor",
    ...badgeForStatus(result.status)
  };
}

export function renderBadgeJson(result: CheckResult): string {
  return JSON.stringify(buildBadgeReport(result), null, 2);
}

export function renderBadgeMarkdown(result: CheckResult): string {
  const badge = buildBadgeReport(result);

  return `![Codex Plugin Doctor](https://img.shields.io/badge/${badge.label}-${badge.message}-${badge.color})`;
}
