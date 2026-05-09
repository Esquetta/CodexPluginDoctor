import { createHash } from "node:crypto";
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
  signature: {
    status: "unsigned";
    reason: string;
  };
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
  packageFingerprint: PackageFingerprint
): unknown {
  return {
    version: packageVersion,
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
    recommendations: buildDoctorRecommendationsFromAnalysis(analysis).actions
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
  targetPath: string
): Promise<DoctorAttestation> {
  const analysis = await buildPackageAnalysis(targetPath);
  const [packageFingerprint, packageJson, manifest] = await Promise.all([
    buildPackageFingerprint(analysis.targetPath),
    readPackageSubject(analysis.targetPath),
    readManifestSubject(analysis.targetPath)
  ]);
  const reportDigest = sha256(stableStringify(
    buildReportDigestPayload(analysis, packageFingerprint)
  ));

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.attestation",
    generatedAt: analysis.generatedAt,
    version: packageVersion,
    targetPath: analysis.targetPath,
    subject: buildSubject(analysis, packageJson, manifest),
    packageFingerprint,
    reportDigest: {
      algorithm: "sha256",
      digest: reportDigest
    },
    summary: buildSummary(analysis),
    verification: {
      recomputeCommand: `codex-plugin-doctor doctor attest ${analysis.targetPath} --json`,
      notes: [
        "Compare packageFingerprint.digest to confirm the same local package contents.",
        "Compare reportDigest.digest to confirm the same validation, security, compatibility, trust, and recommendation signals."
      ]
    },
    signature: {
      status: "unsigned",
      reason: "v0.17 creates deterministic local attestations without key management or hosted signing."
    }
  };
}

export function renderDoctorAttestationJson(attestation: DoctorAttestation): string {
  return JSON.stringify(attestation, null, 2);
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
    `Signature: ${attestation.signature.status}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Verification", "------------");
  lines.push(attestation.verification.recomputeCommand);

  return lines.join("\n");
}
