import type { McpPromptDiffReport } from "../core/mcp-prompt-diff.js";
import type { McpResourceTemplateDiffReport } from "../core/mcp-resource-template-diff.js";
import { SNAPSHOT_LIST_KEYS, type McpSnapshotListKey } from "../core/mcp-snapshot.js";
import type { McpSnapshotDiffReport } from "../core/mcp-snapshot-diff.js";
import type { McpToolDiffReport } from "../core/mcp-tool-diff.js";
import { renderMcpPromptDiffMarkdown } from "./render-mcp-prompt-diff-markdown.js";
import { renderMcpResourceTemplateDiffMarkdown } from "./render-mcp-resource-template-diff-markdown.js";
import { hasListDetails } from "./render-mcp-snapshot-diff-report.js";
import { LIST_LABELS } from "./render-mcp-snapshot-report.js";
import { renderMcpToolDiffMarkdown } from "./render-mcp-tool-diff-markdown.js";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value);
}

function outcome(entry: McpSnapshotDiffReport["lists"][McpSnapshotListKey]): string {
  if (entry.outcome === "list-added" || entry.outcome === "list-removed") return `**${entry.outcome}** (${entry.impact})`;
  if (entry.outcome === "not-compared") return entry.before === null ? "not-compared (manifest not read)" : `not-compared (before \`${entry.before}\`, after \`${entry.after}\`)`;
  if (entry.diff === null) return entry.outcome;
  return entry.diff.comparison.complete ? `compared, \`${entry.diff.status}\`` : `compared, \`${entry.diff.status}\` (\`${entry.diff.comparison.reason}\`)`;
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
    })
  ];
  if (report.manifests.before !== "valid" || report.manifests.after !== "valid") {
    lines.push("", `Before manifest: \`${report.manifests.before}\` · After manifest: \`${report.manifests.after}\``);
  }
  for (const key of SNAPSHOT_LIST_KEYS) {
    const diff = report.lists[key].diff;
    if (hasListDetails(diff)) lines.push("", listSection(key, diff));
  }
  lines.push(
    "",
    "A list the server stopped offering is breaking and a newly offered list is compatible. Names appear only with --show-names; URI templates and descriptions are never included."
  );
  return lines.join("\n");
}
