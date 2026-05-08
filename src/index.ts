import type { CheckOptions, CheckResult } from "./domain/types.js";
import { validatePlugin } from "./core/validate-plugin.js";
export {
  buildSecurityAudit,
  renderSecurityAuditJson,
  renderSecurityScorecard,
  type SecurityAudit
} from "./security/security-audit.js";
export {
  buildTrustScore,
  renderTrustScore,
  renderTrustScoreJson,
  type BuildTrustScoreOptions,
  type TrustScoreReport
} from "./security/trust-score.js";
export {
  buildDoctorSnapshot,
  renderDoctorSnapshot,
  renderDoctorSnapshotJson,
  type DoctorSnapshot
} from "./core/doctor-snapshot.js";
export {
  buildDoctorRecommendations,
  renderDoctorRecommendations,
  renderDoctorRecommendationsJson,
  type DoctorRecommendationAction,
  type DoctorRecommendationsReport
} from "./core/doctor-recommendations.js";
export {
  buildDoctorExportBundle,
  renderDoctorExportBundle,
  renderDoctorExportBundleJson,
  type DoctorExportBundle
} from "./core/doctor-export-bundle.js";
export {
  buildDoctorExportBundleFromAnalysis,
  buildDoctorRecommendationsFromAnalysis,
  buildPackageAnalysis,
  type PackageAnalysis,
  type PackageAnalysisOptions,
  type PackageAnalysisStage,
  type PackageAnalysisTiming
} from "./core/package-analysis.js";
export {
  buildDoctorPerformanceReport,
  renderDoctorPerformanceReport,
  renderDoctorPerformanceReportJson,
  type BuildDoctorPerformanceReportOptions,
  type DoctorPerformanceReport,
  type DoctorPerformanceStage,
  type DoctorPerformanceStageName
} from "./core/performance-report.js";
export {
  buildDoctorNpmPackageReport,
  renderDoctorNpmPackageReport,
  renderDoctorNpmPackageReportJson,
  type BuildDoctorNpmPackageReportOptions,
  type DoctorNpmPackageReport
} from "./core/npm-package-doctor.js";
export {
  buildEcosystemAudit,
  renderEcosystemAudit,
  renderEcosystemAuditJson,
  type EcosystemAuditReport
} from "./audit/ecosystem-audit.js";
export {
  applyPolicyToDoctorConfig,
  applyPolicyToSecurityAudit,
  parsePolicyPack,
  policyEnablesRuntime,
  policyFailsOnWarnings,
  policyPackNames,
  type PolicyPackName
} from "./policy/policy-packs.js";
export {
  buildGenericMcpDoctor,
  renderGenericMcpDoctor,
  renderGenericMcpDoctorJson,
  type GenericMcpDoctorReport
} from "./mcp/generic-mcp-doctor.js";

export async function runCheck(
  targetPath: string,
  options: CheckOptions = {}
): Promise<CheckResult> {
  return validatePlugin(targetPath, options);
}
