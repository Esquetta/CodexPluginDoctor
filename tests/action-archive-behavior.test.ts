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
  runs: { steps: Array<{ id?: string; name?: string; run?: string; env?: Record<string, string> }> };
};

type ActionRun = {
  root: string;
  archiveJsonPath: string;
  archiveSummaryPath: string;
  output: Record<string, string>;
  manifest: { target: { check: boolean }; reports: Record<string, { enabled: boolean; path: string }> };
  invocations: string[][];
  reportDirectory: string;
  readState: () => Promise<{ submission: string; archive: string; toolsDiff: string; status: string }>;
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

async function runArchiveAction(overrides: Record<string, string> = {}, mockToolsDiffExit = "0", mockToolsCaptureExit = "0", seedEarlierReports = false): Promise<ActionRun> {
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
  const runDoctorStep = action.runs.steps.find((step) => step.id === "run-doctor");
  const runDoctorScript = runDoctorStep?.run;
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
if [[ "\${1:-} \${2:-}" == "doctor tools" ]]; then
  for (( index = 1; index <= $#; index += 1 )); do
    if [[ "\${!index}" == "--save-response" ]]; then
      next=$((index + 1))
      save="\${!next}"
    fi
  done
  code="\${MOCK_TOOLS_CAPTURE_EXIT:-0}"
  if [[ "$code" -le 1 ]]; then
    printf '{"jsonrpc":"2.0"}\\n' > "$save"
  fi
  exit "$code"
fi
if [[ "\${1:-} \${2:-}" == "doctor tools-diff" ]]; then
  if [[ " $* " == *" --json "* ]]; then
    printf '{"status":"warn"}\\n'
  else
    printf 'Offline MCP Tool Diff\\nBreaking: 1\\n'
  fi
  exit "\${MOCK_TOOLS_DIFF_EXIT:-0}"
fi
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
  if (seedEarlierReports) {
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(path.join(reportDirectory, "mcp-tools-current.json"), "{}", "utf8");
    await writeFile(path.join(reportDirectory, "codex-plugin-doctor-summary.md"), "stale package summary", "utf8");
  }

  const environment = {
    ...process.env,
    ...Object.fromEntries(Object.entries(runDoctorStep?.env ?? {}).map(([key, value]) => [key, renderInputs(value, inputs)])),
    PATH: `${toBashPath(binDirectory)}:${process.env.PATH ?? ""}`,
    DOCTOR_LOG: toBashPath(logPath),
    MOCK_TOOLS_DIFF_EXIT: mockToolsDiffExit,
    MOCK_TOOLS_CAPTURE_EXIT: mockToolsCaptureExit,
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
      reportDirectory,
      readState: async () => ({
        submission: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-submission-ran"), "utf8"),
        archive: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-submission-archive-ran"), "utf8"),
        toolsDiff: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-tools-diff-ran"), "utf8"),
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

function toolsDiffInvocations(run: ActionRun): string[][] {
  return run.invocations.filter((invocation) => invocation[0] === "doctor" && invocation[1] === "tools-diff");
}

describe("GitHub Action tools-diff behavior", () => {
  it("skips the tool diff and leaves its outputs empty when no inputs are set", async () => {
    const run = await runArchiveAction();

    try {
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect((await run.readState()).toolsDiff).toBe("false");
      expect(run.output["tools-diff-json-path"]).toBe("");
      expect(run.output["tools-diff-summary-path"]).toBe("");
      expect(run.manifest.reports.toolsDiffJson).toEqual({ enabled: false, path: "" });
      expect(await run.runSummary()).not.toContain("MCP Tool Definition Diff");
    } finally {
      await run.cleanup();
    }
  });

  it.each(["any", "breaking"])("compares saved responses with fail-on %s and publishes reports", async (failOn) => {
    const run = await runArchiveAction({ "tools-diff-before": "baseline/tools.json", "tools-diff-after": "current/tools.json", "tools-diff-fail-on": failOn });

    try {
      const expected = ["doctor", "tools-diff", "--before", "baseline/tools.json", "--after", "current/tools.json", "--fail-on", failOn];
      expect(toolsDiffInvocations(run)).toEqual([[...expected, "--json"], expected]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", status: "0" });
      const jsonPath = toBashPath(path.join(run.reportDirectory, "mcp-tools-diff.json"));
      const summaryPath = toBashPath(path.join(run.reportDirectory, "mcp-tools-diff.md"));
      expect(run.output["tools-diff-json-path"]).toBe(jsonPath);
      expect(run.output["tools-diff-summary-path"]).toBe(summaryPath);
      expect(run.manifest.reports.toolsDiffJson).toEqual({ enabled: true, path: jsonPath });
      expect(run.manifest.reports.toolsDiffSummary).toEqual({ enabled: true, path: summaryPath });
      expect(JSON.parse(await readFile(path.join(run.reportDirectory, "mcp-tools-diff.json"), "utf8"))).toEqual({ status: "warn" });
      const summary = await run.runSummary();
      expect(summary).toContain("## MCP Tool Definition Diff");
      expect(summary).toContain(`- Fail on: ${failOn}`);
      expect(summary).toContain("Breaking: 1");
    } finally {
      await run.cleanup();
    }
  });

  it("propagates a failing tool diff exit status", async () => {
    const run = await runArchiveAction({ "tools-diff-before": "before.json", "tools-diff-after": "after.json", "tools-diff-fail-on": "breaking" }, "1");

    try {
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", status: "1" });
      expect(await run.runSummary()).toContain("- Exit status: 1");
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    [{ "tools-diff-before": "before.json" }],
    [{ "tools-diff-after": "after.json" }],
    [{ "tools-diff-before": "before.json", "tools-diff-after": "after.json", "tools-diff-fail-on": "warn" }]
  ])("rejects incomplete or invalid tool diff inputs %j", async (overrides) => {
    const run = await runArchiveAction(overrides);

    try {
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", status: "2" });
      expect(run.output["tools-diff-json-path"]).toBe("");
    } finally {
      await run.cleanup();
    }
  });
});

function invocationsOf(run: ActionRun, command: string): string[][] {
  return run.invocations.filter((invocation) => invocation[0] === command || (invocation[0] === "doctor" && invocation[1] === command));
}

describe("GitHub Action MCP-only behavior", () => {
  const url = "https://mcp.example.test/mcp";

  it("runs only the tool diff when the package check is disabled", async () => {
    const run = await runArchiveAction({ check: "false", "tools-diff-before": "before.json", "tools-diff-after": "after.json" });

    try {
      expect(invocationsOf(run, "check")).toEqual([]);
      expect(toolsDiffInvocations(run)).toHaveLength(2);
      expect(await run.readState()).toMatchObject({ status: "0" });
      expect(run.output["summary-path"]).toBe("");
      expect(run.output["json-path"]).toBe("");
      expect(run.output["sarif-path"]).toBe("");
      expect(run.manifest.target.check).toBe(false);
      expect(run.manifest.reports.json.enabled).toBe(false);
      expect(run.manifest.reports.summary.enabled).toBe(false);
      expect(await run.runSummary()).toContain("MCP Tool Definition Diff");
    } finally {
      await run.cleanup();
    }
  });

  it("keeps the package check enabled by default", async () => {
    const run = await runArchiveAction();

    try {
      expect(invocationsOf(run, "check").length).toBeGreaterThan(0);
      expect(run.manifest.target.check).toBe(true);
      expect(run.output["json-path"]).not.toBe("");
    } finally {
      await run.cleanup();
    }
  });

  it.each([[{ check: "false" }], [{ check: "maybe" }]])("records usage status 2 for %j", async (overrides) => {
    const run = await runArchiveAction(overrides);

    try {
      expect(invocationsOf(run, "check")).toEqual([]);
      expect(await run.readState()).toMatchObject({ status: "2" });
    } finally {
      await run.cleanup();
    }
  });

  it("requires network consent before capturing a tool list", async () => {
    const run = await runArchiveAction({ check: "false", "tools-capture-url": url, "tools-diff-before": "baseline.json" });

    try {
      expect(invocationsOf(run, "tools")).toEqual([]);
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", status: "2" });
      expect(run.output["tools-capture-path"]).toBe("");
    } finally {
      await run.cleanup();
    }
  });

  it("captures the live tool list and compares it with the baseline", async () => {
    const run = await runArchiveAction({ check: "false", "allow-network": "true", "allow-local-network": "true", "tools-capture-url": url, "tools-diff-before": "baseline.json", "tools-diff-fail-on": "breaking" });

    try {
      const capturePath = toBashPath(path.join(run.reportDirectory, "mcp-tools-current.json"));
      expect(invocationsOf(run, "tools")).toEqual([["doctor", "tools", url, "--allow-network", "--save-response", capturePath, "--allow-local-network"]]);
      expect(toolsDiffInvocations(run)[0]).toEqual(["doctor", "tools-diff", "--before", "baseline.json", "--after", capturePath, "--fail-on", "breaking", "--json"]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", status: "0" });
      expect(run.output["tools-capture-path"]).toBe(capturePath);
      expect(run.manifest.reports.toolsCapture).toEqual({ enabled: true, path: capturePath });
    } finally {
      await run.cleanup();
    }
  });

  it("leaves capture findings to the comparison when the capture feeds it", async () => {
    const run = await runArchiveAction({ check: "false", "allow-network": "true", "tools-capture-url": url, "tools-diff-before": "baseline.json", "tools-diff-fail-on": "breaking" }, "0", "1");

    try {
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", status: "0" });
    } finally {
      await run.cleanup();
    }
  });

  it("records capture findings when the capture runs alone", async () => {
    const run = await runArchiveAction({ check: "false", "allow-network": "true", "tools-capture-url": url }, "0", "1");

    try {
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ status: "1" });
      expect(run.output["tools-capture-path"]).not.toBe("");
    } finally {
      await run.cleanup();
    }
  });

  it("never compares a capture left over from an earlier run", async () => {
    const run = await runArchiveAction({ check: "false", "allow-network": "true", "tools-capture-url": url, "tools-diff-before": "baseline.json" }, "0", "2", true);

    try {
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", status: "2" });
      expect(run.output["tools-capture-path"]).toBe("");
      await expect(readFile(path.join(run.reportDirectory, "mcp-tools-current.json"), "utf8")).rejects.toThrow();
    } finally {
      await run.cleanup();
    }
  });

  it("does not publish an earlier package summary when the check is disabled", async () => {
    const run = await runArchiveAction({ check: "false", "tools-diff-before": "before.json", "tools-diff-after": "after.json" }, "0", "0", true);

    try {
      const summary = await run.runSummary();
      expect(summary).not.toContain("stale package summary");
      expect(summary).toContain("MCP Tool Definition Diff");
    } finally {
      await run.cleanup();
    }
  });

  it("does not record runtime probing in the manifest when the check is disabled", async () => {
    const run = await runArchiveAction({ check: "false", runtime: "true", "tools-diff-before": "before.json", "tools-diff-after": "after.json" });

    try {
      expect((run.manifest.target as { runtime: boolean }).runtime).toBe(false);
    } finally {
      await run.cleanup();
    }
  });

  it("skips the comparison when the capture does not save a response", async () => {
    const run = await runArchiveAction({ check: "false", "allow-network": "true", "tools-capture-url": url, "tools-diff-before": "baseline.json" }, "0", "2");

    try {
      expect(invocationsOf(run, "tools")).toHaveLength(1);
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", status: "2" });
      expect(run.output["tools-capture-path"]).toBe("");
      expect(run.manifest.reports.toolsCapture).toEqual({ enabled: false, path: "" });
    } finally {
      await run.cleanup();
    }
  });

  it("uses an explicit after input instead of the capture", async () => {
    const run = await runArchiveAction({ check: "false", "allow-network": "true", "tools-capture-url": url, "tools-diff-before": "baseline.json", "tools-diff-after": "explicit.json" });

    try {
      expect(toolsDiffInvocations(run)[0]).toContain("explicit.json");
      expect(run.output["tools-capture-path"]).not.toBe("");
    } finally {
      await run.cleanup();
    }
  });
});
