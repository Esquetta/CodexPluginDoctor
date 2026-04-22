import type { CheckResult } from "../domain/types.js";

function getCounts(result: CheckResult) {
  const failCount = result.findings.filter(
    (finding) => finding.severity === "fail"
  ).length;
  const warnCount = result.findings.filter(
    (finding) => finding.severity === "warn"
  ).length;

  return {
    failCount,
    warnCount,
    totalCount: result.findings.length
  };
}

function getGlyphs(ascii: boolean) {
  return ascii
    ? {
        fail: "x",
        warn: "!",
        ok: "ok"
      }
    : {
        fail: "✖",
        warn: "!",
        ok: "✔"
      };
}

export function renderTextReport(
  result: CheckResult,
  options: { ascii?: boolean } = {}
): string {
  const ascii = options.ascii ?? false;
  const glyphs = getGlyphs(ascii);
  const { failCount, warnCount, totalCount } = getCounts(result);
  const lines = [
    "Codex Plugin Doctor",
    "===================",
    `Status: ${result.status.toUpperCase()}`,
    `Target: ${result.targetPath}`,
    `Summary: ${failCount} fail, ${warnCount} warn, ${totalCount} total`
  ];

  if (result.findings.length === 0) {
    lines.push("", "No findings.");
    return lines.join("\n");
  }

  const failures = result.findings.filter((finding) => finding.severity === "fail");
  const warnings = result.findings.filter((finding) => finding.severity === "warn");

  const appendSection = (
    title: string,
    items: typeof result.findings,
    marker: string
  ) => {
    if (items.length === 0) {
      return;
    }

    lines.push("", title, "--------");

    for (const finding of items) {
      lines.push(`${marker} ${finding.id}`);
      lines.push(`  Message: ${finding.message}`);
      lines.push(`  Impact: ${finding.impact}`);
      lines.push(`  Suggested fix: ${finding.suggestedFix}`);
    }
  };

  appendSection("Failures", failures, glyphs.fail);
  appendSection("Warnings", warnings, glyphs.warn);

  return lines.join("\n");
}
