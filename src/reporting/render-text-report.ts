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
    if (result.runtimeScorecard) {
      lines.push("", "Runtime Scorecard", "----------------");
      lines.push(`initialize: ${result.runtimeScorecard.initialize}`);
      lines.push(`tools/list: ${result.runtimeScorecard.toolsList}`);
      lines.push(`tools/call: ${result.runtimeScorecard.toolsCall}`);
      lines.push(`resources/list: ${result.runtimeScorecard.resourcesList}`);
      lines.push(`resources/read: ${result.runtimeScorecard.resourceRead}`);
      lines.push(`resources/templates/list: ${result.runtimeScorecard.resourceTemplatesList}`);
      lines.push(`prompts/list: ${result.runtimeScorecard.promptsList}`);
      lines.push(`prompts/get: ${result.runtimeScorecard.promptGet}`);
    }

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

  if (result.runtimeScorecard) {
    lines.push("", "Runtime Scorecard", "----------------");
    lines.push(`initialize: ${result.runtimeScorecard.initialize}`);
    lines.push(`tools/list: ${result.runtimeScorecard.toolsList}`);
    lines.push(`tools/call: ${result.runtimeScorecard.toolsCall}`);
    lines.push(`resources/list: ${result.runtimeScorecard.resourcesList}`);
    lines.push(`resources/read: ${result.runtimeScorecard.resourceRead}`);
    lines.push(`resources/templates/list: ${result.runtimeScorecard.resourceTemplatesList}`);
    lines.push(`prompts/list: ${result.runtimeScorecard.promptsList}`);
    lines.push(`prompts/get: ${result.runtimeScorecard.promptGet}`);
  }

  return lines.join("\n");
}
