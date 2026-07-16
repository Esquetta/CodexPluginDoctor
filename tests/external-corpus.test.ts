import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildExternalValidationCorpusReport,
  ExternalCorpusManifestError,
  loadExternalCorpusManifest
} from "../src/core/external-validation-corpus.js";
import { buildPackageFingerprint } from "../src/core/attestation.js";
import { validatePlugin } from "../src/core/validate-plugin.js";

const digest = `sha256:${"a".repeat(64)}`;

async function createManifest(
  mutate?: (manifest: Record<string, unknown>) => void
): Promise<{ manifestPath: string; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "doctor-external-corpus-"));
  const targetPath = path.join(root, "target");
  await mkdir(targetPath);
  const manifest: Record<string, unknown> = {
    schemaVersion: "1.0.0",
    targets: [{
      id: "healthy-01",
      profile: "healthy",
      sourceType: "local-snapshot",
      disclosure: "anonymized",
      path: "target",
      mode: "codex-plugin",
      contentDigest: digest,
      expectedStatus: "pass",
      reviews: [{
        findingId: "plugin.example",
        fingerprint: "finding-fingerprint",
        classification: "true_positive"
      }]
    }]
  };
  mutate?.(manifest);
  const manifestPath = path.join(root, "corpus.json");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  return { manifestPath, root };
}

function firstTarget(manifest: Record<string, unknown>): Record<string, unknown> {
  return (manifest.targets as Record<string, unknown>[])[0];
}

describe("external corpus manifest", () => {
  it("loads a strict offline manifest", async () => {
    const { manifestPath, root } = await createManifest();
    await expect(loadExternalCorpusManifest(manifestPath)).resolves.toMatchObject({
      schemaVersion: "1.0.0",
      targets: [{ id: "healthy-01", profile: "healthy", resolvedPath: path.join(root, "target") }]
    });
  });

  it("allows relative sibling targets", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "doctor-external-sibling-"));
    const manifestDirectory = path.join(parent, "manifest");
    const targetDirectory = path.join(parent, "private-corpus");
    await mkdir(manifestDirectory);
    await mkdir(targetDirectory);
    const { manifestPath } = await createManifest((manifest) => {
      firstTarget(manifest).path = "../private-corpus";
    });
    const movedManifest = path.join(manifestDirectory, "corpus.json");
    const source = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8"));
    await writeFile(movedManifest, JSON.stringify(source), "utf8");
    await expect(loadExternalCorpusManifest(movedManifest)).resolves.toMatchObject({
      targets: [{ resolvedPath: targetDirectory }]
    });
  });

  it.each([
    ["schema version", (m: Record<string, unknown>) => { m.schemaVersion = "2.0.0"; }],
    ["top-level field", (m: Record<string, unknown>) => { m.notes = "private"; }],
    ["runtime field", (m: Record<string, unknown>) => { firstTarget(m).runtime = true; }],
    ["absolute path", (m: Record<string, unknown>) => { firstTarget(m).path = path.resolve("absolute"); }],
    ["foreign absolute path", (m: Record<string, unknown>) => { firstTarget(m).path = "/private/corpus"; }],
    ["profile", (m: Record<string, unknown>) => { firstTarget(m).profile = "unknown"; }],
    ["sourceType", (m: Record<string, unknown>) => { firstTarget(m).sourceType = "unknown"; }],
    ["mode", (m: Record<string, unknown>) => { firstTarget(m).mode = "unknown"; }],
    ["status", (m: Record<string, unknown>) => { firstTarget(m).expectedStatus = "unknown"; }],
    ["digest", (m: Record<string, unknown>) => { firstTarget(m).contentDigest = "sha256:nope"; }],
    ["classification", (m: Record<string, unknown>) => {
      (firstTarget(m).reviews as Record<string, unknown>[])[0].classification = "unknown";
    }],
    ["review field", (m: Record<string, unknown>) => {
      (firstTarget(m).reviews as Record<string, unknown>[])[0].notes = "private";
    }]
  ])("rejects an invalid %s", async (_label, mutate) => {
    const { manifestPath } = await createManifest(mutate);
    await expect(loadExternalCorpusManifest(manifestPath)).rejects.toBeInstanceOf(ExternalCorpusManifestError);
  });

  it("rejects duplicate target ids", async () => {
    const { manifestPath } = await createManifest((manifest) => {
      const targets = manifest.targets as Record<string, unknown>[];
      targets.push({ ...targets[0] });
    });
    await expect(loadExternalCorpusManifest(manifestPath)).rejects.toThrow("duplicated");
  });

  it("rejects missing target directories", async () => {
    const { manifestPath } = await createManifest((manifest) => {
      firstTarget(manifest).path = "missing";
    });
    await expect(loadExternalCorpusManifest(manifestPath)).rejects.toThrow("does not exist");
  });
});

const fixtureRoot = path.resolve("tests", "fixtures", "external-corpus");

async function createEvaluationManifest(options: {
  fixture?: "healthy" | "broken" | "edge-case";
  digest?: string;
  expectedStatus?: "pass" | "warn" | "fail";
  reviews?: Array<{
    findingId: string;
    fingerprint: string;
    classification: "true_positive" | "false_positive" | "unclear";
  }>;
} = {}): Promise<{ manifestPath: string; targetPath: string }> {
  const fixture = options.fixture ?? "broken";
  const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-evaluation-"));
  const targetPath = path.join(root, "snapshot");
  await cp(path.join(fixtureRoot, fixture), targetPath, { recursive: true });
  const fingerprint = await buildPackageFingerprint(targetPath);
  const result = await validatePlugin(targetPath);
  const manifestPath = path.join(root, "corpus.json");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: "1.0.0",
    targets: [{
      id: `${fixture}-01`,
      profile: fixture === "edge-case" ? "edge-case" : fixture,
      sourceType: "derived-fixture",
      disclosure: "anonymized",
      path: "snapshot",
      mode: "codex-plugin",
      contentDigest: options.digest ?? fingerprint.digest,
      expectedStatus: options.expectedStatus ?? result.status,
      reviews: options.reviews ?? result.findings.map((finding) => ({
        findingId: finding.id,
        fingerprint: finding.fingerprint,
        classification: "true_positive"
      }))
    }]
  }), "utf8");
  return { manifestPath, targetPath };
}

describe("external corpus evaluation", () => {
  it("accepts exact true-positive reviews and returns sanitized evidence", async () => {
    const { manifestPath, targetPath } = await createEvaluationManifest();
    const report = await buildExternalValidationCorpusReport(manifestPath);

    expect(report.summary.status).toBe("pass");
    expect(report.summary.classificationCounts).toEqual({
      truePositive: 1,
      falsePositive: 0,
      unclear: 0,
      missingExpectedFinding: 0
    });
    expect(report.cases[0].expectationMatched).toBe(true);
    expect(JSON.stringify(report)).not.toContain(path.dirname(manifestPath));
    expect(JSON.stringify(report)).not.toContain(targetPath);
  });

  it("rejects digest drift", async () => {
    const { manifestPath } = await createEvaluationManifest({ digest: `sha256:${"0".repeat(64)}` });
    const report = await buildExternalValidationCorpusReport(manifestPath);
    expect(report.cases[0]).toMatchObject({ digestMatched: false, expectationMatched: false });
  });

  it("rejects a missing expected true positive using the exact fingerprint", async () => {
    const { manifestPath } = await createEvaluationManifest({
      reviews: [{
        findingId: "plugin.manifest.missing",
        fingerprint: "different-fingerprint",
        classification: "true_positive"
      }]
    });
    const report = await buildExternalValidationCorpusReport(manifestPath);
    expect(report.cases[0].classificationCounts.missingExpectedFinding).toBe(1);
    expect(report.cases[0].actual.findings[0].classification).toBe("unreviewed");
    expect(report.cases[0].expectationMatched).toBe(false);
  });

  it.each(["false_positive", "unclear"] as const)(
    "rejects a present %s review",
    async (classification) => {
      const initial = await createEvaluationManifest();
      const finding = (await validatePlugin(initial.targetPath)).findings[0];
      const { manifestPath } = await createEvaluationManifest({
        reviews: [{
          findingId: finding.id,
          fingerprint: finding.fingerprint!,
          classification
        }]
      });
      const report = await buildExternalValidationCorpusReport(manifestPath);
      expect(report.cases[0].classificationCounts[
        classification === "false_positive" ? "falsePositive" : "unclear"
      ]).toBe(1);
      expect(report.cases[0].expectationMatched).toBe(false);
    }
  );

  it("rejects an unreviewed actual finding", async () => {
    const { manifestPath } = await createEvaluationManifest({ reviews: [] });
    const report = await buildExternalValidationCorpusReport(manifestPath);
    expect(report.cases[0].actual.findings).toEqual([
      expect.objectContaining({ classification: "unreviewed" })
    ]);
    expect(report.cases[0].expectationMatched).toBe(false);
  });

  it("matches duplicate finding IDs by fingerprint rather than ID alone", async () => {
    const initial = await createEvaluationManifest();
    const finding = (await validatePlugin(initial.targetPath)).findings[0];
    const { manifestPath } = await createEvaluationManifest({
      reviews: [
        {
          findingId: finding.id,
          fingerprint: finding.fingerprint!,
          classification: "true_positive"
        },
        {
          findingId: finding.id,
          fingerprint: "different-fingerprint",
          classification: "true_positive"
        }
      ]
    });
    const report = await buildExternalValidationCorpusReport(manifestPath);
    expect(report.cases[0].classificationCounts).toMatchObject({
      truePositive: 1,
      missingExpectedFinding: 1
    });
    expect(report.cases[0].expectationMatched).toBe(false);
  });

  it("is deterministic across different absolute parent directories", async () => {
    const first = await createEvaluationManifest();
    const second = await createEvaluationManifest();
    const firstReport = await buildExternalValidationCorpusReport(first.manifestPath);
    const secondReport = await buildExternalValidationCorpusReport(second.manifestPath);
    const { generatedAt: _firstGeneratedAt, ...stableFirst } = firstReport;
    const { generatedAt: _secondGeneratedAt, ...stableSecond } = secondReport;
    expect(stableFirst).toEqual(stableSecond);
  });

  it("evaluates healthy and edge-case snapshots without runtime execution", async () => {
    for (const fixture of ["healthy", "edge-case"] as const) {
      const { manifestPath } = await createEvaluationManifest({ fixture });
      const report = await buildExternalValidationCorpusReport(manifestPath);
      expect(report).toMatchObject({
        summary: { status: "pass", runtimeCases: 0 },
        cases: [{ profile: fixture === "edge-case" ? "edge-case" : "healthy" }]
      });
    }
  });
});
