import type { CheckResult } from "../domain/types.js";
import type { InstalledPlugin } from "../core/discover-installed-plugins.js";

export interface InstalledPluginCheckResult {
  plugin: InstalledPlugin;
  result: CheckResult;
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

  return lines.join("\n");
}
