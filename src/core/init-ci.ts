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
    // Running the workflow by hand opens a pull request that makes the current snapshot the baseline,
    // and publishing a release adds the changes since the release before it to its notes.
    ...(snapshotDiff ? ["  workflow_dispatch:", "  release:", "    types: [published]"] : []),
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  capture:",
    ...(snapshotDiff ? ["    if: github.event_name != 'release'"] : []),
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
    ...(snapshotDiff ? ["    if: github.event_name == 'pull_request'"] : []),
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
    ...(options.snapshotBaselineDir === null ? [] : baselineUpdateJob(options.snapshotBaselineDir)),
    ...(options.snapshotBaselineDir === null ? [] : releaseNotesJobs(options.snapshotBaselineDir)),
    ""
  ].join("\n");
}

/**
 * The job a manual run uses to open a pull request with the snapshot as the new baseline. It runs no
 * package code, writes only the files the snapshot's manifest names, and never pushes to the default branch.
 * The write token stays out of the checkout and reaches git only in the step that pushes.
 */
function baselineUpdateJob(baselineDir: string): string[] {
  return [
    "",
    "  update-baseline:",
    "    if: github.event_name == 'workflow_dispatch'",
    "    needs: capture",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      contents: write",
    "      pull-requests: write",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "        with:",
    "          persist-credentials: false",
    "      - uses: actions/download-artifact@v5",
    "        with:",
    "          name: mcp-tools-capture",
    "          path: ${{ runner.temp }}/mcp-tools-capture",
    "      # No cache: nothing another run wrote may reach the job that holds the write token.",
    "      - uses: actions/setup-node@v5",
    "        with:",
    "          node-version: 22",
    "          package-manager-cache: false",
    "      - name: Accept the snapshot as the baseline",
    "        shell: bash",
    "        env:",
    `          BASELINE_DIR: ${yamlString(baselineDir)}`,
    "          SNAPSHOT_DIR: ${{ runner.temp }}/mcp-tools-capture",
    `          DOCTOR: codex-plugin-doctor@${packageVersion}`,
    "        run: |",
    "          # The release notes are the pull request description: they name what changed, as the pull request's",
    "          # diff of the baseline files does anyway. It exits non-zero on changes or when it cannot compare; that is ignored.",
    "          npx --yes \"$DOCTOR\" doctor mcp-snapshot-diff --before \"$BASELINE_DIR\" --after \"$SNAPSHOT_DIR\" --changelog > \"$RUNNER_TEMP/mcp-baseline-update.md\" || true",
    "          npx --yes \"$DOCTOR\" doctor mcp-snapshot-accept --snapshot \"$SNAPSHOT_DIR\" --baseline \"$BASELINE_DIR\"",
    "      - name: Open the baseline pull request",
    "        shell: bash",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    `          BASELINE_DIR: ${yamlString(baselineDir)}`,
    "        run: |",
    "          changes=\"$(git status --porcelain -- \"$BASELINE_DIR\")\"",
    "          if [[ -z \"$changes\" ]]; then",
    "            echo \"The baseline already matches the snapshot.\"",
    "            exit 0",
    "          fi",
    "          # GitHub rejects pull request bodies longer than 65,536 characters.",
    "          body=\"$RUNNER_TEMP/mcp-baseline-update.md\"",
    "          if [[ \"$(wc -c < \"$body\")\" -gt 60000 ]]; then",
    "            truncated=\"$(head -c 60000 \"$body\")\"",
    "            {",
    "              printf '%s\\n' \"$truncated\"",
    "              if (( $(printf '%s\\n' \"$truncated\" | grep -c '^```' || true) % 2 == 1 )); then printf '```\\n'; fi",
    "              printf '\\n_Truncated; run doctor mcp-snapshot-diff --changelog locally for the full release notes._\\n'",
    "            } > \"$body.cut\"",
    "            mv \"$body.cut\" \"$body\"",
    "          fi",
    "          branch=\"mcp-baseline-update/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}\"",
    "          git switch -c \"$branch\"",
    "          git add -A -- \"$BASELINE_DIR\"",
    "          git -c user.name=\"github-actions[bot]\" -c user.email=\"41898282+github-actions[bot]@users.noreply.github.com\" commit -m \"chore: update the MCP snapshot baseline\"",
    "          gh auth setup-git",
    "          git push origin \"$branch\"",
    "          # Into the branch the workflow ran on, so a run from a feature branch updates that branch's baseline.",
    "          gh pr create --base \"$GITHUB_REF_NAME\" --head \"$branch\" --title \"chore: update the MCP snapshot baseline\" --body-file \"$body\""
  ];
}

/**
 * The jobs a published release uses to add the MCP surface changes since the release before it to its notes.
 * The first compares the committed baselines at the two tags with a read-only token, so it starts no server;
 * the second runs no package code and is the only one that can edit the release.
 */
function releaseNotesJobs(baselineDir: string): string[] {
  return [
    "",
    "  release-notes:",
    "    if: github.event_name == 'release'",
    "    runs-on: ubuntu-latest",
    "    outputs:",
    "      written: ${{ steps.notes.outputs.written }}",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "        with:",
    "          persist-credentials: false",
    "          fetch-depth: 0",
    "      - name: Find the release before this one",
    "        id: previous",
    "        shell: bash",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    "          GH_REPO: ${{ github.repository }}",
    "          TAG: ${{ github.event.release.tag_name }}",
    "          PRERELEASE: ${{ github.event.release.prerelease }}",
    "        run: |",
    "          # The newest earlier release this one was built on, so a backport is compared with its own line;",
    "          # a stable release skips prereleases. The API lists releases newest first.",
    "          releases=\"$(gh api \"repos/$GH_REPO/releases?per_page=100\" --jq '.[] | select(.draft | not) | \"\\(.tag_name) \\(.prerelease)\"')\"",
    "          found=false",
    "          previous=\"\"",
    "          while read -r tag prerelease; do",
    "            if [[ \"$found\" != \"true\" ]]; then",
    "              [[ \"$tag\" == \"$TAG\" ]] && found=true",
    "              continue",
    "            fi",
    "            [[ \"$PRERELEASE\" != \"true\" && \"$prerelease\" == \"true\" ]] && continue",
    "            if git merge-base --is-ancestor \"refs/tags/$tag\" HEAD 2>/dev/null; then",
    "              previous=\"$tag\"",
    "              break",
    "            fi",
    "          done <<< \"$releases\"",
    "          if [[ \"$found\" != \"true\" ]]; then",
    "            echo \"$TAG is not among the 100 newest releases.\" >&2",
    "            exit 1",
    "          fi",
    "          [[ -n \"$previous\" ]] || echo \"No earlier release of $TAG among the 100 newest releases to compare with.\"",
    "          echo \"tag=$previous\" >> \"$GITHUB_OUTPUT\"",
    "      - if: steps.previous.outputs.tag != ''",
    "        uses: actions/setup-node@v5",
    "        with:",
    "          node-version: 22",
    "          package-manager-cache: false",
    "      - name: Write the MCP surface changes since that release",
    "        id: notes",
    "        if: steps.previous.outputs.tag != ''",
    "        shell: bash",
    "        env:",
    "          PREVIOUS: ${{ steps.previous.outputs.tag }}",
    `          BASELINE_DIR: ${yamlString(baselineDir)}`,
    `          DOCTOR: codex-plugin-doctor@${packageVersion}`,
    "        run: |",
    "          if [[ ! -f \"$BASELINE_DIR/mcp-snapshot-manifest.json\" ]] || ! git cat-file -e \"refs/tags/$PREVIOUS:$BASELINE_DIR/mcp-snapshot-manifest.json\" 2>/dev/null; then",
    "            echo \"This release or $PREVIOUS has no snapshot baseline in $BASELINE_DIR.\"",
    "            exit 0",
    "          fi",
    "          before=\"$RUNNER_TEMP/mcp-baseline-before\"",
    "          mkdir -p \"$before\" \"$RUNNER_TEMP/mcp-release-notes\"",
    "          git archive \"refs/tags/$PREVIOUS\" -- \"$BASELINE_DIR\" | tar -x -C \"$before\"",
    "          notes=\"$RUNNER_TEMP/mcp-release-notes/notes.md\"",
    "          # It exits non-zero on changes or when it cannot compare; the notes say which.",
    "          npx --yes \"$DOCTOR\" doctor mcp-snapshot-diff --before \"$before/$BASELINE_DIR\" --after \"$BASELINE_DIR\" --changelog > \"$notes\" || true",
    "          if [[ \"$(head -n 1 \"$notes\")\" != \"## MCP surface changes\" ]]; then",
    "            echo \"The comparison wrote no release notes.\" >&2",
    "            exit 1",
    "          fi",
    "          echo \"written=true\" >> \"$GITHUB_OUTPUT\"",
    "      - if: steps.notes.outputs.written == 'true'",
    "        uses: actions/upload-artifact@v7",
    "        with:",
    "          name: mcp-release-notes",
    "          path: ${{ runner.temp }}/mcp-release-notes/notes.md",
    "",
    "  publish-release-notes:",
    "    needs: release-notes",
    "    if: needs.release-notes.outputs.written == 'true'",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      contents: write",
    "    steps:",
    "      - uses: actions/download-artifact@v5",
    "        with:",
    "          name: mcp-release-notes",
    "          path: ${{ runner.temp }}/mcp-release-notes",
    "      - name: Add the MCP surface changes to the release notes",
    "        shell: bash",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    "          GH_REPO: ${{ github.repository }}",
    "          TAG: ${{ github.event.release.tag_name }}",
    "          NOTES: ${{ runner.temp }}/mcp-release-notes/notes.md",
    "        run: |",
    "          # The notes come from a job that ran package code, so they are checked and used only as text.",
    "          if [[ \"$(head -n 1 \"$NOTES\")\" != \"## MCP surface changes\" ]]; then",
    "            echo \"The downloaded file is not MCP surface release notes.\" >&2",
    "            exit 1",
    "          fi",
    "          marker='<!-- codex-plugin-doctor:mcp-surface-changes -->'",
    "          gh release view --json body --jq .body -- \"$TAG\" > \"$RUNNER_TEMP/release-body.md\"",
    "          # Everything above the section an earlier run added stays, so a marker quoted in the notes is kept;",
    "          # a body saved on GitHub may use CRLF.",
    "          awk -v marker=\"$marker\" '{ sub(/\\r$/, \"\"); lines[NR] = $0; if (NR > 1 && lines[NR - 1] == marker && $0 == \"## MCP surface changes\") last = NR - 1 } END { n = last ? last - 1 : NR; for (i = 1; i <= n; i++) print lines[i] }' \\",
    "            \"$RUNNER_TEMP/release-body.md\" > \"$RUNNER_TEMP/release-kept.md\"",
    "          # GitHub rejects release notes longer than 125,000 characters.",
    "          limit=$(( 120000 - $(wc -c < \"$RUNNER_TEMP/release-kept.md\") ))",
    "          if (( limit > 60000 )); then limit=60000; fi",
    "          if (( limit < 1000 )); then",
    "            echo \"The release notes leave no room for the MCP surface changes.\" >&2",
    "            exit 1",
    "          fi",
    "          {",
    "            cat \"$RUNNER_TEMP/release-kept.md\"",
    "            printf '%s\\n' \"$marker\"",
    "            if [[ \"$(wc -c < \"$NOTES\")\" -gt \"$limit\" ]]; then",
    "              printf '%s\\n\\n_Truncated; run doctor mcp-snapshot-diff --changelog locally for the full release notes._\\n' \"$(head -c \"$((limit - 100))\" \"$NOTES\")\"",
    "            else",
    "              cat \"$NOTES\"",
    "            fi",
    "          } > \"$RUNNER_TEMP/release-notes.md\"",
    "          gh release edit --notes-file \"$RUNNER_TEMP/release-notes.md\" -- \"$TAG\""
  ];
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
