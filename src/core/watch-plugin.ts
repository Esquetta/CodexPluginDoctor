import { watch } from "node:fs";
import path from "node:path";
import { validatePlugin } from "./validate-plugin.js";
import type { CheckResult } from "../domain/types.js";

export interface WatchPluginOptions {
  targetPath: string;
  debounceMs?: number;
  runtime?: boolean;
  jsonOutput?: boolean;
  outputPath?: string | null;
}

export interface WatchPluginResult {
  targetPath: string;
  validations: number;
  failures: number;
}

function renderWatchValidation(result: CheckResult, iteration: number, jsonOutput: boolean): string {
  if (jsonOutput) {
    const report = {
      schemaVersion: "1.0.0",
      iteration,
      timestamp: new Date().toISOString(),
      targetPath: result.targetPath,
      status: result.status,
      findingsCount: result.findings.length,
      findings: result.findings
    };
    return JSON.stringify(report, null, 2);
  }

  const icon = result.status === "pass" ? "PASS" : "FAIL";
  return [
    `[#${String(iteration).padStart(3, "0")}] ${icon}  ${result.targetPath}`,
    `      findings: ${result.findings.length} (${result.status})`,
    result.findings.length > 0
      ? result.findings.map((f) => `        ${f.severity === "fail" ? "FAIL" : "WARN"}  ${f.id}: ${f.message}`).join("\n")
      : ""
  ].filter(Boolean).join("\n");
}

export async function watchPlugin(options: WatchPluginOptions): Promise<WatchPluginResult> {
  const { targetPath, debounceMs = 300, runtime = false, jsonOutput = false, outputPath = null } = options;
  const resolvedPath = path.resolve(targetPath);
  let validations = 0;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const runValidation = async (iteration: number): Promise<void> => {
    const result = await validatePlugin(resolvedPath, { runtime });
    validations += 1;

    if (result.status !== "pass") {
      failures += 1;
    }

    const output = renderWatchValidation(result, iteration, jsonOutput);

    if (outputPath) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(outputPath, output, "utf8");
    } else {
      process.stdout.write(`${output}\n\n`);
    }
  };

  return new Promise<WatchPluginResult>((resolve, _reject) => {
    let iteration = 0;

    const schedule = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }

      if (pending) {
        return;
      }

      pending = true;
      timer = setTimeout(async () => {
        pending = false;
        timer = null;
        iteration += 1;
        await runValidation(iteration);
      }, debounceMs);
    };

    const watcher = watch(
      resolvedPath,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename || filename.includes("node_modules") || filename.startsWith(".git")) {
          return;
        }
        schedule();
      }
    );

    watcher.on("error", (error) => {
      process.stderr.write(`Watch error: ${(error as Error).message}\n`);
    });

    const handleExit = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }

      watcher.close();
      resolve({ targetPath: resolvedPath, validations, failures });
    };

    process.on("SIGINT", handleExit);
    process.on("SIGTERM", handleExit);
    process.on("SIGHUP", handleExit);

    process.stdout.write(
      `Watching ${resolvedPath} for changes (debounce: ${debounceMs}ms, runtime: ${runtime ? "enabled" : "disabled"})...\nPress Ctrl+C to stop.\n\n`
    );

    schedule();
  });
}
