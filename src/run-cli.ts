import { writeFile } from "node:fs/promises";

import { runCheck } from "./index.js";
import { renderJsonReport } from "./reporting/render-json-report.js";
import { buildMarkdownReport } from "./reporting/render-markdown-report.js";
import { renderTextReport } from "./reporting/render-text-report.js";

export interface CliIo {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

const defaultIo: CliIo = {
  writeStdout(message: string) {
    process.stdout.write(`${message}\n`);
  },
  writeStderr(message: string) {
    process.stderr.write(`${message}\n`);
  }
};

function printUsage(io: CliIo): void {
  io.writeStderr(
    "Usage: codex-plugin-doctor check <path> [--json|--markdown] [--output <path>] [--runtime]"
  );
}

export async function runCli(
  args: string[],
  io: CliIo = defaultIo
): Promise<number> {
  const [command, maybePath, ...remainingArgs] = args;

  if (command !== "check") {
    printUsage(io);
    return 2;
  }

  const targetPath = maybePath && !maybePath.startsWith("--") ? maybePath : ".";
  const normalizedFlags =
    maybePath && maybePath.startsWith("--")
      ? [maybePath, ...remainingArgs]
      : remainingArgs;

  const jsonOutput = normalizedFlags.includes("--json");
  const markdownOutput = normalizedFlags.includes("--markdown");
  const runtimeProbeEnabled = normalizedFlags.includes("--runtime");
  const outputIndex = normalizedFlags.indexOf("--output");
  const outputPath = outputIndex === -1 ? null : normalizedFlags[outputIndex + 1];

  if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
    io.writeStderr("Missing path after --output.");
    return 2;
  }

  const result = await runCheck(targetPath, { runtime: runtimeProbeEnabled });
  const report = markdownOutput
    ? buildMarkdownReport(result, { runtimeProbeEnabled })
    : jsonOutput
      ? renderJsonReport(result, { runtimeProbeEnabled })
      : renderTextReport(result);

  if (outputPath) {
    await writeFile(outputPath, report, "utf8");
  }

  io.writeStdout(report);

  return result.exitCode;
}
