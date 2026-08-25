import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const bashExecutable = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";

type ActionMetadata = {
  inputs: Record<string, { default?: string | boolean }>;
  runs: { steps: Array<{ id?: string; name?: string; run?: string }> };
};

type ActionRun = {
  root: string;
  archiveJsonPath: string;
  archiveSummaryPath: string;
  output: Record<string, string>;
  manifest: { reports: Record<string, { enabled: boolean; path: string }> };
  invocations: string[][];
  readState: () => Promise<{ submission: string; archive: string; status: string }>;
  runSummary: () => Promise<string>;
  cleanup: () => Promise<void>;
};

function toBashPath(value: string): string {
  return value.replace(/\\/gu, "/");
}

function renderInputs(script: string, inputs: Record<string, string>): string {
  return script.replace(/\$\{\{\s*inputs(?:\.([A-Za-z0-9-]+)|\[['"]([^'"]+)['"]\])\s*\}\}/gu, (_match, dotted, bracketed) => inputs[dotted ?? bracketed] ?? "");
}

function outputEntries(value: string): Record<string, string> {
  return Object.fromEntries(value.split(/\r?\n/gu).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function loadAction(): Promise<ActionMetadata> {
  return parse(await readFile("action.yml", "utf8")) as ActionMetadata;
}

async function runArchiveAction(overrides: Record<string, string> = {}): Promise<ActionRun> {
  const action = await loadAction();
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-action-archive-"));
  const binDirectory = path.join(root, "bin");
  const reportDirectory = path.join(root, "reports");
  const runnerDirectory = path.join(root, "runner");
  const actionOutputPath = path.join(root, "github-output");
  const actionStatePath = path.join(root, "github-state");
  const stepSummaryPath = path.join(root, "github-step-summary");
  const logPath = path.join(root, "doctor.log");
  const archivePath = path.join(root, "submission.zip");
  const defaults = Object.fromEntries(Object.entries(action.inputs).map(([key, value]) => [key, String(value.default ?? "")]));
  const inputs = {
    ...defaults,
    path: toBashPath(path.join(root, "package")),
    "output-dir": toBashPath(reportDirectory),
    "step-summary": "true",
    ...overrides
  };
  const runDoctorScript = action.runs.steps.find((step) => step.id === "run-doctor")?.run;
  const summaryScript = action.runs.steps.find((step) => step.name === "Publish Codex Plugin Doctor summary")?.run;

  if (!runDoctorScript || !summaryScript) throw new Error("Expected composite Action run-doctor and summary scripts.");

  await writeFile(path.join(root, "submission.zip"), "fixture", "utf8");
  await writeFile(path.join(root, "mock-doctor.sh"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf '1.60.0\\n'
  exit 0
fi
printf '%s\\t' "$@" >> "$DOCTOR_LOG"
printf '\\n' >> "$DOCTOR_LOG"
output=""
for (( index = 1; index <= $#; index += 1 )); do
  if [[ "\${!index}" == "--output" ]]; then
    next=$((index + 1))
    output="\${!next}"
    break
  fi
done
if [[ -n "$output" ]]; then
  mkdir -p "$(dirname "$output")"
  if [[ " $* " == *" doctor submission archive "* ]]; then
    printf '# Archive submission report\\n' > "$output"
  else
    printf '{}\\n' > "$output"
  fi
fi
`, "utf8");
  await chmod(path.join(root, "mock-doctor.sh"), 0o755);
  await mkdir(binDirectory, { recursive: true });
  await mkdir(runnerDirectory, { recursive: true });
  await writeFile(path.join(binDirectory, "codex-plugin-doctor"), `#!/usr/bin/env bash
exec "${toBashPath(path.join(root, "mock-doctor.sh"))}" "$@"
`, "utf8");
  await chmod(path.join(binDirectory, "codex-plugin-doctor"), 0o755);

  const environment = {
    ...process.env,
    PATH: `${toBashPath(binDirectory)}:${process.env.PATH ?? ""}`,
    DOCTOR_LOG: toBashPath(logPath),
    ALLOW_NETWORK_INPUT: inputs["allow-network"],
    ALLOW_LOCAL_NETWORK_INPUT: inputs["allow-local-network"],
    ALLOW_SESSION_LIFECYCLE_INPUT: inputs["allow-session-lifecycle"],
    REQUIRE_REMOTE_RELIABILITY_INPUT: inputs["require-remote-reliability"],
    REGISTRY_METADATA_INPUT: inputs["registry-metadata"],
    REQUIRE_REGISTRY_READINESS_INPUT: inputs["require-registry-readiness"],
    SUBMISSION_INPUT: inputs.submission,
    SUBMISSION_ARCHIVE_INPUT: inputs["submission-archive"],
    REQUIRE_SUBMISSION_READY_INPUT: inputs["require-submission-ready"],
    CORPUS_METRICS_MANIFEST_INPUT: inputs["corpus-metrics-manifest"],
    CORPUS_METRICS_BASELINE_INPUT: inputs["corpus-metrics-baseline"],
    CORPUS_METRICS_FAIL_ON_REGRESSION_INPUT: inputs["corpus-metrics-fail-on-regression"],
    GITHUB_OUTPUT: toBashPath(actionOutputPath),
    GITHUB_STATE: toBashPath(actionStatePath),
    GITHUB_STEP_SUMMARY: toBashPath(stepSummaryPath),
    RUNNER_TEMP: toBashPath(runnerDirectory)
  };

  try {
    const runDoctorScriptPath = path.join(root, "run-doctor.sh");
    await writeFile(runDoctorScriptPath, renderInputs(runDoctorScript, inputs), "utf8");
    await chmod(runDoctorScriptPath, 0o755);
    await execFileAsync(bashExecutable, [runDoctorScriptPath], { cwd: root, env: environment });
    const output = outputEntries(await readFile(actionOutputPath, "utf8"));
    const manifest = JSON.parse(await readFile(path.join(reportDirectory, "codex-plugin-doctor-action-manifest.json"), "utf8")) as ActionRun["manifest"];
    const invocations = (await readFile(logPath, "utf8").catch(() => "")).split(/\r?\n/gu).filter(Boolean).map((line) => line.split("\t").filter(Boolean));

    return {
      root,
      archiveJsonPath: path.join(reportDirectory, "codex-plugin-doctor-submission-archive.json"),
      archiveSummaryPath: path.join(reportDirectory, "codex-plugin-doctor-submission-archive.md"),
      output,
      manifest,
      invocations,
      readState: async () => ({
        submission: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-submission-ran"), "utf8"),
        archive: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-submission-archive-ran"), "utf8"),
        status: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-status"), "utf8")
      }),
      runSummary: async () => {
        const summaryScriptPath = path.join(root, "publish-summary.sh");
        await writeFile(summaryScriptPath, renderInputs(summaryScript, inputs), "utf8");
        await chmod(summaryScriptPath, 0o755);
        await execFileAsync(bashExecutable, [summaryScriptPath], { cwd: root, env: environment });
        return readFile(stepSummaryPath, "utf8");
      },
      cleanup: () => rm(root, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function submissionInvocations(run: ActionRun): string[][] {
  return run.invocations.filter((invocation) => invocation[0] === "doctor" && invocation[1] === "submission");
}

describe("GitHub Action archive submission behavior", () => {
  it("keeps archive outputs and summary empty when archive mode is disabled", async () => {
    const run = await runArchiveAction();

    try {
      expect(run.output["submission-archive-json-path"]).toBe("");
      expect(run.output["submission-archive-summary-path"]).toBe("");
      expect((await run.readState()).archive).toBe("false");
      expect(run.manifest.reports.submissionArchiveJson).toEqual({ enabled: false, path: "" });
      expect(run.manifest.reports.submissionArchiveSummary).toEqual({ enabled: false, path: "" });
      expect(submissionInvocations(run)).toEqual([]);
      await expect(readFile(run.archiveJsonPath, "utf8")).rejects.toThrow();
      expect(await run.runSummary()).not.toContain("Archive submission report");
    } finally {
      await run.cleanup();
    }
  });

  it("runs directory submission strict mode without archive reports", async () => {
    const run = await runArchiveAction({ submission: "true", "require-submission-ready": "true" });

    try {
      const submissions = submissionInvocations(run);
      expect(submissions).toHaveLength(2);
      expect(submissions.every((invocation) => !invocation.includes("archive"))).toBe(true);
      expect(submissions[0]).toContain("--require-ready");
      expect(run.output["submission-archive-json-path"]).toBe("");
      expect((await run.readState()).archive).toBe("false");
    } finally {
      await run.cleanup();
    }
  });

  it.each(["false", "true"])("runs archive-only mode and forwards strict gating only when %s", async (strict) => {
    const run = await runArchiveAction({ "submission-archive": toBashPath(path.join(os.tmpdir(), "submission.zip")), "require-submission-ready": strict });

    try {
      const submissions = submissionInvocations(run);
      expect(submissions).toHaveLength(2);
      expect(submissions.every((invocation) => invocation.includes("archive"))).toBe(true);
      expect(submissions[0].includes("--require-ready")).toBe(strict === "true");
      expect(submissions[1]).not.toContain("--require-ready");
      expect((await run.readState()).archive).toBe("true");
      expect(run.output["submission-archive-json-path"]).toBe(run.archiveJsonPath.replace(/\\/gu, "/"));
      expect(run.output["submission-archive-summary-path"]).toBe(run.archiveSummaryPath.replace(/\\/gu, "/"));
      expect(run.manifest.reports.submissionArchiveJson).toEqual({ enabled: true, path: run.output["submission-archive-json-path"] });
      expect(run.manifest.reports.submissionArchiveSummary).toEqual({ enabled: true, path: run.output["submission-archive-summary-path"] });
      expect(await readFile(run.archiveJsonPath, "utf8")).toContain("Archive submission report");
      expect(await run.runSummary()).toContain("Archive submission report");
    } finally {
      await run.cleanup();
    }
  });

  it("rejects both submission modes without leaking archive paths or reports", async () => {
    const run = await runArchiveAction({ submission: "true", "submission-archive": toBashPath(path.join(os.tmpdir(), "submission.zip")), "require-submission-ready": "true" });

    try {
      expect((await run.readState())).toMatchObject({ submission: "false", archive: "false", status: "2" });
      expect(submissionInvocations(run)).toEqual([]);
      expect(run.output["submission-archive-json-path"]).toBe("");
      expect(run.output["submission-archive-summary-path"]).toBe("");
      await expect(readFile(run.archiveJsonPath, "utf8")).rejects.toThrow();
      expect(await run.runSummary()).not.toContain("Archive submission report");
    } finally {
      await run.cleanup();
    }
  });

  it("rejects strict readiness without either submission mode", async () => {
    const run = await runArchiveAction({ "require-submission-ready": "true" });

    try {
      expect((await run.readState())).toMatchObject({ submission: "false", archive: "false", status: "2" });
      expect(submissionInvocations(run)).toEqual([]);
      expect(run.output["submission-archive-json-path"]).toBe("");
      expect(run.output["submission-archive-summary-path"]).toBe("");
    } finally {
      await run.cleanup();
    }
  });
});
