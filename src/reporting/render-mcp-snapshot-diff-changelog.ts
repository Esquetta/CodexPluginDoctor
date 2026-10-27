import { SNAPSHOT_LIST_KEYS, type McpSnapshotListKey } from "../core/mcp-snapshot.js";
import type { McpServerSurfaceChange, McpSnapshotDiffReport } from "../core/mcp-snapshot-diff.js";
import { markdownCodeSpan } from "./quote-server-text.js";
import { describeSnapshotListDiff } from "./render-mcp-snapshot-diff-report.js";
import { LIST_LABELS } from "./render-mcp-snapshot-report.js";

type Section = "breaking" | "review" | "compatible";

const NOUNS: Record<McpSnapshotListKey, { one: string; many: string }> = {
  tools: { one: "tool", many: "tools" },
  prompts: { one: "prompt", many: "prompts" },
  resourceTemplates: { one: "resource template", many: "resource templates" }
};
const SECTIONS: Array<[Section, string]> = [["breaking", "Breaking"], ["review", "Needs review"], ["compatible", "Compatible"]];

function section(impact: "breaking" | "compatible" | "unclassified"): Section {
  return impact === "breaking" ? "breaking" : impact === "compatible" ? "compatible" : "review";
}

// The notes are list items, not table cells, so a pipe in a name needs no escape.
const code = (text: string) => markdownCodeSpan(text, { table: false });

function serverEntry(change: McpServerSurfaceChange): string {
  const value = code(change.value);
  switch (change.kind) {
    case "protocol-version-removed": return `Dropped protocol version ${value}`;
    case "protocol-version-added": return `Added protocol version ${value}`;
    case "capability-removed": return `Dropped the ${value} capability`;
    case "capability-added": return `Added the ${value} capability`;
    case "era-changed": return `Protocol era changed: ${value}`;
    case "instructions-added": return `Added server instructions (${value})`;
    case "instructions-removed": return `Removed server instructions (${value})`;
    case "instructions-changed": return `Changed server instructions (${value})`;
  }
}

/**
 * Release notes for a server's maintainer: every change once under Breaking, Needs review, or Compatible,
 * with tool, prompt, and template names. The report must come from a comparison made with names.
 */
export function renderMcpSnapshotDiffChangelog(report: McpSnapshotDiffReport): string {
  const entries: Record<Section, string[]> = { breaking: [], review: [], compatible: [] };
  const notCompared: string[] = [];

  for (const change of report.server.changes) entries[section(change.impact)].push(serverEntry(change));
  for (const key of SNAPSHOT_LIST_KEYS) {
    const entry = report.lists[key];
    const noun = NOUNS[key];
    if (entry.outcome === "list-removed") entries.breaking.push(`Stopped offering ${noun.many}`);
    if (entry.outcome === "list-added") {
      const status = entry.inspection?.status;
      // A new list that fails or cannot be read leaves the comparison incomplete, so it is listed as not compared.
      if (status === "pass") entries.compatible.push(`Started offering ${noun.many}`);
      else if (status === "warn") entries.review.push(`Started offering ${noun.many}, whose definitions have warnings`);
      else notCompared.push(`${LIST_LABELS[key]}: ${describeSnapshotListDiff(entry)}`);
    }
    if (entry.outcome === "not-compared" || (entry.diff !== null && !entry.diff.comparison.complete)) {
      notCompared.push(`${LIST_LABELS[key]}: ${describeSnapshotListDiff(entry)}`);
    }
    const changes = entry.diff?.comparison.complete ? entry.diff.changes : [];
    for (const change of changes) {
      const name = change.name === undefined ? "(unnamed)" : code(change.name);
      // An added or removed entry's reason only repeats the verb.
      const reasons = change.kind !== "changed" || change.reasons.length === 0 ? "" : ` (${change.reasons.map((reason) => `\`${reason}\``).join(", ")})`;
      const verb = change.kind === "added" ? "Added" : change.kind === "removed" ? "Removed" : "Changed";
      entries[section(change.impact)].push(`${verb} ${noun.one} ${name}${reasons}`);
    }
    // Input warnings fail --fail-on any without changing a definition, so they are named too.
    if (entry.diff?.comparison.complete && entry.diff.status === "warn" && changes.length === 0) {
      entries.review.push(`The ${noun.one} lists have input warnings`);
    }
  }

  const lines = ["## MCP surface changes", ""];
  if (!report.comparison.complete) {
    lines.push("**The comparison is incomplete**, so these notes may miss changes.", "");
    if (notCompared.length > 0) lines.push("### Not compared", "", ...notCompared.map((item) => `- ${item}`), "");
  }
  if (report.server.outcome === "not-recorded") {
    lines.push("The server surface was not recorded in both snapshots, so protocol versions and capabilities were not compared.", "");
  }
  const sections = SECTIONS.filter(([key]) => entries[key].length > 0);
  if (sections.length === 0) lines.push(report.comparison.complete ? "No changes to the MCP surface." : "No changes in the lists that were compared.");
  for (const [key, title] of sections) lines.push(`### ${title}`, "", ...entries[key].map((item) => `- ${item}`), "");
  return lines.join("\n").trimEnd();
}
