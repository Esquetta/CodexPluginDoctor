import type { McpPromptDiffReport } from "../core/mcp-prompt-diff.js";
import type { McpPromptFileReport } from "../core/mcp-prompt-file.js";
import type { McpResourceTemplateDiffReport } from "../core/mcp-resource-template-diff.js";
import type { McpResourceTemplateFileReport } from "../core/mcp-resource-template-file.js";
import { SNAPSHOT_LIST_KEYS, type McpSnapshotListKey } from "../core/mcp-snapshot.js";
import type { McpSnapshotDiffReport, McpSnapshotListDiff } from "../core/mcp-snapshot-diff.js";
import type { McpToolDiffReport } from "../core/mcp-tool-diff.js";
import type { McpToolFileReport } from "../core/mcp-tool-file.js";
import { renderMcpPromptDiffReport } from "./render-mcp-prompt-diff-report.js";
import { renderMcpPromptFileReport } from "./render-mcp-prompt-file-report.js";
import { renderMcpResourceTemplateDiffReport } from "./render-mcp-resource-template-diff-report.js";
import { renderMcpResourceTemplateFileReport } from "./render-mcp-resource-template-file-report.js";
import { LIST_LABELS } from "./render-mcp-snapshot-report.js";
import { renderMcpToolDiffReport } from "./render-mcp-tool-diff-report.js";
import { renderMcpToolFileReport } from "./render-mcp-tool-file-report.js";

type AnyListDiff = McpSnapshotListDiff<
  McpToolDiffReport | McpPromptDiffReport | McpResourceTemplateDiffReport,
  McpToolFileReport | McpPromptFileReport | McpResourceTemplateFileReport
>;

/** One line per list: the outcome, then the counts of a compared list or the side states of one that was not compared. */
export function describeSnapshotListDiff(entry: AnyListDiff): string {
  if (entry.outcome === "list-added") return `list-added (compatible), definitions ${entry.inspection?.status ?? "not checked"}`;
  if (entry.outcome === "list-removed") return "list-removed (breaking)";
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

// A newly offered list gets its own section only when its definitions have findings or did not pass.
export function hasInspectionDetails(inspection: AnyListDiff["inspection"]): inspection is NonNullable<AnyListDiff["inspection"]> {
  return inspection !== null && (inspection.status !== "pass" || inspection.findings.length > 0);
}

function renderInspection(key: McpSnapshotListKey, inspection: AnyListDiff["inspection"]): string {
  if (key === "tools") return renderMcpToolFileReport(inspection as McpToolFileReport);
  if (key === "prompts") return renderMcpPromptFileReport(inspection as McpPromptFileReport);
  return renderMcpResourceTemplateFileReport(inspection as McpResourceTemplateFileReport);
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
      const { diff, inspection } = report.lists[key];
      if (hasListDetails(diff)) return ["", renderListDiff(key, diff)];
      return hasInspectionDetails(inspection) ? ["", `Added ${LIST_LABELS[key].toLowerCase()} list:`, renderInspection(key, inspection)] : [];
    })
  ].join("\n");
}
