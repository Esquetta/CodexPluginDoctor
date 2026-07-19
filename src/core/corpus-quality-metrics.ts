import { createHash } from "node:crypto";
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
  corpusDigest: string;
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

export interface CorpusMetricCountDeltas {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  resolvedFalsePositives: number;
  unreviewed: number;
  unclear: number;
}

export interface CorpusMetricValueComparison {
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface CorpusQualityMetricsDiffTarget {
  id: string;
  regressed: boolean;
  counts: CorpusMetricCountDeltas;
  precision: CorpusMetricValueComparison;
  recall: CorpusMetricValueComparison;
  falsePositiveRate: CorpusMetricValueComparison;
}

export interface CorpusQualityMetricsDiffReport {
  schemaVersion: "1.0.0";
  kind: "doctor.validation.corpus.metrics.diff";
  generatedAt: string;
  version: string;
  corpusDigest: string;
  status: "pass" | "fail";
  exitCode: 0 | 1;
  failOnRegression: boolean;
  summary: {
    comparable: true;
    regression: boolean;
    changedTargets: number;
    precisionBefore: number | null;
    precisionAfter: number | null;
    precisionDelta: number | null;
    recallBefore: number | null;
    recallAfter: number | null;
    recallDelta: number | null;
    falsePositiveRateBefore: number | null;
    falsePositiveRateAfter: number | null;
    falsePositiveRateDelta: number | null;
    counts: CorpusMetricCountDeltas;
  };
  before: { version: string; targetCount: number };
  after: { version: string; targetCount: number };
  targets: CorpusQualityMetricsDiffTarget[];
}

export interface BuildCorpusMetricsDiffOptions {
  failOnRegression?: boolean;
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

export class CorpusMetricsDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusMetricsDiffError";
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
const publicSafeId = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
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
  if (!publicSafeId.test(id)) {
    throw new CorpusMetricsManifestError(`Metrics target ${index} id must be public-safe.`);
  }
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

function buildCorpusDigest(manifest: LoadedCorpusMetricsManifest): string {
  const identity = manifest.targets
    .map((target) => ({
      id: target.id,
      profile: target.profile,
      sourceType: target.sourceType,
      mode: target.mode,
      contentDigest: target.contentDigest,
      reviews: target.reviews
        .map((review) => ({
          findingId: review.findingId,
          fingerprint: review.fingerprint,
          classification: review.classification
        }))
        .sort((left, right) => findingKey(left.findingId, left.fingerprint)
          .localeCompare(findingKey(right.findingId, right.fingerprint)))
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function calculateRawMetrics(counts: Pick<CorpusMetricCounts, "truePositives" | "falsePositives" | "falseNegatives">): CorpusMetricValues {
  const precisionDenominator = counts.truePositives + counts.falsePositives;
  const recallDenominator = counts.truePositives + counts.falseNegatives;
  return {
    precision: precisionDenominator === 0 ? null : counts.truePositives / precisionDenominator,
    recall: recallDenominator === 0 ? null : counts.truePositives / recallDenominator,
    falsePositiveRate: precisionDenominator === 0 ? null : counts.falsePositives / precisionDenominator
  };
}

function calculateMetrics(counts: Pick<CorpusMetricCounts, "truePositives" | "falsePositives" | "falseNegatives">): CorpusMetricValues {
  const raw = calculateRawMetrics(counts);
  return {
    precision: roundMetric(raw.precision),
    recall: roundMetric(raw.recall),
    falsePositiveRate: roundMetric(raw.falsePositiveRate)
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
  const rawMetrics = calculateRawMetrics(counts);
  const completeTargets = targets.filter((target) => target.complete).length;
  const thresholdChecks = buildThresholdChecks(rawMetrics, thresholds).map((check) => ({
    ...check,
    actual: metrics[check.metric]
  }));
  const incomplete = completeTargets !== targets.length;
  const failedThreshold = thresholdChecks.some((check) => !check.passed);
  const status = incomplete ? "incomplete" : failedThreshold ? "fail" : "pass";
  const exitCode = incomplete ? 2 : failedThreshold ? 1 : 0;

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.validation.corpus.metrics",
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    corpusDigest: buildCorpusDigest(manifest),
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

function formatMetric(value: number | null): string {
  return value === null ? "N/A" : `${(value * 100).toFixed(2)}%`;
}

function metricLabel(metric: keyof CorpusMetricValues): string {
  if (metric === "falsePositiveRate") return "False-positive rate";
  return metric[0].toUpperCase() + metric.slice(1);
}

export function renderCorpusQualityMetricsJson(report: CorpusQualityMetricsReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderCorpusQualityMetricsText(
  report: CorpusQualityMetricsReport,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Corpus Quality Metrics",
    "=============================",
    `Version: ${report.version}`,
    `Status: ${report.status.toUpperCase()}`,
    `Targets: ${report.summary.targetCount}`,
    `Precision: ${formatMetric(report.summary.precision)}`,
    `Recall: ${formatMetric(report.summary.recall)}`,
    `False-positive rate: ${formatMetric(report.summary.falsePositiveRate)}`,
    `TP: ${report.summary.truePositives}  FP: ${report.summary.falsePositives}  FN: ${report.summary.falseNegatives}`
  ];
  if (options.outputPath) lines.push(`Output: ${options.outputPath}`);
  const failed = report.thresholdChecks.filter((check) => !check.passed);
  lines.push("", "Failed thresholds", "-----------------");
  if (failed.length === 0) {
    lines.push("None.");
  } else {
    for (const check of failed) {
      lines.push(
        `${metricLabel(check.metric)}: ${formatMetric(check.actual)} ${check.operator} ${formatMetric(check.threshold)} required`
      );
    }
  }
  lines.push("", "Targets", "-------");
  for (const target of report.targets) {
    lines.push(
      `${target.id}: ${target.complete ? "COMPLETE" : "INCOMPLETE"} ` +
      `(precision ${formatMetric(target.metrics.precision)}, recall ${formatMetric(target.metrics.recall)})`
    );
  }
  return lines.join("\n");
}

export function renderCorpusQualityMetricsMarkdown(report: CorpusQualityMetricsReport): string {
  const lines = [
    "# Doctor Corpus Quality Metrics",
    "",
    `- Version: ${report.version}`,
    `- Status: ${report.status.toUpperCase()}`,
    `- Targets: ${report.summary.targetCount}`,
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Precision | ${formatMetric(report.summary.precision)} |`,
    `| Recall | ${formatMetric(report.summary.recall)} |`,
    `| False-positive rate | ${formatMetric(report.summary.falsePositiveRate)} |`,
    `| True positives | ${report.summary.truePositives} |`,
    `| False positives | ${report.summary.falsePositives} |`,
    `| False negatives | ${report.summary.falseNegatives} |`,
    "",
    "## Failed Thresholds",
    ""
  ];
  const failed = report.thresholdChecks.filter((check) => !check.passed);
  if (failed.length === 0) {
    lines.push("None.");
  } else {
    for (const check of failed) {
      lines.push(
        `- ${metricLabel(check.metric)}: ${formatMetric(check.actual)} ${check.operator} ${formatMetric(check.threshold)} required`
      );
    }
  }
  lines.push("", "## Targets", "", "| Target | Review | Precision | Recall |", "| --- | --- | ---: | ---: |");
  for (const target of report.targets) {
    lines.push(
      `| ${target.id} | ${target.complete ? "complete" : "incomplete"} | ` +
      `${formatMetric(target.metrics.precision)} | ${formatMetric(target.metrics.recall)} |`
    );
  }
  return lines.join("\n");
}

const reportSizeLimit = 5 * 1024 * 1024;
const countKeys: Array<keyof CorpusMetricCounts> = [
  "truePositives",
  "falsePositives",
  "falseNegatives",
  "resolvedFalsePositives",
  "unreviewed",
  "unclear"
];

interface ComparableMetricsReport {
  version: string;
  corpusDigest: string;
  summary: CorpusMetricCounts & { targetCount: number };
  targets: Array<{ id: string; counts: CorpusMetricCounts }>;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new CorpusMetricsDiffError(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function parseCounts(value: unknown, label: string): CorpusMetricCounts {
  if (!isRecord(value)) throw new CorpusMetricsDiffError(`${label} is invalid.`);
  return Object.fromEntries(countKeys.map((key) => [
    key,
    requireNonNegativeInteger(value[key], `${label}.${key}`)
  ])) as unknown as CorpusMetricCounts;
}

function metricsMatchCounts(value: unknown, counts: CorpusMetricCounts): boolean {
  if (!isRecord(value)) return false;
  const expected = calculateMetrics(counts);
  return value.precision === expected.precision &&
    value.recall === expected.recall &&
    value.falsePositiveRate === expected.falsePositiveRate;
}

async function loadComparableMetricsReport(
  reportPath: string,
  label: "Before" | "After"
): Promise<ComparableMetricsReport> {
  let fileStat;
  try {
    fileStat = await stat(path.resolve(reportPath));
  } catch {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report could not be read.`);
  }
  if (!fileStat.isFile() || fileStat.size > reportSizeLimit) {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report must be a file no larger than 5 MiB.`);
  }

  let value: unknown;
  try {
    value = await readJsonFile<unknown>(path.resolve(reportPath));
  } catch {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report could not be read as JSON.`);
  }
  if (!isRecord(value) || value.schemaVersion !== "1.0.0" ||
      value.kind !== "doctor.validation.corpus.metrics") {
    throw new CorpusMetricsDiffError(`${label} file is not a supported corpus metrics report.`);
  }
  if (typeof value.version !== "string" || value.version.length === 0) {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report version is invalid.`);
  }
  if (typeof value.corpusDigest !== "string" || !sha256Digest.test(value.corpusDigest)) {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report is missing a valid corpusDigest.`);
  }
  if (!isRecord(value.summary) || !Array.isArray(value.targets)) {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report structure is invalid.`);
  }
  if (value.status === "incomplete" || value.summary.incompleteTargets !== 0 ||
      value.summary.unreviewed !== 0 || value.summary.unclear !== 0) {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report must be complete.`);
  }
  if ((value.status !== "pass" && value.status !== "fail") ||
      (value.status === "pass" ? value.exitCode !== 0 : value.exitCode !== 1)) {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report status is invalid.`);
  }

  const targetCount = requireNonNegativeInteger(value.summary.targetCount, `${label} summary.targetCount`);
  const summaryCounts = parseCounts(value.summary, `${label} summary`);
  if (targetCount === 0 || targetCount !== value.targets.length ||
      value.summary.completeTargets !== targetCount || !metricsMatchCounts(value.summary, summaryCounts)) {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report is internally inconsistent.`);
  }

  const ids = new Set<string>();
  const targets = value.targets.map((target, index) => {
    if (!isRecord(target) || typeof target.id !== "string" || !publicSafeId.test(target.id) ||
        target.complete !== true || target.digestMatched !== true) {
      throw new CorpusMetricsDiffError(`${label} corpus metrics target ${index} is invalid or incomplete.`);
    }
    if (ids.has(target.id)) {
      throw new CorpusMetricsDiffError(`${label} corpus metrics report contains duplicate target IDs.`);
    }
    ids.add(target.id);
    const counts = parseCounts(target.counts, `${label} target ${target.id} counts`);
    if (!metricsMatchCounts(target.metrics, counts)) {
      throw new CorpusMetricsDiffError(`${label} corpus metrics report is internally inconsistent.`);
    }
    return { id: target.id, counts };
  });

  const summedCounts = targets.reduce((total, target) => addCounts(total, target.counts), {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    resolvedFalsePositives: 0,
    unreviewed: 0,
    unclear: 0
  });
  if (countKeys.some((key) => summedCounts[key] !== summaryCounts[key])) {
    throw new CorpusMetricsDiffError(`${label} corpus metrics report is internally inconsistent.`);
  }

  return {
    version: value.version,
    corpusDigest: value.corpusDigest,
    summary: { ...summaryCounts, targetCount },
    targets
  };
}

function subtractCounts(after: CorpusMetricCounts, before: CorpusMetricCounts): CorpusMetricCountDeltas {
  return Object.fromEntries(countKeys.map((key) => [key, after[key] - before[key]])) as unknown as CorpusMetricCountDeltas;
}

function compareMetric(before: number | null, after: number | null): CorpusMetricValueComparison {
  return {
    before: roundMetric(before),
    after: roundMetric(after),
    delta: before === null || after === null ? null : roundMetric(after - before)
  };
}

function metricRegressed(
  precision: CorpusMetricValueComparison,
  recall: CorpusMetricValueComparison,
  falsePositiveRate: CorpusMetricValueComparison
): boolean {
  return (precision.delta !== null && precision.delta < 0) ||
    (recall.delta !== null && recall.delta < 0) ||
    (falsePositiveRate.delta !== null && falsePositiveRate.delta > 0);
}

export async function buildCorpusQualityMetricsDiffReport(
  beforePath: string,
  afterPath: string,
  options: BuildCorpusMetricsDiffOptions = {}
): Promise<CorpusQualityMetricsDiffReport> {
  const [before, after] = await Promise.all([
    loadComparableMetricsReport(beforePath, "Before"),
    loadComparableMetricsReport(afterPath, "After")
  ]);
  const beforeIds = before.targets.map((target) => target.id).sort();
  const afterIds = after.targets.map((target) => target.id).sort();
  if (before.corpusDigest !== after.corpusDigest || JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
    throw new CorpusMetricsDiffError("Corpus metrics reports describe different corpus identities.");
  }

  const afterTargets = new Map(after.targets.map((target) => [target.id, target]));
  const targets = before.targets.map((beforeTarget) => {
    const afterTarget = afterTargets.get(beforeTarget.id)!;
    const beforeMetrics = calculateRawMetrics(beforeTarget.counts);
    const afterMetrics = calculateRawMetrics(afterTarget.counts);
    const precision = compareMetric(beforeMetrics.precision, afterMetrics.precision);
    const recall = compareMetric(beforeMetrics.recall, afterMetrics.recall);
    const falsePositiveRate = compareMetric(
      beforeMetrics.falsePositiveRate,
      afterMetrics.falsePositiveRate
    );
    return {
      id: beforeTarget.id,
      regressed: metricRegressed(precision, recall, falsePositiveRate),
      counts: subtractCounts(afterTarget.counts, beforeTarget.counts),
      precision,
      recall,
      falsePositiveRate
    };
  });
  const changedTargets = targets.filter((target) =>
    countKeys.some((key) => target.counts[key] !== 0)).length;
  const beforeMetrics = calculateRawMetrics(before.summary);
  const afterMetrics = calculateRawMetrics(after.summary);
  const precision = compareMetric(beforeMetrics.precision, afterMetrics.precision);
  const recall = compareMetric(beforeMetrics.recall, afterMetrics.recall);
  const falsePositiveRate = compareMetric(beforeMetrics.falsePositiveRate, afterMetrics.falsePositiveRate);
  const regression = metricRegressed(precision, recall, falsePositiveRate);
  const failOnRegression = options.failOnRegression === true;
  const failed = failOnRegression && regression;

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.validation.corpus.metrics.diff",
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    corpusDigest: before.corpusDigest,
    status: failed ? "fail" : "pass",
    exitCode: failed ? 1 : 0,
    failOnRegression,
    summary: {
      comparable: true,
      regression,
      changedTargets,
      precisionBefore: precision.before,
      precisionAfter: precision.after,
      precisionDelta: precision.delta,
      recallBefore: recall.before,
      recallAfter: recall.after,
      recallDelta: recall.delta,
      falsePositiveRateBefore: falsePositiveRate.before,
      falsePositiveRateAfter: falsePositiveRate.after,
      falsePositiveRateDelta: falsePositiveRate.delta,
      counts: subtractCounts(after.summary, before.summary)
    },
    before: { version: before.version, targetCount: before.summary.targetCount },
    after: { version: after.version, targetCount: after.summary.targetCount },
    targets
  };
}

function formatDelta(value: number | null): string {
  if (value === null) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)} pp`;
}

export function renderCorpusQualityMetricsDiffJson(report: CorpusQualityMetricsDiffReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderCorpusQualityMetricsDiffText(
  report: CorpusQualityMetricsDiffReport,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Corpus Metrics Diff",
    "==========================",
    `Status: ${report.status.toUpperCase()}`,
    `Before version: ${report.before.version}`,
    `After version: ${report.after.version}`,
    `Regression: ${report.summary.regression ? "yes" : "no"}`,
    `Precision delta: ${formatDelta(report.summary.precisionDelta)}`,
    `Recall delta: ${formatDelta(report.summary.recallDelta)}`,
    `False-positive rate delta: ${formatDelta(report.summary.falsePositiveRateDelta)}`,
    `Changed targets: ${report.summary.changedTargets}`
  ];
  if (options.outputPath) lines.push(`Output: ${options.outputPath}`);
  lines.push("", "Target Changes", "--------------");
  const changed = report.targets.filter((target) => countKeys.some((key) => target.counts[key] !== 0));
  if (changed.length === 0) {
    lines.push("None.");
  } else {
    for (const target of changed) {
      lines.push(
        `${target.id}: ${target.regressed ? "REGRESSED" : "CHANGED"} ` +
        `(precision ${formatDelta(target.precision.delta)}, recall ${formatDelta(target.recall.delta)}, ` +
        `false-positive rate ${formatDelta(target.falsePositiveRate.delta)})`
      );
    }
  }
  return lines.join("\n");
}

export function renderCorpusQualityMetricsDiffMarkdown(report: CorpusQualityMetricsDiffReport): string {
  const lines = [
    "# Doctor Corpus Metrics Diff",
    "",
    `- Status: ${report.status.toUpperCase()}`,
    `- Before version: ${report.before.version}`,
    `- After version: ${report.after.version}`,
    `- Regression: ${report.summary.regression ? "yes" : "no"}`,
    "",
    "| Metric | Before | After | Delta |",
    "| --- | ---: | ---: | ---: |",
    `| Precision | ${formatMetric(report.summary.precisionBefore)} | ${formatMetric(report.summary.precisionAfter)} | ${formatDelta(report.summary.precisionDelta)} |`,
    `| Recall | ${formatMetric(report.summary.recallBefore)} | ${formatMetric(report.summary.recallAfter)} | ${formatDelta(report.summary.recallDelta)} |`,
    `| False-positive rate | ${formatMetric(report.summary.falsePositiveRateBefore)} | ${formatMetric(report.summary.falsePositiveRateAfter)} | ${formatDelta(report.summary.falsePositiveRateDelta)} |`,
    "",
    "## Target Changes",
    "",
    "| Target | Result | Precision | Recall | False-positive rate |",
    "| --- | --- | ---: | ---: | ---: |"
  ];
  const changed = report.targets.filter((target) => countKeys.some((key) => target.counts[key] !== 0));
  if (changed.length === 0) {
    lines.push("| None | unchanged | 0.00 pp | 0.00 pp | 0.00 pp |");
  } else {
    for (const target of changed) {
      lines.push(
        `| ${target.id} | ${target.regressed ? "regressed" : "changed"} | ` +
        `${formatDelta(target.precision.delta)} | ${formatDelta(target.recall.delta)} | ` +
        `${formatDelta(target.falsePositiveRate.delta)} |`
      );
    }
  }
  return lines.join("\n");
}
