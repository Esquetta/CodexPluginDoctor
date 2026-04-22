export type FindingSeverity = "warn" | "fail";

export interface Finding {
  id: string;
  severity: FindingSeverity;
  message: string;
  impact: string;
  suggestedFix: string;
}

export interface CheckResult {
  targetPath: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  findings: Finding[];
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
