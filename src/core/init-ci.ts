import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { packageVersion } from "../version.js";

export interface InitCiResult {
  rootPath: string;
  workflowPath: string;
}

function buildWorkflow(): string {
  return [
    "name: Validate Codex plugin",
    "",
    "on:",
    "  pull_request:",
    "  push:",
    "    branches:",
    "      - main",
    "",
    "jobs:",
    "  doctor:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v5",
    `      - uses: Esquetta/CodexPluginDoctor@v${packageVersion}`,
    "        with:",
    `          version: \"${packageVersion}\"`,
    "          path: .",
    "          runtime: \"true\"",
    "          policy: codex-publish",
    "          json: \"true\"",
    "          markdown: \"true\"",
    "          sarif: \"true\"",
    "          upload-artifact: \"true\"",
    "          step-summary: \"true\"",
    "          artifact-name: codex-plugin-doctor-reports",
    ""
  ].join("\n");
}

export interface ToolsDiffWorkflowOptions {
  server: string;
  baseline: string;
  sandbox: "docker" | null;
  // When set, the same server's prompt list is captured too and compared with this baseline.
  promptsBaseline: string | null;
  // When set, the same server's resource template list is captured too and compared with this baseline.
  resourceTemplatesBaseline: string | null;
  // When set, the compare job runs one snapshot diff against this snapshot directory instead of the per-list diffs.
  snapshotBaselineDir: string | null;
}

// JSON strings are valid YAML double-quoted scalars, so names and paths cannot break the document.
const yamlString = (value: string) => JSON.stringify(value);

/**
 * A pull request workflow in two jobs: the first starts the stdio server and uploads its lists,
 * and the second compares it with the committed baseline and comments. Only the second job may write
 * to pull requests, and it runs no package code.
 */
function buildToolsDiffWorkflow(options: ToolsDiffWorkflowOptions): string {
  const snapshotDiff = options.snapshotBaselineDir !== null;
  return [
    snapshotDiff ? "name: MCP snapshot diff" : "name: MCP tool diff",
    "",
    "on:",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  capture:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "        with:",
    "          persist-credentials: false",
    "      # Add install or build steps here if the server needs them; the Docker sandbox has no network.",
    `      - uses: Esquetta/CodexPluginDoctor@v${packageVersion}`,
    "        with:",
    `          version: \"${packageVersion}\"`,
    "          path: .",
    "          check: \"false\"",
    "          runtime: \"true\"",
    // A snapshot reads every list in one server session, so the server starts once for several comparisons.
    ...(!snapshotDiff && options.promptsBaseline === null && options.resourceTemplatesBaseline === null ? [
      `          tools-capture-server: ${yamlString(options.server)}`,
      ...(options.sandbox === "docker" ? ["          tools-capture-sandbox: docker"] : []),
      "          # Catalog findings do not fail this job; the compare job re-checks the saved list.",
      "          tools-capture-defer-findings: \"true\""
    ] : [
      `          snapshot-server: ${yamlString(options.server)}`,
      ...(options.sandbox === "docker" ? ["          snapshot-sandbox: docker"] : []),
      "          # Catalog findings do not fail this job; the compare job re-checks the saved lists.",
      "          snapshot-defer-findings: \"true\""
    ]),
    "          artifact-name: mcp-tools-capture",
    "",
    "  compare:",
    "    needs: capture",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      contents: read",
    "      pull-requests: write",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "        with:",
    "          persist-credentials: false",
    "      # Outside the checkout, so files from the pull request cannot shadow the downloaded list.",
    "      - uses: actions/download-artifact@v5",
    "        with:",
    "          name: mcp-tools-capture",
    "          path: ${{ runner.temp }}/mcp-tools-capture",
    `      - uses: Esquetta/CodexPluginDoctor@v${packageVersion}`,
    "        with:",
    `          version: \"${packageVersion}\"`,
    "          check: \"false\"",
    ...(options.snapshotBaselineDir !== null ? [
      `          snapshot-diff-before-dir: ${yamlString(options.snapshotBaselineDir)}`,
      "          snapshot-diff-after-dir: ${{ runner.temp }}/mcp-tools-capture",
      "          snapshot-diff-fail-on: breaking",
      "          snapshot-diff-comment: \"true\""
    ] : [
      `          tools-diff-before: ${yamlString(options.baseline)}`,
      "          tools-diff-after: ${{ runner.temp }}/mcp-tools-capture/mcp-tools-current.json",
      "          tools-diff-fail-on: breaking",
      "          tools-diff-comment: \"true\""
    ]),
    ...(options.promptsBaseline === null ? [] : [
      `          prompts-diff-before: ${yamlString(options.promptsBaseline)}`,
      "          prompts-diff-after: ${{ runner.temp }}/mcp-tools-capture/mcp-prompts-current.json",
      "          prompts-diff-fail-on: breaking",
      "          prompts-diff-comment: \"true\""
    ]),
    ...(options.resourceTemplatesBaseline === null ? [] : [
      `          resource-templates-diff-before: ${yamlString(options.resourceTemplatesBaseline)}`,
      "          resource-templates-diff-after: ${{ runner.temp }}/mcp-tools-capture/mcp-resource-templates-current.json",
      "          resource-templates-diff-fail-on: breaking",
      "          resource-templates-diff-comment: \"true\""
    ]),
    "          output-dir: ${{ runner.temp }}/codex-plugin-doctor-reports",
    "          artifact-name: mcp-tools-diff",
    ""
  ].join("\n");
}

export async function initToolsDiffWorkflow(targetPath: string, options: ToolsDiffWorkflowOptions): Promise<InitCiResult> {
  const rootPath = path.resolve(targetPath);
  const workflowPath = path.join(rootPath, ".github", "workflows", "codex-plugin-doctor-tools.yml");

  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, buildToolsDiffWorkflow(options), "utf8");
  // doctor tools --save-response writes into an existing directory, so the baselines can be captured next;
  // doctor mcp-snapshot --save-dir creates its directory itself.
  if (options.snapshotBaselineDir === null) {
    for (const baseline of [options.baseline, options.promptsBaseline, options.resourceTemplatesBaseline]) {
      if (baseline !== null) await mkdir(path.dirname(path.resolve(rootPath, baseline)), { recursive: true });
    }
  }

  return { rootPath, workflowPath };
}

export async function initCiWorkflow(targetPath: string): Promise<InitCiResult> {
  const rootPath = path.resolve(targetPath);
  const workflowPath = path.join(rootPath, ".github", "workflows", "codex-plugin-doctor.yml");

  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, buildWorkflow(), "utf8");

  return {
    rootPath,
    workflowPath
  };
}
