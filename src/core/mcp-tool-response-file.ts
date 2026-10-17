import { randomUUID } from "node:crypto";
import { chmod, lstat, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { McpToolCatalogCache } from "./mcp-tool-catalog.js";
import { isBlockedOfflinePath, MAX_TOOL_FILE_BYTES } from "./mcp-tool-file.js";

export type McpListResponseSaveResult =
  | { kind: "saved"; bytes: number; count: number }
  | { kind: "path-blocked" | "not-regular" | "too-large" | "write-failed" };
type ListKey = "tools" | "prompts";

// Serializes an enumerated catalog as one complete tools/list or prompts/list response that the offline file and diff commands accept.
export function serializeMcpListResponse(key: ListKey, items: unknown[], cache: McpToolCatalogCache): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: `${key}-list`,
    result: { resultType: "complete", [key]: items, ttlMs: cache.ttlMs, cacheScope: cache.cacheScope }
  }, null, 2)}\n`;
}

export async function saveMcpListResponse(
  filePath: string,
  key: ListKey,
  items: unknown[],
  cache: McpToolCatalogCache
): Promise<McpListResponseSaveResult> {
  if (isBlockedOfflinePath(filePath)) return { kind: "path-blocked" };

  let content: string;
  let bytes: number;
  try {
    content = serializeMcpListResponse(key, items, cache);
    bytes = Buffer.byteLength(content);
  } catch {
    return { kind: "write-failed" };
  }
  if (bytes > MAX_TOOL_FILE_BYTES) return { kind: "too-large" };

  let existingMode: number | null = null;
  try {
    const existing = await lstat(filePath);
    if (existing.isSymbolicLink() || !existing.isFile()) return { kind: "not-regular" };
    existingMode = existing.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { kind: "write-failed" };
  }

  // Write beside the target and rename so a failed write never leaves a partial response file.
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    // Create with the replaced baseline's permission bits, which may protect private definitions.
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx", mode: existingMode ?? 0o666 });
    if (existingMode !== null) await chmod(tempPath, existingMode);
    await rename(tempPath, filePath);
  } catch {
    await rm(tempPath, { force: true }).catch(() => undefined);
    return { kind: "write-failed" };
  }
  return { kind: "saved", bytes, count: items.length };
}
