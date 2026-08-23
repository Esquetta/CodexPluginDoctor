import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectSubmissionArchive } from "../src/core/submission-archive-reader.js";
import { createZipFixture, crc32 } from "./helpers/zip-fixture.js";

const temporaryDirectories: string[] = [];

async function inspectFixture(content: Uint8Array, name = "plugin.zip") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-reader-"));
  temporaryDirectories.push(directory);
  const archivePath = path.join(directory, name);
  await writeFile(archivePath, content);
  return inspectSubmissionArchive(archivePath);
}

async function inspectSparseArchive(size: number) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-reader-size-"));
  temporaryDirectories.push(directory);
  const archivePath = path.join(directory, "plugin.zip");
  await writeFile(archivePath, new Uint8Array([0]));
  await truncate(archivePath, size);
  return inspectSubmissionArchive(archivePath);
}

function findingIds(inspection: Awaited<ReturnType<typeof inspectSubmissionArchive>>): string[] {
  return inspection.findings.map((finding) => finding.id);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50
  })));
});

describe("submission archive reader", () => {
  it("accepts stored and deflated entries with EOCD comments and exposes a reader only after the safety pass", async () => {
    const inspection = await inspectFixture(createZipFixture([
      { name: ".codex-plugin/plugin.json", content: "{}", method: 0 },
      { name: "skills/check/SKILL.md", content: "# check", method: 8 }
    ], { comment: "safe comment" }));

    expect(inspection.findings).toEqual([]);
    expect(inspection.reader).not.toBeNull();
    expect(inspection.entries.map((entry) => entry.packagePath)).toEqual([
      ".codex-plugin/plugin.json", "skills/check/SKILL.md"
    ]);
    await expect(inspection.reader?.read("skills/check/SKILL.md", 100)).resolves.toEqual(new TextEncoder().encode("# check"));
  });

  it("rejects non-ZIP, empty, truncated, multi-disk, and encrypted inputs without throwing", async () => {
    for (const [name, content] of [
      ["not-a-zip.txt", new Uint8Array([1])],
      ["empty.zip", new Uint8Array()],
      ["truncated.zip", createZipFixture([{ name: "a.txt", content: "a" }]).subarray(0, 15)],
      ["multi.zip", createZipFixture([{ name: "a.txt", content: "a" }], { diskNumber: 1 })],
      ["encrypted.zip", createZipFixture([{ name: "a.txt", content: "a", flags: 1 }])]
    ] as const) {
      const inspection = await inspectFixture(content, name);
      expect(inspection.reader).toBeNull();
      expect(inspection.findings.length).toBeGreaterThan(0);
    }
  });

  it("rejects invalid entry paths without retaining unsafe raw names", async () => {
    const inspection = await inspectFixture(createZipFixture([
      { name: "../private.txt", content: "secret" },
      { name: "safe\\windows.txt", content: "secret" },
      { name: "/absolute.txt", content: "secret" }
    ]));

    expect(findingIds(inspection)).toContain("plugin.submission.archive.path_invalid");
    expect(JSON.stringify(inspection)).not.toContain("../private.txt");
    expect(JSON.stringify(inspection)).not.toContain("safe\\windows.txt");
    expect(JSON.stringify(inspection)).not.toContain("secret");
    expect(inspection.reader).toBeNull();
  });

  it("rejects central and local name, method, and metadata mismatches", async () => {
    const inspection = await inspectFixture(createZipFixture([
      { name: "safe.txt", localName: "other.txt", content: "body" },
      { name: "method.txt", content: "body", method: 8, localCompressedSize: 2 }
    ]));

    expect(findingIds(inspection)).toContain("plugin.submission.archive.header_mismatch");
    expect(inspection.reader).toBeNull();
  });

  it("reports unsupported compression as unavailable coverage without treating the archive as malformed", async () => {
    const inspection = await inspectFixture(createZipFixture([{ name: "unsupported.bin", content: "data", method: 12 }]));

    expect(inspection.findings).toEqual([]);
    expect(inspection.reader).toBeNull();
    expect(inspection.coverage).toContainEqual(expect.objectContaining({
      id: "plugin.submission.archive.compression_method",
      status: "unavailable"
    }));
  });

  it("rejects declared CRC and output-size mismatches even for entries no nested validator requests", async () => {
    const inspection = await inspectFixture(createZipFixture([
      { name: "unused.txt", content: "unrequested", centralCrc32: 0x12345678, localCrc32: 0x12345678 },
      { name: "size.txt", content: "size", centralUncompressedSize: 3 }
    ]));

    expect(findingIds(inspection)).toContain("plugin.submission.archive.crc_mismatch");
    expect(findingIds(inspection)).toContain("plugin.submission.archive.header_mismatch");
    expect(inspection.reader).toBeNull();
  });

  it("rejects duplicate paths, file-directory conflicts, and unsafe type metadata", async () => {
    const inspection = await inspectFixture(createZipFixture([
      { name: "same.txt", content: "one" },
      { name: "same.txt", content: "two" },
      { name: "parent", content: "file" },
      { name: "parent/child.txt", content: "child" },
      { name: "link", content: "target", externalFileAttributes: 0o120777 << 16 }
    ]));

    expect(findingIds(inspection)).toContain("plugin.submission.archive.path_duplicate");
    expect(findingIds(inspection)).toContain("plugin.submission.archive.path_conflict");
    expect(findingIds(inspection)).toContain("plugin.submission.archive.type_unsupported");
    expect(inspection.reader).toBeNull();
  });

  it("supports signed and unsigned data descriptors and rejects a missing descriptor", async () => {
    const valid = await inspectFixture(createZipFixture([
      { name: "signed.txt", content: "signed", descriptor: "signed-32" },
      { name: "unsigned.txt", content: "unsigned", descriptor: "unsigned-32" }
    ]));
    expect(valid.findings).toEqual([]);
    expect(valid.reader).not.toBeNull();

    const invalid = await inspectFixture(createZipFixture([
      { name: "missing.txt", content: "missing", descriptor: "none", flags: 0x0008 }
    ]));
    expect(findingIds(invalid)).toContain("plugin.submission.archive.descriptor_invalid");
  });

  it("accepts local ZIP64 size sentinels and rejects missing or malformed required local ZIP64 data", async () => {
    const name = "local-zip64.txt";
    const archive = createZipFixture([
      { name, content: "local zip64", zip64: true, localZip64: true }
    ], { zip64: true });
    const valid = await inspectFixture(archive);
    expect(valid.findings).toEqual([]);
    expect(valid.reader).not.toBeNull();

    const localExtraOffset = 30 + Buffer.byteLength(name);
    const missing = Buffer.from(archive);
    missing.writeUInt16LE(0x0002, localExtraOffset);
    const missingInspection = await inspectFixture(missing);
    expect(findingIds(missingInspection)).toContain("plugin.submission.archive.range_invalid");
    expect(missingInspection.reader).toBeNull();

    const malformed = Buffer.from(archive);
    malformed.writeUInt16LE(15, localExtraOffset + 2);
    const malformedInspection = await inspectFixture(malformed);
    expect(findingIds(malformedInspection)).toContain("plugin.submission.archive.range_invalid");
    expect(malformedInspection.reader).toBeNull();
  });

  it("validates ZIP64, intervals, types, unused bombs, and its non-executing boundary", async () => {
    const zip64 = await inspectFixture(createZipFixture([
      { name: "zip64.txt", content: "zip64", zip64: true, descriptor: "signed-64" }
    ], { zip64: true }));
    expect(zip64.findings).toEqual([]);
    await expect(zip64.reader?.read("zip64.txt", 10)).resolves.toEqual(new TextEncoder().encode("zip64"));

    const centralOverlap = await inspectFixture(createZipFixture([{ name: "a.txt", content: "a" }], { centralDirectoryOffset: 0 }));
    expect(findingIds(centralOverlap)).toContain("plugin.submission.archive.range_invalid");

    const localOverlap = await inspectFixture(createZipFixture([
      { name: "shared.txt", content: "shared" },
      { name: "shared.txt", content: "shared", centralLocalOffset: 0 }
    ]));
    expect(findingIds(localOverlap)).toContain("plugin.submission.archive.range_invalid");

    const contradictory = await inspectFixture(createZipFixture([
      { name: "regular.txt", content: "body", externalFileAttributes: (0o100644 << 16) | 0x10 }
    ]));
    expect(findingIds(contradictory)).toContain("plugin.submission.archive.type_unsupported");

    const bomb = await inspectFixture(createZipFixture([
      { name: "unused-bomb.txt", content: "A".repeat(16 * 1024), method: 8, centralUncompressedSize: 1, localUncompressedSize: 1 }
    ]));
    expect(findingIds(bomb)).toContain("plugin.submission.archive.crc_mismatch");
    expect(JSON.stringify(bomb)).not.toContain("A".repeat(32));

    const source = await readFile(new URL("../src/core/submission-archive-reader.ts", import.meta.url), "utf8");
    const nodeFsImports = source.match(/^import .* from "node:fs(?:\/promises)?";$/gmu) ?? [];
    expect(nodeFsImports).toEqual([
      'import { close, fstat, open, read, type Stats } from "node:fs";',
      'import { stat } from "node:fs/promises";'
    ]);
    expect(source).not.toMatch(
      /node:child_process|\b(?:writeFile|appendFile|mkdir|rm|rename|copyFile|createWriteStream|truncate|unlink|symlink|link)\s*\(|\bfetch\s*\(/u
    );
    const fetchCalls: unknown[][] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error("network must not be used");
    }) as typeof fetch;
    try {
      const safe = await inspectFixture(createZipFixture([{ name: "safe.txt", content: "safe" }]));
      expect(safe.reader).not.toBeNull();
      expect(fetchCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses a reader request after its inspected archive is replaced", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-reader-binding-"));
    temporaryDirectories.push(directory);
    const archivePath = path.join(directory, "plugin.zip");
    await writeFile(archivePath, createZipFixture([{ name: "safe.txt", content: "inspected" }]));
    const inspection = await inspectSubmissionArchive(archivePath);
    await writeFile(archivePath, createZipFixture([{ name: "safe.txt", content: "tampered!" }]));

    await expect(inspection.reader?.read("safe.txt", 100)).resolves.toBeNull();
  });

  it("rejects a ZIP64 record whose declared size cannot contain its mandatory fields", async () => {
    const archive = createZipFixture([{ name: "zip64.txt", content: "zip64", zip64: true }], { zip64: true });
    const zip64RecordOffset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
    archive.writeBigUInt64LE(1n, zip64RecordOffset + 4);

    const inspection = await inspectFixture(archive);
    expect(findingIds(inspection)).toContain("plugin.submission.archive.range_invalid");
  });

  it("rejects a parseable ZIP64 local interval that crosses the central directory", async () => {
    const archive = createZipFixture([{
      name: "crosses.bin",
      content: "",
      zip64: true,
      centralCompressedSize: 80,
      localCompressedSize: 80
    }], { zip64: true });
    const centralDirectoryOffset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const localDataStart = 30 + Buffer.byteLength("crosses.bin");
    expect(localDataStart).toBe(centralDirectoryOffset);
    expect(localDataStart + 80).toBeLessThanOrEqual(archive.length);
    expect(localDataStart + 80).toBeGreaterThan(centralDirectoryOffset);

    const inspection = await inspectFixture(archive);
    expect(findingIds(inspection)).not.toContain("plugin.submission.archive.invalid_zip");
    expect(findingIds(inspection)).toContain("plugin.submission.archive.range_invalid");
    expect(inspection.reader).toBeNull();
  });

  it("decodes CP437 entry names and rejects fatal UTF-8", async () => {
    const cp437 = await inspectFixture(createZipFixture([{ name: new Uint8Array([0x82, 0x2e, 0x74, 0x78, 0x74]), content: "x" }]));
    expect(cp437.entries[0]?.packagePath).toBe("é.txt");

    const invalidUtf8 = await inspectFixture(createZipFixture([{ name: new Uint8Array([0xff]), content: "x", flags: 0x0800 }]));
    expect(findingIds(invalidUtf8)).toContain("plugin.submission.archive.path_invalid");
  });

  it("terminates deterministically for randomized malformed buffers", async () => {
    for (let index = 0; index < 24; index += 1) {
      const content = Uint8Array.from({ length: index + 1 }, (_, byteIndex) => (index * 37 + byteIndex * 17) & 0xff);
      await expect(inspectFixture(content)).resolves.toEqual(expect.objectContaining({ reader: null }));
    }
  });

  it("uses the decimal 100,000,000-byte compressed archive limit before ZIP parsing", async () => {
    const atLimit = await inspectSparseArchive(100_000_000);
    expect(findingIds(atLimit)).not.toContain("plugin.submission.archive.too_large");

    const overLimit = await inspectSparseArchive(100_000_001);
    expect(overLimit.findings).toContainEqual(expect.objectContaining({
      id: "plugin.submission.archive.too_large",
      evidence: { limit: 100_000_000 }
    }));
  });

  it("distinguishes the 5,000-entry archive limit from 5,001 entries", async () => {
    const atLimitEntries = Array.from({ length: 5_000 }, (_, index) => ({ name: `entries/${index}.txt`, content: "" }));
    const atLimit = await inspectFixture(createZipFixture(atLimitEntries));
    expect(findingIds(atLimit)).not.toContain("plugin.submission.archive.entry_count");

    const overLimitEntries = Array.from({ length: 5_001 }, (_, index) => ({ name: `entries/${index}.txt`, content: "" }));
    const overLimit = await inspectFixture(createZipFixture(overLimitEntries));
    expect(overLimit.findings).toContainEqual(expect.objectContaining({
      id: "plugin.submission.archive.entry_count",
      evidence: { limit: 5_000 }
    }));
  });

  it("distinguishes the 100-MiB declared member limit from one byte above it", async () => {
    const memberLimit = 100 * 1024 * 1024;
    const atLimit = await inspectFixture(createZipFixture([{
      name: "at-limit.bin",
      content: "",
      centralUncompressedSize: memberLimit,
      localUncompressedSize: memberLimit
    }]));
    expect(findingIds(atLimit)).not.toContain("plugin.submission.archive.member_too_large");

    const overLimit = await inspectFixture(createZipFixture([{
      name: "over-limit.bin",
      content: "",
      centralUncompressedSize: memberLimit + 1,
      localUncompressedSize: memberLimit + 1
    }]));
    expect(overLimit.findings).toContainEqual(expect.objectContaining({
      id: "plugin.submission.archive.member_too_large",
      evidence: expect.objectContaining({ limit: memberLimit })
    }));
  });

  it("distinguishes the 512-MiB aggregate declared limit from one byte above it", async () => {
    const memberLimit = 100 * 1024 * 1024;
    const totalLimit = 512 * 1024 * 1024;
    const declaredEntries = (lastSize: number) => [
      ...Array.from({ length: 5 }, (_, index) => ({
        name: `members/${index}.bin`,
        content: "",
        centralUncompressedSize: memberLimit,
        localUncompressedSize: memberLimit
      })),
      {
        name: "members/final.bin",
        content: "",
        centralUncompressedSize: lastSize,
        localUncompressedSize: lastSize
      }
    ];
    const atLimit = await inspectFixture(createZipFixture(declaredEntries(totalLimit - (5 * memberLimit))));
    expect(findingIds(atLimit)).not.toContain("plugin.submission.archive.total_too_large");

    const overLimit = await inspectFixture(createZipFixture(declaredEntries(totalLimit - (5 * memberLimit) + 1)));
    expect(overLimit.findings).toContainEqual(expect.objectContaining({
      id: "plugin.submission.archive.total_too_large",
      evidence: { limit: totalLimit }
    }));
  });

  it("rejects drive-prefixed, empty-segment, deep, and control-character paths", async () => {
    const deepPath = Array.from({ length: 21 }, (_, index) => `segment-${index}`).join("/");
    const inspection = await inspectFixture(createZipFixture([
      { name: "C:drive.txt", content: "x" },
      { name: "empty//segment.txt", content: "x" },
      { name: deepPath, content: "x" },
      { name: "control\u0001.txt", content: "x" }
    ]));

    expect(findingIds(inspection).filter((id) => id === "plugin.submission.archive.path_invalid")).toHaveLength(4);
    expect(JSON.stringify(inspection)).not.toContain("C:drive.txt");
    expect(inspection.reader).toBeNull();
  });

  it("reports Unicode Path decoding ambiguity as unavailable coverage", async () => {
    const rawName = Buffer.from("raw-name.txt");
    const unicodeName = Buffer.from("unicode-name.txt");
    const extra = Buffer.alloc(9 + unicodeName.length);
    extra.writeUInt16LE(0x7075, 0);
    extra.writeUInt16LE(5 + unicodeName.length, 2);
    extra[4] = 1;
    extra.writeUInt32LE(crc32(rawName), 5);
    unicodeName.copy(extra, 9);

    const inspection = await inspectFixture(createZipFixture([{ name: rawName, content: "x", extra }]));
    expect(inspection.findings).toEqual([]);
    expect(inspection.coverage).toContainEqual(expect.objectContaining({
      id: "plugin.submission.archive.filename_decoding",
      status: "unavailable"
    }));
  });

  it("warns for NFKC and case path collisions without failing by that warning alone", async () => {
    const inspection = await inspectFixture(createZipFixture([
      { name: "A\u030A.txt", content: "first", flags: 0x0800 },
      { name: "\u00C5.txt", content: "second", flags: 0x0800 }
    ]));

    expect(inspection.findings).toEqual([expect.objectContaining({
      id: "plugin.submission.archive.normalization_collision",
      severity: "warn"
    })]);
    expect(inspection.reader).not.toBeNull();
  });

  it("rejects local general-purpose flag and compression-method mismatches", async () => {
    const inspection = await inspectFixture(createZipFixture([
      { name: "flag.txt", content: "flag", flags: 0x0008, localFlags: 0, descriptor: "signed-32" },
      { name: "method.txt", content: "method", method: 8, localMethod: 0 }
    ]));

    expect(findingIds(inspection).filter((id) => id === "plugin.submission.archive.header_mismatch")).toHaveLength(2);
  });

  it("accepts an unsigned ZIP64 data descriptor", async () => {
    const inspection = await inspectFixture(createZipFixture([
      { name: "zip64.txt", content: "zip64", zip64: true, descriptor: "unsigned-64" }
    ], { zip64: true }));

    expect(inspection.findings).toEqual([]);
    expect(inspection.reader).not.toBeNull();
  });

  it("rejects ZIP64 locator metadata overlap and malformed ZIP64 record sizes", async () => {
    const locatorOverlap = await inspectFixture(createZipFixture([
      { name: "zip64.txt", content: "zip64", zip64: true }
    ], { zip64: true, zip64EocdOffset: 0 }));
    expect(findingIds(locatorOverlap)).toContain("plugin.submission.archive.range_invalid");

    const shortRecord = await inspectFixture(createZipFixture([
      { name: "zip64.txt", content: "zip64", zip64: true }
    ], { zip64: true, zip64RecordSize: 1 }));
    expect(findingIds(shortRecord)).toContain("plugin.submission.archive.range_invalid");
  });
});
