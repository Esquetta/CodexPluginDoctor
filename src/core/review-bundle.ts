import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildDoctorAttestation,
  renderDoctorAttestationJson,
  verifyDoctorAttestation,
  type DoctorAttestationVerificationReport,
  type DoctorAttestation
} from "./attestation.js";
import {
  buildDoctorReleaseEvidenceReport,
  renderDoctorReleaseEvidenceJson,
  verifyDoctorReleaseEvidence,
  type BuildDoctorReleaseEvidenceOptions,
  type DoctorReleaseEvidenceReport,
  type DoctorReleaseEvidenceVerificationReport
} from "./release-evidence.js";
import {
  buildDoctorRuntimePlan,
  renderDoctorRuntimePlanJson,
  renderDoctorRuntimePlanMarkdown,
  type DoctorRuntimePlan
} from "./runtime-plan.js";
import {
  buildDoctorRuntimePolicyReport,
  renderDoctorRuntimePolicy,
  renderDoctorRuntimePolicyJson,
  type DoctorRuntimePolicyReport
} from "./runtime-policy.js";
import { packageVersion } from "../version.js";
import { readJsonFile } from "./read-json-file.js";

export interface BuildDoctorReviewBundleOptions {
  outputDirectory: string;
  signingKey: string;
  signingKeyEnv: string;
  allowDirty?: boolean;
  allowUntagged?: boolean;
}

export interface DoctorReviewBundleManifest {
  schemaVersion: "1.0.0";
  kind: "doctor.review.bundle";
  generatedAt: string;
  version: string;
  targetPath: string;
  outputDirectory: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  summary: {
    runtimePolicy: DoctorRuntimePolicyReport["recommendation"]["decision"];
    releaseReady: boolean;
    attestation: DoctorAttestation["summary"]["status"];
    releaseEvidence: DoctorReleaseEvidenceReport["status"];
  };
  files: {
    manifest: string;
    summary: string;
    runtimePlanJson: string;
    runtimePlanMarkdown: string;
    runtimePolicyJson: string;
    runtimePolicyText: string;
    attestationJson: string;
    releaseEvidenceJson: string;
  };
  integrity?: {
    algorithm: "sha256";
    files: Record<string, {
      path: string;
      digest: string;
      bytes: number;
    }>;
  };
}

export interface DoctorReviewBundle {
  manifest: DoctorReviewBundleManifest;
  runtimePlan: DoctorRuntimePlan;
  runtimePolicy: DoctorRuntimePolicyReport;
  attestation: DoctorAttestation;
  releaseEvidence: DoctorReleaseEvidenceReport;
}

export interface DoctorReviewBundleVerificationReport {
  schemaVersion: "1.0.0";
  kind: "doctor.review.bundle.verification";
  generatedAt: string;
  bundleDirectory: string;
  targetPath: string;
  status: "pass" | "fail";
  exitCode: 0 | 1;
  summary: {
    manifest: "pass" | "fail";
    files: "pass" | "fail";
    runtimePlan: "pass" | "fail";
    runtimePolicy: "pass" | "fail";
    attestation: "pass" | "fail";
    releaseEvidence: "pass" | "fail";
  };
  checks: Array<{
    id: string;
    status: "pass" | "fail";
    message: string;
  }>;
  attestation: DoctorAttestationVerificationReport | null;
  releaseEvidence: DoctorReleaseEvidenceVerificationReport | null;
}

export interface DoctorReviewBundleDiffReport {
  schemaVersion: "1.0.0";
  kind: "doctor.review.bundle.diff";
  generatedAt: string;
  beforeDirectory: string;
  afterDirectory: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  summary: {
    changed: boolean;
    statusChanged: boolean;
    runtimePolicyChanged: boolean;
    releaseReadyChanged: boolean;
    riskIncreased: boolean;
    changeCount: number;
  };
  before: DoctorReviewBundleDiffSnapshot | null;
  after: DoctorReviewBundleDiffSnapshot | null;
  changes: DoctorReviewBundleDiffChange[];
}

export interface DoctorReviewBundleDiffSnapshot {
  targetPath: string;
  version: string;
  status: DoctorReviewBundleManifest["status"];
  runtimePolicy: DoctorReviewBundleManifest["summary"]["runtimePolicy"];
  releaseReady: boolean;
  attestation: DoctorReviewBundleManifest["summary"]["attestation"];
  releaseEvidence: DoctorReviewBundleManifest["summary"]["releaseEvidence"];
  runtimePlanDigest: string | null;
  releaseEvidenceStatus: DoctorReleaseEvidenceReport["status"] | null;
  releaseEvidenceReady: boolean | null;
}

export interface DoctorReviewBundleDiffChange {
  field: string;
  before: string | boolean | null;
  after: string | boolean | null;
  severity: "info" | "warn" | "fail";
  message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDoctorReviewBundleManifest(value: unknown): value is DoctorReviewBundleManifest {
  return isPlainObject(value) &&
    value.schemaVersion === "1.0.0" &&
    value.kind === "doctor.review.bundle" &&
    typeof value.targetPath === "string" &&
    typeof value.outputDirectory === "string" &&
    isPlainObject(value.summary) &&
    isPlainObject(value.files);
}

function statusRank(status: "pass" | "warn" | "fail"): number {
  return status === "fail" ? 2 : status === "warn" ? 1 : 0;
}

function runtimePolicyRank(policy: DoctorReviewBundleManifest["summary"]["runtimePolicy"]): number {
  return policy === "deny"
    ? 3
    : policy === "sandbox_recommended"
      ? 2
      : policy === "review"
        ? 1
        : 0;
}

function sha256(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function relativeBundleFiles(): DoctorReviewBundleManifest["files"] {
  return {
    manifest: "manifest.json",
    summary: "summary.md",
    runtimePlanJson: "runtime-plan.json",
    runtimePlanMarkdown: "runtime-plan.md",
    runtimePolicyJson: "runtime-policy.json",
    runtimePolicyText: "runtime-policy.txt",
    attestationJson: "attestation.json",
    releaseEvidenceJson: "release-evidence.json"
  };
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function resolveBundleArtifactPath(bundleDirectory: string, relativePath: string): Promise<string> {
  const resolvedBundleDirectory = path.resolve(bundleDirectory);
  const artifactPath = path.resolve(resolvedBundleDirectory, relativePath);

  if (!isPathInsideDirectory(artifactPath, resolvedBundleDirectory)) {
    throw new Error("Bundle artifact path resolves outside the bundle directory.");
  }

  const [canonicalBundleDirectory, canonicalArtifactPath] = await Promise.all([
    realpath(resolvedBundleDirectory),
    realpath(artifactPath)
  ]);

  if (!isPathInsideDirectory(canonicalArtifactPath, canonicalBundleDirectory)) {
    throw new Error("Bundle artifact canonical path resolves outside the bundle directory.");
  }

  return canonicalArtifactPath;
}

function bundleStatus(
  runtimePolicy: DoctorRuntimePolicyReport,
  releaseEvidence: DoctorReleaseEvidenceReport
): "pass" | "warn" | "fail" {
  if (runtimePolicy.status === "fail" || releaseEvidence.status === "fail") {
    return "fail";
  }

  if (runtimePolicy.status === "warn") {
    return "warn";
  }

  return "pass";
}

function renderSummary(bundle: DoctorReviewBundle): string {
  return [
    "# Codex Plugin Doctor Review Bundle",
    "",
    `- Target: \`${bundle.manifest.targetPath}\``,
    `- Status: **${bundle.manifest.status.toUpperCase()}**`,
    `- Runtime policy: \`${bundle.runtimePolicy.recommendation.decision}\``,
    `- Runtime plan digest: \`${bundle.runtimePlan.digest}\``,
    `- Release ready: ${bundle.releaseEvidence.releaseReady ? "yes" : "no"}`,
    `- Attestation: ${bundle.attestation.summary.status.toUpperCase()}`,
    `- Release evidence: ${bundle.releaseEvidence.status.toUpperCase()}`,
    "",
    "## Files",
    "",
    `- [Runtime plan JSON](${bundle.manifest.files.runtimePlanJson})`,
    `- [Runtime plan Markdown](${bundle.manifest.files.runtimePlanMarkdown})`,
    `- [Runtime policy JSON](${bundle.manifest.files.runtimePolicyJson})`,
    `- [Runtime policy text](${bundle.manifest.files.runtimePolicyText})`,
    `- [Attestation JSON](${bundle.manifest.files.attestationJson})`,
    `- [Release evidence JSON](${bundle.manifest.files.releaseEvidenceJson})`,
    "",
    "## Runtime Policy Actions",
    "",
    ...bundle.runtimePolicy.recommendation.actions.map((action) => `- ${action}`)
  ].join("\n");
}

async function writeBundleFiles(bundle: DoctorReviewBundle): Promise<void> {
  const outputDirectory = bundle.manifest.outputDirectory;
  const files = bundle.manifest.files;

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, files.summary), renderSummary(bundle), "utf8"),
    writeFile(path.join(outputDirectory, files.runtimePlanJson), renderDoctorRuntimePlanJson(bundle.runtimePlan), "utf8"),
    writeFile(path.join(outputDirectory, files.runtimePlanMarkdown), renderDoctorRuntimePlanMarkdown(bundle.runtimePlan), "utf8"),
    writeFile(path.join(outputDirectory, files.runtimePolicyJson), renderDoctorRuntimePolicyJson(bundle.runtimePolicy), "utf8"),
    writeFile(path.join(outputDirectory, files.runtimePolicyText), renderDoctorRuntimePolicy(bundle.runtimePolicy), "utf8"),
    writeFile(path.join(outputDirectory, files.attestationJson), renderDoctorAttestationJson(bundle.attestation), "utf8"),
    writeFile(path.join(outputDirectory, files.releaseEvidenceJson), renderDoctorReleaseEvidenceJson(bundle.releaseEvidence), "utf8")
  ]);
  bundle.manifest.integrity = await buildBundleIntegrity(outputDirectory, files);
  await writeFile(path.join(outputDirectory, files.manifest), JSON.stringify(bundle.manifest, null, 2), "utf8");
}

async function buildBundleIntegrity(
  outputDirectory: string,
  files: DoctorReviewBundleManifest["files"]
): Promise<NonNullable<DoctorReviewBundleManifest["integrity"]>> {
  const integrityEntries = await Promise.all(
    Object.entries(files)
      .filter(([fileKey]) => fileKey !== "manifest")
      .map(async ([fileKey, relativePath]) => {
        const content = await readFile(path.join(outputDirectory, relativePath));

        return [
          fileKey,
          {
            path: relativePath,
            digest: sha256(content),
            bytes: content.byteLength
          }
        ] as const;
      })
  );

  return {
    algorithm: "sha256",
    files: Object.fromEntries(integrityEntries)
  };
}

export async function buildDoctorReviewBundle(
  targetPath: string,
  options: BuildDoctorReviewBundleOptions
): Promise<DoctorReviewBundle> {
  const outputDirectory = path.resolve(options.outputDirectory);
  const releaseEvidenceOptions: BuildDoctorReleaseEvidenceOptions = {
    signingKey: options.signingKey,
    signingKeyEnv: options.signingKeyEnv,
    allowDirty: options.allowDirty,
    allowUntagged: options.allowUntagged
  };
  const [
    runtimePlan,
    runtimePolicy,
    attestation,
    releaseEvidence
  ] = await Promise.all([
    buildDoctorRuntimePlan(targetPath),
    buildDoctorRuntimePolicyReport(targetPath),
    buildDoctorAttestation(targetPath, {
      signingKey: options.signingKey,
      signingKeyHint: `env:${options.signingKeyEnv}`,
      recomputeKeyEnv: options.signingKeyEnv
    }),
    buildDoctorReleaseEvidenceReport(targetPath, releaseEvidenceOptions)
  ]);
  const files = relativeBundleFiles();
  const status = bundleStatus(runtimePolicy, releaseEvidence);
  const manifest: DoctorReviewBundleManifest = {
    schemaVersion: "1.0.0",
    kind: "doctor.review.bundle",
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    targetPath: releaseEvidence.targetPath,
    outputDirectory,
    status,
    exitCode: status === "fail" ? 1 : 0,
    summary: {
      runtimePolicy: runtimePolicy.recommendation.decision,
      releaseReady: releaseEvidence.releaseReady,
      attestation: attestation.summary.status,
      releaseEvidence: releaseEvidence.status
    },
    files
  };
  const bundle = {
    manifest,
    runtimePlan,
    runtimePolicy,
    attestation,
    releaseEvidence
  };

  await writeBundleFiles(bundle);

  return bundle;
}

export function renderDoctorReviewBundleJson(bundle: DoctorReviewBundle): string {
  return JSON.stringify(bundle.manifest, null, 2);
}

async function readBundleJsonFile(bundleDirectory: string, relativePath: string): Promise<unknown> {
  return readJsonFile<unknown>(await resolveBundleArtifactPath(bundleDirectory, relativePath));
}

async function readBundleDiffSnapshot(bundleDirectory: string): Promise<DoctorReviewBundleDiffSnapshot | null> {
  const manifestArtifact = await readBundleJsonFile(bundleDirectory, "manifest.json");

  if (!isDoctorReviewBundleManifest(manifestArtifact)) {
    return null;
  }

  const files = manifestArtifact.files;
  let runtimePlanDigest: string | null = null;
  let releaseEvidenceStatus: DoctorReleaseEvidenceReport["status"] | null = null;
  let releaseEvidenceReady: boolean | null = null;

  try {
    const runtimePlan = await readBundleJsonFile(bundleDirectory, files.runtimePlanJson);

    runtimePlanDigest = isPlainObject(runtimePlan) && typeof runtimePlan.digest === "string"
      ? runtimePlan.digest
      : null;
  } catch {
    runtimePlanDigest = null;
  }

  try {
    const releaseEvidence = await readBundleJsonFile(bundleDirectory, files.releaseEvidenceJson);

    releaseEvidenceStatus = isPlainObject(releaseEvidence) &&
      (releaseEvidence.status === "pass" || releaseEvidence.status === "fail")
        ? releaseEvidence.status
        : null;
    releaseEvidenceReady = isPlainObject(releaseEvidence) && typeof releaseEvidence.releaseReady === "boolean"
      ? releaseEvidence.releaseReady
      : null;
  } catch {
    releaseEvidenceStatus = null;
    releaseEvidenceReady = null;
  }

  return {
    targetPath: manifestArtifact.targetPath,
    version: manifestArtifact.version,
    status: manifestArtifact.status,
    runtimePolicy: manifestArtifact.summary.runtimePolicy,
    releaseReady: manifestArtifact.summary.releaseReady,
    attestation: manifestArtifact.summary.attestation,
    releaseEvidence: manifestArtifact.summary.releaseEvidence,
    runtimePlanDigest,
    releaseEvidenceStatus,
    releaseEvidenceReady
  };
}

function createDiffChange(
  field: string,
  before: string | boolean | null,
  after: string | boolean | null,
  severity: DoctorReviewBundleDiffChange["severity"],
  message: string
): DoctorReviewBundleDiffChange | null {
  return before === after
    ? null
    : {
      field,
      before,
      after,
      severity,
      message
    };
}

function diffBundleSnapshots(
  before: DoctorReviewBundleDiffSnapshot,
  after: DoctorReviewBundleDiffSnapshot
): DoctorReviewBundleDiffChange[] {
  const changes = [
    createDiffChange("targetPath", before.targetPath, after.targetPath, "warn", "The bundle target path changed."),
    createDiffChange("version", before.version, after.version, "info", "The doctor version changed."),
    createDiffChange(
      "status",
      before.status,
      after.status,
      statusRank(after.status) > statusRank(before.status) ? "fail" : "info",
      "The review bundle status changed."
    ),
    createDiffChange(
      "runtimePolicy",
      before.runtimePolicy,
      after.runtimePolicy,
      runtimePolicyRank(after.runtimePolicy) > runtimePolicyRank(before.runtimePolicy) ? "warn" : "info",
      "The runtime policy decision changed."
    ),
    createDiffChange(
      "releaseReady",
      before.releaseReady,
      after.releaseReady,
      before.releaseReady && !after.releaseReady ? "fail" : "info",
      "The release readiness flag changed."
    ),
    createDiffChange(
      "attestation",
      before.attestation,
      after.attestation,
      statusRank(after.attestation) > statusRank(before.attestation) ? "fail" : "info",
      "The attestation summary changed."
    ),
    createDiffChange(
      "releaseEvidence",
      before.releaseEvidence,
      after.releaseEvidence,
      statusRank(after.releaseEvidence) > statusRank(before.releaseEvidence) ? "fail" : "info",
      "The release evidence summary changed."
    ),
    createDiffChange(
      "runtimePlanDigest",
      before.runtimePlanDigest,
      after.runtimePlanDigest,
      "warn",
      "The runtime plan digest changed."
    ),
    createDiffChange(
      "releaseEvidenceStatus",
      before.releaseEvidenceStatus,
      after.releaseEvidenceStatus,
      after.releaseEvidenceStatus === "fail" ? "fail" : "info",
      "The embedded release evidence status changed."
    ),
    createDiffChange(
      "releaseEvidenceReady",
      before.releaseEvidenceReady,
      after.releaseEvidenceReady,
      before.releaseEvidenceReady === true && after.releaseEvidenceReady === false ? "fail" : "info",
      "The embedded release evidence readiness changed."
    )
  ];

  return changes.filter((change): change is DoctorReviewBundleDiffChange => change !== null);
}

export async function diffDoctorReviewBundles(
  beforeDirectory: string,
  afterDirectory: string
): Promise<DoctorReviewBundleDiffReport> {
  const resolvedBeforeDirectory = path.resolve(beforeDirectory);
  const resolvedAfterDirectory = path.resolve(afterDirectory);
  const [before, after] = await Promise.all([
    readBundleDiffSnapshot(resolvedBeforeDirectory),
    readBundleDiffSnapshot(resolvedAfterDirectory)
  ]);

  if (!before || !after) {
    const changes: DoctorReviewBundleDiffChange[] = [
      {
        field: before ? "after" : "before",
        before: before ? "valid" : "invalid",
        after: after ? "valid" : "invalid",
        severity: "fail",
        message: "One or more review bundles could not be read as valid bundle directories."
      }
    ];

    return {
      schemaVersion: "1.0.0",
      kind: "doctor.review.bundle.diff",
      generatedAt: new Date().toISOString(),
      beforeDirectory: resolvedBeforeDirectory,
      afterDirectory: resolvedAfterDirectory,
      status: "fail",
      exitCode: 1,
      summary: {
        changed: true,
        statusChanged: false,
        runtimePolicyChanged: false,
        releaseReadyChanged: false,
        riskIncreased: true,
        changeCount: changes.length
      },
      before,
      after,
      changes
    };
  }

  const changes = diffBundleSnapshots(before, after);
  const riskIncreased = changes.some((change) => change.severity === "fail" || change.severity === "warn");
  const status = changes.some((change) => change.severity === "fail")
    ? "fail"
    : riskIncreased
      ? "warn"
      : "pass";

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.review.bundle.diff",
    generatedAt: new Date().toISOString(),
    beforeDirectory: resolvedBeforeDirectory,
    afterDirectory: resolvedAfterDirectory,
    status,
    exitCode: status === "fail" ? 1 : 0,
    summary: {
      changed: changes.length > 0,
      statusChanged: before.status !== after.status,
      runtimePolicyChanged: before.runtimePolicy !== after.runtimePolicy,
      releaseReadyChanged: before.releaseReady !== after.releaseReady,
      riskIncreased,
      changeCount: changes.length
    },
    before,
    after,
    changes
  };
}

export async function verifyDoctorReviewBundle(
  bundleDirectory: string,
  options: {
    signingKey: string;
    targetPath: string;
  }
): Promise<DoctorReviewBundleVerificationReport> {
  const resolvedBundleDirectory = path.resolve(bundleDirectory);
  const targetPath = path.resolve(options.targetPath);
  const checks: DoctorReviewBundleVerificationReport["checks"] = [];
  let manifest: DoctorReviewBundleManifest | null = null;
  let runtimePlanStatus: "pass" | "fail" = "fail";
  let runtimePolicyStatus: "pass" | "fail" = "fail";
  let attestation: DoctorAttestationVerificationReport | null = null;
  let releaseEvidence: DoctorReleaseEvidenceVerificationReport | null = null;
  let integrityStatus: "pass" | "fail" = "pass";

  try {
    const manifestArtifact = await readBundleJsonFile(resolvedBundleDirectory, "manifest.json");

    if (isDoctorReviewBundleManifest(manifestArtifact)) {
      manifest = manifestArtifact;
      checks.push({
        id: "review_bundle.manifest.valid",
        status: "pass",
        message: "The review bundle manifest has the expected schema and kind."
      });
    } else {
      checks.push({
        id: "review_bundle.manifest.valid",
        status: "fail",
        message: "The review bundle manifest is missing or invalid."
      });
    }
  } catch {
    checks.push({
      id: "review_bundle.manifest.valid",
      status: "fail",
      message: "The review bundle manifest could not be read."
    });
  }

  const files = manifest?.files ?? relativeBundleFiles();

  for (const [fileKey, relativePath] of Object.entries(files)) {
    try {
      const artifactPath = await resolveBundleArtifactPath(resolvedBundleDirectory, relativePath);
      const fileStat = await stat(artifactPath);
      checks.push({
        id: `review_bundle.file.${fileKey}`,
        status: fileStat.isFile() ? "pass" : "fail",
        message: fileStat.isFile()
          ? `${relativePath} is present.`
          : `${relativePath} is not a regular file.`
      });
    } catch {
      checks.push({
        id: `review_bundle.file.${fileKey}`,
        status: "fail",
        message: `${relativePath} is missing.`
      });
    }
  }

  if (manifest?.integrity) {
    if (manifest.integrity.algorithm !== "sha256") {
      integrityStatus = "fail";
      checks.push({
        id: "review_bundle.integrity.algorithm",
        status: "fail",
        message: "The review bundle manifest uses an unsupported integrity algorithm."
      });
    } else {
      checks.push({
        id: "review_bundle.integrity.algorithm",
        status: "pass",
        message: "The review bundle manifest uses SHA-256 integrity digests."
      });
    }

    const expectedIntegrityFileKeys = Object.keys(files).filter((fileKey) => fileKey !== "manifest");
    const integrityFileKeys = Object.keys(manifest.integrity.files);
    for (const fileKey of expectedIntegrityFileKeys) {
      if (!(fileKey in manifest.integrity.files)) {
        integrityStatus = "fail";
        checks.push({
          id: `review_bundle.integrity.${fileKey}`,
          status: "fail",
          message: `${files[fileKey as keyof typeof files]} is missing a manifest integrity entry.`
        });
      }
    }
    for (const fileKey of integrityFileKeys) {
      if (!expectedIntegrityFileKeys.includes(fileKey)) {
        integrityStatus = "fail";
        checks.push({
          id: `review_bundle.integrity.${fileKey}`,
          status: "fail",
          message: "The review bundle manifest includes an unexpected integrity entry."
        });
      }
    }

    for (const [fileKey, expected] of Object.entries(manifest.integrity.files)) {
      if (!expectedIntegrityFileKeys.includes(fileKey)) {
        continue;
      }

      try {
        const declaredPath = files[fileKey as keyof typeof files];
        if (expected.path !== declaredPath) {
          integrityStatus = "fail";
          checks.push({
            id: `review_bundle.integrity.${fileKey}.path`,
            status: "fail",
            message: `${expected.path} does not match the declared bundle file path.`
          });
          continue;
        }

        const resolvedIntegrityPath = path.resolve(resolvedBundleDirectory, expected.path);
        if (!isPathInsideDirectory(resolvedIntegrityPath, resolvedBundleDirectory)) {
          integrityStatus = "fail";
          checks.push({
            id: `review_bundle.integrity.${fileKey}.path`,
            status: "fail",
            message: `${expected.path} resolves outside the review bundle directory.`
          });
          continue;
        }

        const integrityPath = await resolveBundleArtifactPath(resolvedBundleDirectory, expected.path);
        const content = await readFile(integrityPath);
        const digest = sha256(content);
        const matches = digest === expected.digest && content.byteLength === expected.bytes;

        if (!matches) {
          integrityStatus = "fail";
        }

        checks.push({
          id: `review_bundle.integrity.${fileKey}`,
          status: matches ? "pass" : "fail",
          message: matches
            ? `${expected.path} matches the manifest integrity digest.`
            : `${expected.path} does not match the manifest integrity digest.`
        });
      } catch {
        integrityStatus = "fail";
        checks.push({
          id: `review_bundle.integrity.${fileKey}`,
          status: "fail",
          message: `${expected.path} could not be read for integrity verification.`
        });
      }
    }
  } else {
    checks.push({
      id: "review_bundle.integrity.present",
      status: "pass",
      message: "No manifest integrity block was present; skipping digest checks for backward compatibility."
    });
  }

  try {
    const runtimePlan = await readBundleJsonFile(resolvedBundleDirectory, files.runtimePlanJson);
    runtimePlanStatus = isPlainObject(runtimePlan) && runtimePlan.kind === "doctor.runtime.plan" ? "pass" : "fail";
    checks.push({
      id: "review_bundle.runtime_plan",
      status: runtimePlanStatus,
      message: runtimePlanStatus === "pass"
        ? "The runtime plan artifact has the expected kind."
        : "The runtime plan artifact is invalid."
    });
  } catch {
    checks.push({
      id: "review_bundle.runtime_plan",
      status: "fail",
      message: "The runtime plan artifact could not be read."
    });
  }

  try {
    const runtimePolicy = await readBundleJsonFile(resolvedBundleDirectory, files.runtimePolicyJson);
    runtimePolicyStatus = isPlainObject(runtimePolicy) && runtimePolicy.kind === "doctor.runtime.policy" ? "pass" : "fail";
    checks.push({
      id: "review_bundle.runtime_policy",
      status: runtimePolicyStatus,
      message: runtimePolicyStatus === "pass"
        ? "The runtime policy artifact has the expected kind."
        : "The runtime policy artifact is invalid."
    });
  } catch {
    checks.push({
      id: "review_bundle.runtime_policy",
      status: "fail",
      message: "The runtime policy artifact could not be read."
    });
  }

  try {
    const attestationPath = await resolveBundleArtifactPath(resolvedBundleDirectory, files.attestationJson);
    attestation = await verifyDoctorAttestation(
      attestationPath,
      targetPath,
      { signingKey: options.signingKey }
    );
    checks.push({
      id: "review_bundle.attestation",
      status: attestation.status,
      message: attestation.status === "pass"
        ? "The bundled attestation verifies against the target package."
        : "The bundled attestation does not verify against the target package."
    });
  } catch {
    checks.push({
      id: "review_bundle.attestation",
      status: "fail",
      message: "The bundled attestation could not be verified."
    });
  }

  try {
    const releaseEvidencePath = await resolveBundleArtifactPath(resolvedBundleDirectory, files.releaseEvidenceJson);
    releaseEvidence = await verifyDoctorReleaseEvidence(
      releaseEvidencePath,
      {
        signingKey: options.signingKey,
        targetPath
      }
    );
    checks.push({
      id: "review_bundle.release_evidence",
      status: releaseEvidence.status,
      message: releaseEvidence.status === "pass"
        ? "The bundled release evidence verifies against the target package."
        : "The bundled release evidence does not verify against the target package."
    });
  } catch {
    checks.push({
      id: "review_bundle.release_evidence",
      status: "fail",
      message: "The bundled release evidence could not be verified."
    });
  }

  const failedChecks = checks.filter((check) => check.status === "fail");
  const fileChecks = checks.filter((check) => check.id.startsWith("review_bundle.file."));
  const manifestStatus = checks.find((check) => check.id === "review_bundle.manifest.valid")?.status ?? "fail";

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.review.bundle.verification",
    generatedAt: new Date().toISOString(),
    bundleDirectory: resolvedBundleDirectory,
    targetPath,
    status: failedChecks.length === 0 ? "pass" : "fail",
    exitCode: failedChecks.length === 0 ? 0 : 1,
    summary: {
      manifest: manifestStatus,
      files: fileChecks.every((check) => check.status === "pass") && integrityStatus === "pass" ? "pass" : "fail",
      runtimePlan: runtimePlanStatus,
      runtimePolicy: runtimePolicyStatus,
      attestation: attestation?.status ?? "fail",
      releaseEvidence: releaseEvidence?.status ?? "fail"
    },
    checks,
    attestation,
    releaseEvidence
  };
}

export function renderDoctorReviewBundleVerificationJson(report: DoctorReviewBundleVerificationReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorReviewBundleVerification(report: DoctorReviewBundleVerificationReport): string {
  const lines = [
    "Doctor Review Bundle Verification",
    "=================================",
    `Bundle: ${report.bundleDirectory}`,
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Manifest: ${report.summary.manifest.toUpperCase()}`,
    `Files: ${report.summary.files.toUpperCase()}`,
    `Runtime plan: ${report.summary.runtimePlan.toUpperCase()}`,
    `Runtime policy: ${report.summary.runtimePolicy.toUpperCase()}`,
    `Attestation: ${report.summary.attestation.toUpperCase()}`,
    `Release evidence: ${report.summary.releaseEvidence.toUpperCase()}`,
    "",
    "Checks",
    "------"
  ];

  for (const check of report.checks) {
    lines.push(`${check.status === "pass" ? "PASS" : "FAIL"} ${check.id}`);
    lines.push(`  ${check.message}`);
  }

  return lines.join("\n");
}

export function renderDoctorReviewBundleDiffJson(report: DoctorReviewBundleDiffReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorReviewBundleDiff(report: DoctorReviewBundleDiffReport): string {
  const lines = [
    "Doctor Review Bundle Diff",
    "=========================",
    `Before: ${report.beforeDirectory}`,
    `After: ${report.afterDirectory}`,
    `Status: ${report.status.toUpperCase()}`,
    `Changed: ${report.summary.changed ? "yes" : "no"}`,
    `Risk increased: ${report.summary.riskIncreased ? "yes" : "no"}`,
    `Changes: ${report.summary.changeCount}`,
    "",
    "Changes",
    "-------"
  ];

  if (report.changes.length === 0) {
    lines.push("No changes.");
    return lines.join("\n");
  }

  for (const change of report.changes) {
    lines.push(`${change.severity.toUpperCase()} ${change.field}`);
    lines.push(`  Before: ${change.before ?? "unknown"}`);
    lines.push(`  After: ${change.after ?? "unknown"}`);
    lines.push(`  ${change.message}`);
  }

  return lines.join("\n");
}

export function renderDoctorReviewBundle(bundle: DoctorReviewBundle): string {
  return [
    "Doctor Review Bundle",
    "====================",
    `Target: ${bundle.manifest.targetPath}`,
    `Output: ${bundle.manifest.outputDirectory}`,
    `Status: ${bundle.manifest.status.toUpperCase()}`,
    `Runtime policy: ${bundle.manifest.summary.runtimePolicy}`,
    `Release ready: ${bundle.manifest.summary.releaseReady ? "yes" : "no"}`,
    "",
    "Files",
    "-----",
    ...Object.values(bundle.manifest.files).map((file) => `- ${file}`)
  ].join("\n");
}
