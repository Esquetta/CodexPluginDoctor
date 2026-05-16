import { execFile } from "node:child_process";
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
  "status" | "exitCode" | "releaseReady"
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

  return {
    ...partialReport,
    status: ready ? "pass" : "fail",
    exitCode: ready ? 0 : 1,
    releaseReady: ready
  };
}

export function renderDoctorReleaseEvidenceJson(report: DoctorReleaseEvidenceReport): string {
  return JSON.stringify(redactValue(report), null, 2);
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
