import { packageVersion } from "../version.js";
import {
  buildDoctorRuntimePlan,
  type DoctorRuntimePlan,
  type RuntimePlanServer
} from "./runtime-plan.js";

export type RuntimePolicyDecision = "allow" | "review" | "sandbox_recommended" | "deny";

export interface RuntimePolicyRecommendation {
  decision: RuntimePolicyDecision;
  reason: string;
  actions: string[];
}

export interface DoctorRuntimePolicyReport {
  schemaVersion: "1.0.0";
  kind: "doctor.runtime.policy";
  generatedAt: string;
  version: string;
  targetPath: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  runtimeExecution: "not_started";
  planDigest: string;
  recommendation: RuntimePolicyRecommendation;
  summary: {
    serverCount: number;
    executableServerCount: number;
    highRiskServerCount: number;
    findingCounts: DoctorRuntimePlan["summary"]["findings"];
  };
  servers: Array<{
    name: string;
    decision: RuntimePolicyDecision;
    riskLevel: RuntimePlanServer["riskLevel"];
    reasons: string[];
  }>;
}

const denyFindingIds = new Set([
  "plugin.security.encoded_command",
  "plugin.security.remote_pipe_install",
  "plugin.security.cwd_outside_root",
  "plugin.security.hard_coded_secret",
  "plugin.security.prompt_injection_text",
  "plugin.security.path_traversal"
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function serverDecision(server: RuntimePlanServer): RuntimePolicyDecision {
  if (server.riskReasons.some((reason) => denyFindingIds.has(reason))) {
    return "deny";
  }

  if (server.riskLevel === "high") {
    return "sandbox_recommended";
  }

  if (
    server.riskLevel === "medium" ||
    server.riskReasons.includes("runtime.executes_local_command") ||
    server.riskReasons.includes("runtime.connects_remote_server")
  ) {
    return "review";
  }

  return "allow";
}

function strongestDecision(decisions: RuntimePolicyDecision[]): RuntimePolicyDecision {
  if (decisions.includes("deny")) {
    return "deny";
  }

  if (decisions.includes("sandbox_recommended")) {
    return "sandbox_recommended";
  }

  if (decisions.includes("review")) {
    return "review";
  }

  return "allow";
}

function buildRecommendation(
  plan: DoctorRuntimePlan,
  decision: RuntimePolicyDecision,
  reasons: string[]
): RuntimePolicyRecommendation {
  if (plan.summary.executableServerCount === 0) {
    return {
      decision: "allow",
      reason: "No executable local MCP runtime servers were found.",
      actions: [
        "Use static validation and security checks; runtime probing is not needed for this package."
      ]
    };
  }

  if (decision === "deny") {
    return {
      decision,
      reason: "One or more runtime servers include high-confidence unsafe execution signals.",
      actions: [
        "Do not start runtime probes until deny-level findings are resolved.",
        "Remove encoded commands, remote pipe-to-shell startup, cwd escapes, hard-coded secrets, or prompt-injection text.",
        "Regenerate `doctor runtime-plan` after fixes and review the new approval digest."
      ]
    };
  }

  if (decision === "sandbox_recommended") {
    return {
      decision,
      reason: "Runtime execution has high-risk findings or failed security checks that need isolation before probing.",
      actions: [
        "Prefer an isolated container, VM, or managed sandbox before starting this MCP server.",
        "Keep network egress allowlists explicit and minimal.",
        "Attach the runtime plan digest and review artifact to the release or CI evidence."
      ]
    };
  }

  if (decision === "review") {
    return {
      decision,
      reason: reasons.length > 0
        ? `Runtime probing requires human review: ${unique(reasons).join(", ")}.`
        : "Runtime probing starts local or remote MCP server surfaces and should be explicitly reviewed.",
      actions: [
        "Review command, args, cwd, URL, probe methods, and risk reasons before execution.",
        "Approve the exact plan digest with `check --runtime --require-runtime-approval --runtime-approval-digest <digest>`.",
        "Use `doctor runtime-plan --markdown` when the approval needs to be preserved with release evidence."
      ]
    };
  }

  return {
    decision,
    reason: "Runtime plan is clean and contains only low-risk executable server entries.",
    actions: [
      "Runtime probes can run after normal operator approval.",
      "Keep the runtime plan digest with CI or release evidence when reproducibility matters."
    ]
  };
}

export async function buildDoctorRuntimePolicyReport(
  targetPath: string,
  generatedAt = new Date().toISOString()
): Promise<DoctorRuntimePolicyReport> {
  const plan = await buildDoctorRuntimePlan(targetPath, generatedAt);
  const servers = plan.servers.map((server) => ({
    name: server.name,
    decision: serverDecision(server),
    riskLevel: server.riskLevel,
    reasons: server.riskReasons
  }));
  const findingReasons = plan.findings.map((finding) => finding.id);
  const decision = plan.summary.findings.fail > 0 && servers.length === 0
    ? "deny"
    : strongestDecision(servers.map((server) => server.decision));
  const recommendation = buildRecommendation(
    plan,
    decision,
    unique([...findingReasons, ...servers.flatMap((server) => server.reasons)])
  );
  const status = recommendation.decision === "deny"
    ? "fail"
    : recommendation.decision === "allow"
      ? "pass"
      : "warn";

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.runtime.policy",
    generatedAt,
    version: packageVersion,
    targetPath: plan.targetPath,
    status,
    exitCode: status === "fail" ? 1 : 0,
    runtimeExecution: "not_started",
    planDigest: plan.digest,
    recommendation,
    summary: {
      serverCount: plan.summary.serverCount,
      executableServerCount: plan.summary.executableServerCount,
      highRiskServerCount: plan.summary.highRiskServerCount,
      findingCounts: plan.summary.findings
    },
    servers
  };
}

export function renderDoctorRuntimePolicyJson(report: DoctorRuntimePolicyReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorRuntimePolicy(report: DoctorRuntimePolicyReport): string {
  const lines = [
    "Doctor Runtime Policy",
    "=====================",
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Decision: ${report.recommendation.decision.toUpperCase()}`,
    `Runtime execution: ${report.runtimeExecution}`,
    `Plan digest: ${report.planDigest}`,
    `Servers: ${report.summary.serverCount}`,
    `Executable servers: ${report.summary.executableServerCount}`,
    `High-risk servers: ${report.summary.highRiskServerCount}`,
    "",
    "Reason",
    "------",
    report.recommendation.reason,
    "",
    "Actions",
    "-------"
  ];

  for (const action of report.recommendation.actions) {
    lines.push(`- ${action}`);
  }

  if (report.servers.length > 0) {
    lines.push("", "Servers", "-------");

    for (const server of report.servers) {
      lines.push(`${server.decision.toUpperCase()} ${server.name}`);
      lines.push(`  Risk: ${server.riskLevel}`);
      lines.push(`  Reasons: ${server.reasons.length > 0 ? server.reasons.join(", ") : "none"}`);
    }
  }

  return lines.join("\n");
}
