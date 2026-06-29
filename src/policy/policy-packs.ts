import type { DoctorConfig } from "../core/doctor-config.js";
import type { DepAuditReport } from "../core/dep-audit.js";
import type { SecurityAudit } from "../security/security-audit.js";

export const policyPackNames = ["codex-publish", "mcp-strict", "security"] as const;
export type PolicyPackName = (typeof policyPackNames)[number];

export function parsePolicyPack(value: string | null): PolicyPackName | null {
  if (!value) {
    return null;
  }

  return policyPackNames.includes(value as PolicyPackName)
    ? value as PolicyPackName
    : null;
}

export function policyEnablesRuntime(policy: PolicyPackName | null): boolean {
  return policy === "codex-publish" || policy === "mcp-strict";
}

export function policyFailsOnWarnings(policy: PolicyPackName | null): boolean {
  return policy !== null;
}

export function applyPolicyToDoctorConfig(
  config: DoctorConfig,
  policy: PolicyPackName | null
): DoctorConfig {
  if (!policyFailsOnWarnings(policy)) {
    return config;
  }

  return {
    ...config,
    failOnWarnings: true
  };
}

export function applyPolicyToSecurityAudit(
  audit: SecurityAudit,
  policy: PolicyPackName | null
): SecurityAudit {
  if (!policyFailsOnWarnings(policy) || audit.status !== "warn") {
    return audit;
  }

  return {
    ...audit,
    status: "fail"
  };
}

export function applyPolicyToDepAudit(
  report: DepAuditReport,
  policy: PolicyPackName | null
): DepAuditReport {
  if (!policyFailsOnWarnings(policy)) {
    return report;
  }

  if (report.status === "warn") {
    return { ...report, status: "fail" };
  }

  return report;
}
