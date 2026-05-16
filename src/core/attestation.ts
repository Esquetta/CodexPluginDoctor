import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildDoctorRecommendationsFromAnalysis,
  buildPackageAnalysis,
  type PackageAnalysis
} from "./package-analysis.js";
import { discoverPackage } from "./discover-package.js";
import { readJsonFile } from "./read-json-file.js";
import { matrixExitCode } from "../compatibility/compatibility-matrix.js";
import { packageVersion } from "../version.js";

export interface PackageFingerprint {
  algorithm: "sha256";
  digest: string;
  files: {
    total: number;
    bytes: number;
  };
}

export interface Digest {
  algorithm: "sha256";
  digest: string;
}

export interface DoctorAttestation {
  schemaVersion: "1.0.0";
  kind: "doctor.attestation";
  generatedAt: string;
  version: string;
  targetPath: string;
  subject: {
    name: string;
    version: string | null;
    description: string | null;
  };
  packageFingerprint: PackageFingerprint;
  reportDigest: Digest;
  summary: {
    status: "pass" | "warn" | "fail";
    validation: {
      status: "pass" | "warn" | "fail";
      findingCount: number;
    };
    security: {
      status: "pass" | "warn" | "fail";
      score: number;
      findingCount: number;
    };
    compatibility: {
      failedClients: string[];
    };
    trust: {
      status: "pass" | "warn" | "fail";
      score: number;
      findingCount: number;
    };
    recommendations: {
      actionCount: number;
    };
  };
  verification: {
    recomputeCommand: string;
    notes: string[];
  };
  signature: DoctorAttestationSignature;
}

export type DoctorAttestationSignature =
  | {
    status: "unsigned";
    reason: string;
  }
  | {
    status: "signed";
    algorithm: "hmac-sha256";
    digest: string;
    payloadDigest: string;
    keyHint: string;
  };

export interface BuildDoctorAttestationOptions {
  signingKey?: string;
  signingKeyHint?: string;
  recomputeKeyEnv?: string;
  versionOverride?: string;
}

export interface DoctorAttestationVerificationReport {
  schemaVersion: "1.0.0";
  kind: "doctor.attestation.verification";
  generatedAt: string;
  artifactPath: string;
  targetPath: string;
  status: "pass" | "fail";
  exitCode: 0 | 1;
  summary: {
    packageFingerprint: "pass" | "fail";
    reportDigest: "pass" | "fail";
    signature: "pass" | "fail";
  };
  unsignedFields: string[];
  checks: DoctorAttestationVerificationCheck[];
}

export interface DoctorAttestationVerificationCheck {
  id: string;
  status: "pass" | "fail";
  message: string;
  expected?: string;
  actual?: string;
}

export interface VerifyDoctorAttestationOptions {
  signingKey: string;
  artifactPath?: string;
}

interface PackageJsonSubject {
  name?: unknown;
  version?: unknown;
  description?: unknown;
}

const excludedDirectoryNames = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".turbo",
  ".codex-doctor",
  "node_modules",
  "coverage"
]);

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

async function collectFileEntries(rootPath: string, currentPath = rootPath): Promise<{
  relativePath: string;
  size: number;
  digest: string;
}[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const fileEntries = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) {
      return [];
    }

    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      return collectFileEntries(rootPath, entryPath);
    }

    if (!entry.isFile()) {
      return [];
    }

    const [details, content] = await Promise.all([
      stat(entryPath),
      readFile(entryPath)
    ]);

    return [
      {
        relativePath: path.relative(rootPath, entryPath).split(path.sep).join("/"),
        size: details.size,
        digest: sha256(content)
      }
    ];
  }));

  return fileEntries.flat().sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

async function buildPackageFingerprint(rootPath: string): Promise<PackageFingerprint> {
  const files = await collectFileEntries(rootPath);
  const bytes = files.reduce((total, file) => total + file.size, 0);
  const digest = sha256(stableStringify(files));

  return {
    algorithm: "sha256",
    digest,
    files: {
      total: files.length,
      bytes
    }
  };
}

async function readPackageSubject(rootPath: string): Promise<PackageJsonSubject | null> {
  try {
    const packageJson = await readJsonFile<unknown>(path.join(rootPath, "package.json"));

    return isPlainObject(packageJson) ? packageJson : null;
  } catch {
    return null;
  }
}

function buildSubject(
  analysis: PackageAnalysis,
  packageJson: PackageJsonSubject | null,
  manifest: PackageJsonSubject | null
): DoctorAttestation["subject"] {
  const name = typeof manifest?.name === "string"
    ? manifest.name
    : typeof packageJson?.name === "string"
      ? packageJson.name
      : path.basename(analysis.targetPath);
  const version = typeof manifest?.version === "string"
    ? manifest.version
    : typeof packageJson?.version === "string"
      ? packageJson.version
      : null;
  const description = typeof manifest?.description === "string"
    ? manifest.description
    : typeof packageJson?.description === "string"
      ? packageJson.description
      : null;

  return {
    name,
    version,
    description
  };
}

async function readManifestSubject(rootPath: string): Promise<PackageJsonSubject | null> {
  const discoveredPackage = await discoverPackage(rootPath);

  if (!discoveredPackage) {
    return null;
  }

  return {
    name: discoveredPackage.manifest.name,
    version: discoveredPackage.manifest.version,
    description: discoveredPackage.manifest.description
  };
}

function buildReportDigestPayload(
  analysis: PackageAnalysis,
  packageFingerprint: PackageFingerprint,
  version: string
): unknown {
  return {
    version,
    packageFingerprint,
    validation: {
      status: analysis.validation.status,
      findings: analysis.validation.findings
    },
    security: {
      status: analysis.security.status,
      score: analysis.security.score,
      findings: analysis.security.findings
    },
    compatibility: analysis.compatibility.results.map((result) => ({
      client: result.client,
      status: result.status,
      summary: result.summary
    })),
    trust: {
      status: analysis.trust.status,
      score: analysis.trust.score,
      findings: analysis.trust.findings
    },
    recommendations: buildDoctorRecommendationsFromAnalysis(analysis).actions.map((action) => ({
      priority: action.priority,
      category: action.category,
      title: action.title,
      reason: action.reason,
      findingId: action.findingId
    }))
  };
}

function buildSummary(
  analysis: PackageAnalysis
): DoctorAttestation["summary"] {
  const recommendations = buildDoctorRecommendationsFromAnalysis(analysis);
  const failedClients = analysis.compatibility.results
    .filter((result) => result.status === "fail")
    .map((result) => result.client);
  const status = analysis.validation.status === "fail" ||
    analysis.security.status === "fail" ||
    analysis.trust.status === "fail" ||
    matrixExitCode(analysis.compatibility) === 1
      ? "fail"
      : analysis.validation.status === "warn" ||
          analysis.security.status === "warn" ||
          analysis.trust.status === "warn"
        ? "warn"
        : "pass";

  return {
    status,
    validation: {
      status: analysis.validation.status,
      findingCount: analysis.validation.findings.length
    },
    security: {
      status: analysis.security.status,
      score: analysis.security.score,
      findingCount: analysis.security.findings.length
    },
    compatibility: {
      failedClients
    },
    trust: {
      status: analysis.trust.status,
      score: analysis.trust.score,
      findingCount: analysis.trust.findings.length
    },
    recommendations: {
      actionCount: recommendations.actions.length
    }
  };
}

export async function buildDoctorAttestation(
  targetPath: string,
  options: BuildDoctorAttestationOptions = {}
): Promise<DoctorAttestation> {
  const analysis = await buildPackageAnalysis(targetPath);
  const [packageFingerprint, packageJson, manifest] = await Promise.all([
    buildPackageFingerprint(analysis.targetPath),
    readPackageSubject(analysis.targetPath),
    readManifestSubject(analysis.targetPath)
  ]);
  const attestationVersion = options.versionOverride ?? packageVersion;
  const reportDigest = sha256(stableStringify(
    buildReportDigestPayload(analysis, packageFingerprint, attestationVersion)
  ));

  const subject = buildSubject(analysis, packageJson, manifest);
  const summary = buildSummary(analysis);
  const signingPayload = buildSigningPayload({
    schemaVersion: "1.0.0",
    kind: "doctor.attestation.signature.v1",
    version: attestationVersion,
    subject,
    packageFingerprint,
    reportDigest,
    summary
  });
  const signature: DoctorAttestationSignature = options.signingKey
    ? {
      status: "signed",
      algorithm: "hmac-sha256",
      digest: `sha256:${createHmac("sha256", options.signingKey)
        .update(stableStringify(signingPayload))
        .digest("hex")}`,
      payloadDigest: sha256(stableStringify(signingPayload)),
      keyHint: options.signingKeyHint ?? "inline"
    }
    : {
      status: "unsigned",
      reason: "No signing key was provided. Use --sign-key-env for reproducible local signing."
    };
  const recomputeCommand = signature.status === "signed"
    ? `codex-plugin-doctor doctor attest ${analysis.targetPath} --json --sign-key-env ${options.recomputeKeyEnv ?? "CODEX_PLUGIN_DOCTOR_SIGNING_KEY"}`
    : `codex-plugin-doctor doctor attest ${analysis.targetPath} --json`;

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.attestation",
    generatedAt: analysis.generatedAt,
    version: attestationVersion,
    targetPath: analysis.targetPath,
    subject,
    packageFingerprint,
    reportDigest: {
      algorithm: "sha256",
      digest: reportDigest
    },
    summary,
    verification: {
      recomputeCommand,
      notes: [
        "Compare packageFingerprint.digest to confirm the same local package contents.",
        "Compare reportDigest.digest to confirm the same validation, security, compatibility, trust, and recommendation signals.",
        signature.status === "signed"
          ? "Recompute the signed attestation with the same HMAC key stored in an environment variable."
          : "Signing is optional and local; unsigned attestations remain deterministic without key material."
      ]
    },
    signature
  };
}

function buildSigningPayload(attestation: Pick<
  DoctorAttestation,
  "schemaVersion" | "subject" | "packageFingerprint" | "summary"
> & {
  kind?: string;
  version: string;
  reportDigest: string | Digest;
}): unknown {
  return {
    schemaVersion: attestation.schemaVersion,
    kind: "doctor.attestation.signature.v1",
    version: attestation.version,
    subject: attestation.subject,
    packageFingerprint: attestation.packageFingerprint,
    reportDigest: typeof attestation.reportDigest === "string"
      ? attestation.reportDigest
      : attestation.reportDigest.digest,
    summary: attestation.summary
  };
}

function signPayload(payload: unknown, signingKey: string): Pick<
  Extract<DoctorAttestationSignature, { status: "signed" }>,
  "digest" | "payloadDigest"
> {
  const serializedPayload = stableStringify(payload);

  return {
    digest: `sha256:${createHmac("sha256", signingKey)
      .update(serializedPayload)
      .digest("hex")}`,
    payloadDigest: sha256(serializedPayload)
  };
}

function isDoctorAttestation(value: unknown): value is DoctorAttestation {
  return isPlainObject(value) &&
    value.schemaVersion === "1.0.0" &&
    value.kind === "doctor.attestation" &&
    typeof value.version === "string" &&
    isPlainObject(value.packageFingerprint) &&
    isPlainObject(value.reportDigest) &&
    isPlainObject(value.signature);
}

function digestMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  return expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer);
}

function createDigestVerificationCheck(
  id: string,
  message: string,
  expected: string,
  actual: string,
  includeDigests = true
): DoctorAttestationVerificationCheck {
  return {
    id,
    status: digestMatches(expected, actual) ? "pass" : "fail",
    message,
    ...(includeDigests ? { expected, actual } : {})
  };
}

export async function verifyDoctorAttestation(
  artifactPath: string,
  targetPath: string,
  options: VerifyDoctorAttestationOptions
): Promise<DoctorAttestationVerificationReport> {
  const resolvedArtifactPath = path.resolve(artifactPath);
  const artifact = await readJsonFile<unknown>(resolvedArtifactPath);

  return verifyDoctorAttestationObject(artifact, targetPath, {
    ...options,
    artifactPath: resolvedArtifactPath
  });
}

export async function verifyDoctorAttestationObject(
  artifact: unknown,
  targetPath: string,
  options: VerifyDoctorAttestationOptions
): Promise<DoctorAttestationVerificationReport> {
  const artifactPath = options.artifactPath ?? "inline:doctor.attestation";

  if (!isDoctorAttestation(artifact)) {
    return {
      schemaVersion: "1.0.0",
      kind: "doctor.attestation.verification",
      generatedAt: new Date().toISOString(),
      artifactPath,
      targetPath: path.resolve(targetPath),
      status: "fail",
      exitCode: 1,
      summary: {
        packageFingerprint: "fail",
        reportDigest: "fail",
        signature: "fail"
      },
      unsignedFields: [
        "generatedAt",
        "targetPath",
        "verification",
        "signature.keyHint"
      ],
      checks: [
        {
          id: "attestation.artifact.invalid",
          status: "fail",
          message: "The attestation artifact is not a valid doctor attestation."
        }
      ]
    };
  }

  const expected = await buildDoctorAttestation(targetPath, {
    signingKey: options.signingKey,
    signingKeyHint: "verification",
    versionOverride: artifact.version
  });
  const checks: DoctorAttestationVerificationCheck[] = [
    createDigestVerificationCheck(
      "attestation.package_fingerprint",
      "Package fingerprint matches the target package contents.",
      expected.packageFingerprint.digest,
      artifact.packageFingerprint.digest
    ),
    createDigestVerificationCheck(
      "attestation.report_digest",
      "Report digest matches the target validation evidence.",
      expected.reportDigest.digest,
      artifact.reportDigest.digest
    )
  ];

  if (artifact.signature.status !== "signed") {
    checks.push({
      id: "attestation.signature.unsigned",
      status: "fail",
      message: "The attestation artifact is unsigned and cannot be verified with a signing key."
    });
  } else {
    const expectedSignature = signPayload(buildSigningPayload(artifact), options.signingKey);

    checks.push(
      createDigestVerificationCheck(
        "attestation.signature.payload",
        "Signature payload digest matches the canonical attestation payload.",
        expectedSignature.payloadDigest,
        artifact.signature.payloadDigest,
        false
      ),
      createDigestVerificationCheck(
        "attestation.signature.mismatch",
        "HMAC-SHA256 signature matches the canonical attestation payload and signing key.",
        expectedSignature.digest,
        artifact.signature.digest,
        false
      )
    );
  }

  const failedChecks = checks.filter((check) => check.status === "fail");
  const packageFingerprint = checks.find((check) => check.id === "attestation.package_fingerprint")?.status ?? "fail";
  const reportDigest = checks.find((check) => check.id === "attestation.report_digest")?.status ?? "fail";
  const signature = checks
    .filter((check) => check.id.startsWith("attestation.signature."))
    .every((check) => check.status === "pass")
      ? "pass"
      : "fail";

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.attestation.verification",
    generatedAt: new Date().toISOString(),
    artifactPath,
    targetPath: expected.targetPath,
    status: failedChecks.length === 0 ? "pass" : "fail",
    exitCode: failedChecks.length === 0 ? 0 : 1,
    summary: {
      packageFingerprint,
      reportDigest,
      signature
    },
    unsignedFields: [
      "generatedAt",
      "targetPath",
      "verification",
      "signature.keyHint"
    ],
    checks
  };
}

export function renderDoctorAttestationJson(attestation: DoctorAttestation): string {
  return JSON.stringify(attestation, null, 2);
}

export function renderDoctorAttestationVerificationJson(
  report: DoctorAttestationVerificationReport
): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorAttestationVerification(
  report: DoctorAttestationVerificationReport,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Attestation Verification",
    "===============================",
    `Artifact: ${report.artifactPath}`,
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Package fingerprint: ${report.summary.packageFingerprint.toUpperCase()}`,
    `Report digest: ${report.summary.reportDigest.toUpperCase()}`,
    `Signature: ${report.summary.signature.toUpperCase()}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Checks", "------");

  for (const check of report.checks) {
    lines.push(`${check.status === "pass" ? "PASS" : "FAIL"} ${check.id}`);
    lines.push(`  ${check.message}`);
  }

  lines.push("", "Unsigned metadata", "-----------------");
  lines.push(report.unsignedFields.join(", "));

  return lines.join("\n");
}

export function renderDoctorAttestation(
  attestation: DoctorAttestation,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Attestation",
    "==================",
    `Target: ${attestation.targetPath}`,
    `Subject: ${attestation.subject.name}${attestation.subject.version ? `@${attestation.subject.version}` : ""}`,
    `Status: ${attestation.summary.status.toUpperCase()}`,
    `Package fingerprint: ${attestation.packageFingerprint.digest}`,
    `Report digest: ${attestation.reportDigest.digest}`,
    `Signature: ${attestation.signature.status}${attestation.signature.status === "signed" ? ` (${attestation.signature.algorithm})` : ""}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Verification", "------------");
  lines.push(attestation.verification.recomputeCommand);

  return lines.join("\n");
}
