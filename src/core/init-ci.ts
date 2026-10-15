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
}

// JSON strings are valid YAML double-quoted scalars, so names and paths cannot break the document.
const yamlString = (value: string) => JSON.stringify(value);

/**
 * A pull request workflow in two jobs: the first starts the stdio server and uploads its tool list,
 * and the second compares it with the committed baseline and comments. Only the second job may write
 * to pull requests, and it runs no package code.
 */
function buildToolsDiffWorkflow(options: ToolsDiffWorkflowOptions): string {
  return [
    "name: MCP tool diff",
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
    `          tools-capture-server: ${yamlString(options.server)}`,
    ...(options.sandbox === "docker" ? ["          tools-capture-sandbox: docker"] : []),
    "          # Catalog findings do not fail this job; the compare job re-checks the saved list.",
    "          tools-capture-defer-findings: \"true\"",
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
    `          tools-diff-before: ${yamlString(options.baseline)}`,
    "          tools-diff-after: ${{ runner.temp }}/mcp-tools-capture/mcp-tools-current.json",
    "          tools-diff-fail-on: breaking",
    "          tools-diff-comment: \"true\"",
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
  // doctor tools --save-response writes into an existing directory, so the baseline can be captured next.
  await mkdir(path.dirname(path.resolve(rootPath, options.baseline)), { recursive: true });

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
