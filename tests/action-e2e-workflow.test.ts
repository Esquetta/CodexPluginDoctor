import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  id?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { needs?: string | string[]; permissions?: Record<string, string>; steps: WorkflowStep[] }>;
}

async function loadWorkflow(): Promise<Workflow> {
  return parse(await readFile(".github/workflows/action-e2e.yml", "utf8")) as Workflow;
}

const localAction = (steps: WorkflowStep[]) => steps.filter((step) => step.uses === "./");

describe("Action end-to-end workflow", () => {
  it("runs only on pull_request and push, and never persists checkout credentials", async () => {
    const workflow = await loadWorkflow();
    // pull_request_target would hand a write token to code from forks that uses: ./ then runs.
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push"]);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps.filter((candidate) => candidate.uses?.startsWith("actions/checkout@"))) {
        expect(step.with).toEqual({ "persist-credentials": false });
      }
    }
  });

  it("runs the local Action with the CLI packed from the same commit", async () => {
    const workflow = await loadWorkflow();
    for (const job of ["capture", "compare"]) {
      const steps = localAction(workflow.jobs[job].steps);
      expect(steps).toHaveLength(1);
      expect(steps[0].with?.version).toBe("file:${{ runner.temp }}/cli/${{ needs.package.outputs.tarball }}");
    }
  });

  it("captures in the Docker sandbox without a write token and compares in a separate job", async () => {
    const workflow = await loadWorkflow();
    const [capture] = localAction(workflow.jobs.capture.steps);
    const [compare] = localAction(workflow.jobs.compare.steps);

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.capture.permissions).toBeUndefined();
    expect(capture.with).toMatchObject({ check: "false", runtime: "true", "tools-capture-sandbox": "docker", "tools-capture-defer-findings": "true" });
    expect(capture.with?.["tools-diff-comment"]).toBeUndefined();

    expect(workflow.jobs.compare.needs).toEqual(["package", "capture"]);
    expect(workflow.jobs.compare.permissions).toEqual({ contents: "read", "pull-requests": "write" });
    expect(compare.with).toMatchObject({ check: "false", "tools-diff-fail-on": "breaking", "tools-diff-comment": "true" });
    expect(compare.with?.runtime).toBeUndefined();
  });
});
