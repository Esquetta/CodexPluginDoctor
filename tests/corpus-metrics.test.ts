import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCorpusQualityMetricsReport,
  CorpusMetricsManifestError,
  loadCorpusMetricsManifest,
  reconcileCorpusMetricFindings
} from "../src/core/corpus-quality-metrics.js";

const digest = `sha256:${"a".repeat(64)}`;
const tpFingerprint = "b".repeat(64);
const fpFingerprint = "c".repeat(64);

async function createMetricsManifest(
  mutate?: (manifest: Record<string, unknown>) => void
): Promise<{ manifestPath: string; root: string; targetPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-metrics-"));
  const targetPath = path.join(root, "packages", "broken-01");
  await mkdir(targetPath, { recursive: true });
  const manifest: Record<string, unknown> = {
    schemaVersion: "1.0.0",
    thresholds: {
      minPrecision: 0.8,
      minRecall: 0.8,
      maxFalsePositiveRate: 0.2
    },
    targets: [{
      id: "broken-01",
      profile: "broken",
      sourceType: "public-package",
      disclosure: "anonymized",
      path: "packages/broken-01",
      mode: "codex-plugin",
      contentDigest: digest,
      source: {
        repository: "https://github.com/example/plugin",
        revision: "d".repeat(40)
      },
      reviews: [{
        findingId: "plugin.manifest.missing_field",
        fingerprint: tpFingerprint,
        classification: "true_positive"
      }]
    }]
  };
  mutate?.(manifest);
  const manifestPath = path.join(root, "corpus.json");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  return { manifestPath, root, targetPath };
}

function firstTarget(manifest: Record<string, unknown>): Record<string, unknown> {
  return (manifest.targets as Record<string, unknown>[])[0];
}

describe("corpus metrics manifest", () => {
  it("loads strict thresholds, provenance, and a contained target", async () => {
    const { manifestPath, targetPath } = await createMetricsManifest();
    await expect(loadCorpusMetricsManifest(manifestPath)).resolves.toMatchObject({
      schemaVersion: "1.0.0",
      thresholds: { minPrecision: 0.8, minRecall: 0.8, maxFalsePositiveRate: 0.2 },
      targets: [{ id: "broken-01", resolvedPath: targetPath }]
    });
  });

  it("rejects a target that escapes the metrics manifest directory", async () => {
    const { manifestPath } = await createMetricsManifest((manifest) => {
      firstTarget(manifest).path = "../outside";
    });
    await expect(loadCorpusMetricsManifest(manifestPath)).rejects.toThrow(
      "Metrics target path must remain beneath the manifest directory."
    );
  });

  it.each([
    ["unknown field", (m: Record<string, unknown>) => { m.notes = "private"; }],
    ["invalid threshold", (m: Record<string, unknown>) => {
      (m.thresholds as Record<string, unknown>).minPrecision = 1.1;
    }],
    ["non-HTTPS source", (m: Record<string, unknown>) => {
      (firstTarget(m).source as Record<string, unknown>).repository = "http://example.com/repo";
    }],
    ["mutable revision", (m: Record<string, unknown>) => {
      (firstTarget(m).source as Record<string, unknown>).revision = "main";
    }],
    ["absolute path", (m: Record<string, unknown>) => {
      firstTarget(m).path = path.resolve("outside");
    }],
    ["invalid digest", (m: Record<string, unknown>) => {
      firstTarget(m).contentDigest = "sha256:nope";
    }]
  ])("rejects %s", async (_label, mutate) => {
    const { manifestPath } = await createMetricsManifest(mutate);
    await expect(loadCorpusMetricsManifest(manifestPath)).rejects.toBeInstanceOf(
      CorpusMetricsManifestError
    );
  });

  it("rejects duplicate target ids and duplicate review keys", async () => {
    const duplicateTargets = await createMetricsManifest((manifest) => {
      const targets = manifest.targets as Record<string, unknown>[];
      targets.push({ ...targets[0] });
    });
    await expect(loadCorpusMetricsManifest(duplicateTargets.manifestPath)).rejects.toThrow(
      "duplicated"
    );

    const duplicateReviews = await createMetricsManifest((manifest) => {
      const reviews = firstTarget(manifest).reviews as Record<string, unknown>[];
      reviews.push({ ...reviews[0] });
    });
    await expect(loadCorpusMetricsManifest(duplicateReviews.manifestPath)).rejects.toThrow(
      "duplicate finding review"
    );
  });
});

describe("corpus metrics reconciliation", () => {
  it("classifies exact fingerprints and calculates reviewed finding metrics", () => {
    const result = reconcileCorpusMetricFindings(
      [
        { findingId: "rule.tp.1", fingerprint: "1".repeat(64), classification: "true_positive" },
        { findingId: "rule.tp.2", fingerprint: "2".repeat(64), classification: "true_positive" },
        { findingId: "rule.tp.missing", fingerprint: "3".repeat(64), classification: "true_positive" },
        { findingId: "rule.fp", fingerprint: "4".repeat(64), classification: "false_positive" },
        { findingId: "rule.fp.resolved", fingerprint: "5".repeat(64), classification: "false_positive" },
        { findingId: "rule.unclear", fingerprint: "6".repeat(64), classification: "unclear" }
      ],
      [
        { findingId: "rule.tp.1", fingerprint: "1".repeat(64) },
        { findingId: "rule.tp.2", fingerprint: "2".repeat(64) },
        { findingId: "rule.fp", fingerprint: "4".repeat(64) },
        { findingId: "rule.unclear", fingerprint: "6".repeat(64) },
        { findingId: "rule.unreviewed", fingerprint: "7".repeat(64) }
      ]
    );

    expect(result.counts).toEqual({
      truePositives: 2,
      falsePositives: 1,
      falseNegatives: 1,
      resolvedFalsePositives: 1,
      unreviewed: 1,
      unclear: 1
    });
    expect(result.metrics).toEqual({
      precision: 0.666667,
      recall: 0.666667,
      falsePositiveRate: 0.333333
    });
    expect(result.complete).toBe(false);
  });

  it("returns null metrics when their denominators are zero", () => {
    const result = reconcileCorpusMetricFindings([], []);
    expect(result.metrics).toEqual({ precision: null, recall: null, falsePositiveRate: null });
    expect(result.complete).toBe(true);
  });
});

describe("corpus metrics report", () => {
  it("uses CLI threshold overrides and keeps local paths out of output", async () => {
    const { manifestPath, root, targetPath } = await createMetricsManifest();
    const report = await buildCorpusQualityMetricsReport(manifestPath, {
      thresholds: { minPrecision: 1, minRecall: 1, maxFalsePositiveRate: 0 },
      analyzeTarget: async () => ({
        findings: [{ findingId: "plugin.manifest.missing_field", fingerprint: tpFingerprint }]
      }),
      buildFingerprint: async () => ({ digest })
    });

    expect(report).toMatchObject({
      kind: "doctor.validation.corpus.metrics",
      status: "pass",
      exitCode: 0,
      thresholds: { minPrecision: 1, minRecall: 1, maxFalsePositiveRate: 0 },
      summary: {
        targetCount: 1,
        truePositives: 1,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1,
        recall: 1,
        falsePositiveRate: 0
      }
    });
    expect(JSON.stringify(report)).not.toContain(root);
    expect(JSON.stringify(report)).not.toContain(targetPath);
  });

  it("returns exit 1 for complete threshold failures and exit 2 for incomplete review", async () => {
    const failed = await createMetricsManifest((manifest) => {
      const reviews = firstTarget(manifest).reviews as Record<string, unknown>[];
      reviews.push({
        findingId: "plugin.false_alarm",
        fingerprint: fpFingerprint,
        classification: "false_positive"
      });
    });
    const options = {
      analyzeTarget: async () => ({ findings: [
        { findingId: "plugin.manifest.missing_field", fingerprint: tpFingerprint },
        { findingId: "plugin.false_alarm", fingerprint: fpFingerprint }
      ] }),
      buildFingerprint: async () => ({ digest })
    };
    const failedReport = await buildCorpusQualityMetricsReport(failed.manifestPath, options);
    expect(failedReport).toMatchObject({ status: "fail", exitCode: 1 });

    const incomplete = await createMetricsManifest();
    const incompleteReport = await buildCorpusQualityMetricsReport(incomplete.manifestPath, {
      analyzeTarget: async () => ({ findings: [
        { findingId: "plugin.manifest.missing_field", fingerprint: tpFingerprint },
        { findingId: "plugin.unreviewed", fingerprint: "9".repeat(64) }
      ] }),
      buildFingerprint: async () => ({ digest })
    });
    expect(incompleteReport).toMatchObject({ status: "incomplete", exitCode: 2 });
  });
});
