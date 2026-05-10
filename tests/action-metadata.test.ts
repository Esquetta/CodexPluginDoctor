import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitHub Action metadata", () => {
  it("exposes a composite action that installs and runs codex-plugin-doctor", async () => {
    const actionMetadata = await readFile("action.yml", "utf8");

    expect(actionMetadata).toContain("name: Codex Plugin Doctor");
    expect(actionMetadata).toContain("using: composite");
    expect(actionMetadata).toContain("outputs:");
    expect(actionMetadata).toContain("status:");
    expect(actionMetadata).toContain("report-dir:");
    expect(actionMetadata).toContain("summary-path:");
    expect(actionMetadata).toContain("json-path:");
    expect(actionMetadata).toContain("sarif-path:");
    expect(actionMetadata).toContain("steps.run-doctor.outputs.status");
    expect(actionMetadata).toContain("npm install -g codex-plugin-doctor@${{ inputs.version }}");
    expect(actionMetadata).toContain("id: run-doctor");
    expect(actionMetadata).toContain("args=(check)");
    expect(actionMetadata).toContain('codex-plugin-doctor "$@"');
    expect(actionMetadata).toContain('run_doctor "check" "${args[@]}" "${history_args[@]}" --no-animations');
    expect(actionMetadata).toContain("inputs:");
    expect(actionMetadata).toContain("version:");
    expect(actionMetadata).toContain("path:");
    expect(actionMetadata).toContain("runtime:");
    expect(actionMetadata).toContain("history:");
    expect(actionMetadata).toContain("policy:");
    expect(actionMetadata).toContain("profile:");
    expect(actionMetadata).toContain("output-dir:");
    expect(actionMetadata).toContain("artifact-name:");
    expect(actionMetadata).toContain("upload-artifact:");
    expect(actionMetadata).toContain("step-summary:");
    expect(actionMetadata).toContain("json:");
    expect(actionMetadata).toContain("markdown:");
    expect(actionMetadata).toContain('args+=(--history "${{ inputs.history }}")');
    expect(actionMetadata).toContain('args+=(--policy "${{ inputs.policy }}")');
    expect(actionMetadata).toContain('args+=(--profile "${{ inputs.profile }}")');
    expect(actionMetadata).toContain("codex-plugin-doctor-report.json");
    expect(actionMetadata).toContain("codex-plugin-doctor-summary.md");
    expect(actionMetadata).toContain("codex-plugin-doctor.sarif");
    expect(actionMetadata).toContain("actions/upload-artifact@v5");
    expect(actionMetadata).toContain('cat "$summary_path" >> "$GITHUB_STEP_SUMMARY"');
    expect(actionMetadata).toContain('echo "status=$status"');
    expect(actionMetadata).toContain('>> "$GITHUB_OUTPUT"');
    expect(actionMetadata).toContain('printf "%s" "$status" > "$status_file"');
    expect(actionMetadata).toContain('exit "$status"');
  });

  it("documents the public GitHub Action consumer workflow", async () => {
    const readme = await readFile("README.md", "utf8");
    const actionUsage = await readFile("docs/engineering/github-action-usage.md", "utf8");
    const ciWorkflow = await readFile(".github/workflows/ci.yml", "utf8");
    const artifactScript = await readFile("scripts/generate-validation-artifacts.mjs", "utf8");

    expect(readme).toContain("Esquetta/CodexPluginDoctor@v0.20.0");
    expect(readme).toContain("docs/engineering/github-action-usage.md");
    expect(actionUsage).toContain("uses: Esquetta/CodexPluginDoctor@v0.20.0");
    expect(actionUsage).toContain('runtime: "true"');
    expect(actionUsage).toContain('policy: codex-publish');
    expect(actionUsage).toContain('upload-artifact: "true"');
    expect(actionUsage).toContain('artifact-name: codex-plugin-doctor-reports');
    expect(actionUsage).toContain('output-dir: codex-plugin-doctor-reports');
    expect(actionUsage).toContain("codex-plugin-doctor-summary.md");
    expect(actionUsage).toContain("codex-plugin-doctor-report.json");
    expect(actionUsage).toContain('sarif: "true"');
    expect(actionUsage).toContain("history: validation-history.jsonl");
    expect(actionUsage).toContain("--fail-on-regression");
    expect(actionUsage).toContain("--profile publish");
    expect(ciWorkflow).toContain("codex-plugin-doctor.sarif");
    expect(artifactScript).toContain('"--sarif"');
    expect(artifactScript).toContain("codex-plugin-doctor.sarif");
  });
});
