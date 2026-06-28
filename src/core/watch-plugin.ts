import { watch } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { validatePlugin } from "./validate-plugin.js";
import type { CheckResult } from "../domain/types.js";

export interface WatchPluginOptions {
  targetPath: string;
  debounceMs?: number;
  runtime?: boolean;
  jsonOutput?: boolean;
  outputPath?: string | null;
  maxIterations?: number;
  failFast?: boolean;
  accumulateJsonPath?: string | null;
}

export interface WatchPluginResult {
  targetPath: string;
  validations: number;
  failures: number;
  iterationsReached?: boolean;
}

const ignoredDirs = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".cache",
  "build",
  ".turbo",
  ".next",
  ".nuxt",
  "__pycache__"
]);

function isIgnored(filename: string): boolean {
  for (const dir of ignoredDirs) {
    if (filename.includes(dir) || filename.startsWith(`${dir}/`) || filename.startsWith(`${dir}\\`)) {
      return true;
    }
  }

  return false;
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
    return JSON.stringify(report);
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
  const {
    targetPath,
    debounceMs = 300,
    runtime = false,
    jsonOutput = false,
    outputPath = null,
    maxIterations = 0,
    failFast = false,
    accumulateJsonPath = null
  } = options;

  const resolvedPath = path.resolve(targetPath);
  let validations = 0;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const runValidation = async (iteration: number): Promise<void> => {
    try {
      const result = await validatePlugin(resolvedPath, { runtime });

      if (result.status !== "pass") {
        failures += 1;
      }

      const output = renderWatchValidation(result, iteration, jsonOutput);

      if (outputPath) {
        await writeFile(outputPath, output, "utf8");
      }

      if (accumulateJsonPath && jsonOutput) {
        await writeFile(accumulateJsonPath, `${output}\n`, { encoding: "utf8", flag: "a" });
      }

      if (!outputPath && !accumulateJsonPath) {
        if (jsonOutput) {
          process.stdout.write(`${JSON.stringify(JSON.parse(output), null, 2)}\n\n`);
        } else {
          process.stdout.write(`${output}\n\n`);
        }
      }
    } catch (error) {
      process.stderr.write(`Watch validation error: ${(error as Error).message}\n`);
      failures += 1;
    } finally {
      validations += 1;
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

        if (failFast && failures > 0) {
          cleanup();
          resolve({ targetPath: resolvedPath, validations, failures });
          return;
        }

        if (maxIterations > 0 && validations >= maxIterations) {
          cleanup();
          resolve({ targetPath: resolvedPath, validations, failures, iterationsReached: true });
          return;
        }

        if (maxIterations > 0) {
          schedule();
        }
      }, debounceMs);
    };

    const watcher = watch(
      resolvedPath,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename || isIgnored(filename)) {
          return;
        }

        if (outputPath && filename === path.basename(outputPath)) {
          return;
        }

        if (accumulateJsonPath && filename === path.basename(accumulateJsonPath)) {
          return;
        }

        schedule();
      }
    );

    watcher.on("error", (error) => {
      process.stderr.write(`Watch error: ${(error as Error).message}\n`);
    });

    const cleanup = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }

      watcher.close();
      process.removeListener("SIGINT", handleExit);
      process.removeListener("SIGTERM", handleExit);
      process.removeListener("SIGHUP", handleExit);
    };

    const handleExit = (): void => {
      cleanup();
      resolve({ targetPath: resolvedPath, validations, failures });
    };

    process.on("SIGINT", handleExit);
    process.on("SIGTERM", handleExit);
    process.on("SIGHUP", handleExit);

    const flags: string[] = [];

    if (maxIterations > 0) {
      flags.push(`max-iterations: ${maxIterations}`);
    }

    if (failFast) {
      flags.push("fail-fast");
    }

    const flagsStr = flags.length > 0 ? `, ${flags.join(", ")}` : "";

    process.stdout.write(
      `Watching ${resolvedPath} for changes (debounce: ${debounceMs}ms, runtime: ${runtime ? "enabled" : "disabled"}${flagsStr})...\nPress Ctrl+C to stop.\n\n`
    );

    schedule();
  });
}
