import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

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
    expect(actionMetadata).toContain("validation-corpus-path:");
    expect(actionMetadata).toContain("output-contract-path:");
    expect(actionMetadata).toContain("review-bundle-path:");
    expect(actionMetadata).toContain("review-bundle-verification-path:");
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
    expect(actionMetadata).toContain("corpus:");
    expect(actionMetadata).toContain("contract:");
    expect(actionMetadata).toContain("review-bundle:");
    expect(actionMetadata).toContain("review-bundle-dir:");
    expect(actionMetadata).toContain("review-bundle-verify:");
    expect(actionMetadata).toContain("signing-key-env:");
    expect(actionMetadata).toContain("review-bundle-allow-dirty:");
    expect(actionMetadata).toContain("review-bundle-allow-untagged:");
    expect(actionMetadata).toContain('args+=(--history "${{ inputs.history }}")');
    expect(actionMetadata).toContain('args+=(--policy "${{ inputs.policy }}")');
    expect(actionMetadata).toContain('args+=(--profile "${{ inputs.profile }}")');
    expect(actionMetadata).toContain("codex-plugin-doctor-report.json");
    expect(actionMetadata).toContain("codex-plugin-doctor-summary.md");
    expect(actionMetadata).toContain("codex-plugin-doctor.sarif");
    expect(actionMetadata).toContain("validation-corpus.json");
    expect(actionMetadata).toContain("output-contract.json");
    expect(actionMetadata).toContain('run_doctor "validation corpus" doctor corpus --json --output "$validation_corpus_path"');
    expect(actionMetadata).toContain('run_doctor "output contract" doctor contract --json --output "$output_contract_path"');
    expect(actionMetadata).toContain('review_bundle_args=(doctor review-bundle "${{ inputs.path }}" --output "$review_bundle_path" --sign-key-env "$signing_key_env")');
    expect(actionMetadata).toContain('doctor review-bundle verify "$review_bundle_path" --target "${{ inputs.path }}" --sign-key-env "$signing_key_env" --json --output "$review_bundle_verification_path"');
    expect(actionMetadata).toContain("actions/upload-artifact@v7");
    expect(actionMetadata).toContain("FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: \"true\"");
    expect(actionMetadata).toContain('cat "$summary_path" >> "$GITHUB_STEP_SUMMARY"');
    expect(actionMetadata).toContain('echo "status=$status"');
    expect(actionMetadata).toContain('echo "validation-corpus-path=$validation_corpus_path"');
    expect(actionMetadata).toContain('echo "output-contract-path=$output_contract_path"');
    expect(actionMetadata).toContain('echo "review-bundle-path=$review_bundle_path"');
    expect(actionMetadata).toContain('echo "review-bundle-verification-path=$review_bundle_verification_path"');
    expect(actionMetadata).toContain('>> "$GITHUB_OUTPUT"');
    expect(actionMetadata).toContain('printf "%s" "$status" > "$status_file"');
    expect(actionMetadata).toContain('exit "$status"');
  });

  it("documents the public GitHub Action consumer workflow", async () => {
    const readme = await readFile("README.md", "utf8");
    const actionUsage = await readFile("docs/engineering/github-action-usage.md", "utf8");
    const ciWorkflow = await readFile(".github/workflows/ci.yml", "utf8");
    const artifactScript = await readFile("scripts/generate-validation-artifacts.mjs", "utf8");

    const actionRef = `Esquetta/CodexPluginDoctor@v${packageJson.version}`;
    const packageVersion = `version: "${packageJson.version}"`;

    expect(readme).toContain(actionRef);
    expect(readme).toContain(packageVersion);
    expect(readme).toContain("docs/engineering/github-action-usage.md");
    expect(actionUsage).toContain(`uses: ${actionRef}`);
    expect(actionUsage).toContain(packageVersion);
    expect(actionUsage).toContain('runtime: "true"');
    expect(actionUsage).toContain('policy: codex-publish');
    expect(actionUsage).toContain('upload-artifact: "true"');
    expect(actionUsage).toContain('artifact-name: codex-plugin-doctor-reports');
    expect(actionUsage).toContain('output-dir: codex-plugin-doctor-reports');
    expect(actionUsage).toContain("codex-plugin-doctor-summary.md");
    expect(actionUsage).toContain("codex-plugin-doctor-report.json");
    expect(actionUsage).toContain("review-bundle:");
    expect(actionUsage).toContain("review-bundle-verify:");
    expect(actionUsage).toContain("corpus:");
    expect(actionUsage).toContain("contract:");
    expect(actionUsage).toContain("validation-corpus.json");
    expect(actionUsage).toContain("output-contract.json");
    expect(actionUsage).toContain("CODEX_PLUGIN_DOCTOR_SIGNING_KEY");
    expect(actionUsage).toContain('sarif: "true"');
    expect(actionUsage).toContain("history: validation-history.jsonl");
    expect(actionUsage).toContain("--fail-on-regression");
    expect(actionUsage).toContain("--profile publish");
    expect(ciWorkflow).toContain("codex-plugin-doctor.sarif");
    expect(ciWorkflow).toContain("actions/upload-artifact@v7");
    expect(ciWorkflow).toContain("FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: \"true\"");
    expect(artifactScript).toContain('"--sarif"');
    expect(artifactScript).toContain("codex-plugin-doctor.sarif");
  });

  it("keeps repository workflows aligned on current artifact upload runtime", async () => {
    const ciWorkflow = await readFile(".github/workflows/ci.yml", "utf8");
    const releaseCandidateWorkflow = await readFile(".github/workflows/release-candidate.yml", "utf8");

    for (const workflow of [ciWorkflow, releaseCandidateWorkflow]) {
      expect(workflow).toContain("actions/checkout@v5");
      expect(workflow).toContain("actions/setup-node@v5");
      expect(workflow).toContain("actions/upload-artifact@v7");
      expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"');
      expect(workflow).not.toContain("actions/upload-artifact@v5");
    }
  });
});
