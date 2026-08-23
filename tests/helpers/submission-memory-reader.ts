import type {
  SubmissionPackageEntry,
  SubmissionPackageEntryKind,
  SubmissionPackageReader
} from "../../src/core/submission-package-reader.js";

type ResolvedEntryKind = Exclude<SubmissionPackageEntryKind, "symlink">;

export interface MemorySubmissionPackageEntry {
  content?: string | Uint8Array;
  kind?: SubmissionPackageEntryKind;
  resolvedKind?: ResolvedEntryKind | null;
  resolvedPackagePath?: string;
  safeResolution?: SubmissionPackageEntry["safeResolution"];
  size?: number;
}

const invalidPackagePathMessage = "Invalid package path.";

function normalizePackagePath(
  packagePath: string,
  allowRoot: boolean,
  allowTrailingSlash = false
): string {
  if (typeof packagePath !== "string") throw new Error(invalidPackagePathMessage);
  if (packagePath === "") {
    if (allowRoot) return "";
    throw new Error(invalidPackagePathMessage);
  }
  if (/[\u0000-\u001F\u007F]/u.test(packagePath)
    || packagePath.startsWith("/")
    || packagePath.startsWith("\\")
    || /^[a-zA-Z]:/u.test(packagePath)
    || packagePath.includes("\\")) {
    throw new Error(invalidPackagePathMessage);
  }
  const pathWithoutTrailingSlash = allowTrailingSlash && packagePath.endsWith("/")
    ? packagePath.slice(0, -1)
    : packagePath;
  const segments = pathWithoutTrailingSlash.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(invalidPackagePathMessage);
  }
  return pathWithoutTrailingSlash;
}

function bytesFor(entry: MemorySubmissionPackageEntry): Uint8Array | null {
  if (entry.content === undefined) return null;
  if (typeof entry.content === "string") return new TextEncoder().encode(entry.content);
  return Uint8Array.from(entry.content);
}

function entryFor(packagePath: string, source: MemorySubmissionPackageEntry): SubmissionPackageEntry {
  const content = bytesFor(source);
  const kind = source.kind ?? (content === null ? "other" : "file");
  return {
    packagePath,
    kind,
    ...(source.resolvedPackagePath === undefined ? {} : { resolvedPackagePath: source.resolvedPackagePath }),
    resolvedKind: source.resolvedKind ?? (kind === "symlink" ? null : kind),
    size: source.size ?? content?.byteLength ?? 0,
    safeResolution: source.safeResolution ?? "safe"
  };
}

export function createMemorySubmissionPackageReader(
  source: Readonly<Record<string, MemorySubmissionPackageEntry>>
): SubmissionPackageReader {
  const entries = new Map<string, MemorySubmissionPackageEntry>();
  for (const [packagePath, entry] of Object.entries(source)) {
    entries.set(normalizePackagePath(packagePath, false), entry);
  }

  return {
    async list(directory: string): Promise<readonly SubmissionPackageEntry[]> {
      const normalizedDirectory = normalizePackagePath(directory, true, true);
      const prefix = normalizedDirectory === "" ? "" : `${normalizedDirectory}/`;
      return [...entries]
        .filter(([packagePath]) => packagePath.startsWith(prefix) && !packagePath.slice(prefix.length).includes("/"))
        .map(([packagePath, entry]) => entryFor(packagePath, entry))
        .sort((left, right) => left.packagePath.localeCompare(right.packagePath));
    },

    async stat(packagePath: string): Promise<SubmissionPackageEntry | null> {
      const normalizedPackagePath = normalizePackagePath(packagePath, false);
      const entry = entries.get(normalizedPackagePath);
      return entry === undefined ? null : entryFor(normalizedPackagePath, entry);
    },

    async read(packagePath: string, maxBytes: number): Promise<Uint8Array | null> {
      const normalizedPackagePath = normalizePackagePath(packagePath, false);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        throw new Error("maxBytes must be a nonnegative safe integer.");
      }
      const sourceEntry = entries.get(normalizedPackagePath);
      if (sourceEntry === undefined) return null;
      const entry = entryFor(normalizedPackagePath, sourceEntry);
      const content = bytesFor(sourceEntry);
      if (entry.resolvedKind !== "file"
        || entry.safeResolution !== "safe"
        || entry.size > maxBytes
        || content === null
        || content.byteLength > maxBytes
        || entry.size !== content.byteLength) return null;
      return Uint8Array.from(content);
    }
  };
}
