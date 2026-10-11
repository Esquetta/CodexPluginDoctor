import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  name: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}

async function releaseWorkflow() {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  const workflow = parse(source) as {
    on: { push: { branches: string[]; paths: string[] }; workflow_dispatch: unknown };
    permissions: Record<string, string>;
    env: Record<string, string>;
    jobs: { release: { if: string; steps: WorkflowStep[] } };
  };
  const steps = workflow.jobs.release.steps;
  const step = (name: string) => {
    const found = steps.find((entry) => entry.name === name);
    if (!found) throw new Error(`Missing release workflow step: ${name}`);
    return found;
  };
  return { source, workflow, steps, step };
}

describe("release workflow", () => {
  it("runs only on main in the upstream repository, for version bumps or on demand", async () => {
    const { workflow } = await releaseWorkflow();
    expect(workflow.on.push).toEqual({ branches: ["main"], paths: ["package.json"] });
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.jobs.release.if).toBe("github.repository == 'Esquetta/CodexPluginDoctor' && github.ref == 'refs/heads/main'");
    expect(workflow.permissions).toEqual({ contents: "write", "id-token": "write" });
  });

  it("publishes to npm through trusted publishing without a stored token", async () => {
    const { source, step } = await releaseWorkflow();
    const publish = step("Publish to npm");
    expect(publish.if).toBe("steps.state.outputs.npm == 'pending'");
    expect(publish.run).toContain("npm publish --access public --provenance");
    expect(publish.env).toBeUndefined();
    expect(source).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|registry-url/u);
  });

  it("tests and builds before publishing, and skips each part that already exists", async () => {
    const { steps, step } = await releaseWorkflow();
    const names = steps.map((entry) => entry.name);
    expect(names.indexOf("Run tests")).toBeLessThan(names.indexOf("Publish to npm"));
    expect(names.indexOf("Build CLI")).toBeLessThan(names.indexOf("Extract release notes"));
    expect(names.indexOf("Publish to npm")).toBeLessThan(names.indexOf("Create GitHub release"));
    expect(step("Create GitHub release").if).toBe("steps.state.outputs.release == 'pending'");
    expect(step("Determine release state").run).toContain('if [[ "$version" == *-* ]]');
  });

  it("stops instead of skipping a draft or prerelease GitHub release, or a tag on another commit", async () => {
    const { step } = await releaseWorkflow();
    const state = step("Determine release state").run;
    expect(state).toContain("--json isDraft,isPrerelease");
    expect(state).toContain('if [[ "$release_kind" != "published" ]]');
    expect(state).toContain('git ls-remote origin "refs/tags/${tag}" "refs/tags/${tag}^{}"');
    expect(state).toContain('"$tag_commit" != "$GITHUB_SHA"');
  });

  it("creates the release from the CHANGELOG section and verifies sync", async () => {
    const { step } = await releaseWorkflow();
    expect(step("Extract release notes").run).toContain("node scripts/extract-release-notes.mjs");
    expect(step("Create GitHub release").run).toContain('--notes-file "$RUNNER_TEMP/release-notes.md"');
    expect(step("Verify release sync").run).toContain("npm run verify-release-sync");
  });

  it("verifies sync for every stable version, even when both parts already existed", async () => {
    const { step } = await releaseWorkflow();
    expect(step("Install dependencies").if).toBe("steps.state.outputs.npm != 'skip'");
    expect(step("Verify release sync").if).toBe("steps.state.outputs.npm != 'skip'");
  });

  it("stays on the repository's current action versions", async () => {
    const { workflow, steps } = await releaseWorkflow();
    expect(steps.filter((entry) => entry.uses).map((entry) => entry.uses)).toEqual(["actions/checkout@v5", "actions/setup-node@v5"]);
    expect(workflow.env).toEqual({ FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true" });
  });
});
