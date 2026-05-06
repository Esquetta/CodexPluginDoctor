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

export async function runCheck(
  targetPath: string,
  options: CheckOptions = {}
): Promise<CheckResult> {
  return validatePlugin(targetPath, options);
}
