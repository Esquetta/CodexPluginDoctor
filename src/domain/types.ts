export type FindingSeverity = "warn" | "fail";

export type FindingEvidenceValue = string | number | boolean | null;

export type FindingEvidence = Record<string, FindingEvidenceValue>;

export interface Finding {
  id: string;
  severity: FindingSeverity;
  message: string;
  impact: string;
  suggestedFix: string;
  evidence?: FindingEvidence;
  fingerprint?: string;
}

export interface FindingSuppression {
  reason: string;
  expiresAt: string;
}

export interface SuppressedFinding extends Finding {
  suppression: FindingSuppression;
}

export interface SuppressionSummary {
  applied: number;
  expired: number;
  invalid: number;
}

export interface CheckResult {
  targetPath: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  findings: Finding[];
  suppressedFindings?: SuppressedFinding[];
  suppressionSummary?: SuppressionSummary;
  runtimeScorecard?: RuntimeScorecard;
}

export interface CheckOptions {
  runtime?: boolean;
  runtimeTranscript?: (line: string) => void;
}

export interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
  skills?: string;
  mcpServers?: string;
}

export interface DiscoveredPackage {
  rootPath: string;
  manifestPath: string;
  manifest: PluginManifest;
}

export interface JsonReportSummary {
  targetPath: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  runtimeProbeEnabled: boolean;
  runtimeScorecard?: RuntimeScorecard;
  findingCounts: {
    fail: number;
    warn: number;
    total: number;
  };
}

export interface JsonReport {
  schemaVersion: "1.0.0";
  generatedAt: string;
  summary: JsonReportSummary;
  findings: Finding[];
}

export type RuntimeCapabilityStatus =
  | "pass"
  | "fail"
  | "warn"
  | "skipped"
  | "unsupported";

export interface RuntimeScorecard {
  initialize: RuntimeCapabilityStatus;
  toolsList: RuntimeCapabilityStatus;
  toolsCall: RuntimeCapabilityStatus;
  resourcesList: RuntimeCapabilityStatus;
  resourceRead: RuntimeCapabilityStatus;
  resourceTemplatesList: RuntimeCapabilityStatus;
  promptsList: RuntimeCapabilityStatus;
  promptGet: RuntimeCapabilityStatus;
}

export interface RuntimeProbeResult {
  findings: Finding[];
  scorecard: RuntimeScorecard;
}
