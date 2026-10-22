import type { McpPromptDiffReport } from "../core/mcp-prompt-diff.js";
import type { McpResourceTemplateDiffReport } from "../core/mcp-resource-template-diff.js";
import { SNAPSHOT_LIST_KEYS, type McpSnapshotListKey } from "../core/mcp-snapshot.js";
import type { McpSnapshotDiffReport, McpSnapshotListDiff } from "../core/mcp-snapshot-diff.js";
import type { McpToolDiffReport } from "../core/mcp-tool-diff.js";
import { renderMcpPromptDiffReport } from "./render-mcp-prompt-diff-report.js";
import { renderMcpResourceTemplateDiffReport } from "./render-mcp-resource-template-diff-report.js";
import { LIST_LABELS } from "./render-mcp-snapshot-report.js";
import { renderMcpToolDiffReport } from "./render-mcp-tool-diff-report.js";

type AnyListDiff = McpSnapshotListDiff<McpToolDiffReport | McpPromptDiffReport | McpResourceTemplateDiffReport>;

/** One line per list: the outcome, then the counts of a compared list or the side states of one that was not compared. */
export function describeSnapshotListDiff(entry: AnyListDiff): string {
  if (entry.outcome === "list-added" || entry.outcome === "list-removed") return `${entry.outcome} (${entry.impact})`;
  if (entry.outcome === "not-compared") {
    return entry.before === null ? "not-compared (manifest not read)" : `not-compared (before ${entry.before}, after ${entry.after})`;
  }
  if (entry.diff === null) return entry.outcome;
  const comparison = entry.diff.comparison;
  if (!comparison.complete) return `compared, ${entry.diff.status} (${comparison.reason})`;
  return `compared, ${entry.diff.status} (added ${comparison.added}, removed ${comparison.removed}, changed ${comparison.changed}, unchanged ${comparison.unchanged}, breaking ${comparison.breaking}, unclassified ${comparison.unclassified})`;
}

// A compared list gets its own section only when it has changes, input findings, or an incomplete comparison.
export function hasListDetails(diff: AnyListDiff["diff"]): diff is NonNullable<AnyListDiff["diff"]> {
  return diff !== null && (diff.changes.length > 0 || diff.before.findings.length + diff.after.findings.length > 0 || !diff.comparison.complete);
}

function renderListDiff(key: McpSnapshotListKey, diff: AnyListDiff["diff"]): string {
  if (key === "tools") return renderMcpToolDiffReport(diff as McpToolDiffReport);
  if (key === "prompts") return renderMcpPromptDiffReport(diff as McpPromptDiffReport);
  return renderMcpResourceTemplateDiffReport(diff as McpResourceTemplateDiffReport);
}

export function renderMcpSnapshotDiffReport(report: McpSnapshotDiffReport): string {
  const comparison = report.comparison;
  return [
    "MCP Snapshot Diff",
    "=================",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    `Comparison complete: ${comparison.complete}`,
    ...(comparison.reason === null ? [] : [`Reason: ${comparison.reason}`]),
    `Breaking: ${comparison.breaking ?? "not compared"}`,
    `Unclassified: ${comparison.unclassified ?? "not compared"}`,
    `Before manifest: ${report.manifests.before}`,
    `After manifest: ${report.manifests.after}`,
    ...SNAPSHOT_LIST_KEYS.map((key) => `${LIST_LABELS[key]}: ${describeSnapshotListDiff(report.lists[key])}`),
    "A list the server stopped offering is breaking and a newly offered list is compatible; within a list, impact labels are heuristics, not proof of compatibility.",
    ...SNAPSHOT_LIST_KEYS.flatMap((key) => {
      const diff = report.lists[key].diff;
      return hasListDetails(diff) ? ["", renderListDiff(key, diff)] : [];
    })
  ].join("\n");
}
