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
    "      - uses: actions/checkout@v4",
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
