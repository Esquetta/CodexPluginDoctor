import { stat } from "node:fs/promises";
import path from "node:path";

import { buildGenericMcpDoctor } from "../mcp/generic-mcp-doctor.js";
import { packageVersion } from "../version.js";
import { buildPackageFingerprint } from "./attestation.js";
import type {
  ExternalCorpusMode,
  ExternalCorpusProfile,
  ExternalCorpusSourceType,
  FindingReviewClassification
} from "./external-validation-corpus.js";
import { readJsonFile } from "./read-json-file.js";
import { validatePlugin } from "./validate-plugin.js";

export interface CorpusMetricThresholds {
  minPrecision?: number;
  minRecall?: number;
  maxFalsePositiveRate?: number;
}

export interface CorpusMetricFindingReview {
  findingId: string;
  fingerprint: string;
  classification: FindingReviewClassification;
}

export interface CorpusMetricSource {
  repository: string;
  revision: string;
}

export interface CorpusMetricTarget {
  id: string;
  profile: ExternalCorpusProfile;
  sourceType: ExternalCorpusSourceType;
  disclosure: "anonymized";
  path: string;
  mode: ExternalCorpusMode;
  contentDigest: string;
  source?: CorpusMetricSource;
  reviews: CorpusMetricFindingReview[];
}

export interface CorpusMetricsManifest {
  schemaVersion: "1.0.0";
  thresholds?: CorpusMetricThresholds;
  targets: CorpusMetricTarget[];
}

interface LoadedCorpusMetricTarget extends CorpusMetricTarget {
  resolvedPath: string;
}

interface LoadedCorpusMetricsManifest extends CorpusMetricsManifest {
  targets: LoadedCorpusMetricTarget[];
}

export interface CorpusMetricFinding {
  findingId: string;
  fingerprint: string;
}

export interface CorpusMetricCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  resolvedFalsePositives: number;
  unreviewed: number;
  unclear: number;
}

export interface CorpusMetricValues {
  precision: number | null;
  recall: number | null;
  falsePositiveRate: number | null;
}

export interface CorpusMetricOutcome extends CorpusMetricFinding {
  classification: FindingReviewClassification | "unreviewed";
  emitted: boolean;
}

export interface CorpusMetricReconciliation {
  counts: CorpusMetricCounts;
  metrics: CorpusMetricValues;
  complete: boolean;
  outcomes: CorpusMetricOutcome[];
}

export interface CorpusMetricThresholdCheck {
  metric: keyof CorpusMetricValues;
  operator: ">=" | "<=";
  threshold: number;
  actual: number | null;
  passed: boolean;
}

export interface CorpusQualityMetricsTargetResult {
  id: string;
  profile: ExternalCorpusProfile;
  sourceType: ExternalCorpusSourceType;
  disclosure: "anonymized";
  mode: ExternalCorpusMode;
  source?: CorpusMetricSource;
  digestMatched: boolean;
  counts: CorpusMetricCounts;
  metrics: CorpusMetricValues;
  complete: boolean;
  outcomes: CorpusMetricOutcome[];
}

export interface CorpusQualityMetricsReport {
  schemaVersion: "1.0.0";
  kind: "doctor.validation.corpus.metrics";
  generatedAt: string;
  version: string;
  status: "pass" | "fail" | "incomplete";
  exitCode: 0 | 1 | 2;
  summary: CorpusMetricCounts & CorpusMetricValues & {
    targetCount: number;
    completeTargets: number;
    incompleteTargets: number;
  };
  thresholds: CorpusMetricThresholds;
  thresholdChecks: CorpusMetricThresholdCheck[];
  targets: CorpusQualityMetricsTargetResult[];
}

export interface BuildCorpusMetricsOptions {
  thresholds?: CorpusMetricThresholds;
  environment?: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform };
  analyzeTarget?: (
    targetPath: string,
    mode: ExternalCorpusMode
  ) => Promise<{ findings: CorpusMetricFinding[] }>;
  buildFingerprint?: (targetPath: string) => Promise<{ digest: string }>;
}

export class CorpusMetricsManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusMetricsManifestError";
  }
}

const manifestKeys = new Set(["schemaVersion", "thresholds", "targets"]);
const thresholdKeys = new Set(["minPrecision", "minRecall", "maxFalsePositiveRate"]);
const targetKeys = new Set([
  "id", "profile", "sourceType", "disclosure", "path", "mode",
  "contentDigest", "source", "reviews"
]);
const sourceKeys = new Set(["repository", "revision"]);
const reviewKeys = new Set(["findingId", "fingerprint", "classification"]);
const profiles = new Set<ExternalCorpusProfile>(["healthy", "broken", "edge-case"]);
const sourceTypes = new Set<ExternalCorpusSourceType>([
  "public-package", "local-snapshot", "derived-fixture"
]);
const modes = new Set<ExternalCorpusMode>(["codex-plugin", "generic-mcp"]);
const classifications = new Set<FindingReviewClassification>([
  "true_positive", "false_positive", "unclear"
]);
const sha256Digest = /^sha256:[a-f0-9]{64}$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;
const immutableRevision = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new CorpusMetricsManifestError(
      `${label} contains unsupported field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`
    );
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CorpusMetricsManifestError(`${label} must be a non-empty string.`);
  }
  return value;
}

function parseThresholds(value: unknown): CorpusMetricThresholds | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new CorpusMetricsManifestError("Metrics thresholds must be an object.");
  rejectUnknownKeys(value, thresholdKeys, "Metrics thresholds");
  const result: CorpusMetricThresholds = {};
  for (const key of thresholdKeys) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 1) {
      throw new CorpusMetricsManifestError(`Metrics threshold ${key} must be between 0 and 1.`);
    }
    result[key as keyof CorpusMetricThresholds] = candidate;
  }
  return result;
}

function parseSource(value: unknown, targetId: string): CorpusMetricSource | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new CorpusMetricsManifestError(`Metrics target ${targetId} source must be an object.`);
  rejectUnknownKeys(value, sourceKeys, `Metrics target ${targetId} source`);
  const repository = requireString(value.repository, `Metrics target ${targetId} source repository`);
  const revision = requireString(value.revision, `Metrics target ${targetId} source revision`);
  let parsed: URL;
  try {
    parsed = new URL(repository);
  } catch {
    throw new CorpusMetricsManifestError(`Metrics target ${targetId} source repository must use HTTPS.`);
  }
  if (parsed.protocol !== "https:") {
    throw new CorpusMetricsManifestError(`Metrics target ${targetId} source repository must use HTTPS.`);
  }
  if (!immutableRevision.test(revision)) {
    throw new CorpusMetricsManifestError(`Metrics target ${targetId} source revision must be immutable.`);
  }
  return { repository, revision };
}

function parseReview(value: unknown, targetId: string, index: number): CorpusMetricFindingReview {
  if (!isRecord(value)) throw new CorpusMetricsManifestError(`Metrics target ${targetId} review ${index} must be an object.`);
  rejectUnknownKeys(value, reviewKeys, `Metrics target ${targetId} review ${index}`);
  const findingId = requireString(value.findingId, `Metrics target ${targetId} review ${index} findingId`);
  const fingerprint = requireString(value.fingerprint, `Metrics target ${targetId} review ${index} fingerprint`);
  if (!fingerprintPattern.test(fingerprint)) {
    throw new CorpusMetricsManifestError(`Metrics target ${targetId} review ${index} fingerprint must be a sha256 fingerprint.`);
  }
  if (typeof value.classification !== "string" ||
      !classifications.has(value.classification as FindingReviewClassification)) {
    throw new CorpusMetricsManifestError(`Metrics target ${targetId} review ${index} has an unsupported classification.`);
  }
  return { findingId, fingerprint, classification: value.classification as FindingReviewClassification };
}

function resolveContainedTarget(manifestDirectory: string, targetPath: string): string {
  if (path.posix.isAbsolute(targetPath) || path.win32.isAbsolute(targetPath)) {
    throw new CorpusMetricsManifestError("Metrics target path must be relative to the manifest file.");
  }
  const root = path.resolve(manifestDirectory);
  const resolved = path.resolve(root, targetPath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CorpusMetricsManifestError("Metrics target path must remain beneath the manifest directory.");
  }
  return resolved;
}

async function parseTarget(
  value: unknown,
  manifestDirectory: string,
  index: number
): Promise<LoadedCorpusMetricTarget> {
  if (!isRecord(value)) throw new CorpusMetricsManifestError(`Metrics target ${index} must be an object.`);
  rejectUnknownKeys(value, targetKeys, `Metrics target ${index}`);
  const id = requireString(value.id, `Metrics target ${index} id`);
  const targetPath = requireString(value.path, `Metrics target ${id} path`);
  if (typeof value.profile !== "string" || !profiles.has(value.profile as ExternalCorpusProfile)) {
    throw new CorpusMetricsManifestError(`Metrics target ${id} has an unsupported profile.`);
  }
  if (typeof value.sourceType !== "string" || !sourceTypes.has(value.sourceType as ExternalCorpusSourceType)) {
    throw new CorpusMetricsManifestError(`Metrics target ${id} has an unsupported sourceType.`);
  }
  if (value.disclosure !== "anonymized") {
    throw new CorpusMetricsManifestError(`Metrics target ${id} disclosure must be anonymized.`);
  }
  if (typeof value.mode !== "string" || !modes.has(value.mode as ExternalCorpusMode)) {
    throw new CorpusMetricsManifestError(`Metrics target ${id} has an unsupported mode.`);
  }
  if (typeof value.contentDigest !== "string" || !sha256Digest.test(value.contentDigest)) {
    throw new CorpusMetricsManifestError(`Metrics target ${id} contentDigest must be a sha256 digest.`);
  }
  if (!Array.isArray(value.reviews)) {
    throw new CorpusMetricsManifestError(`Metrics target ${id} reviews must be an array.`);
  }
  const reviews = value.reviews.map((review, reviewIndex) => parseReview(review, id, reviewIndex));
  const reviewKeysSeen = new Set<string>();
  for (const review of reviews) {
    const key = findingKey(review.findingId, review.fingerprint);
    if (reviewKeysSeen.has(key)) {
      throw new CorpusMetricsManifestError(`Metrics target ${id} contains a duplicate finding review.`);
    }
    reviewKeysSeen.add(key);
  }
  const resolvedPath = resolveContainedTarget(manifestDirectory, targetPath);
  try {
    if (!(await stat(resolvedPath)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new CorpusMetricsManifestError(`Metrics target ${id} directory does not exist.`);
  }
  const source = parseSource(value.source, id);
  return {
    id,
    profile: value.profile as ExternalCorpusProfile,
    sourceType: value.sourceType as ExternalCorpusSourceType,
    disclosure: "anonymized",
    path: targetPath,
    mode: value.mode as ExternalCorpusMode,
    contentDigest: value.contentDigest,
    ...(source ? { source } : {}),
    reviews,
    resolvedPath
  };
}

export async function loadCorpusMetricsManifest(manifestPath: string): Promise<LoadedCorpusMetricsManifest> {
  let value: unknown;
  try {
    value = await readJsonFile<unknown>(path.resolve(manifestPath));
  } catch {
    throw new CorpusMetricsManifestError("Metrics manifest could not be read as JSON.");
  }
  if (!isRecord(value)) throw new CorpusMetricsManifestError("Metrics manifest must be an object.");
  rejectUnknownKeys(value, manifestKeys, "Metrics manifest");
  if (value.schemaVersion !== "1.0.0") {
    throw new CorpusMetricsManifestError("Unsupported metrics manifest schemaVersion.");
  }
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    throw new CorpusMetricsManifestError("Metrics manifest targets must be a non-empty array.");
  }
  const manifestDirectory = path.dirname(path.resolve(manifestPath));
  const targets = await Promise.all(value.targets.map((target, index) =>
    parseTarget(target, manifestDirectory, index)));
  const ids = new Set<string>();
  for (const target of targets) {
    if (ids.has(target.id)) throw new CorpusMetricsManifestError(`Metrics target id ${target.id} is duplicated.`);
    ids.add(target.id);
  }
  const thresholds = parseThresholds(value.thresholds);
  return { schemaVersion: "1.0.0", ...(thresholds ? { thresholds } : {}), targets };
}

function findingKey(findingId: string, fingerprint: string): string {
  return `${findingId}:${fingerprint}`;
}

function roundMetric(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1_000_000) / 1_000_000;
}

function calculateMetrics(counts: Pick<CorpusMetricCounts, "truePositives" | "falsePositives" | "falseNegatives">): CorpusMetricValues {
  const precisionDenominator = counts.truePositives + counts.falsePositives;
  const recallDenominator = counts.truePositives + counts.falseNegatives;
  return {
    precision: roundMetric(precisionDenominator === 0 ? null : counts.truePositives / precisionDenominator),
    recall: roundMetric(recallDenominator === 0 ? null : counts.truePositives / recallDenominator),
    falsePositiveRate: roundMetric(precisionDenominator === 0 ? null : counts.falsePositives / precisionDenominator)
  };
}

export function reconcileCorpusMetricFindings(
  reviews: CorpusMetricFindingReview[],
  actualFindings: CorpusMetricFinding[]
): CorpusMetricReconciliation {
  const reviewsByKey = new Map(reviews.map((review) => [findingKey(review.findingId, review.fingerprint), review]));
  const actualKeys = new Set(actualFindings.map((finding) => findingKey(finding.findingId, finding.fingerprint)));
  const outcomes: CorpusMetricOutcome[] = actualFindings.map((finding) => ({
    ...finding,
    classification: reviewsByKey.get(findingKey(finding.findingId, finding.fingerprint))?.classification ?? "unreviewed",
    emitted: true
  }));
  for (const review of reviews) {
    if (!actualKeys.has(findingKey(review.findingId, review.fingerprint))) {
      outcomes.push({ ...review, emitted: false });
    }
  }
  outcomes.sort((left, right) => findingKey(left.findingId, left.fingerprint)
    .localeCompare(findingKey(right.findingId, right.fingerprint)));
  const counts: CorpusMetricCounts = {
    truePositives: outcomes.filter((item) => item.emitted && item.classification === "true_positive").length,
    falsePositives: outcomes.filter((item) => item.emitted && item.classification === "false_positive").length,
    falseNegatives: outcomes.filter((item) => !item.emitted && item.classification === "true_positive").length,
    resolvedFalsePositives: outcomes.filter((item) => !item.emitted && item.classification === "false_positive").length,
    unreviewed: outcomes.filter((item) => item.emitted && item.classification === "unreviewed").length,
    unclear: outcomes.filter((item) => item.classification === "unclear").length
  };
  return {
    counts,
    metrics: calculateMetrics(counts),
    complete: counts.unreviewed === 0 && counts.unclear === 0,
    outcomes
  };
}

function addCounts(left: CorpusMetricCounts, right: CorpusMetricCounts): CorpusMetricCounts {
  return {
    truePositives: left.truePositives + right.truePositives,
    falsePositives: left.falsePositives + right.falsePositives,
    falseNegatives: left.falseNegatives + right.falseNegatives,
    resolvedFalsePositives: left.resolvedFalsePositives + right.resolvedFalsePositives,
    unreviewed: left.unreviewed + right.unreviewed,
    unclear: left.unclear + right.unclear
  };
}

async function defaultAnalyzeTarget(
  targetPath: string,
  mode: ExternalCorpusMode,
  environment?: BuildCorpusMetricsOptions["environment"]
): Promise<{ findings: CorpusMetricFinding[] }> {
  const report = mode === "generic-mcp"
    ? await buildGenericMcpDoctor(targetPath, environment)
    : await validatePlugin(targetPath);
  return {
    findings: report.findings.map((finding) => {
      if (!finding.fingerprint) {
        throw new CorpusMetricsManifestError("Metrics analysis produced a finding without a fingerprint.");
      }
      return { findingId: finding.id, fingerprint: finding.fingerprint };
    })
  };
}

function buildThresholdChecks(
  metrics: CorpusMetricValues,
  thresholds: CorpusMetricThresholds
): CorpusMetricThresholdCheck[] {
  const definitions: Array<[keyof CorpusMetricThresholds, keyof CorpusMetricValues, ">=" | "<="]> = [
    ["minPrecision", "precision", ">="],
    ["minRecall", "recall", ">="],
    ["maxFalsePositiveRate", "falsePositiveRate", "<="]
  ];
  return definitions.flatMap(([thresholdKey, metric, operator]) => {
    const threshold = thresholds[thresholdKey];
    if (threshold === undefined) return [];
    const actual = metrics[metric];
    const passed = actual !== null && (operator === ">=" ? actual >= threshold : actual <= threshold);
    return [{ metric, operator, threshold, actual, passed }];
  });
}

export async function buildCorpusQualityMetricsReport(
  manifestPath: string,
  options: BuildCorpusMetricsOptions = {}
): Promise<CorpusQualityMetricsReport> {
  const manifest = await loadCorpusMetricsManifest(manifestPath);
  const thresholds = { ...(manifest.thresholds ?? {}), ...(options.thresholds ?? {}) };
  const analyzeTarget = options.analyzeTarget ?? ((targetPath, mode) =>
    defaultAnalyzeTarget(targetPath, mode, options.environment));
  const fingerprintBuilder = options.buildFingerprint ?? buildPackageFingerprint;
  const targets: CorpusQualityMetricsTargetResult[] = [];

  for (const target of manifest.targets) {
    const [analysis, fingerprint] = await Promise.all([
      analyzeTarget(target.resolvedPath, target.mode),
      fingerprintBuilder(target.resolvedPath)
    ]);
    const reconciliation = reconcileCorpusMetricFindings(target.reviews, analysis.findings);
    const digestMatched = fingerprint.digest === target.contentDigest;
    targets.push({
      id: target.id,
      profile: target.profile,
      sourceType: target.sourceType,
      disclosure: target.disclosure,
      mode: target.mode,
      ...(target.source ? { source: target.source } : {}),
      digestMatched,
      counts: reconciliation.counts,
      metrics: reconciliation.metrics,
      complete: reconciliation.complete && digestMatched,
      outcomes: reconciliation.outcomes
    });
  }

  const emptyCounts: CorpusMetricCounts = {
    truePositives: 0, falsePositives: 0, falseNegatives: 0,
    resolvedFalsePositives: 0, unreviewed: 0, unclear: 0
  };
  const counts = targets.reduce((total, target) => addCounts(total, target.counts), emptyCounts);
  const metrics = calculateMetrics(counts);
  const completeTargets = targets.filter((target) => target.complete).length;
  const thresholdChecks = buildThresholdChecks(metrics, thresholds);
  const incomplete = completeTargets !== targets.length;
  const failedThreshold = thresholdChecks.some((check) => !check.passed);
  const status = incomplete ? "incomplete" : failedThreshold ? "fail" : "pass";
  const exitCode = incomplete ? 2 : failedThreshold ? 1 : 0;

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.validation.corpus.metrics",
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    status,
    exitCode,
    summary: {
      targetCount: targets.length,
      completeTargets,
      incompleteTargets: targets.length - completeTargets,
      ...counts,
      ...metrics
    },
    thresholds,
    thresholdChecks,
    targets
  };
}

