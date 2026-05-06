import type { CheckOptions, CheckResult } from "./domain/types.js";
import { validatePlugin } from "./core/validate-plugin.js";
export {
  buildSecurityAudit,
  renderSecurityAuditJson,
  renderSecurityScorecard,
  type SecurityAudit
} from "./security/security-audit.js";
export {
  buildDoctorSnapshot,
  renderDoctorSnapshot,
  renderDoctorSnapshotJson,
  type DoctorSnapshot
} from "./core/doctor-snapshot.js";
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
