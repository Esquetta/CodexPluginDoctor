import type {
  CompatibilityEnvironment,
  CompatibilityMatrix
} from "../compatibility/compatibility-matrix.js";
import type { JsonReport } from "../domain/types.js";
import type { DoctorRecommendationsReport } from "./doctor-recommendations.js";
import type { SecurityAudit } from "../security/security-audit.js";
import type { TrustScoreReport } from "../security/trust-score.js";
import {
  buildDoctorExportBundleFromAnalysis,
  buildDoctorRecommendationsFromAnalysis,
  buildPackageAnalysis
} from "./package-analysis.js";

export interface DoctorExportBundle {
  schemaVersion: "1.0.0";
  generatedAt: string;
  kind: "doctor.export.bundle";
  version: string;
  targetPath: string;
  validation: JsonReport;
  security: SecurityAudit;
  compatibility: CompatibilityMatrix;
  recommendations: DoctorRecommendationsReport;
  trust: TrustScoreReport;
}

function redactString(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_SECRET]")
    .replace(/npm_[A-Za-z0-9_-]{12,}/g, "[REDACTED_SECRET]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{12,}/g, "[REDACTED_SECRET]")
    .replace(/SHOULD_NOT_LEAK/g, "[REDACTED_SECRET]");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        redactValue(nestedValue)
      ])
    );
  }

  return value;
}

export async function buildDoctorExportBundle(
  targetPath: string,
  environment: CompatibilityEnvironment = {}
): Promise<DoctorExportBundle> {
  const analysis = await buildPackageAnalysis(targetPath, { environment });

  return buildDoctorExportBundleFromAnalysis(
    analysis,
    buildDoctorRecommendationsFromAnalysis(analysis)
  );
}

export function renderDoctorExportBundleJson(bundle: DoctorExportBundle): string {
  return JSON.stringify(redactValue(bundle), null, 2);
}

export function renderDoctorExportBundle(
  bundle: DoctorExportBundle,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Export Bundle",
    "====================",
    `Target: ${bundle.targetPath}`,
    `Version: ${bundle.version}`,
    `Validation: ${bundle.validation.summary.status.toUpperCase()}`,
    `Security: ${bundle.security.status.toUpperCase()} (${bundle.security.score}/100)`,
    `Trust: ${bundle.trust.status.toUpperCase()} (${bundle.trust.score}/100)`,
    `Recommendations: ${bundle.recommendations.actions.length}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Bundle sections", "---------------");
  lines.push("validation");
  lines.push("security");
  lines.push("compatibility");
  lines.push("recommendations");
  lines.push("trust");

  return lines.join("\n");
}
