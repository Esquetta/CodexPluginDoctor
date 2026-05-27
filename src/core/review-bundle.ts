import { mkdir, stat, writeFile } from "node:fs/promises";
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
    writeFile(path.join(outputDirectory, files.manifest), JSON.stringify(bundle.manifest, null, 2), "utf8"),
    writeFile(path.join(outputDirectory, files.summary), renderSummary(bundle), "utf8"),
    writeFile(path.join(outputDirectory, files.runtimePlanJson), renderDoctorRuntimePlanJson(bundle.runtimePlan), "utf8"),
    writeFile(path.join(outputDirectory, files.runtimePlanMarkdown), renderDoctorRuntimePlanMarkdown(bundle.runtimePlan), "utf8"),
    writeFile(path.join(outputDirectory, files.runtimePolicyJson), renderDoctorRuntimePolicyJson(bundle.runtimePolicy), "utf8"),
    writeFile(path.join(outputDirectory, files.runtimePolicyText), renderDoctorRuntimePolicy(bundle.runtimePolicy), "utf8"),
    writeFile(path.join(outputDirectory, files.attestationJson), renderDoctorAttestationJson(bundle.attestation), "utf8"),
    writeFile(path.join(outputDirectory, files.releaseEvidenceJson), renderDoctorReleaseEvidenceJson(bundle.releaseEvidence), "utf8")
  ]);
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
  return readJsonFile<unknown>(path.join(bundleDirectory, relativePath));
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
      const fileStat = await stat(path.join(resolvedBundleDirectory, relativePath));
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
    attestation = await verifyDoctorAttestation(
      path.join(resolvedBundleDirectory, files.attestationJson),
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
    releaseEvidence = await verifyDoctorReleaseEvidence(
      path.join(resolvedBundleDirectory, files.releaseEvidenceJson),
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
      files: fileChecks.every((check) => check.status === "pass") ? "pass" : "fail",
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
