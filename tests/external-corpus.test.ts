import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ExternalCorpusManifestError,
  loadExternalCorpusManifest
} from "../src/core/external-validation-corpus.js";

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
