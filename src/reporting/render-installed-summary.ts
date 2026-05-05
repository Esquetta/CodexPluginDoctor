import type { CheckResult } from "../domain/types.js";
import type { InstalledPlugin } from "../core/discover-installed-plugins.js";
import type {
  CompatibilityMatrix,
  CompatibilityStatus
} from "../compatibility/compatibility-matrix.js";

export interface InstalledPluginCheckResult {
  plugin: InstalledPlugin;
  result: CheckResult;
  compatibilityMatrix?: CompatibilityMatrix;
}

function statusLabel(status: CompatibilityStatus): string {
  return status.toUpperCase();
}

function statusCount(
  matrix: CompatibilityMatrix,
  status: CompatibilityStatus
): number {
  return matrix.results.filter((result) => result.status === status).length;
}

function renderCompatibilitySummary(
  checkedPlugins: InstalledPluginCheckResult[]
): string[] {
  const pluginsWithCompatibility = checkedPlugins.filter(
    (item) => item.compatibilityMatrix
  );

  if (pluginsWithCompatibility.length === 0) {
    return [];
  }

  const lines = [
    "",
    "Installed Compatibility Summary",
    "===============================",
    `Checked: ${pluginsWithCompatibility.length}`,
    "",
    "Clients",
    "-------"
  ];

  for (const item of pluginsWithCompatibility) {
    const matrix = item.compatibilityMatrix;

    if (!matrix) {
      continue;
    }

    lines.push("", `${item.plugin.name} - ${item.plugin.relativePath}`);
    lines.push(
      `  Score: ${statusCount(matrix, "pass")} pass, ${statusCount(matrix, "warn")} warn, ${statusCount(matrix, "fail")} fail, ${statusCount(matrix, "skipped")} skipped`
    );

    for (const result of matrix.results) {
      lines.push(
        `  ${result.client}: ${statusLabel(result.status)} - ${result.summary}`
      );
    }
  }

  return lines;
}

export function renderInstalledSummary(
  checkedPlugins: InstalledPluginCheckResult[]
): string {
  const passCount = checkedPlugins.filter(
    (item) => item.result.status === "pass"
  ).length;
  const warnCount = checkedPlugins.filter(
    (item) => item.result.status === "warn"
  ).length;
  const failCount = checkedPlugins.filter(
    (item) => item.result.status === "fail"
  ).length;
  const lines = [
    "Installed Plugin Summary",
    "========================",
    `Checked: ${checkedPlugins.length}`,
    `Pass: ${passCount}`,
    `Warn: ${warnCount}`,
    `Fail: ${failCount}`,
    "",
    "Plugins",
    "-------"
  ];

  for (const item of checkedPlugins) {
    const findingIds = item.result.findings.map((finding) => finding.id);
    const suffix = findingIds.length > 0 ? ` (${findingIds.join(", ")})` : "";

    lines.push(
      `${item.result.status.toUpperCase()} ${item.plugin.name} - ${item.plugin.relativePath}${suffix}`
    );
  }

  lines.push(...renderCompatibilitySummary(checkedPlugins));

  return lines.join("\n");
}
