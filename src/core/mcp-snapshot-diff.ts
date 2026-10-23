import path from "node:path";

import { compareMcpPromptFiles, type McpPromptDiffReport } from "./mcp-prompt-diff.js";
import { inspectMcpPromptFile, type McpPromptFileReport } from "./mcp-prompt-file.js";
import { compareMcpResourceTemplateFiles, type McpResourceTemplateDiffReport } from "./mcp-resource-template-diff.js";
import { inspectMcpResourceTemplateFile, type McpResourceTemplateFileReport } from "./mcp-resource-template-file.js";
import { SNAPSHOT_LIST_FILES, SNAPSHOT_LIST_KEYS, SNAPSHOT_MANIFEST_FILE, type McpSnapshotListKey, type McpSnapshotManifest } from "./mcp-snapshot.js";
import { compareMcpToolFiles, type McpToolDiffReport } from "./mcp-tool-diff.js";
import { inspectMcpToolFile, isBlockedOfflinePath, readBoundedRegularFile, type McpToolFileReport } from "./mcp-tool-file.js";
import type { CatalogStatus } from "./mcp-tool-catalog.js";

type ManifestState = "valid" | "unavailable" | "invalid" | "blocked";
// saved: the snapshot wrote the list; not-offered: the server does not offer it; not-saved: offered but not read completely.
type ListState = "saved" | "not-offered" | "not-saved";

export interface McpSnapshotListDiff<R, F> {
  outcome: "compared" | "list-added" | "list-removed" | "not-offered" | "not-compared";
  // Set for a list that appeared or disappeared; a compared list carries impacts per entry in its diff.
  impact: "breaking" | "compatible" | null;
  before: ListState | null;
  after: ListState | null;
  diff: R | null;
  // The file check of a newly offered list, which has no baseline to be compared with.
  inspection: F | null;
}

export interface McpSnapshotDiffReport {
  schemaVersion: 1;
  scope: "mcp-snapshot-diff";
  status: "pass" | "warn" | "incomplete" | "blocked";
  manifests: { before: ManifestState; after: ManifestState };
  comparison: {
    complete: boolean;
    reason: "input-blocked" | "manifest-unavailable" | "list-not-saved" | "list-incomplete" | null;
    breaking: number | null;
    unclassified: number | null;
  };
  lists: {
    tools: McpSnapshotListDiff<McpToolDiffReport, McpToolFileReport>;
    prompts: McpSnapshotListDiff<McpPromptDiffReport, McpPromptFileReport>;
    resourceTemplates: McpSnapshotListDiff<McpResourceTemplateDiffReport, McpResourceTemplateFileReport>;
  };
  coverage: {
    comparison: "structural-only";
    serverCatalog: "not-tested";
    impactClassification: "heuristic";
  };
}

export interface McpSnapshotDiffOptions {
  showNames?: boolean;
}

const LIST_STATUSES = new Set<CatalogStatus>(["pass", "warn", "fail", "unsupported", "not-applicable", "incomplete", "blocked"]);
const COMPARE = {
  tools: compareMcpToolFiles,
  prompts: compareMcpPromptFiles,
  resourceTemplates: compareMcpResourceTemplateFiles
};
const INSPECT = {
  tools: inspectMcpToolFile,
  prompts: inspectMcpPromptFile,
  resourceTemplates: inspectMcpResourceTemplateFile
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Only the fixed file names are ever read, so a manifest cannot point the comparison at another path.
function parseManifest(value: unknown): McpSnapshotManifest["lists"] | null {
  if (!isJsonObject(value) || value.schemaVersion !== 1 || value.scope !== "mcp-snapshot-manifest" || !isJsonObject(value.lists)) return null;
  const lists = {} as McpSnapshotManifest["lists"];
  for (const key of SNAPSHOT_LIST_KEYS) {
    const entry = value.lists[key];
    if (!isJsonObject(entry) || !LIST_STATUSES.has(entry.status as CatalogStatus)) return null;
    if (entry.file !== null && entry.file !== SNAPSHOT_LIST_FILES[key]) return null;
    lists[key] = { status: entry.status as CatalogStatus, file: entry.file };
  }
  return lists;
}

async function readManifest(directory: string): Promise<{ state: ManifestState; lists: McpSnapshotManifest["lists"] | null }> {
  if (isBlockedOfflinePath(directory)) return { state: "blocked", lists: null };
  const file = await readBoundedRegularFile(path.join(directory, SNAPSHOT_MANIFEST_FILE));
  if (file.kind === "unavailable") return { state: "unavailable", lists: null };
  if (file.kind !== "content") return { state: "invalid", lists: null };
  let lists: McpSnapshotManifest["lists"] | null = null;
  try {
    lists = parseManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.content)));
  } catch {
    lists = null;
  }
  return lists === null ? { state: "invalid", lists: null } : { state: "valid", lists };
}

function listState(entry: McpSnapshotManifest["lists"][McpSnapshotListKey]): ListState {
  if (entry.file !== null) return "saved";
  return entry.status === "not-applicable" ? "not-offered" : "not-saved";
}

/**
 * Compares two snapshot directories written by `doctor mcp-snapshot --save-dir`, list by list. Each
 * manifest says why a list file is present or absent, so a list the server stopped offering is a
 * breaking change and a list that could not be read leaves the comparison incomplete.
 */
export async function compareMcpSnapshotDirectories(
  beforeDirectory: string,
  afterDirectory: string,
  options: McpSnapshotDiffOptions = {}
): Promise<McpSnapshotDiffReport> {
  const [before, after] = await Promise.all([readManifest(beforeDirectory), readManifest(afterDirectory)]);
  const diffOptions = options.showNames === true ? { showNames: true } : {};
  const lists = {} as Record<McpSnapshotListKey, McpSnapshotListDiff<
    McpToolDiffReport | McpPromptDiffReport | McpResourceTemplateDiffReport,
    McpToolFileReport | McpPromptFileReport | McpResourceTemplateFileReport
  >>;

  for (const key of SNAPSHOT_LIST_KEYS) {
    if (before.lists === null || after.lists === null) {
      lists[key] = { outcome: "not-compared", impact: null, before: null, after: null, diff: null, inspection: null };
      continue;
    }
    const beforeState = listState(before.lists[key]);
    const afterState = listState(after.lists[key]);
    const base = { before: beforeState, after: afterState, diff: null, inspection: null };
    const fileName = SNAPSHOT_LIST_FILES[key];
    if (beforeState === "saved" && afterState === "saved") {
      const diff = await COMPARE[key](path.join(beforeDirectory, fileName), path.join(afterDirectory, fileName), diffOptions);
      lists[key] = { outcome: "compared", impact: null, ...base, diff };
    } else if (beforeState === "saved" && afterState === "not-offered") {
      lists[key] = { outcome: "list-removed", impact: "breaking", ...base };
    } else if (beforeState === "not-offered" && afterState === "saved") {
      // Nothing to compare it with, so the new list's definitions are checked on their own.
      lists[key] = { outcome: "list-added", impact: "compatible", ...base, inspection: await INSPECT[key](path.join(afterDirectory, fileName)) };
    } else if (beforeState === "not-offered" && afterState === "not-offered") {
      lists[key] = { outcome: "not-offered", impact: null, ...base };
    } else {
      lists[key] = { outcome: "not-compared", impact: null, ...base };
    }
  }

  const entries = SNAPSHOT_LIST_KEYS.map((key) => lists[key]);
  const reason: McpSnapshotDiffReport["comparison"]["reason"] =
    before.state === "blocked" || after.state === "blocked"
      || entries.some((entry) => entry.diff?.status === "blocked" || entry.inspection?.status === "blocked") ? "input-blocked"
      : before.lists === null || after.lists === null ? "manifest-unavailable"
        : entries.some((entry) => entry.outcome === "not-compared") ? "list-not-saved"
          // A new list whose definitions fail or cannot be read completely is incomplete, like a compared one.
          : entries.some((entry) => (entry.diff !== null && !entry.diff.comparison.complete)
            || (entry.inspection !== null && entry.inspection.status !== "pass" && entry.inspection.status !== "warn")) ? "list-incomplete"
            : null;
  const changed = entries.some((entry) => entry.outcome === "list-added" || entry.outcome === "list-removed" || entry.diff?.status === "warn");
  const complete = reason === null;

  return {
    schemaVersion: 1,
    scope: "mcp-snapshot-diff",
    status: reason === "input-blocked" ? "blocked" : !complete ? "incomplete" : changed ? "warn" : "pass",
    manifests: { before: before.state, after: after.state },
    comparison: {
      complete,
      reason,
      breaking: complete
        ? entries.reduce((total, entry) => total + (entry.outcome === "list-removed" ? 1 : entry.diff?.comparison.breaking ?? 0), 0)
        : null,
      unclassified: complete ? entries.reduce((total, entry) => total + (entry.diff?.comparison.unclassified ?? 0), 0) : null
    },
    lists: lists as McpSnapshotDiffReport["lists"],
    coverage: { comparison: "structural-only", serverCatalog: "not-tested", impactClassification: "heuristic" }
  };
}
