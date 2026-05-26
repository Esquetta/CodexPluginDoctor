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
  buildDoctorAttestation,
  renderDoctorAttestation,
  renderDoctorAttestationJson,
  renderDoctorAttestationVerification,
  renderDoctorAttestationVerificationJson,
  verifyDoctorAttestation,
  type DoctorAttestation,
  type DoctorAttestationVerificationCheck,
  type DoctorAttestationVerificationReport,
  type Digest,
  type PackageFingerprint
} from "./core/attestation.js";
export {
  buildDoctorOutputContract,
  renderDoctorOutputContract,
  renderDoctorOutputContractJson,
  type DoctorOutputContract,
  type OutputContractRule,
  type OutputContractSchema
} from "./core/output-contract.js";
export {
  buildDoctorValidationCorpusReport,
  renderDoctorValidationCorpusJson,
  renderDoctorValidationCorpusReport,
  type BuildDoctorValidationCorpusOptions,
  type DoctorValidationCorpusReport,
  type ValidationCorpusCaseDefinition,
  type ValidationCorpusCaseResult
} from "./core/validation-corpus.js";
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
  buildDoctorRuntimePlan,
  evaluateRuntimeApproval,
  renderDoctorRuntimePlan,
  renderDoctorRuntimePlanMarkdown,
  renderDoctorRuntimePlanJson,
  runtimeApprovalPassed,
  type DoctorRuntimePlan,
  type RuntimeApprovalReport,
  type RuntimePlanServer
} from "./core/runtime-plan.js";
export {
  buildDoctorRuntimePolicyReport,
  renderDoctorRuntimePolicy,
  renderDoctorRuntimePolicyJson,
  type DoctorRuntimePolicyReport,
  type RuntimePolicyDecision,
  type RuntimePolicyRecommendation
} from "./core/runtime-policy.js";
export {
  buildDoctorReviewBundle,
  renderDoctorReviewBundle,
  renderDoctorReviewBundleJson,
  type BuildDoctorReviewBundleOptions,
  type DoctorReviewBundle,
  type DoctorReviewBundleManifest
} from "./core/review-bundle.js";
export {
  buildDoctorReleaseEvidenceAssetReport,
  buildDoctorReleaseEvidenceReport,
  renderDoctorReleaseEvidenceAsset,
  renderDoctorReleaseEvidenceAssetJson,
  renderDoctorReleaseEvidence,
  renderDoctorReleaseEvidenceJson,
  renderDoctorReleaseEvidenceVerification,
  renderDoctorReleaseEvidenceVerificationJson,
  verifyDoctorReleaseEvidence,
  type BuildDoctorReleaseEvidenceOptions,
  type DoctorReleaseEvidenceAssetReport,
  type DoctorReleaseEvidenceGitMetadata,
  type DoctorReleaseEvidencePackageMetadata,
  type DoctorReleaseEvidenceReport,
  type DoctorReleaseEvidenceVerificationReport
} from "./core/release-evidence.js";
export {
  buildDoctorNpmPackageReport,
  renderDoctorNpmPackageReport,
  renderDoctorNpmPackageReportJson,
  type BuildDoctorNpmPackageReportOptions,
  type DoctorNpmPackageReport
} from "./core/npm-package-doctor.js";
export {
  buildDoctorRiskDiffReport,
  renderDoctorRiskDiffReport,
  renderDoctorRiskDiffReportJson,
  type BuildDoctorRiskDiffReportOptions,
  type DoctorRiskDiffReport,
  type RiskDiffFinding,
  type RiskFindingCategory
} from "./core/risk-diff.js";
export {
  buildDoctorInspectorReport,
  renderDoctorInspectorReport,
  renderDoctorInspectorReportJson,
  type BuildDoctorInspectorReportOptions,
  type DoctorInspectorReport
} from "./core/inspector-bridge.js";
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
