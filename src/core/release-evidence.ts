import { execFile } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";

import {
  buildDoctorAttestation,
  verifyDoctorAttestationObject,
  type DoctorAttestation,
  type DoctorAttestationVerificationReport
} from "./attestation.js";
import {
  buildDoctorPerformanceReport,
  type DoctorPerformanceReport,
  type DoctorPerformanceThresholdOptions
} from "./performance-report.js";
import {
  buildDoctorValidationCorpusReport,
  type DoctorValidationCorpusReport
} from "./validation-corpus.js";
import { redactValue } from "./doctor-export-bundle.js";
import { readJsonFile } from "./read-json-file.js";
import {
  buildSecurityAudit,
  type SecurityAudit
} from "../security/security-audit.js";
import {
  buildTrustScore,
  type TrustScoreReport
} from "../security/trust-score.js";
import type { CompatibilityEnvironment } from "../compatibility/compatibility-matrix.js";
import type { CheckResult } from "../domain/types.js";
import { packageVersion } from "../version.js";

const execFileAsync = promisify(execFile);

type EvidenceStatus = "pass" | "warn" | "fail";

export interface DoctorReleaseEvidenceSignature {
  status: "signed";
  algorithm: "hmac-sha256";
  digest: string;
  payloadDigest: string;
  keyHint: string;
}

export interface DoctorReleaseEvidencePackageMetadata {
  name: string | null;
  version: string | null;
  private: boolean | null;
}

export interface DoctorReleaseEvidenceGitMetadata {
  commit: string | null;
  tag: string | null;
  dirty: boolean | null;
}

export interface DoctorReleaseEvidenceReport {
  schemaVersion: "1.0.0";
  kind: "doctor.release.evidence";
  generatedAt: string;
  version: string;
  targetPath: string;
  status: "pass" | "fail";
  exitCode: 0 | 1;
  releaseReady: boolean;
  summary: {
    attestation: EvidenceStatus;
    attestationVerification: EvidenceStatus;
    corpus: EvidenceStatus;
    performance: EvidenceStatus;
    releaseGates: EvidenceStatus;
    security: EvidenceStatus;
    trust: EvidenceStatus;
  };
  releaseGates: {
    status: EvidenceStatus;
    checks: Array<{
      id: string;
      status: EvidenceStatus;
      message: string;
    }>;
  };
  package: DoctorReleaseEvidencePackageMetadata;
  git: DoctorReleaseEvidenceGitMetadata;
  attestation: DoctorAttestation;
  attestationVerification: DoctorAttestationVerificationReport;
  corpus: DoctorValidationCorpusReport;
  performance: DoctorPerformanceReport;
  security: Pick<SecurityAudit, "status" | "score" | "findingCounts">;
  trust: Pick<TrustScoreReport, "status" | "score" | "findingCounts">;
  evidenceSignature: DoctorReleaseEvidenceSignature;
}

export interface DoctorReleaseEvidenceVerificationReport {
  schemaVersion: "1.0.0";
  kind: "doctor.release.evidence.verification";
  generatedAt: string;
  artifactPath: string;
  targetPath: string | null;
  status: "pass" | "fail";
  exitCode: 0 | 1;
  summary: {
    artifact: EvidenceStatus;
    attestation: EvidenceStatus;
    evidenceSignature: EvidenceStatus;
    releaseReady: EvidenceStatus;
    releaseGates: EvidenceStatus;
  };
  checks: Array<{
    id: string;
    status: EvidenceStatus;
    message: string;
  }>;
  attestation: DoctorAttestationVerificationReport | null;
}

export interface DoctorReleaseEvidenceAssetReport {
  schemaVersion: "1.0.0";
  kind: "doctor.release.evidence.asset";
  generatedAt: string;
  version: string;
  targetPath: string;
  tag: string;
  artifactPath: string;
  status: "pass" | "fail";
  exitCode: 0 | 1;
  uploaded: boolean;
  uploadCommand: string[];
  releaseEvidence: {
    status: "pass" | "fail";
    releaseReady: boolean;
    evidenceSignature: "signed";
  };
}

export interface BuildDoctorReleaseEvidenceOptions {
  signingKey: string;
  signingKeyEnv: string;
  allowDirty?: boolean;
  allowUntagged?: boolean;
  environment?: CompatibilityEnvironment;
  runCheck?: (targetPath: string) => Promise<CheckResult>;
  performanceThresholds?: DoctorPerformanceThresholdOptions;
}

interface PackageJsonMetadata {
  name?: unknown;
  version?: unknown;
  private?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  return expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer);
}

function isDoctorReleaseEvidenceReport(value: unknown): value is DoctorReleaseEvidenceReport {
  return isPlainObject(value) &&
    value.schemaVersion === "1.0.0" &&
    value.kind === "doctor.release.evidence" &&
    typeof value.targetPath === "string" &&
    isPlainObject(value.summary) &&
    isPlainObject(value.releaseGates) &&
    isPlainObject(value.attestation) &&
    isPlainObject(value.evidenceSignature);
}

function toEvidenceStatus(status: "pass" | "warn" | "fail"): EvidenceStatus {
  return status;
}

async function readPackageMetadata(rootPath: string): Promise<DoctorReleaseEvidencePackageMetadata> {
  try {
    const packageJson = await readJsonFile<PackageJsonMetadata>(path.join(rootPath, "package.json"));

    return {
      name: typeof packageJson.name === "string" ? packageJson.name : null,
      version: typeof packageJson.version === "string" ? packageJson.version : null,
      private: typeof packageJson.private === "boolean" ? packageJson.private : null
    };
  } catch {
    return {
      name: null,
      version: null,
      private: null
    };
  }
}

async function readGitValue(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    const value = stdout.trim();

    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readGitDirty(cwd: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd });

    return stdout.trim().length > 0;
  } catch {
    return null;
  }
}

async function readGitMetadata(rootPath: string): Promise<DoctorReleaseEvidenceGitMetadata> {
  const [commit, tag, dirtyOutput] = await Promise.all([
    readGitValue(["rev-parse", "HEAD"], rootPath),
    readGitValue(["describe", "--tags", "--exact-match"], rootPath),
    readGitDirty(rootPath)
  ]);

  return {
    commit,
    tag,
    dirty: dirtyOutput
  };
}

function releaseReady(report: Omit<
  DoctorReleaseEvidenceReport,
  "status" | "exitCode" | "releaseReady" | "evidenceSignature"
>): boolean {
  return report.attestation.summary.status !== "fail" &&
    report.attestationVerification.status === "pass" &&
    report.corpus.summary.status === "pass" &&
    report.performance.status === "pass" &&
    report.releaseGates.status === "pass" &&
    report.security.status !== "fail" &&
    report.trust.status !== "fail";
}

function buildReleaseGateReport(
  git: DoctorReleaseEvidenceGitMetadata,
  options: BuildDoctorReleaseEvidenceOptions
): DoctorReleaseEvidenceReport["releaseGates"] {
  const checks: DoctorReleaseEvidenceReport["releaseGates"]["checks"] = [
    {
      id: "git.commit.present",
      status: git.commit ? "pass" : "fail",
      message: git.commit
        ? "Git commit resolved for this release evidence bundle."
        : "Git commit could not be resolved."
    },
    {
      id: "git.tag.exact",
      status: git.tag || options.allowUntagged ? "pass" : "fail",
      message: git.tag
        ? `Current commit is tagged as ${git.tag}.`
        : options.allowUntagged
          ? "Current commit is not on an exact git tag, but --allow-untagged was explicitly set."
        : "Current commit is not on an exact git tag."
    },
    {
      id: "git.worktree.clean",
      status: git.dirty === false || options.allowDirty ? "pass" : "fail",
      message: git.dirty === false
        ? "Git worktree is clean."
        : options.allowDirty
          ? "Git worktree is dirty, but --allow-dirty was explicitly set."
          : "Git worktree has uncommitted changes."
    }
  ];

  return {
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks
  };
}

function buildReleaseEvidenceSigningPayload(
  report: Omit<DoctorReleaseEvidenceReport, "evidenceSignature">
): unknown {
  return {
    schemaVersion: report.schemaVersion,
    kind: "doctor.release.evidence.signature.v1",
    version: report.version,
    status: report.status,
    releaseReady: report.releaseReady,
    summary: report.summary,
    package: report.package,
    git: report.git,
    releaseGates: report.releaseGates,
    attestation: {
      version: report.attestation.version,
      subject: report.attestation.subject,
      packageFingerprint: report.attestation.packageFingerprint,
      reportDigest: report.attestation.reportDigest,
      summary: report.attestation.summary,
      signature: report.attestation.signature
    },
    attestationVerification: {
      status: report.attestationVerification.status,
      summary: report.attestationVerification.summary
    },
    corpus: {
      status: report.corpus.summary.status,
      summary: report.corpus.summary
    },
    performance: {
      status: report.performance.status,
      summary: report.performance.summary,
      thresholds: report.performance.thresholds
    },
    security: report.security,
    trust: report.trust
  };
}

function signReleaseEvidence(
  report: Omit<DoctorReleaseEvidenceReport, "evidenceSignature">,
  signingKey: string,
  keyHint: string
): DoctorReleaseEvidenceSignature {
  const redactedReport = redactValue(report) as Omit<DoctorReleaseEvidenceReport, "evidenceSignature">;
  const serializedPayload = stableStringify(buildReleaseEvidenceSigningPayload(redactedReport));

  return {
    status: "signed",
    algorithm: "hmac-sha256",
    digest: `sha256:${createHmac("sha256", signingKey)
      .update(serializedPayload)
      .digest("hex")}`,
    payloadDigest: sha256(serializedPayload),
    keyHint
  };
}

export async function buildDoctorReleaseEvidenceReport(
  targetPath: string,
  options: BuildDoctorReleaseEvidenceOptions
): Promise<DoctorReleaseEvidenceReport> {
  const rootPath = path.resolve(targetPath);
  const security = await buildSecurityAudit(rootPath);
  const [
    attestation,
    corpus,
    performance,
    trust,
    packageMetadata,
    git
  ] = await Promise.all([
    buildDoctorAttestation(rootPath, {
      signingKey: options.signingKey,
      signingKeyHint: `env:${options.signingKeyEnv}`,
      recomputeKeyEnv: options.signingKeyEnv
    }),
    buildDoctorValidationCorpusReport({ environment: options.environment }),
    buildDoctorPerformanceReport(rootPath, {
      environment: options.environment,
      runCheck: options.runCheck,
      thresholds: options.performanceThresholds
    }),
    buildTrustScore(rootPath, { securityAudit: security }),
    readPackageMetadata(rootPath),
    readGitMetadata(rootPath)
  ]);
  const normalizedPackageMetadata = {
    name: packageMetadata.name ?? attestation.subject.name,
    version: packageMetadata.version ?? attestation.subject.version,
    private: packageMetadata.private
  };
  const attestationVerification = await verifyDoctorAttestationObject(
    attestation,
    rootPath,
    {
      signingKey: options.signingKey,
      artifactPath: "inline:doctor.release-evidence.attestation"
    }
  );
  const releaseGates = buildReleaseGateReport(git, options);
  const partialReport = {
    schemaVersion: "1.0.0" as const,
    kind: "doctor.release.evidence" as const,
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    targetPath: rootPath,
    summary: {
      attestation: toEvidenceStatus(attestation.summary.status),
      attestationVerification: attestationVerification.status,
      corpus: corpus.summary.status,
      performance: performance.status,
      releaseGates: releaseGates.status,
      security: toEvidenceStatus(security.status),
      trust: toEvidenceStatus(trust.status)
    },
    package: normalizedPackageMetadata,
    git,
    releaseGates,
    attestation,
    attestationVerification,
    corpus,
    performance,
    security: {
      status: security.status,
      score: security.score,
      findingCounts: security.findingCounts
    },
    trust: {
      status: trust.status,
      score: trust.score,
      findingCounts: trust.findingCounts
    }
  };
  const ready = releaseReady(partialReport);

  const report = {
    ...partialReport,
    status: (ready ? "pass" : "fail") as "pass" | "fail",
    exitCode: (ready ? 0 : 1) as 0 | 1,
    releaseReady: ready
  };

  return {
    ...report,
    evidenceSignature: signReleaseEvidence(
      report,
      options.signingKey,
      `env:${options.signingKeyEnv}`
    )
  };
}

export function renderDoctorReleaseEvidenceJson(report: DoctorReleaseEvidenceReport): string {
  return JSON.stringify(redactValue(report), null, 2);
}

export async function verifyDoctorReleaseEvidence(
  artifactPath: string,
  options: {
    signingKey: string;
    targetPath: string;
  }
): Promise<DoctorReleaseEvidenceVerificationReport> {
  const resolvedArtifactPath = path.resolve(artifactPath);
  const artifact = await readJsonFile<unknown>(resolvedArtifactPath);

  if (!isDoctorReleaseEvidenceReport(artifact)) {
    return {
      schemaVersion: "1.0.0",
      kind: "doctor.release.evidence.verification",
      generatedAt: new Date().toISOString(),
      artifactPath: resolvedArtifactPath,
      targetPath: options.targetPath ? path.resolve(options.targetPath) : null,
      status: "fail",
      exitCode: 1,
      summary: {
        artifact: "fail",
        attestation: "fail",
        evidenceSignature: "fail",
        releaseReady: "fail",
        releaseGates: "fail"
      },
      checks: [
        {
          id: "release_evidence.artifact.invalid",
          status: "fail",
          message: "The release evidence artifact is not a valid doctor release evidence bundle."
        }
      ],
      attestation: null
    };
  }

  const targetPath = path.resolve(options.targetPath);
  const attestation = await verifyDoctorAttestationObject(
    artifact.attestation,
    targetPath,
    {
      signingKey: options.signingKey,
      artifactPath: `${resolvedArtifactPath}#attestation`
    }
  );
  const unsignedArtifact = { ...artifact };
  delete (unsignedArtifact as Partial<DoctorReleaseEvidenceReport>).evidenceSignature;
  const expectedEvidenceSignature = signReleaseEvidence(
    unsignedArtifact,
    options.signingKey,
    "verification"
  );
  const signatureStatus = artifact.evidenceSignature.status === "signed" &&
    artifact.evidenceSignature.algorithm === "hmac-sha256" &&
    digestMatches(expectedEvidenceSignature.payloadDigest, artifact.evidenceSignature.payloadDigest) &&
    digestMatches(expectedEvidenceSignature.digest, artifact.evidenceSignature.digest)
      ? "pass"
      : "fail";
  const checks: DoctorReleaseEvidenceVerificationReport["checks"] = [
    {
      id: "release_evidence.artifact.valid",
      status: "pass",
      message: "The release evidence artifact has the expected schema and kind."
    },
    {
      id: "release_evidence.signature",
      status: signatureStatus,
      message: signatureStatus === "pass"
        ? "The release evidence signature matches the canonical release evidence payload."
        : "The release evidence signature does not match the canonical release evidence payload."
    },
    {
      id: "release_evidence.release_ready",
      status: artifact.releaseReady && artifact.status === "pass" ? "pass" : "fail",
      message: artifact.releaseReady && artifact.status === "pass"
        ? "The release evidence bundle reports releaseReady=true and status=pass."
        : "The release evidence bundle was not release-ready when it was created."
    },
    {
      id: "release_evidence.release_gates",
      status: artifact.releaseGates.status === "pass" &&
        artifact.releaseGates.checks.every((check) => check.status === "pass")
          ? "pass"
          : "fail",
      message: artifact.releaseGates.status === "pass"
        ? "All recorded release gates passed."
        : "One or more recorded release gates failed."
    },
    {
      id: "release_evidence.attestation",
      status: attestation.status,
      message: attestation.status === "pass"
        ? "The embedded signed attestation verifies against the target package."
        : "The embedded signed attestation does not verify against the target package."
    }
  ];
  const failedChecks = checks.filter((check) => check.status === "fail");

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.release.evidence.verification",
    generatedAt: new Date().toISOString(),
    artifactPath: resolvedArtifactPath,
    targetPath,
    status: failedChecks.length === 0 ? "pass" : "fail",
    exitCode: failedChecks.length === 0 ? 0 : 1,
      summary: {
      artifact: "pass",
      attestation: attestation.status,
      evidenceSignature: signatureStatus,
      releaseReady: checks.find((check) => check.id === "release_evidence.release_ready")?.status ?? "fail",
      releaseGates: checks.find((check) => check.id === "release_evidence.release_gates")?.status ?? "fail"
    },
    checks,
    attestation
  };
}

export function renderDoctorReleaseEvidenceVerificationJson(
  report: DoctorReleaseEvidenceVerificationReport
): string {
  return JSON.stringify(redactValue(report), null, 2);
}

export function renderDoctorReleaseEvidenceVerification(
  report: DoctorReleaseEvidenceVerificationReport,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Release Evidence Verification",
    "====================================",
    `Artifact: ${report.artifactPath}`,
    `Target: ${report.targetPath ?? "unknown"}`,
    `Status: ${report.status.toUpperCase()}`,
    `Attestation: ${report.summary.attestation.toUpperCase()}`,
    `Release ready: ${report.summary.releaseReady.toUpperCase()}`,
    `Release gates: ${report.summary.releaseGates.toUpperCase()}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Checks", "------");

  for (const check of report.checks) {
    lines.push(`${check.status === "pass" ? "PASS" : "FAIL"} ${check.id}`);
    lines.push(`  ${check.message}`);
  }

  return lines.join("\n");
}

export function buildDoctorReleaseEvidenceAssetReport(
  evidence: DoctorReleaseEvidenceReport,
  options: {
    tag: string;
    artifactPath: string;
    uploaded: boolean;
  }
): DoctorReleaseEvidenceAssetReport {
  const artifactPath = path.resolve(options.artifactPath);
  const status = evidence.status === "pass" && evidence.releaseReady
    ? "pass"
    : "fail";

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.release.evidence.asset",
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    targetPath: evidence.targetPath,
    tag: options.tag,
    artifactPath,
    status,
    exitCode: status === "pass" ? 0 : 1,
    uploaded: options.uploaded,
    uploadCommand: [
      "gh",
      "release",
      "upload",
      options.tag,
      artifactPath,
      "--clobber"
    ],
    releaseEvidence: {
      status: evidence.status,
      releaseReady: evidence.releaseReady,
      evidenceSignature: evidence.evidenceSignature.status
    }
  };
}

export function renderDoctorReleaseEvidenceAssetJson(
  report: DoctorReleaseEvidenceAssetReport
): string {
  return JSON.stringify(redactValue(report), null, 2);
}

export function renderDoctorReleaseEvidenceAsset(
  report: DoctorReleaseEvidenceAssetReport
): string {
  return [
    "Doctor Release Evidence Asset",
    "=============================",
    `Target: ${report.targetPath}`,
    `Tag: ${report.tag}`,
    `Artifact: ${report.artifactPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Uploaded: ${report.uploaded ? "yes" : "no"}`,
    `Upload command: ${report.uploadCommand.join(" ")}`
  ].join("\n");
}

export function renderDoctorReleaseEvidence(report: DoctorReleaseEvidenceReport): string {
  return [
    "Doctor Release Evidence",
    "=======================",
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Release ready: ${report.releaseReady ? "yes" : "no"}`,
    `Attestation: ${report.summary.attestation.toUpperCase()}`,
    `Attestation verification: ${report.summary.attestationVerification.toUpperCase()}`,
    `Corpus: ${report.summary.corpus.toUpperCase()}`,
    `Performance: ${report.summary.performance.toUpperCase()}`,
    `Release gates: ${report.summary.releaseGates.toUpperCase()}`,
    `Security: ${report.summary.security.toUpperCase()} (${report.security.score}/100)`,
    `Trust: ${report.summary.trust.toUpperCase()} (${report.trust.score}/100)`,
    `Git commit: ${report.git.commit ?? "unknown"}`,
    `Git tag: ${report.git.tag ?? "not tagged"}`
  ].join("\n");
}
