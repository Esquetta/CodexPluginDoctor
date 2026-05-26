import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildDoctorAttestation,
  renderDoctorAttestationJson,
  type DoctorAttestation
} from "./attestation.js";
import {
  buildDoctorReleaseEvidenceReport,
  renderDoctorReleaseEvidenceJson,
  type BuildDoctorReleaseEvidenceOptions,
  type DoctorReleaseEvidenceReport
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
