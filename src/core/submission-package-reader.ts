import {
  lstat,
  open,
  readdir,
  realpath,
  stat
} from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";

export type SubmissionPackageEntryKind = "file" | "directory" | "symlink" | "other";

export interface SubmissionPackageEntry {
  packagePath: string;
  kind: SubmissionPackageEntryKind;
  resolvedKind: Exclude<SubmissionPackageEntryKind, "symlink"> | null;
  size: number;
  safeResolution: "safe" | "outside" | "unavailable";
}

export interface SubmissionPackageReader {
  list(directory: string): Promise<readonly SubmissionPackageEntry[]>;
  stat(packagePath: string): Promise<SubmissionPackageEntry | null>;
  read(packagePath: string, maxBytes: number): Promise<Uint8Array | null>;
}

type ResolvedEntryKind = Exclude<SubmissionPackageEntryKind, "symlink">;
type AncestorResolution = "safe" | "outside" | "unavailable";

const invalidPackagePathMessage = "Invalid package path.";
const invalidMaxBytesMessage = "maxBytes must be a nonnegative safe integer.";

function packageEntryKind(stats: Stats): SubmissionPackageEntryKind {
  if (stats.isFile()) {
    return "file";
  }

  if (stats.isDirectory()) {
    return "directory";
  }

  if (stats.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

function resolvedEntryKind(stats: Stats): ResolvedEntryKind {
  const kind = packageEntryKind(stats);

  return kind === "symlink" ? "other" : kind;
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

function normalizePackagePath(packagePath: string, options: {
  allowRoot: boolean;
  allowTrailingSlash: boolean;
}): string {
  if (typeof packagePath !== "string") {
    throw new Error(invalidPackagePathMessage);
  }

  if (packagePath === "") {
    if (options.allowRoot) {
      return "";
    }

    throw new Error(invalidPackagePathMessage);
  }

  if (/[\u0000-\u001F\u007F]/u.test(packagePath)
    || packagePath.startsWith("/")
    || packagePath.startsWith("\\")
    || /^[a-zA-Z]:/.test(packagePath)
    || packagePath.includes("\\")) {
    throw new Error(invalidPackagePathMessage);
  }

  const pathWithoutTrailingSlash = options.allowTrailingSlash && packagePath.endsWith("/")
    ? packagePath.slice(0, -1)
    : packagePath;
  const segments = pathWithoutTrailingSlash.split("/");

  if (pathWithoutTrailingSlash === ""
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(invalidPackagePathMessage);
  }

  return segments.join("/");
}

function nativePathFor(rootPath: string, packagePath: string): string | null {
  const candidatePath = path.resolve(rootPath, ...packagePath.split("/"));

  return isWithinRoot(rootPath, candidatePath) ? candidatePath : null;
}

function validMaxBytes(maxBytes: number): boolean {
  return Number.isSafeInteger(maxBytes) && maxBytes >= 0;
}

export function createDirectorySubmissionPackageReader(rootPath: string): SubmissionPackageReader {
  const nativeRootPath = path.resolve(rootPath);

  async function canonicalRootPath(): Promise<string | null> {
    try {
      return await realpath(nativeRootPath);
    } catch {
      return null;
    }
  }

  async function ancestorsStayWithinRoot(
    packagePath: string,
    rootCanonicalPath: string
  ): Promise<AncestorResolution> {
    const segments = packagePath.split("/");
    let ancestorPath = nativeRootPath;

    for (const segment of segments.slice(0, -1)) {
      ancestorPath = path.join(ancestorPath, segment);

      try {
        const canonicalAncestorPath = await realpath(ancestorPath);
        if (!isWithinRoot(rootCanonicalPath, canonicalAncestorPath)) {
          return "outside";
        }
      } catch {
        return "unavailable";
      }
    }

    return "safe";
  }

  async function entryFor(packagePath: string): Promise<SubmissionPackageEntry | null> {
    const candidatePath = nativePathFor(nativeRootPath, packagePath);

    if (candidatePath === null) {
      return null;
    }

    try {
      const rootCanonicalPath = await canonicalRootPath();

      if (rootCanonicalPath === null) {
        return null;
      }

      const ancestorResolution = await ancestorsStayWithinRoot(packagePath, rootCanonicalPath);
      if (ancestorResolution === "outside") {
        return {
          packagePath,
          kind: "other",
          resolvedKind: null,
          size: 0,
          safeResolution: "outside"
        };
      }
      if (ancestorResolution === "unavailable") {
        return null;
      }

      const entryStats = await lstat(candidatePath);
      const kind = packageEntryKind(entryStats);

      try {
        const canonicalCandidatePath = await realpath(candidatePath);
        const safeResolution = isWithinRoot(rootCanonicalPath, canonicalCandidatePath);

        if (!safeResolution) {
          return {
            packagePath,
            kind,
            resolvedKind: null,
            size: entryStats.size,
            safeResolution: "outside"
          };
        }

        const targetStats = await stat(candidatePath);

        return {
          packagePath,
          kind,
          resolvedKind: resolvedEntryKind(targetStats),
          size: targetStats.size,
          safeResolution: "safe"
        };
      } catch {
        return kind === "symlink"
          ? {
              packagePath,
              kind,
              resolvedKind: null,
              size: entryStats.size,
              safeResolution: "unavailable"
            }
          : null;
      }
    } catch {
      return null;
    }
  }

  return {
    async list(directory: string): Promise<readonly SubmissionPackageEntry[]> {
      const normalizedDirectory = normalizePackagePath(directory, {
        allowRoot: true,
        allowTrailingSlash: true
      });
      const directoryPath = normalizedDirectory === ""
        ? nativeRootPath
        : nativePathFor(nativeRootPath, normalizedDirectory);

      if (directoryPath === null) {
        return [];
      }

      try {
        if (normalizedDirectory !== "") {
          const directoryEntry = await entryFor(normalizedDirectory);

          if (directoryEntry?.resolvedKind !== "directory" || directoryEntry.safeResolution !== "safe") {
            return [];
          }
        } else if (await canonicalRootPath() === null) {
          return [];
        }

        const childNames = await readdir(directoryPath);
        const entries: Array<SubmissionPackageEntry | null> = new Array(childNames.length).fill(null);
        let nextChildIndex = 0;

        async function readNextChild(): Promise<void> {
          while (nextChildIndex < childNames.length) {
            const childIndex = nextChildIndex;
            nextChildIndex += 1;
            const childName = childNames[childIndex];
            const childPackagePath = normalizedDirectory === ""
              ? childName
              : `${normalizedDirectory}/${childName}`;

            try {
              const normalizedChildPath = normalizePackagePath(childPackagePath, {
                allowRoot: false,
                allowTrailingSlash: false
              });
              entries[childIndex] = await entryFor(normalizedChildPath);
            } catch {
              entries[childIndex] = null;
            }
          }
        }

        const workerCount = Math.min(16, childNames.length);
        const workers = Array.from({ length: workerCount }, async () => readNextChild());
        await Promise.all(workers);

        return entries
          .filter((entry): entry is SubmissionPackageEntry => entry !== null)
          .sort((left, right) => left.packagePath.localeCompare(right.packagePath));
      } catch {
        return [];
      }
    },

    async stat(packagePath: string): Promise<SubmissionPackageEntry | null> {
      return entryFor(normalizePackagePath(packagePath, {
        allowRoot: false,
        allowTrailingSlash: false
      }));
    },

    async read(packagePath: string, maxBytes: number): Promise<Uint8Array | null> {
      const normalizedPackagePath = normalizePackagePath(packagePath, {
        allowRoot: false,
        allowTrailingSlash: false
      });

      if (!validMaxBytes(maxBytes)) {
        throw new Error(invalidMaxBytesMessage);
      }

      const entry = await entryFor(normalizedPackagePath);

      if (entry?.resolvedKind !== "file" || entry.safeResolution !== "safe" || entry.size > maxBytes) {
        return null;
      }

      const candidatePath = nativePathFor(nativeRootPath, normalizedPackagePath);

      if (candidatePath === null) {
        return null;
      }

      let fileHandle: Awaited<ReturnType<typeof open>> | null = null;

      try {
        fileHandle = await open(candidatePath, "r");
        const handleStats = await fileHandle.stat();

        if (!handleStats.isFile()
          || !Number.isSafeInteger(handleStats.size)
          || handleStats.size < 0
          || handleStats.size > maxBytes) {
          return null;
        }

        const rootCanonicalPath = await canonicalRootPath();
        const canonicalCandidatePath = await realpath(candidatePath);
        const pathStats = await stat(candidatePath);

        if (rootCanonicalPath === null
          || !isWithinRoot(rootCanonicalPath, canonicalCandidatePath)
          || !pathStats.isFile()
          || handleStats.dev !== pathStats.dev
          || handleStats.ino !== pathStats.ino) {
          return null;
        }

        const content = Buffer.alloc(handleStats.size);
        let offset = 0;

        while (offset < content.length) {
          const { bytesRead } = await fileHandle.read(content, offset, content.length - offset, offset);
          if (bytesRead === 0) {
            return null;
          }
          offset += bytesRead;
        }

        const probe = Buffer.alloc(1);
        const { bytesRead: extraBytesRead } = await fileHandle.read(probe, 0, 1, offset);
        if (extraBytesRead !== 0) {
          return null;
        }

        return Uint8Array.from(content);
      } catch {
        return null;
      } finally {
        await fileHandle?.close().catch(() => undefined);
      }
    }
  };
}
