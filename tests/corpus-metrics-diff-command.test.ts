import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CorpusMetricsDiffError,
  type BuildCorpusMetricsDiffOptions,
  type CorpusQualityMetricsDiffReport
} from "../src/core/corpus-quality-metrics.js";
import { runCli } from "../src/run-cli.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      writeStdout(message: string) { stdout.push(message); },
      writeStderr(message: string) { stderr.push(message); }
    }
  };
}

const report: CorpusQualityMetricsDiffReport = {
  schemaVersion: "1.0.0",
  kind: "doctor.validation.corpus.metrics.diff",
  generatedAt: "2026-07-19T00:00:00.000Z",
  version: "1.49.0",
  corpusDigest: `sha256:${"a".repeat(64)}`,
  status: "fail",
  exitCode: 1,
  failOnRegression: true,
  summary: {
    comparable: true,
    regression: true,
    changedTargets: 1,
    precisionBefore: 0.8,
    precisionAfter: 0.6,
    precisionDelta: -0.2,
    recallBefore: 0.8,
    recallAfter: 0.6,
    recallDelta: -0.2,
    falsePositiveRateBefore: 0.2,
    falsePositiveRateAfter: 0.4,
    falsePositiveRateDelta: 0.2,
    counts: {
      truePositives: -1,
      falsePositives: 1,
      falseNegatives: 1,
      resolvedFalsePositives: 0,
      unreviewed: 0,
      unclear: 0
    }
  },
  before: { version: "1.48.0", targetCount: 1 },
  after: { version: "1.49.0", targetCount: 1 },
  targets: []
};

describe("doctor corpus metrics diff command", () => {
  it("parses the regression gate and returns the report exit code", async () => {
    const { io, stdout, stderr } = createIo();
    let received: BuildCorpusMetricsDiffOptions | undefined;
    const exitCode = await runCli([
      "doctor", "corpus", "metrics", "diff",
      "--before", "before.json", "--after", "after.json",
      "--fail-on-regression", "--json"
    ], io, {
      buildCorpusMetricsDiffReportImpl: async (_before, _after, options) => {
        received = options;
        return report;
      }
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(received).toEqual({ failOnRegression: true });
    expect(JSON.parse(stdout.join(""))).toMatchObject({ kind: report.kind });
  });

  it("writes Markdown output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-metrics-diff-command-"));
    const outputPath = path.join(root, "diff.md");
    const { io } = createIo();
    await runCli([
      "doctor", "corpus", "metrics", "diff",
      "--before", "before.json", "--after", "after.json",
      "--markdown", "--output", outputPath
    ], io, { buildCorpusMetricsDiffReportImpl: async () => report });

    await expect(readFile(outputPath, "utf8")).resolves.toContain("# Doctor Corpus Metrics Diff");
  });

  it("returns exit 2 for non-comparable reports", async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli([
      "doctor", "corpus", "metrics", "diff",
      "--before", "before.json", "--after", "after.json"
    ], io, {
      buildCorpusMetricsDiffReportImpl: async () => {
        throw new CorpusMetricsDiffError("Corpus identities differ.");
      }
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Corpus identities differ.");
  });

  it.each([
    [["doctor", "corpus", "metrics", "diff"], "requires --before"],
    [["doctor", "corpus", "metrics", "diff", "--before"], "Missing path after --before"],
    [["doctor", "corpus", "metrics", "diff", "--before", "a", "--after", "b", "--json", "--markdown"], "either --json or --markdown"],
    [["doctor", "corpus", "metrics", "diff", "--before", "a", "--after", "b", "extra"], "Unknown corpus metrics diff argument"]
  ])("rejects invalid usage %#", async (args, expectedError) => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(args, io, {
      buildCorpusMetricsDiffReportImpl: async () => report
    });
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain(expectedError);
  });
});
