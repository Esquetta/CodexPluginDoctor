import type { McpDiscoveryReport } from "../core/mcp-discovery.js";

export function renderMcpDiscoveryReport(report: McpDiscoveryReport): string {
  return [
    "MCP Discovery",
    "=============",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    `Requested protocol: ${report.requestedVersion}`,
    `Advertised versions: ${report.supportedVersions.join(", ") || "not available"}`,
    `Discovery response: ${report.coverage.discovery}`,
    `Runtime: ${report.coverage.runtime}`,
    "Discovery does not establish full protocol conformance or client compatibility.",
    ...report.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.id}: ${finding.message}\n  ${finding.suggestedFix}`)
  ].join("\n");
}
