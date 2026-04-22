#!/usr/bin/env node

import { renderTextReport } from "./reporting/render-text-report.js";
import { runCheck } from "./index.js";

function printUsage(): void {
  console.error("Usage: codex-plugin-doctor check <path> [--json]");
}

async function main(): Promise<void> {
  const [, , command, maybePath, ...flags] = process.argv;

  if (command !== "check") {
    printUsage();
    process.exitCode = 2;
    return;
  }

  const targetPath = maybePath && !maybePath.startsWith("--") ? maybePath : ".";
  const normalizedFlags =
    maybePath && maybePath.startsWith("--") ? [maybePath, ...flags] : flags;
  const jsonOutput = normalizedFlags.includes("--json");

  const result = await runCheck(targetPath);

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderTextReport(result));
  }

  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`codex-plugin-doctor failed: ${message}`);
  process.exitCode = 2;
});
