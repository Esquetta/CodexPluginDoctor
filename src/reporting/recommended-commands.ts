import type { CheckResult } from "../domain/types.js";

function quoteCliArg(value: string): string {
  return JSON.stringify(value);
}

export function buildRecommendedCommands(result: CheckResult): string[] {
  if (result.findings.length === 0) {
    return [];
  }

  const target = quoteCliArg(result.targetPath);
  const commands = [
    `codex-plugin-doctor doctor recommend ${target}`,
    `codex-plugin-doctor fix ${target} --dry-run`
  ];

  if (result.findings.some((finding) => finding.fingerprint)) {
    commands.push(`codex-plugin-doctor suppress add ${target}`);
  }

  return commands;
}
