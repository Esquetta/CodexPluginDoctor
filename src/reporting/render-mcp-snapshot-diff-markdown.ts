import type { McpPromptDiffReport } from "../core/mcp-prompt-diff.js";
import type { McpResourceTemplateDiffReport } from "../core/mcp-resource-template-diff.js";
import { SNAPSHOT_LIST_KEYS, type McpSnapshotListKey } from "../core/mcp-snapshot.js";
import { LIST_CAPABILITIES, type McpSnapshotDiffReport } from "../core/mcp-snapshot-diff.js";
import type { McpToolDiffReport } from "../core/mcp-tool-diff.js";
import { renderMcpPromptDiffMarkdown } from "./render-mcp-prompt-diff-markdown.js";
import { renderMcpResourceTemplateDiffMarkdown } from "./render-mcp-resource-template-diff-markdown.js";
import { markdownCodeSpan } from "./quote-server-text.js";
import { hasInspectionDetails, hasListDetails } from "./render-mcp-snapshot-diff-report.js";
import { describeLocation, LIST_LABELS } from "./render-mcp-snapshot-report.js";
import { renderMcpToolDiffMarkdown } from "./render-mcp-tool-diff-markdown.js";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value);
}

function outcome(entry: McpSnapshotDiffReport["lists"][McpSnapshotListKey]): string {
  if (entry.outcome === "list-added") return `**list-added** (compatible), definitions \`${entry.inspection?.status ?? "not checked"}\``;
  if (entry.outcome === "list-removed") return "**list-removed** (breaking)";
  if (entry.outcome === "not-compared") return entry.before === null ? "not-compared (manifest not read)" : `not-compared (before \`${entry.before}\`, after \`${entry.after}\`)`;
  if (entry.diff === null) return entry.outcome;
  return entry.diff.comparison.complete ? `compared, \`${entry.diff.status}\`` : `compared, \`${entry.diff.status}\` (\`${entry.diff.comparison.reason}\`)`;
}

// Protocol versions and the capabilities no list row covers, counted like list entries.
function serverRow(server: McpSnapshotDiffReport["server"]): string {
  if (server.outcome === "not-recorded") return "| Server surface | not-recorded | - | - | - | - | - | - |";
  const of = (...kinds: string[]) => server.changes.filter((change) => kinds.includes(change.kind)).length;
  const offered = (surface: NonNullable<McpSnapshotDiffReport["server"]["before"]>) =>
    [...surface.versions.map((version) => `v:${version}`), ...surface.capabilities.filter((name) => !LIST_CAPABILITIES.has(name)).map((name) => `c:${name}`)];
  const after = new Set(offered(server.after!));
  const unchanged = offered(server.before!).filter((value) => after.has(value)).length;
  const impact = (kind: string) => server.changes.filter((change) => change.impact === kind).length;
  return `| Server surface | compared | ${of("protocol-version-added", "capability-added")} | ${of("protocol-version-removed", "capability-removed")} | ${of("era-changed")} | ${unchanged} | ${impact("breaking")} | ${impact("unclassified")} |`;
}

// Each compared list keeps its own section, one heading level below the snapshot heading.
function listSection(key: McpSnapshotListKey, diff: McpToolDiffReport | McpPromptDiffReport | McpResourceTemplateDiffReport): string {
  const markdown = key === "tools" ? renderMcpToolDiffMarkdown(diff as McpToolDiffReport)
    : key === "prompts" ? renderMcpPromptDiffMarkdown(diff as McpPromptDiffReport)
      : renderMcpResourceTemplateDiffMarkdown(diff as McpResourceTemplateDiffReport);
  return markdown.split("\n").map((line) => (line.startsWith("#") ? `#${line}` : line)).join("\n");
}

export function renderMcpSnapshotDiffMarkdown(report: McpSnapshotDiffReport): string {
  const comparison = report.comparison;
  const lines = [
    "## MCP Snapshot Diff",
    "",
    `**Status:** \`${report.status}\` · **Comparison complete:** ${comparison.complete ? "yes" : "no"}${comparison.reason === null ? "" : ` · **Reason:** \`${comparison.reason}\``}`,
    "",
    "| List | Outcome | Added | Removed | Changed | Unchanged | Breaking | Unclassified |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...SNAPSHOT_LIST_KEYS.map((key) => {
      const entry = report.lists[key];
      const counts = entry.diff?.comparison;
      const breaking = entry.outcome === "list-removed" ? "1" : count(counts?.breaking);
      return `| ${LIST_LABELS[key]} | ${outcome(entry)} | ${count(counts?.added)} | ${count(counts?.removed)} | ${count(counts?.changed)} | ${count(counts?.unchanged)} | ${breaking} | ${count(counts?.unclassified)} |`;
    }),
    serverRow(report.server)
  ];
  if (report.manifests.before !== "valid" || report.manifests.after !== "valid") {
    lines.push("", `Before manifest: \`${report.manifests.before}\` · After manifest: \`${report.manifests.after}\``);
  }
  if (report.server.changes.length > 0) {
    lines.push("", "### Server Surface Changes", "", "| Change | Value | Impact |", "| --- | --- | --- |",
      ...report.server.changes.map((change) => `| ${change.kind} | ${markdownCodeSpan(change.value)} | **${change.impact}** |`));
  }
  for (const key of SNAPSHOT_LIST_KEYS) {
    const { diff, inspection } = report.lists[key];
    if (hasListDetails(diff)) lines.push("", listSection(key, diff));
    if (hasInspectionDetails(inspection)) {
      lines.push(
        "", `### Added ${LIST_LABELS[key]} List`, "",
        `**Definitions:** \`${inspection.status}\`${inspection.inspection.reason === null ? "" : ` · **Reason:** \`${inspection.inspection.reason}\``}`
      );
      if (inspection.findings.length > 0) {
        lines.push("", "| Severity | Finding | Location | Message |", "| --- | --- | --- | --- |",
          ...inspection.findings.map((finding) => `| ${finding.severity} | \`${finding.id}\` | ${finding.location ? describeLocation(key, finding.location) : "-"} | ${finding.message} |`));
      }
    }
  }
  lines.push(
    "",
    "A list the server stopped offering is breaking and a newly offered list is compatible. Tool, prompt, and template names appear only with --show-names; URI templates and descriptions are never included."
  );
  return lines.join("\n");
}
