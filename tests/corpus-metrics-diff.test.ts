import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCorpusQualityMetricsDiffReport,
  CorpusMetricsDiffError,
  renderCorpusQualityMetricsDiffJson,
  renderCorpusQualityMetricsDiffMarkdown,
  renderCorpusQualityMetricsDiffText,
  type CorpusQualityMetricsReport
} from "../src/core/corpus-quality-metrics.js";

function metricsReport(overrides: Partial<CorpusQualityMetricsReport["summary"]> = {}): CorpusQualityMetricsReport {
  const summary = {
    targetCount: 1,
    completeTargets: 1,
    incompleteTargets: 0,
    truePositives: 4,
    falsePositives: 1,
    falseNegatives: 1,
    resolvedFalsePositives: 0,
    unreviewed: 0,
    unclear: 0,
    precision: 0.8,
    recall: 0.8,
    falsePositiveRate: 0.2,
    ...overrides
  };
  return {
    schemaVersion: "1.0.0",
    kind: "doctor.validation.corpus.metrics",
    generatedAt: "2026-07-19T00:00:00.000Z",
    version: "1.49.0",
    corpusDigest: `sha256:${"a".repeat(64)}`,
    status: "pass",
    exitCode: 0,
    summary,
    thresholds: {},
    thresholdChecks: [],
    targets: [{
      id: "broken-01",
      profile: "broken",
      sourceType: "public-package",
      disclosure: "anonymized",
      mode: "codex-plugin",
      digestMatched: true,
      complete: true,
      counts: {
        truePositives: summary.truePositives,
        falsePositives: summary.falsePositives,
        falseNegatives: summary.falseNegatives,
        resolvedFalsePositives: summary.resolvedFalsePositives,
        unreviewed: summary.unreviewed,
        unclear: summary.unclear
      },
      metrics: {
        precision: summary.precision,
        recall: summary.recall,
        falsePositiveRate: summary.falsePositiveRate
      },
      outcomes: []
    }]
  };
}

async function writeReport(root: string, name: string, report: CorpusQualityMetricsReport): Promise<string> {
  const reportPath = path.join(root, name);
  await writeFile(reportPath, JSON.stringify(report), "utf8");
  return reportPath;
}

describe("corpus metrics diff", () => {
  it("detects exact quality regressions and sanitizes report paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-metrics-diff-"));
    const beforePath = await writeReport(root, "private-before.json", metricsReport());
    const afterPath = await writeReport(root, "private-after.json", metricsReport({
      truePositives: 3,
      falsePositives: 2,
      falseNegatives: 2,
      precision: 0.6,
      recall: 0.6,
      falsePositiveRate: 0.4
    }));

    const report = await buildCorpusQualityMetricsDiffReport(beforePath, afterPath, {
      failOnRegression: true
    });

    expect(report.status).toBe("fail");
    expect(report.exitCode).toBe(1);
    expect(report.summary).toMatchObject({
      comparable: true,
      regression: true,
      precisionDelta: -0.2,
      recallDelta: -0.2,
      falsePositiveRateDelta: 0.2,
      changedTargets: 1
    });
    expect(report.targets[0]).toMatchObject({ id: "broken-01", regressed: true });
    const serialized = renderCorpusQualityMetricsDiffJson(report);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("private-before.json");
  });

  it("reports a regression without failing when the gate is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-metrics-diff-"));
    const beforePath = await writeReport(root, "before.json", metricsReport());
    const afterPath = await writeReport(root, "after.json", metricsReport({
      falseNegatives: 2,
      recall: 0.666667
    }));

    const report = await buildCorpusQualityMetricsDiffReport(beforePath, afterPath);
    expect(report.status).toBe("pass");
    expect(report.exitCode).toBe(0);
    expect(report.summary.regression).toBe(true);
  });

  it("rejects reports from different corpus identities", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-metrics-diff-"));
    const before = metricsReport();
    const after = metricsReport();
    after.corpusDigest = `sha256:${"b".repeat(64)}`;
    const beforePath = await writeReport(root, "before.json", before);
    const afterPath = await writeReport(root, "after.json", after);

    await expect(buildCorpusQualityMetricsDiffReport(beforePath, afterPath)).rejects.toThrow(
      new CorpusMetricsDiffError("Corpus metrics reports describe different corpus identities.")
    );
  });

  it("rejects incomplete and internally inconsistent reports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-metrics-diff-"));
    const incomplete = metricsReport({ incompleteTargets: 1, completeTargets: 0 });
    incomplete.status = "incomplete";
    incomplete.exitCode = 2;
    incomplete.targets[0].complete = false;
    const inconsistent = metricsReport();
    inconsistent.summary.truePositives = 99;
    const inconsistentMetric = metricsReport();
    inconsistentMetric.targets[0].metrics.precision = 0.1;
    const validPath = await writeReport(root, "valid.json", metricsReport());

    await expect(buildCorpusQualityMetricsDiffReport(
      await writeReport(root, "incomplete.json", incomplete),
      validPath
    )).rejects.toThrow("must be complete");
    await expect(buildCorpusQualityMetricsDiffReport(
      validPath,
      await writeReport(root, "inconsistent.json", inconsistent)
    )).rejects.toThrow("internally inconsistent");
    await expect(buildCorpusQualityMetricsDiffReport(
      validPath,
      await writeReport(root, "inconsistent-metric.json", inconsistentMetric)
    )).rejects.toThrow("internally inconsistent");
  });

  it("renders text and Markdown summaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-metrics-diff-"));
    const beforePath = await writeReport(root, "before.json", metricsReport());
    const afterPath = await writeReport(root, "after.json", metricsReport({
      truePositives: 5,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
      falsePositiveRate: 0
    }));
    const report = await buildCorpusQualityMetricsDiffReport(beforePath, afterPath);

    expect(renderCorpusQualityMetricsDiffText(report)).toContain("Doctor Corpus Metrics Diff");
    expect(renderCorpusQualityMetricsDiffText(report)).toContain("Regression: no");
    expect(renderCorpusQualityMetricsDiffMarkdown(report)).toContain("# Doctor Corpus Metrics Diff");
  });
});
