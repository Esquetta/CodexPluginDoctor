import { stat } from "node:fs/promises";
import path from "node:path";

import { buildGenericMcpDoctor } from "../mcp/generic-mcp-doctor.js";
import { packageVersion } from "../version.js";
import { buildPackageFingerprint } from "./attestation.js";
import { readJsonFile } from "./read-json-file.js";
import { validatePlugin } from "./validate-plugin.js";

export type ExternalCorpusProfile = "healthy" | "broken" | "edge-case";
export type ExternalCorpusSourceType =
  | "public-package"
  | "local-snapshot"
  | "derived-fixture";
export type ExternalCorpusMode = "codex-plugin" | "generic-mcp";
export type FindingReviewClassification =
  | "true_positive"
  | "false_positive"
  | "unclear";

export interface ExternalCorpusFindingReview {
  findingId: string;
  fingerprint: string;
  classification: FindingReviewClassification;
}

export interface ExternalCorpusTarget {
  id: string;
  profile: ExternalCorpusProfile;
  sourceType: ExternalCorpusSourceType;
  disclosure: "anonymized";
  path: string;
  mode: ExternalCorpusMode;
  contentDigest: string;
  expectedStatus: "pass" | "warn" | "fail";
  reviews: ExternalCorpusFindingReview[];
}

export interface ExternalCorpusManifest {
  schemaVersion: "1.0.0";
  targets: ExternalCorpusTarget[];
}

export interface LoadedExternalCorpusTarget extends ExternalCorpusTarget {
  resolvedPath: string;
}

export interface LoadedExternalCorpusManifest extends ExternalCorpusManifest {
  targets: LoadedExternalCorpusTarget[];
}

export interface ExternalCorpusReportedFinding {
  findingId: string;
  fingerprint: string;
  classification: FindingReviewClassification | "unreviewed";
}

export interface ExternalCorpusCaseResult {
  id: string;
  profile: ExternalCorpusProfile;
  sourceType: ExternalCorpusSourceType;
  disclosure: "anonymized";
  mode: ExternalCorpusMode;
  expected: {
    status: ExternalCorpusTarget["expectedStatus"];
    contentDigest: string;
    findings: ExternalCorpusFindingReview[];
  };
  actual: {
    status: ExternalCorpusTarget["expectedStatus"];
    contentDigest: string;
    findings: ExternalCorpusReportedFinding[];
  };
  digestMatched: boolean;
  classificationCounts: ExternalCorpusClassificationCounts;
  expectationMatched: boolean;
}

export interface ExternalCorpusClassificationCounts {
  truePositive: number;
  falsePositive: number;
  unclear: number;
  missingExpectedFinding: number;
}

export interface ExternalValidationCorpusReport {
  schemaVersion: "1.0.0";
  kind: "doctor.validation.corpus";
  corpusType: "external";
  generatedAt: string;
  version: string;
  summary: {
    status: "pass" | "fail";
    caseCount: number;
    passedExpectations: number;
    failedExpectations: number;
    runtimeCases: 0;
    classificationCounts: ExternalCorpusClassificationCounts;
  };
  cases: ExternalCorpusCaseResult[];
}

export interface BuildExternalValidationCorpusOptions {
  environment?: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  };
}

export class ExternalCorpusManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalCorpusManifestError";
  }
}

const topLevelKeys = new Set(["schemaVersion", "targets"]);
const targetKeys = new Set([
  "id",
  "profile",
  "sourceType",
  "disclosure",
  "path",
  "mode",
  "contentDigest",
  "expectedStatus",
  "reviews"
]);
const reviewKeys = new Set(["findingId", "fingerprint", "classification"]);
const profiles = new Set<ExternalCorpusProfile>(["healthy", "broken", "edge-case"]);
const sourceTypes = new Set<ExternalCorpusSourceType>([
  "public-package",
  "local-snapshot",
  "derived-fixture"
]);
const modes = new Set<ExternalCorpusMode>(["codex-plugin", "generic-mcp"]);
const statuses = new Set<ExternalCorpusTarget["expectedStatus"]>(["pass", "warn", "fail"]);
const classifications = new Set<FindingReviewClassification>([
  "true_positive",
  "false_positive",
  "unclear"
]);
const sha256Digest = /^sha256:[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));

  if (unknown.length > 0) {
    throw new ExternalCorpusManifestError(
      `${label} contains unsupported field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`
    );
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ExternalCorpusManifestError(`${label} must be a non-empty string.`);
  }

  return value;
}

function parseReview(value: unknown, targetId: string, index: number): ExternalCorpusFindingReview {
  if (!isRecord(value)) {
    throw new ExternalCorpusManifestError(`Corpus target ${targetId} review ${index} must be an object.`);
  }

  rejectUnknownKeys(value, reviewKeys, `Corpus target ${targetId} review ${index}`);
  const findingId = requireString(value.findingId, `Corpus target ${targetId} review ${index} findingId`);
  const fingerprint = requireString(value.fingerprint, `Corpus target ${targetId} review ${index} fingerprint`);
  const classification = value.classification;

  if (typeof classification !== "string" || !classifications.has(classification as FindingReviewClassification)) {
    throw new ExternalCorpusManifestError(`Corpus target ${targetId} review ${index} has an unsupported classification.`);
  }

  return {
    findingId,
    fingerprint,
    classification: classification as FindingReviewClassification
  };
}

async function parseTarget(
  value: unknown,
  manifestDirectory: string,
  index: number
): Promise<LoadedExternalCorpusTarget> {
  if (!isRecord(value)) {
    throw new ExternalCorpusManifestError(`Corpus target ${index} must be an object.`);
  }

  rejectUnknownKeys(value, targetKeys, `Corpus target ${index}`);
  const id = requireString(value.id, `Corpus target ${index} id`);
  const targetPath = requireString(value.path, `Corpus target ${id} path`);

  if (path.posix.isAbsolute(targetPath) || path.win32.isAbsolute(targetPath)) {
    throw new ExternalCorpusManifestError("Corpus target path must be relative to the manifest file.");
  }

  if (typeof value.profile !== "string" || !profiles.has(value.profile as ExternalCorpusProfile)) {
    throw new ExternalCorpusManifestError(`Corpus target ${id} has an unsupported profile.`);
  }

  if (typeof value.sourceType !== "string" || !sourceTypes.has(value.sourceType as ExternalCorpusSourceType)) {
    throw new ExternalCorpusManifestError(`Corpus target ${id} has an unsupported sourceType.`);
  }

  if (value.disclosure !== "anonymized") {
    throw new ExternalCorpusManifestError(`Corpus target ${id} disclosure must be anonymized.`);
  }

  if (typeof value.mode !== "string" || !modes.has(value.mode as ExternalCorpusMode)) {
    throw new ExternalCorpusManifestError(`Corpus target ${id} has an unsupported mode.`);
  }

  if (typeof value.expectedStatus !== "string" || !statuses.has(value.expectedStatus as ExternalCorpusTarget["expectedStatus"])) {
    throw new ExternalCorpusManifestError(`Corpus target ${id} has an unsupported expectedStatus.`);
  }

  if (typeof value.contentDigest !== "string" || !sha256Digest.test(value.contentDigest)) {
    throw new ExternalCorpusManifestError(`Corpus target ${id} contentDigest must be a sha256 digest.`);
  }

  if (!Array.isArray(value.reviews)) {
    throw new ExternalCorpusManifestError(`Corpus target ${id} reviews must be an array.`);
  }

  const resolvedPath = path.resolve(manifestDirectory, targetPath);

  try {
    if (!(await stat(resolvedPath)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new ExternalCorpusManifestError(`Corpus target ${id} directory does not exist.`);
  }

  return {
    id,
    profile: value.profile as ExternalCorpusProfile,
    sourceType: value.sourceType as ExternalCorpusSourceType,
    disclosure: "anonymized",
    path: targetPath,
    mode: value.mode as ExternalCorpusMode,
    contentDigest: value.contentDigest,
    expectedStatus: value.expectedStatus as ExternalCorpusTarget["expectedStatus"],
    reviews: value.reviews.map((review, reviewIndex) => parseReview(review, id, reviewIndex)),
    resolvedPath
  };
}

export async function loadExternalCorpusManifest(
  manifestPath: string
): Promise<LoadedExternalCorpusManifest> {
  let value: unknown;

  try {
    value = await readJsonFile<unknown>(path.resolve(manifestPath));
  } catch {
    throw new ExternalCorpusManifestError("Corpus manifest could not be read as JSON.");
  }

  if (!isRecord(value)) {
    throw new ExternalCorpusManifestError("Corpus manifest must be an object.");
  }

  rejectUnknownKeys(value, topLevelKeys, "Corpus manifest");

  if (value.schemaVersion !== "1.0.0") {
    throw new ExternalCorpusManifestError("Unsupported corpus manifest schemaVersion.");
  }

  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    throw new ExternalCorpusManifestError("Corpus manifest targets must be a non-empty array.");
  }

  const manifestDirectory = path.dirname(path.resolve(manifestPath));
  const targets = await Promise.all(
    value.targets.map((target, index) => parseTarget(target, manifestDirectory, index))
  );
  const seenIds = new Set<string>();

  for (const target of targets) {
    if (seenIds.has(target.id)) {
      throw new ExternalCorpusManifestError(`Corpus target id ${target.id} is duplicated.`);
    }
    seenIds.add(target.id);
  }

  return { schemaVersion: "1.0.0", targets };
}

function findingKey(findingId: string, fingerprint: string): string {
  return `${findingId}:${fingerprint}`;
}

function emptyClassificationCounts(): ExternalCorpusClassificationCounts {
  return {
    truePositive: 0,
    falsePositive: 0,
    unclear: 0,
    missingExpectedFinding: 0
  };
}

function addClassificationCounts(
  total: ExternalCorpusClassificationCounts,
  value: ExternalCorpusClassificationCounts
): ExternalCorpusClassificationCounts {
  return {
    truePositive: total.truePositive + value.truePositive,
    falsePositive: total.falsePositive + value.falsePositive,
    unclear: total.unclear + value.unclear,
    missingExpectedFinding: total.missingExpectedFinding + value.missingExpectedFinding
  };
}

async function evaluateExternalCorpusTarget(
  target: LoadedExternalCorpusTarget,
  options: BuildExternalValidationCorpusOptions
): Promise<ExternalCorpusCaseResult> {
  const report = target.mode === "generic-mcp"
    ? await buildGenericMcpDoctor(target.resolvedPath, options.environment)
    : await validatePlugin(target.resolvedPath);
  const packageFingerprint = await buildPackageFingerprint(target.resolvedPath);
  const findings = report.findings.map((finding) => {
    if (!finding.fingerprint) {
      throw new ExternalCorpusManifestError(
        `Corpus target ${target.id} produced a finding without a fingerprint.`
      );
    }

    return {
      findingId: finding.id,
      fingerprint: finding.fingerprint
    };
  });
  const reviewsByKey = new Map(
    target.reviews.map((review) => [
      findingKey(review.findingId, review.fingerprint),
      review
    ])
  );
  const actualKeys = new Set(
    findings.map((finding) => findingKey(finding.findingId, finding.fingerprint))
  );
  const missingExpectedFinding = target.reviews.filter((review) =>
    review.classification === "true_positive" &&
    !actualKeys.has(findingKey(review.findingId, review.fingerprint))
  ).length;
  const classifiedFindings: ExternalCorpusReportedFinding[] = findings
    .map((finding) => ({
      ...finding,
      classification: reviewsByKey.get(
        findingKey(finding.findingId, finding.fingerprint)
      )?.classification ?? "unreviewed" as const
    }))
    .sort((left, right) => findingKey(left.findingId, left.fingerprint)
      .localeCompare(findingKey(right.findingId, right.fingerprint)));
  const classificationCounts = {
    truePositive: classifiedFindings.filter((finding) => finding.classification === "true_positive").length,
    falsePositive: classifiedFindings.filter((finding) => finding.classification === "false_positive").length,
    unclear: classifiedFindings.filter((finding) => finding.classification === "unclear").length,
    missingExpectedFinding
  };
  const digestMatched = packageFingerprint.digest === target.contentDigest;
  const expectationMatched =
    digestMatched &&
    report.status === target.expectedStatus &&
    classificationCounts.falsePositive === 0 &&
    classificationCounts.unclear === 0 &&
    classificationCounts.missingExpectedFinding === 0 &&
    classifiedFindings.every((finding) => finding.classification !== "unreviewed");

  return {
    id: target.id,
    profile: target.profile,
    sourceType: target.sourceType,
    disclosure: target.disclosure,
    mode: target.mode,
    expected: {
      status: target.expectedStatus,
      contentDigest: target.contentDigest,
      findings: [...target.reviews].sort((left, right) =>
        findingKey(left.findingId, left.fingerprint)
          .localeCompare(findingKey(right.findingId, right.fingerprint)))
    },
    actual: {
      status: report.status,
      contentDigest: packageFingerprint.digest,
      findings: classifiedFindings
    },
    digestMatched,
    classificationCounts,
    expectationMatched
  };
}

export async function buildExternalValidationCorpusReport(
  manifestPath: string,
  options: BuildExternalValidationCorpusOptions = {}
): Promise<ExternalValidationCorpusReport> {
  const manifest = await loadExternalCorpusManifest(manifestPath);
  const cases = await Promise.all(
    manifest.targets.map((target) => evaluateExternalCorpusTarget(target, options))
  );
  const failedExpectations = cases.filter((result) => !result.expectationMatched).length;
  const classificationCounts = cases.reduce(
    (total, result) => addClassificationCounts(total, result.classificationCounts),
    emptyClassificationCounts()
  );

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.validation.corpus",
    corpusType: "external",
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    summary: {
      status: failedExpectations === 0 ? "pass" : "fail",
      caseCount: cases.length,
      passedExpectations: cases.length - failedExpectations,
      failedExpectations,
      runtimeCases: 0,
      classificationCounts
    },
    cases
  };
}
