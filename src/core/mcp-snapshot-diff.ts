import path from "node:path";

import { compareMcpPromptFiles, type McpPromptDiffReport } from "./mcp-prompt-diff.js";
import { inspectMcpPromptFile, type McpPromptFileReport } from "./mcp-prompt-file.js";
import { compareMcpResourceTemplateFiles, type McpResourceTemplateDiffReport } from "./mcp-resource-template-diff.js";
import { inspectMcpResourceTemplateFile, type McpResourceTemplateFileReport } from "./mcp-resource-template-file.js";
import {
  MAX_SURFACE_CAPABILITIES,
  MAX_SURFACE_NAME_LENGTH,
  MAX_SURFACE_VERSIONS,
  SNAPSHOT_LIST_FILES,
  SNAPSHOT_LIST_KEYS,
  SNAPSHOT_MANIFEST_FILE,
  type McpServerSurface,
  type McpSnapshotListKey,
  type McpSnapshotManifest
} from "./mcp-snapshot.js";
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

export interface McpServerSurfaceChange {
  kind: "era-changed" | "protocol-version-removed" | "protocol-version-added" | "capability-removed" | "capability-added"
    | "instructions-added" | "instructions-removed" | "instructions-changed";
  // A protocol version, a capability name, the eras as "before -> after", or an instructions hash prefix and length.
  value: string;
  impact: "breaking" | "compatible" | "unclassified";
}

export interface McpSnapshotDiffReport {
  schemaVersion: 1;
  scope: "mcp-snapshot-diff";
  status: "pass" | "warn" | "incomplete" | "blocked";
  manifests: { before: ManifestState; after: ManifestState };
  // not-recorded when either manifest has no server surface, such as one written before 1.84.0.
  server: { outcome: "compared" | "not-recorded"; before: McpServerSurface | null; after: McpServerSurface | null; changes: McpServerSurfaceChange[] };
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
// The list rows already report these capabilities, so the server surface leaves them out.
export const LIST_CAPABILITIES = new Set(["tools", "prompts", "resources"]);
const COMPARE = {
  tools: compareMcpToolFiles,
  prompts: compareMcpPromptFiles,
  resourceTemplates: compareMcpResourceTemplateFiles
};
// Each list's offline file check, which also judges a list that has no baseline to be compared with.
export const INSPECT = {
  tools: inspectMcpToolFile,
  prompts: inspectMcpPromptFile,
  resourceTemplates: inspectMcpResourceTemplateFile
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function surfaceNames(value: unknown, max: number): string[] | null {
  return Array.isArray(value) && value.length <= max
    && value.every((name) => typeof name === "string" && name.length > 0 && name.length <= MAX_SURFACE_NAME_LENGTH)
    && new Set(value).size === value.length ? value as string[] : null;
}

// undefined: the manifest predates the server surface; null: the snapshot did not establish it.
function parseServerSurface(value: unknown): McpServerSurface | null | undefined | "invalid" {
  if (value === undefined || value === null) return value;
  if (!isJsonObject(value) || (value.era !== "modern" && value.era !== "legacy")) return "invalid";
  const versions = surfaceNames(value.versions, MAX_SURFACE_VERSIONS);
  const capabilities = surfaceNames(value.capabilities, MAX_SURFACE_CAPABILITIES);
  const instructions = value.instructions;
  const validInstructions = instructions === undefined || instructions === null
    || (isJsonObject(instructions) && typeof instructions.sha256 === "string" && /^[0-9a-f]{64}$/u.test(instructions.sha256)
      && Number.isSafeInteger(instructions.length) && (instructions.length as number) >= 0);
  if (versions === null || capabilities === null || !validInstructions) return "invalid";
  return {
    era: value.era, versions, capabilities,
    ...(instructions === undefined ? {} : { instructions: instructions === null ? null : { sha256: (instructions as { sha256: string }).sha256, length: (instructions as { length: number }).length } })
  };
}

type ParsedManifest = { lists: McpSnapshotManifest["lists"]; server: McpServerSurface | null | undefined };

// Only the fixed file names are ever read, so a manifest cannot point the comparison at another path.
function parseManifest(value: unknown): ParsedManifest | null {
  if (!isJsonObject(value) || value.schemaVersion !== 1 || value.scope !== "mcp-snapshot-manifest" || !isJsonObject(value.lists)) return null;
  const lists = {} as McpSnapshotManifest["lists"];
  for (const key of SNAPSHOT_LIST_KEYS) {
    const entry = value.lists[key];
    if (!isJsonObject(entry) || !LIST_STATUSES.has(entry.status as CatalogStatus)) return null;
    if (entry.file !== null && entry.file !== SNAPSHOT_LIST_FILES[key]) return null;
    lists[key] = { status: entry.status as CatalogStatus, file: entry.file };
  }
  const server = parseServerSurface(value.server);
  return server === "invalid" ? null : { lists, server };
}

export async function readSnapshotManifest(directory: string): Promise<{ state: ManifestState; manifest: ParsedManifest | null }> {
  if (isBlockedOfflinePath(directory)) return { state: "blocked", manifest: null };
  const file = await readBoundedRegularFile(path.join(directory, SNAPSHOT_MANIFEST_FILE));
  if (file.kind === "unavailable") return { state: "unavailable", manifest: null };
  if (file.kind !== "content") return { state: "invalid", manifest: null };
  let manifest: ParsedManifest | null = null;
  try {
    manifest = parseManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.content)));
  } catch {
    manifest = null;
  }
  return manifest === null ? { state: "invalid", manifest: null } : { state: "valid", manifest };
}

// Compares the protocol versions and the capabilities that no list row reports.
function compareServerSurfaces(before: McpServerSurface | null | undefined, after: McpServerSurface | null | undefined): McpSnapshotDiffReport["server"] {
  if (before === null || before === undefined || after === null || after === undefined) {
    return { outcome: "not-recorded", before: before ?? null, after: after ?? null, changes: [] };
  }
  const changes: McpServerSurfaceChange[] = [];
  if (before.era !== after.era) {
    // A legacy server keeps working for clients that negotiate with initialize; a modern one may not.
    changes.push({ kind: "era-changed", value: `${before.era} -> ${after.era}`, impact: after.era === "legacy" ? "breaking" : "unclassified" });
  }
  const difference = (left: string[], right: string[]) => left.filter((value) => !right.includes(value));
  if (before.era === "legacy" && after.era === "legacy") {
    // A legacy surface holds only the version initialize negotiated for the version Doctor requested, so a
    // newer one shows an upgrade and an older one shows that the newer version is no longer accepted.
    const [from, to] = [before.versions[0], after.versions[0]];
    if (from !== undefined && to !== undefined && from !== to) {
      changes.push(to > from ? { kind: "protocol-version-added", value: to, impact: "compatible" } : { kind: "protocol-version-removed", value: from, impact: "breaking" });
    }
  } else {
    for (const value of difference(before.versions, after.versions)) changes.push({ kind: "protocol-version-removed", value, impact: "breaking" });
    for (const value of difference(after.versions, before.versions)) changes.push({ kind: "protocol-version-added", value, impact: "compatible" });
  }
  const capabilities = (surface: McpServerSurface) => surface.capabilities.filter((name) => !LIST_CAPABILITIES.has(name));
  for (const value of difference(capabilities(before), capabilities(after))) changes.push({ kind: "capability-removed", value, impact: "breaking" });
  for (const value of difference(capabilities(after), capabilities(before))) changes.push({ kind: "capability-added", value, impact: "compatible" });
  // Instructions steer the agent, so any change needs a person to read it; surfaces before 1.86.0 have none to compare.
  if (before.instructions !== undefined && after.instructions !== undefined) {
    const [from, to] = [before.instructions, after.instructions];
    const describe = (instructions: { sha256: string; length: number }) => `sha256:${instructions.sha256.slice(0, 12)}, ${instructions.length} characters`;
    if (from === null && to !== null) changes.push({ kind: "instructions-added", value: describe(to), impact: "unclassified" });
    else if (from !== null && to === null) changes.push({ kind: "instructions-removed", value: describe(from), impact: "unclassified" });
    else if (from !== null && to !== null && from.sha256 !== to.sha256) {
      changes.push({ kind: "instructions-changed", value: `${describe(from)} -> ${describe(to)}`, impact: "unclassified" });
    }
  }
  return { outcome: "compared", before, after, changes };
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
  const [beforeRead, afterRead] = await Promise.all([readSnapshotManifest(beforeDirectory), readSnapshotManifest(afterDirectory)]);
  const before = { state: beforeRead.state, lists: beforeRead.manifest?.lists ?? null };
  const after = { state: afterRead.state, lists: afterRead.manifest?.lists ?? null };
  const server = compareServerSurfaces(beforeRead.manifest?.server, afterRead.manifest?.server);
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
  const changed = server.changes.length > 0
    || entries.some((entry) => entry.outcome === "list-added" || entry.outcome === "list-removed" || entry.diff?.status === "warn");
  const serverImpacts = (impact: McpServerSurfaceChange["impact"]) => server.changes.filter((change) => change.impact === impact).length;
  const complete = reason === null;

  return {
    schemaVersion: 1,
    scope: "mcp-snapshot-diff",
    status: reason === "input-blocked" ? "blocked" : !complete ? "incomplete" : changed ? "warn" : "pass",
    manifests: { before: before.state, after: after.state },
    server,
    comparison: {
      complete,
      reason,
      breaking: complete
        ? entries.reduce((total, entry) => total + (entry.outcome === "list-removed" ? 1 : entry.diff?.comparison.breaking ?? 0), serverImpacts("breaking"))
        : null,
      unclassified: complete ? entries.reduce((total, entry) => total + (entry.diff?.comparison.unclassified ?? 0), serverImpacts("unclassified")) : null
    },
    lists: lists as McpSnapshotDiffReport["lists"],
    coverage: { comparison: "structural-only", serverCatalog: "not-tested", impactClassification: "heuristic" }
  };
}
