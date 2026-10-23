import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  readState: () => Promise<{ submission: string; archive: string; toolsDiff: string; promptsDiff: string; resourceTemplatesDiff: string; status: string }>;
  runSummary: () => Promise<string>;
  runComment: (event: CommentEvent) => Promise<{ stdout: string; gh: string[][]; body: string | null; ghToken: string | null }>;
  cleanup: () => Promise<void>;
};

type CommentEvent = {
  name: string;
  payload?: Record<string, unknown>;
  existing?: string[];
  patchExit?: string;
  postExit?: string;
  withoutGh?: boolean;
  serverUrl?: string;
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

async function cleanupActionFixture(root: string): Promise<void> {
  const resolved = await realpath(root);
  if (path.dirname(resolved) !== await realpath(os.tmpdir()) || !path.basename(resolved).startsWith("codex-plugin-doctor-action-archive-")) {
    throw new Error("Unexpected Action test cleanup target.");
  }
  await rm(resolved, { recursive: true, force: true });
}

async function runArchiveAction(
  overrides: Record<string, string> = {},
  mockToolsDiffExit = "0",
  mockToolsCaptureExit = "0",
  seedEarlierReports = false,
  callerEnvironment: Record<string, string> = {}
): Promise<ActionRun> {
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
  const summaryStep = action.runs.steps.find((step) => step.name === "Publish Codex Plugin Doctor summary");
  const summaryScript = summaryStep?.run;
  const commentStep = action.runs.steps.find((step) => step.name === "Comment Codex Plugin Doctor diffs");

  if (!runDoctorScript || !summaryScript || !commentStep?.run) throw new Error("Expected composite Action run-doctor, summary, and comment scripts.");

  await writeFile(path.join(root, "submission.zip"), "fixture", "utf8");
  await mkdir(binDirectory, { recursive: true });
  await mkdir(runnerDirectory, { recursive: true });
  // The mock is the executable itself: every extra bash process costs hundreds of milliseconds on Windows.
  await writeFile(path.join(binDirectory, "codex-plugin-doctor"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${MOCK_FORBID_CLI:-}" == "true" ]]; then
  printf 'Unexpected CLI execution\\n' >&2
  exit 99
fi
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
if [[ "\${1:-} \${2:-}" == "doctor tools" || "\${1:-} \${2:-}" == "doctor prompts" || "\${1:-} \${2:-}" == "doctor resource-templates" ]]; then
  for (( index = 1; index <= $#; index += 1 )); do
    if [[ "\${!index}" == "--save-response" ]]; then
      next=$((index + 1))
      save="\${!next}"
    fi
  done
  code="\${MOCK_TOOLS_CAPTURE_EXIT:-0}"
  if [[ "\${2:-}" == "prompts" ]]; then code="\${MOCK_PROMPTS_CAPTURE_EXIT:-0}"; fi
  if [[ "\${2:-}" == "resource-templates" ]]; then code="\${MOCK_RESOURCE_TEMPLATES_CAPTURE_EXIT:-0}"; fi
  if [[ "$code" -le 1 ]]; then
    printf '{"jsonrpc":"2.0"}\\n' > "$save"
  fi
  exit "$code"
fi
if [[ "\${1:-} \${2:-}" == "doctor mcp-snapshot" ]]; then
  for (( index = 1; index <= $#; index += 1 )); do
    if [[ "\${!index}" == "--save-dir" ]]; then
      next=$((index + 1))
      save_dir="\${!next}"
    fi
  done
  for kind in \${MOCK_SNAPSHOT_LISTS-tools prompts resource-templates}; do
    printf '{"jsonrpc":"2.0"}\\n' > "$save_dir/mcp-$kind-current.json"
  done
  printf '{"scope":"mcp-snapshot-manifest"}\\n' > "$save_dir/mcp-snapshot-manifest.json"
  exit "\${MOCK_SNAPSHOT_EXIT:-0}"
fi
if [[ "\${1:-} \${2:-}" == "doctor mcp-snapshot-diff" ]]; then
  if [[ " $* " == *" --json "* ]]; then
    printf '{"scope":"%s","status":"warn"}\\n' "\${MOCK_SNAPSHOT_DIFF_SCOPE:-mcp-snapshot-diff}"
  elif [[ " $* " == *" --markdown "* ]]; then
    if [[ -n "\${MOCK_NO_MARKDOWN:-}" ]]; then
      printf 'Invalid comparison arguments.\\n' >&2
      exit 2
    fi
    printf '## MCP Snapshot Diff\\n\\n| List | Outcome |\\n| Prompts | list-removed |\\n'
  else
    printf 'MCP Snapshot Diff\\nPrompts: list-removed (breaking)\\n'
  fi
  exit "\${MOCK_SNAPSHOT_DIFF_EXIT:-0}"
fi
if [[ "\${1:-} \${2:-}" == "doctor tools-diff" ]]; then
  if [[ " $* " == *" --json "* ]]; then
    printf '{"status":"warn"}\\n'
  elif [[ " $* " == *" --markdown "* ]]; then
    if [[ -n "\${MOCK_NO_MARKDOWN:-}" ]]; then
      printf 'Invalid comparison arguments.\\n' >&2
      exit 2
    fi
    printf '## MCP Tool Definition Diff\\n\\n| Breaking |\\n| 1 |\\n'
  else
    printf 'Offline MCP Tool Diff\\nBreaking: 1\\n'
  fi
  exit "\${MOCK_TOOLS_DIFF_EXIT:-0}"
fi
if [[ "\${1:-} \${2:-}" == "doctor prompts-diff" ]]; then
  if [[ " $* " == *" --json "* ]]; then
    printf '{"status":"warn"}\\n'
  elif [[ " $* " == *" --markdown "* ]]; then
    printf '## MCP Prompt Definition Diff\\n\\n| Breaking |\\n| 1 |\\n'
  else
    printf 'Offline MCP Prompt Diff\\nBreaking: 1\\n'
  fi
  exit "\${MOCK_PROMPTS_DIFF_EXIT:-0}"
fi
if [[ "\${1:-} \${2:-}" == "doctor resource-templates-diff" ]]; then
  if [[ " $* " == *" --json "* ]]; then
    printf '{"status":"warn"}\\n'
  elif [[ " $* " == *" --markdown "* ]]; then
    printf '## MCP Resource Template Definition Diff\\n\\n| Breaking |\\n| 1 |\\n'
  else
    printf 'Offline MCP Resource Template Diff\\nBreaking: 1\\n'
  fi
  exit "\${MOCK_RESOURCE_TEMPLATES_DIFF_EXIT:-0}"
fi
if [[ -n "$output" ]]; then
  mkdir -p "\${output%/*}"
  if [[ " $* " == *" doctor submission archive "* ]]; then
    printf '# Archive submission report\\n' > "$output"
  else
    printf '{}\\n' > "$output"
  fi
fi
`, "utf8");
  await chmod(path.join(binDirectory, "codex-plugin-doctor"), 0o755);
  if (seedEarlierReports) {
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(path.join(reportDirectory, "mcp-tools-current.json"), "{}", "utf8");
    await writeFile(path.join(reportDirectory, "mcp-snapshot-manifest.json"), "{}", "utf8");
    await writeFile(path.join(reportDirectory, "codex-plugin-doctor-summary.md"), "stale package summary", "utf8");
    await writeFile(path.join(runnerDirectory, "codex-plugin-doctor-status"), "0", "utf8");
    await writeFile(path.join(runnerDirectory, "codex-plugin-doctor-tools-diff-ran"), "true", "utf8");
  }

  const environment = {
    ...process.env,
    ...callerEnvironment,
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
        promptsDiff: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-prompts-diff-ran"), "utf8"),
        resourceTemplatesDiff: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-resource-templates-diff-ran"), "utf8"),
        snapshotDiff: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-snapshot-diff-ran"), "utf8"),
        status: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-status"), "utf8")
      }),
      runSummary: async () => {
        const summaryScriptPath = path.join(root, "publish-summary.sh");
        await writeFile(summaryScriptPath, renderInputs(summaryScript, inputs), "utf8");
        await chmod(summaryScriptPath, 0o755);
        await execFileAsync(bashExecutable, [summaryScriptPath], {
          cwd: root,
          env: { ...environment, ...Object.fromEntries(Object.entries(summaryStep?.env ?? {}).map(([key, value]) => [key, renderInputs(value, inputs)])) }
        });
        return readFile(stepSummaryPath, "utf8");
      },
      runComment: async (event) => {
        const ghDirectory = path.join(root, "gh-bin");
        const ghLog = path.join(root, "gh.log");
        const bodyCopy = path.join(root, "gh-body.md");
        const tokenCopy = path.join(root, "gh-token");
        const eventPath = path.join(root, "event.json");
        await mkdir(ghDirectory, { recursive: true });
        if (!event.withoutGh) {
          // Stands in for gh: records arguments, copies the posted body, and replays canned results.
          await writeFile(path.join(ghDirectory, "gh"), `#!/usr/bin/env bash
printf '%s\\t' "$@" >> "$GH_LOG"
printf '\\n' >> "$GH_LOG"
printf '%s' "\${GH_TOKEN:-}" > "$GH_TOKEN_COPY"
for argument in "$@"; do
  if [[ "$argument" == body=@* ]]; then cp "\${argument#body=@}" "$GH_BODY_COPY"; fi
done
if [[ " $* " == *" --paginate "* ]]; then
  for id in \${MOCK_GH_EXISTING:-}; do printf '%s\\n' "$id"; done
  exit 0
fi
if [[ " $* " == *" PATCH "* ]]; then exit "\${MOCK_GH_PATCH_EXIT:-0}"; fi
exit "\${MOCK_GH_POST_EXIT:-0}"
`, "utf8");
          await chmod(path.join(ghDirectory, "gh"), 0o755);
        }
        await writeFile(eventPath, JSON.stringify(event.payload ?? {}), "utf8");
        const toolsDirectory = path.join(root, "tools-bin");
        const bashPath = (await execFileAsync(bashExecutable, ["-c", "command -v bash"])).stdout.trim();
        if (event.withoutGh) {
          await mkdir(toolsDirectory, { recursive: true });
          for (const tool of ["cat", "wc", "head", "tail", "grep", "node"]) {
            const { stdout: located } = await execFileAsync(bashExecutable, ["-c", `command -v ${tool}`]);
            await writeFile(path.join(toolsDirectory, tool), `#!${bashPath}\nexec "${located.trim()}" "$@"\n`, "utf8");
            await chmod(path.join(toolsDirectory, tool), 0o755);
          }
        }
        const commentScriptPath = path.join(root, "comment.sh");
        await writeFile(commentScriptPath, renderInputs(commentStep.run as string, inputs), "utf8");
        await chmod(commentScriptPath, 0o755);
        // On Windows the configured bash is already absolute; elsewhere use the resolved path, because
        // the hermetic PATH below holds no bash.
        const { stdout } = await execFileAsync(process.platform === "win32" ? bashExecutable : bashPath, [commentScriptPath], {
          cwd: root,
          env: {
            ...environment,
            ...Object.fromEntries(Object.entries(commentStep.env ?? {}).map(([key, value]) => [key, renderInputs(value, inputs)])),
            PATH: event.withoutGh ? toBashPath(toolsDirectory) : `${toBashPath(ghDirectory)}:${environment.PATH}`,
            GITHUB_SERVER_URL: event.serverUrl ?? "https://github.com",
            GH_LOG: toBashPath(ghLog),
            GH_BODY_COPY: toBashPath(bodyCopy),
            GH_TOKEN_COPY: toBashPath(tokenCopy),
            GITHUB_EVENT_NAME: event.name,
            GITHUB_EVENT_PATH: toBashPath(eventPath),
            GITHUB_REPOSITORY: "owner/repo",
            MOCK_GH_EXISTING: (event.existing ?? []).join(" "),
            MOCK_GH_PATCH_EXIT: event.patchExit ?? "0",
            MOCK_GH_POST_EXIT: event.postExit ?? "0"
          }
        });
        return {
          stdout,
          gh: (await readFile(ghLog, "utf8").catch(() => "")).split(/\r?\n/gu).filter(Boolean).map((line) => line.split("\t").filter(Boolean)),
          body: await readFile(bodyCopy, "utf8").catch(() => null),
          ghToken: await readFile(tokenCopy, "utf8").catch(() => null)
        };
      },
      cleanup: () => cleanupActionFixture(root)
    };
  } catch (error) {
    // Early rejections still hand their state to the later steps, so failed runs expose it too.
    if (error && typeof error === "object") {
      Object.assign(error, {
        actionState: {
          status: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-status"), "utf8").catch(() => undefined),
          toolsDiff: await readFile(path.join(runnerDirectory, "codex-plugin-doctor-tools-diff-ran"), "utf8").catch(() => undefined)
        },
        actionOutput: outputEntries(await readFile(actionOutputPath, "utf8").catch(() => ""))
      });
    }
    await cleanupActionFixture(root);
    throw error;
  }
}

function submissionInvocations(run: ActionRun): string[][] {
  return run.invocations.filter((invocation) => invocation[0] === "doctor" && invocation[1] === "submission");
}

describe("GitHub Action input handling", () => {
  it("passes inputs to scripts only through env, never by expression in run", async () => {
    const action = await loadAction();
    const interpolated = action.runs.steps.filter((step) => step.run?.includes("${{")).map((step) => step.name);
    expect(interpolated).toEqual([]);
  });

  it.each([
    ["config", { config: 'x" --runtime "' }, "x\" --runtime \""],
    ["path", { path: '." --runtime "' }, '." --runtime "']
  ])("keeps a quoted %s value as one argument", async (_label, overrides: Record<string, string>, value) => {
    const run = await runArchiveAction(overrides);

    try {
      const check = run.invocations.find((invocation) => invocation[0] === "check") ?? [];
      expect(check).toContain(value);
      expect(check).not.toContain("--runtime");
    } finally {
      await run.cleanup();
    }
  });
});

describe("GitHub Action input validation", () => {
  it.each([
    ["an option-shaped path", { path: "--runtime" }, "path must not start with -; use ./ before a directory name that starts with -."],
    ["an option-shaped filter", { installed: "true", filter: "--runtime" }, "filter must not start with -; use ./ before a path that starts with -."],
    ["a signing key name that is not a variable name", { "review-bundle": "true", "signing-key-env": "x[$(echo injected >&2)]" }, "signing-key-env must be an environment variable name."],
    ["a multi-line output directory", { "output-dir": "reports\nstatus=0" }, "output-dir must be a single line."],
    ["a multi-line review bundle directory", { "review-bundle-dir": "bundle\nstatus=0" }, "review-bundle-dir must be a single line."]
  ])("rejects %s before any Doctor command", async (_label, overrides: Record<string, string>, stderr) => {
    await expect(runArchiveAction(overrides, "0", "0", false, { MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({
      code: 2,
      stdout: "",
      stderr: `${stderr}\n`,
      actionState: { status: "2" },
      actionOutput: { status: "2" }
    });
  });
});

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
      expect(toolsDiffInvocations(run)).toEqual([[...expected, "--json"], [...expected, "--markdown"]]);
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
      expect(summary).toContain("| Breaking |");
      expect(summary).not.toContain("```text");
    } finally {
      await run.cleanup();
    }
  });

  it("falls back to the text report when the installed CLI has no Markdown output", async () => {
    const run = await runArchiveAction({ "tools-diff-before": "before.json", "tools-diff-after": "after.json" }, "0", "0", false, { MOCK_NO_MARKDOWN: "1" });

    try {
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", status: "0" });
      const summary = await run.runSummary();
      expect(summary).toContain("## MCP Tool Definition Diff");
      expect(summary).toContain("```text\nOffline MCP Tool Diff\nBreaking: 1\n```");
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

describe("GitHub Action authenticated capture", () => {
  const url = "https://mcp.example.test/mcp";
  const capture = { check: "false", "allow-network": "true", "tools-capture-url": url };

  it.each(["true", "false"])("rejects capture credentials with runtime before any CLI invocation (check=%s)", async (check) => {
    await expect(runArchiveAction({
      ...capture, check, runtime: "true", "tools-capture-token-env": "MCP_TOKEN"
    }, "0", "0", true, { MCP_TOKEN: "secret-sentinel", MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({
      code: 2,
      stdout: "",
      stderr: "tools-capture-token-env cannot be combined with runtime probing, which runtime: true, profile: publish, and policy: codex-publish or mcp-strict turn on. Use separate Action steps.\n",
      actionState: { status: "2", toolsDiff: "false" },
      actionOutput: { status: "2" }
    });
  });

  it("forwards only the token variable name to the capture", async () => {
    const run = await runArchiveAction({ ...capture, "tools-capture-token-env": "MCP_TOKEN" }, "0", "0", false, { MCP_TOKEN: "secret-sentinel" });

    try {
      expect(invocationsOf(run, "tools")[0]).toEqual(expect.arrayContaining(["--bearer-token-env", "MCP_TOKEN"]));
      expect(JSON.stringify(run.invocations)).not.toContain("secret-sentinel");
      expect(await run.readState()).toMatchObject({ status: "0" });
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    [{ ...capture, "tools-capture-token-env": "MCP_TOKEN" }, {}],
    [{ ...capture, "tools-capture-token-env": "bad-name" }, { "bad-name": "x" }],
    [{ check: "false", "tools-capture-token-env": "MCP_TOKEN", "tools-diff-before": "a.json", "tools-diff-after": "b.json" }, { MCP_TOKEN: "secret-sentinel" }]
  ])("records usage status 2 without a request for %j", async (overrides, environment) => {
    const run = await runArchiveAction(overrides, "0", "0", false, environment);

    try {
      expect(invocationsOf(run, "tools")).toEqual([]);
      expect(await run.readState()).toMatchObject({ status: "2" });
    } finally {
      await run.cleanup();
    }
  });
});

describe("GitHub Action stdio capture", () => {
  const capture = { check: "false", runtime: "true", "tools-capture-server": "local-server" };

  it("starts the named stdio server only with runtime consent and compares its tool list", async () => {
    const run = await runArchiveAction({ ...capture, "tools-diff-before": "baseline.json", "tools-diff-fail-on": "breaking" });

    try {
      const capturePath = toBashPath(path.join(run.reportDirectory, "mcp-tools-current.json"));
      const packagePath = toBashPath(path.join(run.root, "package"));
      expect(invocationsOf(run, "tools")).toEqual([["doctor", "tools", packagePath, "--server", "local-server", "--runtime", "--save-response", capturePath]]);
      expect(toolsDiffInvocations(run)[0]).toEqual(["doctor", "tools-diff", "--before", "baseline.json", "--after", capturePath, "--fail-on", "breaking", "--json"]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", status: "0" });
      expect(run.output["tools-capture-path"]).toBe(capturePath);
      expect(run.manifest.reports.toolsCapture).toEqual({ enabled: true, path: capturePath });
    } finally {
      await run.cleanup();
    }
  });

  it("runs the stdio capture in the Docker sandbox and forwards variables by name", async () => {
    const run = await runArchiveAction({ ...capture, "tools-capture-sandbox": "docker", "tools-capture-env": "API_KEY, REGION\nTIMEOUT" }, "0", "0", false, { API_KEY: "secret-sentinel" });

    try {
      const capturePath = toBashPath(path.join(run.reportDirectory, "mcp-tools-current.json"));
      const packagePath = toBashPath(path.join(run.root, "package"));
      expect(invocationsOf(run, "tools")).toEqual([[
        "doctor", "tools", packagePath, "--server", "local-server", "--runtime", "--save-response", capturePath,
        "--sandbox", "docker", "--env", "API_KEY", "--env", "REGION", "--env", "TIMEOUT"
      ]]);
      expect(JSON.stringify(run.invocations)).not.toContain("secret-sentinel");
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    [{ ...capture, "tools-capture-sandbox": "podman" }, "tools-capture-sandbox must be docker or empty."],
    [{ check: "false", "tools-capture-sandbox": "docker", "tools-diff-before": "a.json", "tools-diff-after": "b.json" }, "tools-capture-sandbox requires tools-capture-server."],
    [{ ...capture, "tools-capture-env": "API_KEY" }, "tools-capture-env requires tools-capture-sandbox: docker; a native server already inherits the step's environment."],
    [{ ...capture, "tools-capture-sandbox": "docker", "tools-capture-env": "API-KEY" }, "tools-capture-env must list environment variable names."],
    [{ ...capture, "tools-capture-sandbox": "docker", "tools-capture-env": "API_KEY, API_KEY" }, "tools-capture-env lists API_KEY more than once."],
    [{ ...capture, "tools-capture-defer-findings": "yes" }, "tools-capture-defer-findings must be true or false."]
  ])("rejects %j before any CLI invocation", async (overrides, stderr) => {
    await expect(runArchiveAction(overrides, "0", "0", false, { MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({ code: 2, stdout: "", stderr: `${stderr}\n` });
  });

  it("accepts tabs, spaces, and stray commas between capture variable names", async () => {
    const run = await runArchiveAction({ ...capture, "tools-capture-sandbox": "docker", "tools-capture-env": " ,API_KEY\t,, REGION ," });

    try {
      expect(invocationsOf(run, "tools")[0].slice(-4)).toEqual(["--env", "API_KEY", "--env", "REGION"]);
    } finally {
      await run.cleanup();
    }
  });

  it("leaves capture findings to a later comparison when asked to defer them", async () => {
    const run = await runArchiveAction({ ...capture, "tools-capture-defer-findings": "true" }, "0", "1");

    try {
      expect(await run.readState()).toMatchObject({ status: "0" });
      expect(run.output["tools-capture-path"]).not.toBe("");
    } finally {
      await run.cleanup();
    }
  });

  it("still fails a deferred capture that saved nothing", async () => {
    const run = await runArchiveAction({ ...capture, "tools-capture-defer-findings": "true" }, "0", "2");

    try {
      expect(await run.readState()).toMatchObject({ status: "2" });
    } finally {
      await run.cleanup();
    }
  });

  it("records capture findings when the stdio capture runs alone", async () => {
    const run = await runArchiveAction(capture, "0", "1");

    try {
      expect(invocationsOf(run, "tools")).toHaveLength(1);
      expect(await run.readState()).toMatchObject({ status: "1" });
    } finally {
      await run.cleanup();
    }
  });

  it("skips the comparison when the stdio capture does not save a response", async () => {
    const run = await runArchiveAction({ ...capture, "tools-diff-before": "baseline.json" }, "0", "2", true);

    try {
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", status: "2" });
      expect(run.output["tools-capture-path"]).toBe("");
      await expect(readFile(path.join(run.reportDirectory, "mcp-tools-current.json"), "utf8")).rejects.toThrow();
    } finally {
      await run.cleanup();
    }
  });

  it("records usage status 2 without starting a server when runtime consent is missing", async () => {
    const run = await runArchiveAction({ check: "false", "tools-capture-server": "local-server", "tools-diff-before": "baseline.json" });

    try {
      expect(invocationsOf(run, "tools")).toEqual([]);
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ status: "2" });
      expect(run.output["tools-capture-path"]).toBe("");
    } finally {
      await run.cleanup();
    }
  });

  // With check enabled, runtime probing would start servers before a later rejection.
  it.each([
    ["true", { "tools-capture-url": "https://mcp.example.test/mcp", "allow-network": "true" }, "tools-capture-url and tools-capture-server cannot be combined.\n"],
    ["false", { "tools-capture-url": "https://mcp.example.test/mcp", "allow-network": "true" }, "tools-capture-url and tools-capture-server cannot be combined.\n"],
    ["true", { installed: "true" }, "tools-capture-server reads the package at path and cannot be combined with installed: true.\n"],
    ["false", { installed: "true" }, "tools-capture-server reads the package at path and cannot be combined with installed: true.\n"]
  ])("rejects conflicting capture inputs before any CLI invocation (check=%s, %j)", async (check, overrides, stderr) => {
    await expect(runArchiveAction({
      ...capture, check, ...overrides
    }, "0", "0", true, { MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({
      code: 2,
      stdout: "",
      stderr,
      actionState: { status: "2", toolsDiff: "false" },
      actionOutput: { status: "2" }
    });
  });

  it("rejects capture credentials with a stdio capture before any CLI invocation", async () => {
    await expect(runArchiveAction({
      ...capture, "tools-capture-token-env": "MCP_TOKEN"
    }, "0", "0", false, { MCP_TOKEN: "secret-sentinel", MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({ code: 2, stdout: "" });
  });
});

describe("GitHub Action tool diff pull request comment", () => {
  const diff = { check: "false", "tools-diff-before": "before.json", "tools-diff-after": "after.json", "tools-diff-comment": "true", "github-token": "token-sentinel" };
  const pullRequest = { name: "pull_request", payload: { pull_request: { number: 42 } } };
  const marker = "<!-- codex-plugin-doctor:tools-diff -->";

  it("posts the tool diff summary with a marker on a pull request", async () => {
    const run = await runArchiveAction(diff);

    try {
      const comment = await run.runComment(pullRequest);
      expect(comment.gh[0]).toEqual(expect.arrayContaining(["api", "--paginate", "repos/owner/repo/issues/42/comments"]));
      expect(comment.gh[1]).toEqual(expect.arrayContaining(["api", "-X", "POST", "repos/owner/repo/issues/42/comments"]));
      expect(comment.body?.startsWith(`${marker}\n## MCP Tool Definition Diff`)).toBe(true);
      expect(comment.body).toContain("- Fail on: any");
      expect(comment.ghToken).toBe("token-sentinel");
      expect(JSON.stringify(comment.gh)).not.toContain("token-sentinel");
      expect(comment.stdout).toContain("Posted the Codex Plugin Doctor tool diff comment.");
    } finally {
      await run.cleanup();
    }
  });

  it("updates the latest existing marker comment instead of posting another", async () => {
    const run = await runArchiveAction(diff);

    try {
      const comment = await run.runComment({ ...pullRequest, existing: ["101", "202"] });
      expect(comment.gh).toHaveLength(2);
      expect(comment.gh[1]).toEqual(expect.arrayContaining(["api", "-X", "PATCH", "repos/owner/repo/issues/comments/202"]));
      // Only bot comments that start with the marker may be edited.
      expect(comment.gh[0]).toContain(`.[] | select(.user.type == "Bot" and (.body | startswith("${marker}"))) | .id`);
      expect(comment.stdout).toContain("Updated the Codex Plugin Doctor tool diff comment.");
    } finally {
      await run.cleanup();
    }
  });

  it("posts a new comment when the existing one cannot be updated", async () => {
    const run = await runArchiveAction(diff);

    try {
      const comment = await run.runComment({ ...pullRequest, existing: ["202"], patchExit: "1" });
      expect(comment.gh.map((call) => call.find((arg) => ["--paginate", "PATCH", "POST"].includes(arg)))).toEqual(["--paginate", "PATCH", "POST"]);
    } finally {
      await run.cleanup();
    }
  });

  it("warns without failing when the comment cannot be posted", async () => {
    const run = await runArchiveAction(diff);

    try {
      const comment = await run.runComment({ ...pullRequest, postExit: "1" });
      expect(comment.stdout).toContain("::warning::Codex Plugin Doctor could not post the tool diff comment.");
    } finally {
      await run.cleanup();
    }
  });

  it("runs the comment step only when enabled, and gives the token to that step alone", async () => {
    const action = await loadAction();
    const steps = action.runs.steps as Array<{ name?: string; id?: string; if?: string; env?: Record<string, string>; run?: string }>;
    const comment = steps.find((step) => step.name === "Comment Codex Plugin Doctor diffs");
    const skip = steps.find((step) => step.name === "Skip Codex Plugin Doctor diff comments");
    // Evaluated by the runner, so package code cannot change it; every input that starts package code is listed.
    const commentRequested = "(inputs['tools-diff-comment'] == 'true' || inputs['prompts-diff-comment'] == 'true' || inputs['resource-templates-diff-comment'] == 'true' || inputs['snapshot-diff-comment'] == 'true')";
    const packageCode = "(inputs.runtime == 'true' || inputs.profile == 'publish' || inputs.policy == 'codex-publish' || inputs.policy == 'mcp-strict')";
    // Package code may have replaced tools on PATH for later steps, whatever the event.
    expect(comment?.if).toBe(`${"${{"} always() && ${commentRequested} && !${packageCode} }}`);
    expect(skip?.if).toBe(`${"${{"} always() && ${commentRequested} && ${packageCode} }}`);
    expect(skip?.env).toBeUndefined();
    expect(skip?.run).toContain("::warning::Diff comments skipped because this Action invocation ran package code or was allowed to.");
    expect(comment?.env?.GH_TOKEN).toBe("${{ inputs['github-token'] }}");
    const others = steps.filter((step) => step !== comment).map((step) => JSON.stringify(step));
    expect(others.some((step) => step.includes("github-token"))).toBe(false);
    expect(action.inputs["tools-diff-comment"].default).toBe("false");
    expect(action.inputs["prompts-diff-comment"].default).toBe("false");
    expect(action.inputs["resource-templates-diff-comment"].default).toBe("false");
    expect(action.inputs["snapshot-diff-comment"].default).toBe("false");
  });

  it.each([
    ["no tool diff ran", { check: "false", "tools-diff-comment": "true", "tools-diff-before": "before.json" }, pullRequest, true],
    ["the event is not a pull request", diff, { name: "push", payload: {} }, true],
    ["the event has no pull request number", diff, { name: "pull_request", payload: { pull_request: { number: "x" } } }, true],
    ["gh is not installed", diff, { ...pullRequest, withoutGh: true }, "the GitHub CLI is not installed."],
    ["the server is not GitHub.com", diff, { ...pullRequest, serverUrl: "https://github.example.test" }, "Tool diff comment skipped because it supports GitHub.com only."]
  ])("skips the comment when %s", async (_label, overrides, event, message) => {
    const run = await runArchiveAction(overrides);

    try {
      const comment = await run.runComment(event);
      expect(comment.gh).toEqual([]);
      expect(comment.body).toBeNull();
      if (typeof message === "string") expect(comment.stdout).toContain(message);
      else if (message) expect(comment.stdout).toMatch(/Tool diff comment skipped/u);
    } finally {
      await run.cleanup();
    }
  });

  it("truncates a summary that would exceed the comment size limit", async () => {
    const run = await runArchiveAction(diff);

    try {
      await writeFile(path.join(run.reportDirectory, "mcp-tools-diff.md"), "x".repeat(70_000), "utf8");
      const comment = await run.runComment(pullRequest);
      expect(comment.body?.length).toBeLessThanOrEqual(65_536);
      expect(comment.body).toContain("Truncated; the full diff is in mcp-tools-diff.md in the report directory.");
    } finally {
      await run.cleanup();
    }
  });

  it("forgets a tool diff from an earlier invocation before installing the CLI", async () => {
    const install = (await loadAction()).runs.steps.find((step) => step.name === "Install Codex Plugin Doctor")?.run ?? "";
    expect(install.indexOf('rm -f "${RUNNER_TEMP:-.}/codex-plugin-doctor-tools-diff-ran"')).toBeGreaterThanOrEqual(0);
    expect(install.indexOf("rm -f")).toBeLessThan(install.indexOf("npm install"));
  });

  it("forgets a tool diff from an earlier invocation when this one stops unexpectedly", async () => {
    // The mock CLI fails its version check, so the run step stops before recording any state.
    await expect(runArchiveAction(diff, "0", "0", true, { MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({
      code: 99,
      actionState: { toolsDiff: undefined }
    });
  });

  it("closes a code fence that truncation leaves open", async () => {
    const run = await runArchiveAction(diff);

    try {
      await writeFile(path.join(run.reportDirectory, "mcp-tools-diff.md"), `## MCP Tool Definition Diff\n\n\`\`\`text\n${"line\n".repeat(20_000)}\`\`\`\n`, "utf8");
      const comment = await run.runComment(pullRequest);
      const fences = (comment.body ?? "").split("\n").filter((line) => line.startsWith("\`\`\`"));
      expect(fences.length % 2).toBe(0);
    } finally {
      await run.cleanup();
    }
  });
});

function promptsDiffInvocations(run: ActionRun): string[][] {
  return run.invocations.filter((invocation) => invocation[0] === "doctor" && invocation[1] === "prompts-diff");
}

describe("GitHub Action prompt diff", () => {
  const capture = { check: "false", runtime: "true", "prompts-capture-server": "local-server" };

  it("compares saved prompt lists and publishes their reports without a tool diff", async () => {
    const run = await runArchiveAction({ check: "false", "prompts-diff-before": "before.json", "prompts-diff-after": "after.json", "prompts-diff-fail-on": "breaking" });

    try {
      const jsonPath = toBashPath(path.join(run.reportDirectory, "mcp-prompts-diff.json"));
      expect(promptsDiffInvocations(run)[0]).toEqual(["doctor", "prompts-diff", "--before", "before.json", "--after", "after.json", "--fail-on", "breaking", "--json"]);
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", promptsDiff: "true", status: "0" });
      expect(run.output["prompts-diff-json-path"]).toBe(jsonPath);
      expect(run.output["tools-diff-json-path"]).toBe("");
      expect(run.manifest.reports.promptsDiffJson).toEqual({ enabled: true, path: jsonPath });
      expect(run.manifest.reports.toolsDiffJson).toEqual({ enabled: false, path: "" });
      const summary = await run.runSummary();
      expect(summary).toContain("MCP Prompt Definition Diff");
      expect(summary).not.toContain("MCP Tool Definition Diff");
    } finally {
      await run.cleanup();
    }
  });

  it("propagates a failing prompt diff exit status", async () => {
    const run = await runArchiveAction({ check: "false", "prompts-diff-before": "before.json", "prompts-diff-after": "after.json" }, "0", "0", false, { MOCK_PROMPTS_DIFF_EXIT: "1" });

    try {
      expect(await run.readState()).toMatchObject({ promptsDiff: "true", status: "1" });
    } finally {
      await run.cleanup();
    }
  });

  it("captures a stdio server's prompt list in the Docker sandbox and compares it with the baseline", async () => {
    const run = await runArchiveAction({ ...capture, "prompts-capture-sandbox": "docker", "prompts-capture-env": "API_KEY", "prompts-diff-before": "baseline.json" }, "0", "0", false, { API_KEY: "secret-sentinel" });

    try {
      const capturePath = toBashPath(path.join(run.reportDirectory, "mcp-prompts-current.json"));
      const packagePath = toBashPath(path.join(run.root, "package"));
      expect(invocationsOf(run, "prompts")).toEqual([[
        "doctor", "prompts", packagePath, "--server", "local-server", "--runtime", "--save-response", capturePath, "--sandbox", "docker", "--env", "API_KEY"
      ]]);
      expect(invocationsOf(run, "tools")).toEqual([]);
      expect(promptsDiffInvocations(run)[0]).toEqual(["doctor", "prompts-diff", "--before", "baseline.json", "--after", capturePath, "--fail-on", "any", "--json"]);
      expect(run.output["prompts-capture-path"]).toBe(capturePath);
      expect(run.manifest.reports.promptsCapture).toEqual({ enabled: true, path: capturePath });
      expect(JSON.stringify(run.invocations)).not.toContain("secret-sentinel");
    } finally {
      await run.cleanup();
    }
  });

  it("captures and compares tools and prompts from one server independently", async () => {
    const run = await runArchiveAction({
      ...capture, "tools-capture-server": "local-server", "tools-diff-before": "tools.json", "prompts-diff-before": "prompts.json"
    }, "0", "0", false, { MOCK_PROMPTS_CAPTURE_EXIT: "2" });

    try {
      expect(invocationsOf(run, "tools")).toHaveLength(1);
      expect(invocationsOf(run, "prompts")).toHaveLength(1);
      expect(toolsDiffInvocations(run)).toHaveLength(2);
      // The prompt capture saved nothing, so its comparison is skipped and the step fails.
      expect(promptsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", promptsDiff: "false", status: "2" });
      expect(run.output["tools-capture-path"]).not.toBe("");
      expect(run.output["prompts-capture-path"]).toBe("");
    } finally {
      await run.cleanup();
    }
  });

  it("requires network consent before capturing a prompt list over HTTP", async () => {
    const run = await runArchiveAction({ check: "false", "prompts-capture-url": "https://mcp.example.test/mcp", "prompts-diff-before": "baseline.json" });

    try {
      expect(invocationsOf(run, "prompts")).toEqual([]);
      expect(await run.readState()).toMatchObject({ promptsDiff: "false", status: "2" });
    } finally {
      await run.cleanup();
    }
  });

  it("forwards only the prompt token variable name to an HTTP capture", async () => {
    const url = "https://mcp.example.test/mcp";
    const run = await runArchiveAction({ check: "false", "allow-network": "true", "prompts-capture-url": url, "prompts-capture-token-env": "MCP_TOKEN" }, "0", "0", false, { MCP_TOKEN: "secret-sentinel" });

    try {
      const capturePath = toBashPath(path.join(run.reportDirectory, "mcp-prompts-current.json"));
      expect(invocationsOf(run, "prompts")).toEqual([["doctor", "prompts", url, "--allow-network", "--save-response", capturePath, "--bearer-token-env", "MCP_TOKEN"]]);
      expect(JSON.stringify(run.invocations)).not.toContain("secret-sentinel");
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    [{ ...capture, "prompts-capture-sandbox": "podman" }, "prompts-capture-sandbox must be docker or empty."],
    [{ ...capture, "prompts-capture-env": "API_KEY" }, "prompts-capture-env requires prompts-capture-sandbox: docker; a native server already inherits the step's environment."],
    [{ ...capture, "prompts-capture-url": "https://mcp.example.test/mcp" }, "prompts-capture-url and prompts-capture-server cannot be combined."],
    [{ ...capture, "prompts-capture-defer-findings": "yes" }, "prompts-capture-defer-findings must be true or false."],
    [{ ...capture, "prompts-capture-token-env": "MCP_TOKEN" }, "prompts-capture-token-env cannot be combined with runtime probing, which runtime: true, profile: publish, and policy: codex-publish or mcp-strict turn on. Use separate Action steps."],
    [{ check: "false", "prompts-capture-sandbox": "docker", "prompts-diff-before": "a.json", "prompts-diff-after": "b.json" }, "prompts-capture-sandbox requires prompts-capture-server."],
    [{ ...capture, installed: "true" }, "prompts-capture-server reads the package at path and cannot be combined with installed: true."],
    [{ ...capture, "prompts-capture-sandbox": "docker", "prompts-capture-env": "API-KEY" }, "prompts-capture-env must list environment variable names."],
    [{ ...capture, "prompts-capture-sandbox": "docker", "prompts-capture-env": "API_KEY, API_KEY" }, "prompts-capture-env lists API_KEY more than once."]
  ])("rejects %j before any CLI invocation", async (overrides, stderr) => {
    await expect(runArchiveAction(overrides, "0", "0", false, { MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({ code: 2, stdout: "", stderr: `${stderr}\n` });
  });

  it.each([
    ["a stdio capture without runtime consent", { check: "false", "prompts-capture-server": "local-server", "prompts-diff-before": "baseline.json" }, {}],
    ["a token variable without an HTTP capture", { check: "false", "prompts-capture-token-env": "MCP_TOKEN", "prompts-diff-before": "a.json", "prompts-diff-after": "b.json" }, { MCP_TOKEN: "secret-sentinel" }],
    ["a token variable name that is not a name", { check: "false", "allow-network": "true", "prompts-capture-url": "https://mcp.example.test/mcp", "prompts-capture-token-env": "MCP-TOKEN" }, {}],
    ["an unset token variable", { check: "false", "allow-network": "true", "prompts-capture-url": "https://mcp.example.test/mcp", "prompts-capture-token-env": "MCP_TOKEN" }, {}]
  ])("records status 2 without capturing prompts for %s", async (_label, overrides, environment) => {
    const run = await runArchiveAction(overrides, "0", "0", false, environment);

    try {
      expect(invocationsOf(run, "prompts")).toEqual([]);
      expect(await run.readState()).toMatchObject({ status: "2" });
      expect(run.output["prompts-capture-path"]).toBe("");
    } finally {
      await run.cleanup();
    }
  });

  it("rejects an invalid prompt diff failure mode", async () => {
    const run = await runArchiveAction({ check: "false", "prompts-diff-before": "a.json", "prompts-diff-after": "b.json", "prompts-diff-fail-on": "warn" });

    try {
      expect(promptsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ promptsDiff: "false", status: "2" });
    } finally {
      await run.cleanup();
    }
  });
});

describe("GitHub Action prompt diff pull request comment", () => {
  const pullRequest = { name: "pull_request", payload: { pull_request: { number: 42 } } };
  const promptsDiff = { check: "false", "prompts-diff-before": "before.json", "prompts-diff-after": "after.json", "prompts-diff-comment": "true", "github-token": "token-sentinel" };

  it("posts the prompt diff under its own marker", async () => {
    const run = await runArchiveAction(promptsDiff);

    try {
      const comment = await run.runComment(pullRequest);
      expect(comment.gh).toHaveLength(2);
      expect(comment.gh[0]).toContain('.[] | select(.user.type == "Bot" and (.body | startswith("<!-- codex-plugin-doctor:prompts-diff -->"))) | .id');
      expect(comment.body?.startsWith("<!-- codex-plugin-doctor:prompts-diff -->\n## MCP Prompt Definition Diff")).toBe(true);
      expect(comment.stdout).toContain("Posted the Codex Plugin Doctor prompt diff comment.");
      expect(comment.stdout).not.toContain("tool diff");
    } finally {
      await run.cleanup();
    }
  });

  it("posts the tool and prompt diffs as two comments when both are enabled", async () => {
    const run = await runArchiveAction({ ...promptsDiff, "tools-diff-before": "tools-before.json", "tools-diff-after": "tools-after.json", "tools-diff-comment": "true" });

    try {
      const comment = await run.runComment(pullRequest);
      expect(comment.gh.filter((call) => call.includes("POST"))).toHaveLength(2);
      expect(comment.stdout).toContain("Posted the Codex Plugin Doctor tool diff comment.");
      expect(comment.stdout).toContain("Posted the Codex Plugin Doctor prompt diff comment.");
    } finally {
      await run.cleanup();
    }
  });

  it("treats comment flags without regard to case, as the step condition does", async () => {
    const run = await runArchiveAction({ ...promptsDiff, "prompts-diff-comment": "True" });

    try {
      expect((await run.runComment(pullRequest)).stdout).toContain("Posted the Codex Plugin Doctor prompt diff comment.");
    } finally {
      await run.cleanup();
    }
  });

  it("skips the prompt comment when no prompt diff ran", async () => {
    const run = await runArchiveAction({ check: "false", "prompts-diff-comment": "true", "prompts-diff-before": "before.json" });

    try {
      const comment = await run.runComment(pullRequest);
      expect(comment.gh).toEqual([]);
      expect(comment.stdout).toContain("Prompt diff comment skipped because no prompt diff ran.");
    } finally {
      await run.cleanup();
    }
  });

  it("names the prompt summary file when truncating", async () => {
    const run = await runArchiveAction(promptsDiff);

    try {
      await writeFile(path.join(run.reportDirectory, "mcp-prompts-diff.md"), "x".repeat(70_000), "utf8");
      const comment = await run.runComment(pullRequest);
      expect(comment.body?.length).toBeLessThanOrEqual(65_536);
      expect(comment.body).toContain("Truncated; the full diff is in mcp-prompts-diff.md in the report directory.");
    } finally {
      await run.cleanup();
    }
  });
});

function resourceTemplatesDiffInvocations(run: ActionRun): string[][] {
  return run.invocations.filter((invocation) => invocation[0] === "doctor" && invocation[1] === "resource-templates-diff");
}

describe("GitHub Action resource template diff", () => {
  const capture = { check: "false", runtime: "true", "resource-templates-capture-server": "local-server" };

  it("compares saved resource template lists and publishes their reports on their own", async () => {
    const run = await runArchiveAction({ check: "false", "resource-templates-diff-before": "before.json", "resource-templates-diff-after": "after.json", "resource-templates-diff-fail-on": "breaking" });

    try {
      const jsonPath = toBashPath(path.join(run.reportDirectory, "mcp-resource-templates-diff.json"));
      expect(resourceTemplatesDiffInvocations(run)[0]).toEqual([
        "doctor", "resource-templates-diff", "--before", "before.json", "--after", "after.json", "--fail-on", "breaking", "--json"
      ]);
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(promptsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", promptsDiff: "false", resourceTemplatesDiff: "true", status: "0" });
      expect(run.output["resource-templates-diff-json-path"]).toBe(jsonPath);
      expect(run.manifest.reports.resourceTemplatesDiffJson).toEqual({ enabled: true, path: jsonPath });
      expect(await run.runSummary()).toContain("MCP Resource Template Definition Diff");
    } finally {
      await run.cleanup();
    }
  });

  it("propagates a failing resource template diff exit status", async () => {
    const run = await runArchiveAction({ check: "false", "resource-templates-diff-before": "a.json", "resource-templates-diff-after": "b.json" }, "0", "0", false, { MOCK_RESOURCE_TEMPLATES_DIFF_EXIT: "1" });

    try {
      expect(await run.readState()).toMatchObject({ resourceTemplatesDiff: "true", status: "1" });
    } finally {
      await run.cleanup();
    }
  });

  it("captures a stdio server's templates in the Docker sandbox and compares them with the baseline", async () => {
    const run = await runArchiveAction({
      ...capture, "resource-templates-capture-sandbox": "docker", "resource-templates-capture-env": "API_KEY", "resource-templates-diff-before": "baseline.json"
    }, "0", "0", false, { API_KEY: "secret-sentinel" });

    try {
      const capturePath = toBashPath(path.join(run.reportDirectory, "mcp-resource-templates-current.json"));
      const packagePath = toBashPath(path.join(run.root, "package"));
      expect(invocationsOf(run, "resource-templates")).toEqual([[
        "doctor", "resource-templates", packagePath, "--server", "local-server", "--runtime", "--save-response", capturePath, "--sandbox", "docker", "--env", "API_KEY"
      ]]);
      expect(resourceTemplatesDiffInvocations(run)[0]).toEqual(["doctor", "resource-templates-diff", "--before", "baseline.json", "--after", capturePath, "--fail-on", "any", "--json"]);
      expect(run.output["resource-templates-capture-path"]).toBe(capturePath);
      expect(run.manifest.reports.resourceTemplatesCapture).toEqual({ enabled: true, path: capturePath });
      expect(JSON.stringify(run.invocations)).not.toContain("secret-sentinel");
    } finally {
      await run.cleanup();
    }
  });

  it("captures and compares all three lists from one server independently", async () => {
    const run = await runArchiveAction({
      ...capture,
      "tools-capture-server": "local-server", "tools-diff-before": "tools.json",
      "prompts-capture-server": "local-server", "prompts-diff-before": "prompts.json",
      "resource-templates-diff-before": "templates.json"
    }, "0", "0", false, { MOCK_RESOURCE_TEMPLATES_CAPTURE_EXIT: "2" });

    try {
      expect(invocationsOf(run, "tools")).toHaveLength(1);
      expect(invocationsOf(run, "prompts")).toHaveLength(1);
      expect(invocationsOf(run, "resource-templates")).toHaveLength(1);
      // The template capture saved nothing, so only its comparison is skipped and the step fails.
      expect(resourceTemplatesDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", promptsDiff: "true", resourceTemplatesDiff: "false", status: "2" });
      expect(run.output["resource-templates-capture-path"]).toBe("");
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    [{ ...capture, "resource-templates-capture-sandbox": "podman" }, "resource-templates-capture-sandbox must be docker or empty."],
    [{ ...capture, "resource-templates-capture-url": "https://mcp.example.test/mcp" }, "resource-templates-capture-url and resource-templates-capture-server cannot be combined."],
    [{ ...capture, "resource-templates-capture-token-env": "MCP_TOKEN" }, "resource-templates-capture-token-env cannot be combined with runtime probing, which runtime: true, profile: publish, and policy: codex-publish or mcp-strict turn on. Use separate Action steps."],
    [{ ...capture, "resource-templates-capture-defer-findings": "yes" }, "resource-templates-capture-defer-findings must be true or false."]
  ])("rejects %j before any CLI invocation", async (overrides, stderr) => {
    await expect(runArchiveAction(overrides, "0", "0", false, { MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({ code: 2, stdout: "", stderr: `${stderr}\n` });
  });

  it("requires network consent before capturing templates over HTTP", async () => {
    const run = await runArchiveAction({ check: "false", "resource-templates-capture-url": "https://mcp.example.test/mcp", "resource-templates-diff-before": "baseline.json" });

    try {
      expect(invocationsOf(run, "resource-templates")).toEqual([]);
      expect(await run.readState()).toMatchObject({ resourceTemplatesDiff: "false", status: "2" });
    } finally {
      await run.cleanup();
    }
  });
});

describe("GitHub Action MCP snapshot", () => {
  const snapshot = { check: "false", runtime: "true", "snapshot-server": "local-server" };
  const allDiffs = { "tools-diff-before": "tools.json", "prompts-diff-before": "prompts.json", "resource-templates-diff-before": "templates.json" };

  it("reads every list in one sandboxed session and compares each saved list with its baseline", async () => {
    const run = await runArchiveAction({
      ...snapshot, "snapshot-sandbox": "docker", "snapshot-env": "API_KEY", ...allDiffs
    }, "0", "0", false, { API_KEY: "secret-sentinel" });

    try {
      const reportDirectory = toBashPath(run.reportDirectory);
      const packagePath = toBashPath(path.join(run.root, "package"));
      expect(invocationsOf(run, "mcp-snapshot")).toEqual([[
        "doctor", "mcp-snapshot", packagePath, "--server", "local-server", "--runtime", "--save-dir", reportDirectory, "--sandbox", "docker", "--env", "API_KEY"
      ]]);
      for (const command of ["tools", "prompts", "resource-templates"]) expect(invocationsOf(run, command)).toEqual([]);
      expect(toolsDiffInvocations(run)[0]).toEqual(["doctor", "tools-diff", "--before", "tools.json", "--after", `${reportDirectory}/mcp-tools-current.json`, "--fail-on", "any", "--json"]);
      expect(promptsDiffInvocations(run)[0]).toEqual(["doctor", "prompts-diff", "--before", "prompts.json", "--after", `${reportDirectory}/mcp-prompts-current.json`, "--fail-on", "any", "--json"]);
      expect(resourceTemplatesDiffInvocations(run)[0]).toEqual([
        "doctor", "resource-templates-diff", "--before", "templates.json", "--after", `${reportDirectory}/mcp-resource-templates-current.json`, "--fail-on", "any", "--json"
      ]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", promptsDiff: "true", resourceTemplatesDiff: "true", status: "0" });
      expect(run.output["prompts-capture-path"]).toBe(`${reportDirectory}/mcp-prompts-current.json`);
      expect(run.manifest.reports.resourceTemplatesCapture).toEqual({ enabled: true, path: `${reportDirectory}/mcp-resource-templates-current.json` });
      expect(JSON.stringify(run.invocations)).not.toContain("secret-sentinel");
    } finally {
      await run.cleanup();
    }
  });

  it("snapshots an HTTP endpoint with network consent and a bearer token by name", async () => {
    const url = "https://mcp.example.test/mcp";
    const refused = await runArchiveAction({ check: "false", "snapshot-url": url });
    try {
      expect(invocationsOf(refused, "mcp-snapshot")).toEqual([]);
      expect(await refused.readState()).toMatchObject({ status: "2" });
    } finally {
      await refused.cleanup();
    }

    const run = await runArchiveAction({ check: "false", "allow-network": "true", "snapshot-url": url, "snapshot-token-env": "MCP_TOKEN" }, "0", "0", false, { MCP_TOKEN: "token-sentinel" });
    try {
      expect(invocationsOf(run, "mcp-snapshot")).toEqual([[
        "doctor", "mcp-snapshot", url, "--allow-network", "--save-dir", toBashPath(run.reportDirectory), "--bearer-token-env", "MCP_TOKEN"
      ]]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", status: "0" });
      expect(run.output["tools-capture-path"]).toBe(toBashPath(path.join(run.reportDirectory, "mcp-tools-current.json")));
    } finally {
      await run.cleanup();
    }
  });

  it("compares only the lists the snapshot saved and never a stale capture", async () => {
    const run = await runArchiveAction({ ...snapshot, ...allDiffs }, "0", "0", true, { MOCK_SNAPSHOT_LISTS: "prompts", MOCK_SNAPSHOT_EXIT: "2" });

    try {
      expect(promptsDiffInvocations(run)[0]).toContain(`${toBashPath(run.reportDirectory)}/mcp-prompts-current.json`);
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(resourceTemplatesDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", promptsDiff: "true", resourceTemplatesDiff: "false", status: "2" });
      expect(run.output["tools-capture-path"]).toBe("");
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    ["no comparison runs", {}, "1"],
    ["findings are deferred", { "snapshot-defer-findings": "true" }, "0"],
    ["every saved list feeds a comparison", allDiffs, "0"],
    ["a saved list feeds no comparison", { "tools-diff-before": "tools.json" }, "1"]
  ])("records snapshot findings when %s", async (_case, overrides, status) => {
    const run = await runArchiveAction({ ...snapshot, ...overrides }, "0", "0", false, { MOCK_SNAPSHOT_EXIT: "1" });

    try {
      expect(await run.readState()).toMatchObject({ status });
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    ["every compared list was saved", "prompts resource-templates", { "prompts-diff-before": "prompts.json" }, "0"],
    ["a compared list was not saved", "prompts", { "tools-diff-before": "tools.json" }, "2"]
  ])("leaves an incomplete deferred snapshot to its comparisons when %s", async (_case, lists, diffs, status) => {
    const run = await runArchiveAction({ ...snapshot, "snapshot-defer-findings": "true", ...diffs }, "0", "0", false, { MOCK_SNAPSHOT_LISTS: lists, MOCK_SNAPSHOT_EXIT: "2" });

    try {
      expect(await run.readState()).toMatchObject({ status });
    } finally {
      await run.cleanup();
    }
  });

  it("keeps an explicit diff after input ahead of the snapshot file", async () => {
    const run = await runArchiveAction({ ...snapshot, "tools-diff-before": "tools.json", "tools-diff-after": "explicit.json" });

    try {
      expect(toolsDiffInvocations(run)[0]).toEqual(["doctor", "tools-diff", "--before", "tools.json", "--after", "explicit.json", "--fail-on", "any", "--json"]);
      expect(run.output["tools-capture-path"]).toBe(toBashPath(path.join(run.reportDirectory, "mcp-tools-current.json")));
    } finally {
      await run.cleanup();
    }
  });

  it("starts no server without runtime consent and skips the comparison it would feed", async () => {
    const run = await runArchiveAction({ check: "false", "snapshot-server": "local-server", "tools-diff-before": "tools.json" }, "0", "0", true);

    try {
      expect(invocationsOf(run, "mcp-snapshot")).toEqual([]);
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "false", status: "2" });
      expect(run.output["tools-capture-path"]).toBe("");
      // The earlier run's manifest goes with its list files, so it can never describe this run.
      await expect(stat(path.join(run.reportDirectory, "mcp-snapshot-manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await run.cleanup();
    }
  });

  it("records status 2 for snapshot-token-env without snapshot-url", async () => {
    const run = await runArchiveAction({ check: "false", "snapshot-token-env": "MCP_TOKEN", "tools-diff-before": "a.json", "tools-diff-after": "b.json" });

    try {
      expect(invocationsOf(run, "mcp-snapshot")).toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", status: "2" });
    } finally {
      await run.cleanup();
    }
  });

  it.each(["false", "true"])("records status 2 when the snapshot saves no list, with deferred findings %s", async (defer) => {
    const run = await runArchiveAction({ ...snapshot, "snapshot-defer-findings": defer }, "0", "0", false, { MOCK_SNAPSHOT_LISTS: "", MOCK_SNAPSHOT_EXIT: "1" });

    try {
      expect(await run.readState()).toMatchObject({ status: "2" });
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    [{ ...snapshot, "tools-capture-server": "local-server" }, "snapshot-url and snapshot-server cannot be combined with the tools-, prompts-, or resource-templates-capture inputs."],
    [{ ...snapshot, "snapshot-url": "https://mcp.example.test/mcp" }, "snapshot-url and snapshot-server cannot be combined."],
    [{ check: "false", "snapshot-sandbox": "docker" }, "snapshot-sandbox requires snapshot-server."],
    [{ ...snapshot, "snapshot-env": "API_KEY" }, "snapshot-env requires snapshot-sandbox: docker; a native server already inherits the step's environment."],
    [{ ...snapshot, "snapshot-defer-findings": "yes" }, "snapshot-defer-findings must be true or false."],
    [{ ...snapshot, installed: "true" }, "snapshot-server reads the package at path and cannot be combined with installed: true."],
    [{ ...snapshot, "snapshot-token-env": "MCP_TOKEN" }, "snapshot-token-env cannot be combined with runtime probing, which runtime: true, profile: publish, and policy: codex-publish or mcp-strict turn on. Use separate Action steps."],
    [
      { profile: "publish", "allow-network": "true", "snapshot-url": "https://mcp.example.test/mcp", "snapshot-token-env": "MCP_TOKEN" },
      "snapshot-token-env cannot be combined with runtime probing, which runtime: true, profile: publish, and policy: codex-publish or mcp-strict turn on. Use separate Action steps."
    ],
    [
      { policy: "mcp-strict", "allow-network": "true", "tools-capture-url": "https://mcp.example.test/mcp", "tools-capture-token-env": "MCP_TOKEN" },
      "tools-capture-token-env cannot be combined with runtime probing, which runtime: true, profile: publish, and policy: codex-publish or mcp-strict turn on. Use separate Action steps."
    ],
    [
      { policy: "codex-publish", "allow-network": "true", "prompts-capture-url": "https://mcp.example.test/mcp", "prompts-capture-token-env": "MCP_TOKEN" },
      "prompts-capture-token-env cannot be combined with runtime probing, which runtime: true, profile: publish, and policy: codex-publish or mcp-strict turn on. Use separate Action steps."
    ]
  ])("rejects %j before any CLI invocation", async (overrides, stderr) => {
    await expect(runArchiveAction(overrides, "0", "0", false, { MOCK_FORBID_CLI: "true" })).rejects.toMatchObject({ code: 2, stdout: "", stderr: `${stderr}\n` });
  });

  it("accepts a token with the publish profile when the package check is off", async () => {
    const run = await runArchiveAction({
      check: "false", profile: "publish", "allow-network": "true", "snapshot-url": "https://mcp.example.test/mcp", "snapshot-token-env": "MCP_TOKEN"
    }, "0", "0", false, { MCP_TOKEN: "token-sentinel" });

    try {
      expect(invocationsOf(run, "mcp-snapshot")).toHaveLength(1);
      expect(invocationsOf(run, "check")).toEqual([]);
      expect(await run.readState()).toMatchObject({ status: "0" });
    } finally {
      await run.cleanup();
    }
  });
});

function snapshotDiffInvocations(run: ActionRun): string[][] {
  return run.invocations.filter((invocation) => invocation[0] === "doctor" && invocation[1] === "mcp-snapshot-diff");
}

describe("GitHub Action MCP snapshot diff", () => {
  const snapshot = { check: "false", runtime: "true", "snapshot-server": "local-server" };

  it("compares this step's snapshot with the committed baseline in one report", async () => {
    const run = await runArchiveAction({ ...snapshot, "snapshot-diff-before-dir": "mcp/baseline", "snapshot-diff-fail-on": "breaking" });

    try {
      const reportDirectory = toBashPath(run.reportDirectory);
      expect(invocationsOf(run, "mcp-snapshot")).toHaveLength(1);
      expect(snapshotDiffInvocations(run)[0]).toEqual(["doctor", "mcp-snapshot-diff", "--before", "mcp/baseline", "--after", reportDirectory, "--fail-on", "breaking", "--json"]);
      expect(toolsDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ snapshotDiff: "true", toolsDiff: "false", status: "0" });
      expect(run.output["snapshot-diff-json-path"]).toBe(`${reportDirectory}/mcp-snapshot-diff.json`);
      expect(run.output["snapshot-diff-summary-path"]).toBe(`${reportDirectory}/mcp-snapshot-diff.md`);
      expect(run.manifest.reports.snapshotDiffJson).toEqual({ enabled: true, path: `${reportDirectory}/mcp-snapshot-diff.json` });
      expect(await readFile(path.join(run.reportDirectory, "mcp-snapshot-diff.md"), "utf8")).toContain("- Fail on: breaking");
      expect(await run.runSummary()).toContain("## MCP Snapshot Diff");
    } finally {
      await run.cleanup();
    }
  });

  it("leaves snapshot findings to the snapshot diff, which re-checks every saved list", async () => {
    const run = await runArchiveAction({ ...snapshot, "snapshot-diff-before-dir": "mcp/baseline" }, "0", "0", false, { MOCK_SNAPSHOT_EXIT: "1" });

    try {
      expect(await run.readState()).toMatchObject({ snapshotDiff: "true", status: "0" });
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    ["an explicit after directory leaves the snapshot's findings to the status", { "snapshot-diff-after-dir": "elsewhere" }, { MOCK_SNAPSHOT_EXIT: "1" }, "1"],
    ["an incomplete snapshot still records status 2 without deferred findings", {}, { MOCK_SNAPSHOT_EXIT: "2" }, "2"],
    ["deferred findings leave an incomplete snapshot to the comparison", { "snapshot-defer-findings": "true" }, { MOCK_SNAPSHOT_EXIT: "2" }, "0"]
  ])("records the snapshot status when %s", async (_case, overrides, environment, status) => {
    const run = await runArchiveAction({ ...snapshot, "snapshot-diff-before-dir": "mcp/baseline", ...overrides }, "0", "0", false, environment);

    try {
      expect(snapshotDiffInvocations(run)).not.toEqual([]);
      expect(await run.readState()).toMatchObject({ snapshotDiff: "true", status });
    } finally {
      await run.cleanup();
    }
  });

  it("runs the per-list diffs and the snapshot diff from one snapshot", async () => {
    const run = await runArchiveAction({ ...snapshot, "snapshot-diff-before-dir": "mcp/baseline", "tools-diff-before": "tools.json", "tools-diff-comment": "true" });

    try {
      expect(toolsDiffInvocations(run)[0]).toContain(toBashPath(path.join(run.reportDirectory, "mcp-tools-current.json")));
      expect(snapshotDiffInvocations(run)).not.toEqual([]);
      expect(await run.readState()).toMatchObject({ toolsDiff: "true", snapshotDiff: "true", status: "0" });
    } finally {
      await run.cleanup();
    }
  });

  it("skips the snapshot diff when this step's snapshot did not run", async () => {
    const run = await runArchiveAction({ check: "false", "snapshot-server": "local-server", "snapshot-diff-before-dir": "mcp/baseline" });

    try {
      expect(invocationsOf(run, "mcp-snapshot")).toEqual([]);
      expect(snapshotDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ snapshotDiff: "false", status: "2" });
    } finally {
      await run.cleanup();
    }
  });

  it("records status 2 when a CLI older than 1.82.0 answers the snapshot diff with another report", async () => {
    const run = await runArchiveAction({ check: "false", "snapshot-diff-before-dir": "before", "snapshot-diff-after-dir": "after" }, "0", "0", false, { MOCK_SNAPSHOT_DIFF_SCOPE: "environment" });

    try {
      expect(snapshotDiffInvocations(run)).not.toEqual([]);
      // Nothing from the other report reaches the summary, the outputs, or a comment.
      expect(await run.readState()).toMatchObject({ snapshotDiff: "false", status: "2" });
      expect(run.output["snapshot-diff-summary-path"]).toBe("");
      expect(await run.runSummary()).not.toContain("MCP Snapshot Diff");
    } finally {
      await run.cleanup();
    }
  });

  it("compares two saved directories without a snapshot and propagates the diff exit status", async () => {
    const run = await runArchiveAction({ check: "false", "snapshot-diff-before-dir": "before", "snapshot-diff-after-dir": "after" }, "0", "0", false, { MOCK_SNAPSHOT_DIFF_EXIT: "1" });

    try {
      expect(invocationsOf(run, "mcp-snapshot")).toEqual([]);
      expect(snapshotDiffInvocations(run)[0]).toEqual(["doctor", "mcp-snapshot-diff", "--before", "before", "--after", "after", "--fail-on", "any", "--json"]);
      expect(await run.readState()).toMatchObject({ snapshotDiff: "true", status: "1" });
    } finally {
      await run.cleanup();
    }
  });

  it("falls back to the text report when the pinned CLI has no Markdown", async () => {
    const run = await runArchiveAction({ check: "false", "snapshot-diff-before-dir": "before", "snapshot-diff-after-dir": "after" }, "0", "0", false, { MOCK_NO_MARKDOWN: "1" });

    try {
      const summary = await readFile(path.join(run.reportDirectory, "mcp-snapshot-diff.md"), "utf8");
      expect(summary.startsWith("## MCP Snapshot Diff\n\n```text\nMCP Snapshot Diff\n")).toBe(true);
    } finally {
      await run.cleanup();
    }
  });

  it.each([
    ["a before directory without an after directory or a snapshot", { check: "false", "snapshot-diff-before-dir": "before" }],
    ["an after directory alone", { check: "false", "snapshot-diff-after-dir": "after" }],
    ["an unknown fail-on mode", { check: "false", "snapshot-diff-before-dir": "before", "snapshot-diff-after-dir": "after", "snapshot-diff-fail-on": "major" }]
  ])("records status 2 for %s without running the diff", async (_case, overrides) => {
    const run = await runArchiveAction(overrides);

    try {
      expect(snapshotDiffInvocations(run)).toEqual([]);
      expect(await run.readState()).toMatchObject({ snapshotDiff: "false", status: "2" });
    } finally {
      await run.cleanup();
    }
  });

  it("posts the snapshot diff under its own marker, and skips it when no snapshot diff ran", async () => {
    const pullRequest = { name: "pull_request", payload: { pull_request: { number: 42 } } };
    const run = await runArchiveAction({
      check: "false", "snapshot-diff-before-dir": "before", "snapshot-diff-after-dir": "after", "snapshot-diff-comment": "true", "github-token": "token-sentinel"
    });
    const skipped = await runArchiveAction({ check: "false", "snapshot-diff-before-dir": "before", "snapshot-diff-comment": "true" });

    try {
      const comment = await run.runComment(pullRequest);
      expect(comment.body?.startsWith("<!-- codex-plugin-doctor:snapshot-diff -->\n## MCP Snapshot Diff")).toBe(true);
      expect(comment.stdout).toContain("Posted the Codex Plugin Doctor snapshot diff comment.");
      const none = await skipped.runComment(pullRequest);
      expect(none.gh).toEqual([]);
      expect(none.stdout).toContain("Snapshot diff comment skipped because no snapshot diff ran.");
    } finally {
      await run.cleanup();
      await skipped.cleanup();
    }
  });
});

describe("GitHub Action resource template diff pull request comment", () => {
  const pullRequest = { name: "pull_request", payload: { pull_request: { number: 42 } } };
  const templatesDiff = {
    check: "false", "resource-templates-diff-before": "before.json", "resource-templates-diff-after": "after.json",
    "resource-templates-diff-comment": "true", "github-token": "token-sentinel"
  };

  it("posts the resource template diff under its own marker", async () => {
    const run = await runArchiveAction(templatesDiff);

    try {
      const comment = await run.runComment(pullRequest);
      expect(comment.gh).toHaveLength(2);
      expect(comment.body?.startsWith("<!-- codex-plugin-doctor:resource-templates-diff -->\n## MCP Resource Template Definition Diff")).toBe(true);
      expect(comment.stdout).toContain("Posted the Codex Plugin Doctor resource template diff comment.");
    } finally {
      await run.cleanup();
    }
  });

  it("skips the resource template comment when no resource template diff ran", async () => {
    const run = await runArchiveAction({ check: "false", "resource-templates-diff-comment": "true", "resource-templates-diff-before": "before.json" });

    try {
      const comment = await run.runComment(pullRequest);
      expect(comment.gh).toEqual([]);
      expect(comment.stdout).toContain("Resource template diff comment skipped because no resource template diff ran.");
    } finally {
      await run.cleanup();
    }
  });
});
