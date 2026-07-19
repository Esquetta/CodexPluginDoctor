import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  renderCorpusQualityMetricsJson,
  renderCorpusQualityMetricsMarkdown,
  renderCorpusQualityMetricsText,
  type BuildCorpusMetricsOptions,
  type CorpusQualityMetricsReport
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

const report: CorpusQualityMetricsReport = {
  schemaVersion: "1.0.0",
  kind: "doctor.validation.corpus.metrics",
  generatedAt: "2026-07-17T00:00:00.000Z",
  version: "1.48.0",
  corpusDigest: `sha256:${"a".repeat(64)}`,
  status: "fail",
  exitCode: 1,
  summary: {
    targetCount: 1,
    completeTargets: 1,
    incompleteTargets: 0,
    truePositives: 2,
    falsePositives: 1,
    falseNegatives: 0,
    resolvedFalsePositives: 0,
    unreviewed: 0,
    unclear: 0,
    precision: 0.666667,
    recall: 1,
    falsePositiveRate: 0.333333
  },
  thresholds: { minPrecision: 0.9 },
  thresholdChecks: [{
    metric: "precision",
    operator: ">=",
    threshold: 0.9,
    actual: 0.666667,
    passed: false
  }],
  targets: [{
    id: "broken-01",
    profile: "broken",
    sourceType: "public-package",
    disclosure: "anonymized",
    mode: "codex-plugin",
    digestMatched: true,
    complete: true,
    counts: {
      truePositives: 2,
      falsePositives: 1,
      falseNegatives: 0,
      resolvedFalsePositives: 0,
      unreviewed: 0,
      unclear: 0
    },
    metrics: { precision: 0.666667, recall: 1, falsePositiveRate: 0.333333 },
    outcomes: []
  }]
};

describe("corpus metrics renderers", () => {
  it("renders deterministic JSON, text, and Markdown summaries", () => {
    expect(JSON.parse(renderCorpusQualityMetricsJson(report))).toMatchObject({
      kind: "doctor.validation.corpus.metrics",
      status: "fail"
    });
    const text = renderCorpusQualityMetricsText(report);
    expect(text).toContain("Doctor Corpus Quality Metrics");
    expect(text.indexOf("Failed thresholds")).toBeLessThan(text.indexOf("\nTargets\n"));
    const markdown = renderCorpusQualityMetricsMarkdown(report);
    expect(markdown).toContain("# Doctor Corpus Quality Metrics");
    expect(markdown.indexOf("## Failed Thresholds")).toBeLessThan(markdown.indexOf("## Targets"));
  });

  it("renders null metrics as N/A", () => {
    const empty = structuredClone(report);
    empty.summary.precision = null;
    empty.summary.recall = null;
    empty.summary.falsePositiveRate = null;
    expect(renderCorpusQualityMetricsText(empty)).toContain("Precision: N/A");
    expect(renderCorpusQualityMetricsMarkdown(empty)).toContain("Precision | N/A");
  });
});

describe("doctor corpus metrics command", () => {
  it("parses threshold overrides and returns the report exit code", async () => {
    const { io, stdout, stderr } = createIo();
    let received: BuildCorpusMetricsOptions | undefined;
    const exitCode = await runCli([
      "doctor", "corpus", "metrics", "--manifest", "corpus.json", "--json",
      "--min-precision", "0.95", "--min-recall", "0.8",
      "--max-false-positive-rate", "0.05"
    ], io, {
      buildCorpusMetricsReportImpl: async (_manifest, options) => {
        received = options;
        return report;
      }
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(received?.thresholds).toEqual({
      minPrecision: 0.95,
      minRecall: 0.8,
      maxFalsePositiveRate: 0.05
    });
    expect(JSON.parse(stdout.join(""))).toMatchObject({ kind: report.kind });
  });

  it("writes the selected Markdown output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-metrics-command-"));
    const outputPath = path.join(root, "metrics.md");
    const { io } = createIo();
    await runCli([
      "doctor", "corpus", "metrics", "--manifest", "corpus.json",
      "--markdown", "--output", outputPath
    ], io, { buildCorpusMetricsReportImpl: async () => report });
    await expect(readFile(outputPath, "utf8")).resolves.toContain(
      "# Doctor Corpus Quality Metrics"
    );
  });

  it("returns exit 2 when metrics analysis cannot complete", async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli([
      "doctor", "corpus", "metrics", "--manifest", "corpus.json"
    ], io, {
      buildCorpusMetricsReportImpl: async () => {
        throw new Error("analysis unavailable");
      }
    });
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Corpus metrics analysis failed: analysis unavailable");
  });

  it.each([
    [["doctor", "corpus", "metrics"], "requires --manifest"],
    [["doctor", "corpus", "metrics", "--manifest"], "Missing path after --manifest"],
    [["doctor", "corpus", "metrics", "--manifest", "x", "--json", "--markdown"], "either --json or --markdown"],
    [["doctor", "corpus", "metrics", "--manifest", "x", "--min-precision", "nope"], "between 0 and 1"],
    [["doctor", "corpus", "metrics", "--manifest", "x", "--min-recall", "2"], "between 0 and 1"],
    [["doctor", "corpus", "metrics", "--manifest", "x", "extra"], "Unknown corpus metrics argument"]
  ])("rejects invalid usage %#", async (args, expectedError) => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(args, io, {
      buildCorpusMetricsReportImpl: async () => report
    });
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain(expectedError);
  });
});
