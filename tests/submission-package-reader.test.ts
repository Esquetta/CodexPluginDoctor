import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDirectorySubmissionPackageReader,
  type SubmissionPackageReader
} from "../src/core/submission-package-reader.js";

const temporaryDirectories: string[] = [];
const fileSymlinkIt = process.platform === "win32" ? it.skip : it;
const unsafeNameIt = process.platform === "linux" ? it : it.skip;

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createReaderFixture(): Promise<{
  rootPath: string;
  reader: SubmissionPackageReader;
}> {
  const rootPath = await createTemporaryDirectory("submission-package-reader-");

  await Promise.all([
    writeFile(path.join(rootPath, "z-last.txt"), "z"),
    writeFile(path.join(rootPath, "a-first.txt"), "first"),
    mkdir(path.join(rootPath, "nested")),
    mkdir(path.join(rootPath, "empty"))
  ]);
  await writeFile(path.join(rootPath, "nested", "child.txt"), "nested");

  return {
    rootPath,
    reader: createDirectorySubmissionPackageReader(rootPath)
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50
  })));
});

describe("directory submission package reader", () => {
  it("lists normalized immediate child package paths in sorted order", async () => {
    const { reader } = await createReaderFixture();

    await expect(reader.list("")) .resolves.toEqual([
      expect.objectContaining({ packagePath: "a-first.txt", kind: "file" }),
      expect.objectContaining({ packagePath: "empty", kind: "directory" }),
      expect.objectContaining({ packagePath: "nested", kind: "directory" }),
      expect.objectContaining({ packagePath: "z-last.txt", kind: "file" })
    ]);
    await expect(reader.list("nested/")) .resolves.toEqual([
      expect.objectContaining({ packagePath: "nested/child.txt", kind: "file" })
    ]);
  });

  it("does not recursively include descendants when listing a directory", async () => {
    const { reader } = await createReaderFixture();

    const entries = await reader.list("");

    expect(entries.map((entry) => entry.packagePath)).not.toContain("nested/child.txt");
  });

  it("returns complete sorted listings with bounded metadata workers", async () => {
    const { rootPath, reader } = await createReaderFixture();
    const bulkNames = Array.from(
      { length: 300 },
      (_, index) => `bulk-${String(index).padStart(3, "0")}.txt`
    );

    for (const name of bulkNames) {
      await writeFile(path.join(rootPath, name), name);
    }

    const listedPaths = (await reader.list("")).map((entry) => entry.packagePath);
    const expectedPaths = [
      "a-first.txt",
      "empty",
      "nested",
      "z-last.txt",
      ...bulkNames
    ].sort((left, right) => left.localeCompare(right));

    expect(listedPaths).toEqual(expectedPaths);
    expect(new Set(listedPaths).size).toBe(listedPaths.length);
  });

  it("returns list entries that round-trip through stat", async () => {
    const { reader } = await createReaderFixture();
    const entries = await reader.list("");

    for (const entry of entries) {
      await expect(reader.stat(entry.packagePath)).resolves.not.toBeNull();
    }
  });

  unsafeNameIt("filters unsafe native child names from package listings", async () => {
    const { rootPath, reader } = await createReaderFixture();
    const unsafeNames = [
      "a\\b",
      "C:entry",
      `control${String.fromCharCode(1)}entry`
    ];

    await Promise.all(unsafeNames.map(async (name) => writeFile(path.join(rootPath, name), "unsafe")));

    const listedPaths = (await reader.list("")).map((entry) => entry.packagePath);
    for (const unsafeName of unsafeNames) {
      expect(listedPaths).not.toContain(unsafeName);
    }
  });

  it("returns null for missing stat and read targets", async () => {
    const { reader } = await createReaderFixture();

    await expect(reader.stat("missing.txt")).resolves.toBeNull();
    await expect(reader.read("missing.txt", 10)).resolves.toBeNull();
  });

  it("reports file and directory kinds with safe resolution", async () => {
    const { reader } = await createReaderFixture();

    await expect(reader.stat("a-first.txt")).resolves.toEqual({
      packagePath: "a-first.txt",
      kind: "file",
      resolvedKind: "file",
      size: 5,
      safeResolution: "safe"
    });
    await expect(reader.stat("nested")).resolves.toEqual({
      packagePath: "nested",
      kind: "directory",
      resolvedKind: "directory",
      size: expect.any(Number),
      safeResolution: "safe"
    });
  });

  fileSymlinkIt("reports contained symlinks without exposing their native targets", async () => {
    const { rootPath, reader } = await createReaderFixture();
    await symlink(path.join(rootPath, "a-first.txt"), path.join(rootPath, "contained-link.txt"), "file");

    const entry = await reader.stat("contained-link.txt");

    expect(entry).toEqual({
      packagePath: "contained-link.txt",
      kind: "symlink",
      resolvedKind: "file",
      size: expect.any(Number),
      safeResolution: "safe"
    });
    expect(JSON.stringify(entry)).not.toContain(rootPath);
    await expect(reader.read("contained-link.txt", 5)).resolves.toEqual(new Uint8Array([102, 105, 114, 115, 116]));
  });

  it("marks an external directory junction as outside without reading target metadata", async () => {
    const { rootPath, reader } = await createReaderFixture();
    const outsideRoot = await createTemporaryDirectory("submission-package-reader-outside-");
    await writeFile(path.join(outsideRoot, "private.txt"), "outside");
    await symlink(outsideRoot, path.join(rootPath, "outside-link"), "junction");

    await expect(reader.stat("outside-link")).resolves.toEqual({
      packagePath: "outside-link",
      kind: "symlink",
      resolvedKind: null,
      size: expect.any(Number),
      safeResolution: "outside"
    });
    await expect(reader.read("outside-link", 100)).resolves.toBeNull();
    await expect(reader.stat("outside-link/private.txt")).resolves.toBeNull();
    await expect(reader.read("outside-link/private.txt", 100)).resolves.toBeNull();
    await expect(reader.list("outside-link")).resolves.toEqual([]);
  });

  fileSymlinkIt("marks broken links as unavailable", async () => {
    const { rootPath, reader } = await createReaderFixture();
    await symlink(path.join(rootPath, "missing-target.txt"), path.join(rootPath, "broken-link.txt"), "file");

    await expect(reader.stat("broken-link.txt")).resolves.toEqual({
      packagePath: "broken-link.txt",
      kind: "symlink",
      resolvedKind: null,
      size: expect.any(Number),
      safeResolution: "unavailable"
    });
  });

  it.each([
    ["../secret"],
    ["nested/../a-first.txt"],
    ["/absolute.txt"],
    ["C:/drive.txt"],
    ["\\\\server\\share\\file.txt"],
    ["nested//child.txt"],
    ["nested/./child.txt"],
    ["nested/\u0000child.txt"],
    [""]
  ])("rejects unsafe stat and read package paths without host-path disclosure: %j", async (packagePath) => {
    const { rootPath, reader } = await createReaderFixture();

    await expect(reader.stat(packagePath)).rejects.toThrow("Invalid package path.");
    await expect(reader.read(packagePath, 10)).rejects.toThrow("Invalid package path.");
    await expect(reader.stat(packagePath)).rejects.not.toThrow(rootPath);
  });

  it.each([
    ["../secret"],
    ["/absolute"],
    ["C:/drive"],
    ["\\\\server\\share"],
    ["nested//child"],
    ["nested/./child"],
    ["nested/\u0000child"]
  ])("rejects unsafe list package paths without host-path disclosure: %j", async (packagePath) => {
    const { rootPath, reader } = await createReaderFixture();

    await expect(reader.list(packagePath)).rejects.toThrow("Invalid package path.");
    await expect(reader.list(packagePath)).rejects.not.toThrow(rootPath);
  });

  it("rejects invalid read limits and stops oversize content before reading", async () => {
    const { rootPath, reader } = await createReaderFixture();
    const filePath = path.join(rootPath, "a-first.txt");

    for (const maxBytes of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(reader.read("a-first.txt", maxBytes)).rejects.toThrow(
        "maxBytes must be a nonnegative safe integer."
      );
    }

    await expect(reader.read("a-first.txt", 4)).resolves.toBeNull();
    await rm(filePath);
    await expect(reader.read("a-first.txt", 4)).resolves.toBeNull();
  });

  it("reads exactly at the size boundary and returns a fresh byte array", async () => {
    const { reader } = await createReaderFixture();

    const firstRead = await reader.read("a-first.txt", 5);
    const secondRead = await reader.read("a-first.txt", 5);

    expect(firstRead).toBeInstanceOf(Uint8Array);
    expect(firstRead && new TextDecoder().decode(firstRead)).toBe("first");
    expect(secondRead && new TextDecoder().decode(secondRead)).toBe("first");
    if (firstRead === null || secondRead === null) {
      throw new Error("Expected readable fixture file.");
    }
    firstRead[0] = 0;
    expect(secondRead[0]).toBe("f".charCodeAt(0));
  });

  it("keeps native root paths out of successful entries and expected error messages", async () => {
    const { rootPath, reader } = await createReaderFixture();
    const entries = await reader.list("");

    expect(JSON.stringify(entries)).not.toContain(rootPath);
    await expect(reader.list("../outside")).rejects.toThrow("Invalid package path.");
  });
});
