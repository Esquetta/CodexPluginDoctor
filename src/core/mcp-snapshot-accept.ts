import { lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { SNAPSHOT_LIST_FILES, SNAPSHOT_LIST_KEYS, SNAPSHOT_MANIFEST_FILE, type McpSnapshotListKey, type McpSnapshotManifest } from "./mcp-snapshot.js";
import { INSPECT, readSnapshotManifest } from "./mcp-snapshot-diff.js";
import { isBlockedOfflinePath, readBoundedRegularFile } from "./mcp-tool-file.js";
import { saveLocalFile } from "./mcp-tool-response-file.js";

export type McpSnapshotAcceptResult =
  | { kind: "accepted"; lists: Record<McpSnapshotListKey, "copied" | "not-offered">; removed: string[]; server: boolean }
  // refused: nothing in the baseline changed; failed: a write stopped partway and the baseline has no manifest.
  | { kind: "refused" | "failed"; reason: string };

const LABELS: Record<McpSnapshotListKey, string> = { tools: "tool", prompts: "prompt", resourceTemplates: "resource template" };
const WRITE_FAILURES = {
  "path-blocked": "the path is not a local file path",
  "not-regular": "the existing target is not a regular file",
  "too-large": "it exceeds the one MiB file limit",
  "write-failed": "it could not be written"
};

// Succeeds when nothing is at the path or a regular file is, which may then be replaced or removed.
async function replaceable(filePath: string): Promise<boolean> {
  try {
    const existing = await lstat(filePath);
    return existing.isFile() && !existing.isSymbolicLink();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function exists(filePath: string): Promise<boolean> {
  return lstat(filePath).then(() => true, () => false);
}

/**
 * Makes a snapshot directory written by `doctor mcp-snapshot --save-dir` the baseline: the list files its
 * manifest names, each of which must pass its file check, then the manifest. Baseline list files the
 * manifest does not name are removed, and no other file is read or written.
 */
export async function acceptMcpSnapshot(snapshotDirectory: string, baselineDirectory: string): Promise<McpSnapshotAcceptResult> {
  if (isBlockedOfflinePath(snapshotDirectory) || isBlockedOfflinePath(baselineDirectory)) {
    return { kind: "refused", reason: "The snapshot and baseline directories must be local paths." };
  }
  if (path.resolve(snapshotDirectory) === path.resolve(baselineDirectory)) {
    return { kind: "refused", reason: "The snapshot directory is already the baseline directory." };
  }
  const { state, manifest } = await readSnapshotManifest(snapshotDirectory);
  if (manifest === null) {
    return { kind: "refused", reason: `The snapshot directory has no valid ${SNAPSHOT_MANIFEST_FILE} (${state}).` };
  }

  // Every check runs before the baseline changes, so a refused snapshot leaves it as it was.
  const contents = new Map<McpSnapshotListKey, string>();
  for (const key of SNAPSHOT_LIST_KEYS) {
    const { status, file } = manifest.lists[key];
    if (file === null) {
      if (status !== "not-applicable") {
        return { kind: "refused", reason: `The ${LABELS[key]} list was offered but not saved (status ${status}); take the snapshot again.` };
      }
      continue;
    }
    const filePath = path.join(snapshotDirectory, file);
    const inspection = await INSPECT[key](filePath);
    const read = await readBoundedRegularFile(filePath);
    if (inspection.status !== "pass" && inspection.status !== "warn") {
      return { kind: "refused", reason: `The ${LABELS[key]} list in the snapshot did not pass its file check (status ${inspection.status}).` };
    }
    if (read.kind !== "content") {
      return { kind: "refused", reason: `The ${LABELS[key]} list in the snapshot could not be read (${read.kind}).` };
    }
    contents.set(key, read.content.toString("utf8"));
  }
  for (const fileName of [...Object.values(SNAPSHOT_LIST_FILES), SNAPSHOT_MANIFEST_FILE]) {
    if (!(await replaceable(path.join(baselineDirectory, fileName)))) {
      return { kind: "refused", reason: `${fileName} in the baseline directory is not a regular file.` };
    }
  }

  try {
    await mkdir(baselineDirectory, { recursive: true });
    // Without its manifest, a baseline that a failed write leaves half updated is never compared as complete.
    await rm(path.join(baselineDirectory, SNAPSHOT_MANIFEST_FILE), { force: true });
  } catch {
    return { kind: "failed", reason: "The baseline directory could not be prepared." };
  }
  const lists = {} as Record<McpSnapshotListKey, "copied" | "not-offered">;
  const removed: string[] = [];
  for (const key of SNAPSHOT_LIST_KEYS) {
    const target = path.join(baselineDirectory, SNAPSHOT_LIST_FILES[key]);
    const content = contents.get(key);
    if (content === undefined) {
      lists[key] = "not-offered";
      if (await exists(target)) {
        try {
          await rm(target);
        } catch {
          return { kind: "failed", reason: `${SNAPSHOT_LIST_FILES[key]} could not be removed from the baseline directory.` };
        }
        removed.push(SNAPSHOT_LIST_FILES[key]);
      }
      continue;
    }
    const saved = await saveLocalFile(target, content);
    if (saved.kind !== "saved") return { kind: "failed", reason: `${SNAPSHOT_LIST_FILES[key]} was not written because ${WRITE_FAILURES[saved.kind]}.` };
    lists[key] = "copied";
  }
  const written: McpSnapshotManifest = {
    schemaVersion: 1,
    scope: "mcp-snapshot-manifest",
    lists: manifest.lists,
    ...(manifest.server === undefined ? {} : { server: manifest.server })
  };
  const saved = await saveLocalFile(path.join(baselineDirectory, SNAPSHOT_MANIFEST_FILE), `${JSON.stringify(written, null, 2)}\n`);
  if (saved.kind !== "saved") return { kind: "failed", reason: `${SNAPSHOT_MANIFEST_FILE} was not written because ${WRITE_FAILURES[saved.kind]}.` };
  return { kind: "accepted", lists, removed, server: manifest.server !== undefined && manifest.server !== null };
}
