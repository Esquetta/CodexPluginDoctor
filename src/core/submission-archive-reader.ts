import { close, fstat, open, read, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import iconv from "iconv-lite";
import * as yauzl from "yauzl";

import type { SubmissionPackageEntry, SubmissionPackageReader } from "./submission-package-reader.js";
import type { SubmissionFinding } from "./submission-preflight.js";

const maxCompressedBytes = 100 * 1000 * 1000;
const maxEntries = 5_000;
const maxMemberBytes = 100 * 1024 * 1024;
const maxTotalBytes = 512 * 1024 * 1024;
const maxPathSegments = 20;
const invalidPackagePathMessage = "Invalid package path.";
const unsafeArchiveFileName = /[\u0000-\u001F\u007F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;

function sanitizedArchiveFileName(value: unknown): string {
  if (typeof value !== "string") return "archive.zip";
  const fileName = path.basename(value);
  return fileName === "" || fileName.trim() !== fileName || unsafeArchiveFileName.test(fileName)
    ? "archive.zip"
    : fileName;
}

export interface SubmissionArchiveFinding extends SubmissionFinding {
  id: `plugin.submission.archive.${string}`;
}

export interface SubmissionArchiveCoverage {
  id: string;
  status: "automatic" | "manual" | "unavailable";
  reason: string;
}

export interface SubmissionArchiveInspection {
  fileName: string;
  compressedBytes: number;
  uncompressedBytes: number;
  entryCount: number;
  entries: readonly SubmissionPackageEntry[];
  findings: readonly SubmissionArchiveFinding[];
  coverage: readonly SubmissionArchiveCoverage[];
  reader: SubmissionPackageReader | null;
}

interface MutableSubmissionArchiveInspection extends Omit<SubmissionArchiveInspection, "entries" | "findings" | "coverage"> {
  entries: SubmissionPackageEntry[];
  findings: SubmissionArchiveFinding[];
  coverage: SubmissionArchiveCoverage[];
}

interface CheckedEntry {
  index: number;
  packageEntry: SubmissionPackageEntry;
  crc32: number;
  compressionMethod: number;
  uncompressedSize: number;
}

interface LocalHeader {
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  rawName: Buffer;
  dataStart: number;
  intervalEnd: number;
}

interface LocalInterval {
  start: number;
  end: number;
}

interface ArchiveMetadata {
  centralStart: number;
  metadataStart: number;
}

interface ArchiveIdentity {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320;
  return value >>> 0;
});

function updateCrc32(value: number, content: Uint8Array): number {
  let result = value;
  for (const byte of content) result = (result >>> 8) ^ crcTable[(result ^ byte) & 0xff];
  return result >>> 0;
}

function archiveFinding(
  id: SubmissionArchiveFinding["id"],
  message: string,
  evidence?: SubmissionArchiveFinding["evidence"],
  severity: SubmissionArchiveFinding["severity"] = "fail"
): SubmissionArchiveFinding {
  return evidence === undefined ? { id, severity, message } : { id, severity, message, evidence };
}

function unavailableCoverage(reason: string): SubmissionArchiveCoverage {
  return { id: "plugin.submission.archive.compression_method", status: "unavailable", reason };
}

function blankInspection(fileName: string, compressedBytes = 0): MutableSubmissionArchiveInspection {
  return {
    fileName,
    compressedBytes,
    uncompressedBytes: 0,
    entryCount: 0,
    entries: [],
    findings: [],
    coverage: [],
    reader: null
  };
}

function validSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function openFileDescriptor(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    open(filePath, "r", (error, fileDescriptor) => {
      if (error !== null) reject(error);
      else resolve(fileDescriptor);
    });
  });
}

function statFileDescriptor(fileDescriptor: number): Promise<Stats> {
  return new Promise((resolve, reject) => {
    fstat(fileDescriptor, (error, details) => {
      if (error !== null) reject(error);
      else resolve(details);
    });
  });
}

function readFileDescriptor(fileDescriptor: number, content: Buffer, offset: number, length: number, position: number): Promise<number> {
  return new Promise((resolve, reject) => {
    read(fileDescriptor, content, offset, length, position, (error, bytesRead) => {
      if (error !== null) reject(error);
      else resolve(bytesRead);
    });
  });
}

function closeFileDescriptor(fileDescriptor: number): Promise<void> {
  return new Promise((resolve, reject) => {
    close(fileDescriptor, (error) => {
      if (error !== null) reject(error);
      else resolve();
    });
  });
}

function archiveIdentity(details: Stats): ArchiveIdentity {
  return { dev: details.dev, ino: details.ino, size: details.size, mtimeMs: details.mtimeMs, ctimeMs: details.ctimeMs };
}

function matchesArchiveIdentity(details: Stats, expected: ArchiveIdentity): boolean {
  return details.isFile()
    && details.dev === expected.dev
    && details.ino === expected.ino
    && details.size === expected.size
    && details.mtimeMs === expected.mtimeMs
    && details.ctimeMs === expected.ctimeMs;
}

function normalizeRequestedPath(packagePath: string): string {
  if (typeof packagePath !== "string" || packagePath === "" || /[\u0000-\u001F\u007F]/u.test(packagePath)
    || packagePath.startsWith("/") || packagePath.startsWith("\\") || /^[a-zA-Z]:/u.test(packagePath)
    || packagePath.includes("\\")) throw new Error(invalidPackagePathMessage);
  const segments = packagePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new Error(invalidPackagePathMessage);
  return packagePath;
}

function decodePath(rawName: Buffer, flags: number): string | null {
  try {
    return (flags & 0x0800) !== 0
      ? new TextDecoder("utf-8", { fatal: true }).decode(rawName)
      : iconv.decode(rawName, "cp437");
  } catch {
    return null;
  }
}

function normalizeArchivePath(decodedPath: string): { path: string; directory: boolean } | null {
  if (decodedPath.length === 0 || decodedPath.trim() !== decodedPath || /[\u0000-\u001F\u007F]/u.test(decodedPath)
    || decodedPath.startsWith("/") || decodedPath.startsWith("\\") || /^[a-zA-Z]:/u.test(decodedPath)
    || decodedPath.includes("\\")) return null;
  const directory = decodedPath.endsWith("/");
  const withoutTrailingSlash = directory ? decodedPath.slice(0, -1) : decodedPath;
  const segments = withoutTrailingSlash.split("/");
  if (withoutTrailingSlash.length === 0 || segments.length > maxPathSegments
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return { path: segments.join("/"), directory };
}

function entryKind(entry: yauzl.Entry, trailingDirectory: boolean): SubmissionPackageEntry["kind"] {
  const madeByUnix = entry.versionMadeBy >>> 8 === 3;
  const unixType = madeByUnix ? (entry.externalFileAttributes >>> 16) & 0o170000 : 0;
  const dosDirectory = (entry.externalFileAttributes & 0x10) !== 0;
  if (unixType === 0o120000) return "symlink";
  if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) return "other";
  if (trailingDirectory || dosDirectory || unixType === 0o040000) return "directory";
  return "file";
}

function hasContradictoryType(entry: yauzl.Entry, trailingDirectory: boolean, kind: SubmissionPackageEntry["kind"]): boolean {
  const madeByUnix = entry.versionMadeBy >>> 8 === 3;
  const unixType = madeByUnix ? (entry.externalFileAttributes >>> 16) & 0o170000 : 0;
  const dosDirectory = (entry.externalFileAttributes & 0x10) !== 0;
  return ((trailingDirectory || dosDirectory) && unixType === 0o100000)
    || (unixType === 0o040000 && kind !== "directory")
    || ((trailingDirectory || dosDirectory) && kind !== "directory");
}

function unicodePathChangesDecodedName(entry: yauzl.Entry, rawName: Buffer, decodedPath: string): boolean {
  const field = entry.extraFields.find((candidate) => candidate.id === 0x7075);
  if (field === undefined || field.data.length < 5 || field.data[0] !== 1) return false;
  const expectedCrc = field.data.readUInt32LE(1);
  if (expectedCrc !== crc32(rawName)) return false;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(field.data.subarray(5)) !== decodedPath;
  } catch {
    return false;
  }
}

function crc32(content: Uint8Array): number {
  return (updateCrc32(0xffffffff, content) ^ 0xffffffff) >>> 0;
}

async function readExactly(fileDescriptor: number, position: number, length: number): Promise<Buffer | null> {
  const content = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = await readFileDescriptor(fileDescriptor, content, offset, length - offset, position + offset);
    if (bytesRead === 0) return null;
    offset += bytesRead;
  }
  return content;
}

function readSafeUInt64(content: Buffer, offset: number): number | null {
  if (offset + 8 > content.length) return null;
  const value = content.readBigUInt64LE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function parseLocalExtraFields(content: Buffer): readonly { id: number; data: Buffer }[] | null {
  const fields: { id: number; data: Buffer }[] = [];
  let offset = 0;
  while (offset < content.length) {
    if (content.length - offset < 4) return null;
    const id = content.readUInt16LE(offset);
    const length = content.readUInt16LE(offset + 2);
    offset += 4;
    if (length > content.length - offset) return null;
    fields.push({ id, data: content.subarray(offset, offset + length) });
    offset += length;
  }
  return fields;
}

async function readLocalHeader(
  fileDescriptor: number,
  entry: yauzl.Entry,
  fileSize: number
): Promise<LocalHeader | null> {
  const offset = entry.relativeOffsetOfLocalHeader;
  if (!validSafeInteger(offset) || offset + 30 > fileSize) return null;
  const fixed = await readExactly(fileDescriptor, offset, 30);
  if (fixed === null || fixed.readUInt32LE(0) !== 0x04034b50) return null;
  const flags = fixed.readUInt16LE(6);
  const method = fixed.readUInt16LE(8);
  const crc = fixed.readUInt32LE(14);
  const compressedSize = fixed.readUInt32LE(18);
  const uncompressedSize = fixed.readUInt32LE(22);
  const nameLength = fixed.readUInt16LE(26);
  const extraLength = fixed.readUInt16LE(28);
  const dataStart = offset + 30 + nameLength + extraLength;
  if (!validSafeInteger(dataStart) || dataStart > fileSize) return null;
  const rawName = await readExactly(fileDescriptor, offset + 30, nameLength);
  const extra = await readExactly(fileDescriptor, offset + 30 + nameLength, extraLength);
  const extraFields = extra === null ? null : parseLocalExtraFields(extra);
  if (rawName === null || extraFields === null || !validSafeInteger(entry.compressedSize) || dataStart + entry.compressedSize > fileSize) return null;

  let resolvedCompressedSize = compressedSize;
  let resolvedUncompressedSize = uncompressedSize;
  if ((flags & 0x0008) === 0 && (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff)) {
    const zip64Fields = extraFields.filter((field) => field.id === 0x0001);
    if (zip64Fields.length !== 1) return null;
    let zip64Offset = 0;
    if (uncompressedSize === 0xffffffff) {
      const value = readSafeUInt64(zip64Fields[0].data, zip64Offset);
      if (value === null) return null;
      resolvedUncompressedSize = value;
      zip64Offset += 8;
    }
    if (compressedSize === 0xffffffff) {
      const value = readSafeUInt64(zip64Fields[0].data, zip64Offset);
      if (value === null) return null;
      resolvedCompressedSize = value;
    }
  }

  let descriptorLength = 0;
  if ((flags & 0x0008) !== 0) {
    const zip64Descriptor = entry.versionNeededToExtract >= 45;
    const descriptor = await readExactly(fileDescriptor, dataStart + entry.compressedSize, zip64Descriptor ? 24 : 16);
    if (descriptor === null) return null;
    const signed = descriptor.readUInt32LE(0) === 0x08074b50;
    const base = signed ? 4 : 0;
    const descriptorLengthWithoutSignature = zip64Descriptor ? 20 : 12;
    if (descriptor.length < base + descriptorLengthWithoutSignature
      || descriptor.readUInt32LE(base) !== entry.crc32) return null;
    const compressedSize = zip64Descriptor
      ? readSafeUInt64(descriptor, base + 4)
      : descriptor.readUInt32LE(base + 4);
    const uncompressedSize = zip64Descriptor
      ? readSafeUInt64(descriptor, base + 12)
      : descriptor.readUInt32LE(base + 8);
    if (compressedSize === null || uncompressedSize === null
      || compressedSize !== entry.compressedSize || uncompressedSize !== entry.uncompressedSize) return null;
    descriptorLength = (signed ? 4 : 0) + descriptorLengthWithoutSignature;
  }

  return {
    flags,
    method,
    crc32: crc,
    compressedSize: resolvedCompressedSize,
    uncompressedSize: resolvedUncompressedSize,
    rawName,
    dataStart,
    intervalEnd: dataStart + entry.compressedSize + descriptorLength
  };
}

async function readArchiveMetadata(
  fileDescriptor: number,
  fileSize: number
): Promise<ArchiveMetadata | null> {
  const tailLength = Math.min(fileSize, 0xffff + 22 + 20);
  const tail = await readExactly(fileDescriptor, fileSize - tailLength, tailLength);
  if (tail === null) return null;
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength !== tail.length) continue;
    const eocdOffset = fileSize - tailLength + offset;
    const disk = tail.readUInt16LE(offset + 4);
    const centralDisk = tail.readUInt16LE(offset + 6);
    const entriesOnDisk = tail.readUInt16LE(offset + 8);
    const entryCount = tail.readUInt16LE(offset + 10);
    const centralSize32 = tail.readUInt32LE(offset + 12);
    const centralStart32 = tail.readUInt32LE(offset + 16);
    const zip64 = entriesOnDisk === 0xffff || entryCount === 0xffff || centralSize32 === 0xffffffff || centralStart32 === 0xffffffff;
    if (!zip64) {
      if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount
        || centralStart32 > eocdOffset
        || centralSize32 > eocdOffset - centralStart32) return null;
      if (entryCount === 0 && centralSize32 === 0 && centralStart32 === eocdOffset) {
        return { centralStart: centralStart32, metadataStart: centralStart32 };
      }
      const signature = await readExactly(fileDescriptor, centralStart32, 4);
      return signature?.readUInt32LE(0) === 0x02014b50
        ? { centralStart: centralStart32, metadataStart: centralStart32 }
        : null;
    }
    if (eocdOffset < 20) return null;
    const locator = await readExactly(fileDescriptor, eocdOffset - 20, 20);
    if (locator === null || locator.readUInt32LE(0) !== 0x07064b50 || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) return null;
    const zip64Offset = readSafeUInt64(locator, 8);
    if (zip64Offset === null || zip64Offset > eocdOffset - 20 - 56) return null;
    const zip64Record = await readExactly(fileDescriptor, zip64Offset, 56);
    const zip64RecordSize = zip64Record === null ? null : readSafeUInt64(zip64Record, 4);
    if (zip64Record === null || zip64Record.readUInt32LE(0) !== 0x06064b50 || zip64RecordSize === null
      || zip64RecordSize < 44 || zip64RecordSize > eocdOffset - 20 - zip64Offset - 12
      || zip64Record.readUInt32LE(16) !== 0 || zip64Record.readUInt32LE(20) !== 0) return null;
    const zip64EntriesOnDisk = readSafeUInt64(zip64Record, 24);
    const zip64Entries = readSafeUInt64(zip64Record, 32);
    const centralSize = readSafeUInt64(zip64Record, 40);
    const centralStart = readSafeUInt64(zip64Record, 48);
    if (zip64EntriesOnDisk === null || zip64Entries === null || centralSize === null || centralStart === null
      || zip64EntriesOnDisk !== zip64Entries || centralStart > zip64Offset
      || centralSize > zip64Offset - centralStart) return null;
    const signature = await readExactly(fileDescriptor, centralStart, 4);
    return signature?.readUInt32LE(0) === 0x02014b50
      ? { centralStart, metadataStart: Math.min(centralStart, zip64Offset) }
      : null;
  }
  return null;
}

async function streamAndValidate(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  expectedCrc: number,
  expectedSize: number,
  currentTotal: number
): Promise<{ actualBytes: number; totalBytes: number } | null> {
  try {
    const stream = await zip.openReadStreamPromise(entry);
    let actualBytes = 0;
    let crc = 0xffffffff;
    for await (const chunk of stream as Readable) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (actualBytes + bytes.length > expectedSize || currentTotal + actualBytes + bytes.length > maxTotalBytes) {
        stream.destroy();
        return null;
      }
      actualBytes += bytes.length;
      crc = updateCrc32(crc, bytes);
    }
    return actualBytes === expectedSize && ((crc ^ 0xffffffff) >>> 0) === expectedCrc
      ? { actualBytes, totalBytes: currentTotal + actualBytes }
      : null;
  } catch {
    return null;
  }
}

async function openZip(fileDescriptor: number): Promise<yauzl.ZipFile> {
  return yauzl.fromFdPromise(fileDescriptor, {
    autoClose: false,
    lazyEntries: true,
    decodeStrings: false,
    strictFileNames: false,
    validateEntrySizes: false
  });
}

function createArchiveReader(zipPath: string, checkedEntries: readonly CheckedEntry[], expectedIdentity: ArchiveIdentity): SubmissionPackageReader {
  const byPath = new Map(checkedEntries.map((entry) => [entry.packageEntry.packagePath, entry]));
  const packageEntries = checkedEntries.map((entry) => entry.packageEntry);
  return {
    async list(directory: string): Promise<readonly SubmissionPackageEntry[]> {
      const normalizedDirectory = directory === "" ? "" : normalizeRequestedPath(directory.endsWith("/") ? directory.slice(0, -1) : directory);
      const prefix = normalizedDirectory === "" ? "" : `${normalizedDirectory}/`;
      return packageEntries.filter((entry) => entry.packagePath.startsWith(prefix) && !entry.packagePath.slice(prefix.length).includes("/"));
    },
    async stat(packagePath: string): Promise<SubmissionPackageEntry | null> {
      return byPath.get(normalizeRequestedPath(packagePath))?.packageEntry ?? null;
    },
    async read(packagePath: string, maxBytes: number): Promise<Uint8Array | null> {
      const selected = byPath.get(normalizeRequestedPath(packagePath));
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("maxBytes must be a nonnegative safe integer.");
      if (selected === undefined || selected.packageEntry.resolvedKind !== "file" || selected.uncompressedSize > maxBytes) return null;
      let zip: yauzl.ZipFile | null = null;
      let fileDescriptor: number | null = null;
      try {
        fileDescriptor = await openFileDescriptor(zipPath);
        if (!matchesArchiveIdentity(await statFileDescriptor(fileDescriptor), expectedIdentity)) return null;
        zip = await openZip(fileDescriptor);
        fileDescriptor = null;
        let index = 0;
        for await (const entry of zip.eachEntry()) {
          if (index++ !== selected.index) continue;
          const stream = await zip.openReadStreamPromise(entry);
          const result = Buffer.alloc(selected.uncompressedSize);
          let offset = 0;
          let crc = 0xffffffff;
          for await (const chunk of stream as Readable) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            if (offset + bytes.length > result.length) return null;
            bytes.copy(result, offset);
            offset += bytes.length;
            crc = updateCrc32(crc, bytes);
          }
          return offset === result.length && ((crc ^ 0xffffffff) >>> 0) === selected.crc32
            ? Uint8Array.from(result)
            : null;
        }
        return null;
      } catch {
        return null;
      } finally {
        zip?.close();
        if (fileDescriptor !== null) await closeFileDescriptor(fileDescriptor).catch(() => undefined);
      }
    }
  };
}

export async function inspectSubmissionArchive(zipPath: string): Promise<SubmissionArchiveInspection> {
  const fileName = sanitizedArchiveFileName(zipPath);
  let details: Stats;
  try {
    if (typeof zipPath !== "string" || path.extname(zipPath).toLowerCase() !== ".zip") {
      const report = blankInspection(fileName);
      report.findings.push(archiveFinding("plugin.submission.archive.invalid_file", "Input must be a regular .zip file."));
      return report;
    }
    details = await stat(zipPath);
  } catch {
    const report = blankInspection(fileName);
    report.findings.push(archiveFinding("plugin.submission.archive.invalid_file", "Input must be a readable regular .zip file."));
    return report;
  }
  const report = blankInspection(fileName, validSafeInteger(details.size) ? details.size : 0);
  if (!details.isFile() || !validSafeInteger(details.size) || details.size === 0) {
    report.findings.push(archiveFinding("plugin.submission.archive.invalid_file", "Input must be a non-empty regular .zip file."));
    return report;
  }
  if (details.size > maxCompressedBytes) {
    report.findings.push(archiveFinding("plugin.submission.archive.too_large", "Archive exceeds the compressed size limit.", { limit: maxCompressedBytes }));
    return report;
  }

  let zip: yauzl.ZipFile | null = null;
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = await openFileDescriptor(zipPath);
    const openedDetails = await statFileDescriptor(fileDescriptor);
    if (!matchesArchiveIdentity(openedDetails, archiveIdentity(details))) {
      report.findings.push(archiveFinding("plugin.submission.archive.invalid_zip", "Archive changed while opening for inspection."));
      return report;
    }
    const metadata = await readArchiveMetadata(fileDescriptor, openedDetails.size);
    if (metadata === null) {
      report.findings.push(archiveFinding("plugin.submission.archive.range_invalid", "Archive metadata ranges are invalid."));
      return report;
    }
    const inspectionDescriptor = fileDescriptor;
    zip = await openZip(inspectionDescriptor);
    fileDescriptor = null;
    if (!validSafeInteger(zip.entryCount) || zip.entryCount > maxEntries) {
      report.findings.push(archiveFinding("plugin.submission.archive.entry_count", "Archive entry count exceeds the limit.", { limit: maxEntries }));
      return report;
    }
    report.entryCount = zip.entryCount;
    const checked: CheckedEntry[] = [];
    const intervals: LocalInterval[] = [];
    const paths = new Map<string, SubmissionPackageEntry>();
    const normalizedPaths = new Set<string>();
    let declaredTotal = 0;
    let actualTotal = 0;
    let unsupportedCompression = false;
    let index = 0;

    for await (const entry of zip.eachEntry()) {
      const entryIndex = index++;
      const rawName = entry.fileName as unknown as Buffer;
      const decodedPath = decodePath(rawName, entry.generalPurposeBitFlag);
      const normalized = decodedPath === null ? null : normalizeArchivePath(decodedPath);
      if (normalized === null || decodedPath === null) {
        report.findings.push(archiveFinding("plugin.submission.archive.path_invalid", "Archive entry path is invalid.", { entryIndex }));
        continue;
      }
      if (!validSafeInteger(entry.compressedSize) || !validSafeInteger(entry.uncompressedSize)
        || !validSafeInteger(entry.crc32) || entry.uncompressedSize > maxMemberBytes) {
        report.findings.push(archiveFinding("plugin.submission.archive.member_too_large", "Archive entry exceeds a supported size limit.", { entryIndex, limit: maxMemberBytes }));
        continue;
      }
      declaredTotal += entry.uncompressedSize;
      if (!validSafeInteger(declaredTotal) || declaredTotal > maxTotalBytes) {
        report.findings.push(archiveFinding("plugin.submission.archive.total_too_large", "Archive exceeds the total uncompressed size limit.", { limit: maxTotalBytes }));
        continue;
      }
      const local = await readLocalHeader(inspectionDescriptor, entry, details.size);
      if (local === null) {
        report.findings.push(archiveFinding((entry.generalPurposeBitFlag & 0x0008) !== 0 ? "plugin.submission.archive.descriptor_invalid" : "plugin.submission.archive.range_invalid", "Archive local header or descriptor is invalid.", { entryIndex }));
        continue;
      }
      if (!rawName.equals(local.rawName) || local.flags !== entry.generalPurposeBitFlag || local.method !== entry.compressionMethod
        || ((entry.generalPurposeBitFlag & 0x0008) === 0 && (local.crc32 !== entry.crc32 || local.compressedSize !== entry.compressedSize || local.uncompressedSize !== entry.uncompressedSize))) {
        report.findings.push(archiveFinding("plugin.submission.archive.header_mismatch", "Archive central and local headers disagree.", { entryIndex }));
        continue;
      }
      intervals.push({ start: entry.relativeOffsetOfLocalHeader, end: local.intervalEnd });
      const kind = entryKind(entry, normalized.directory);
      if (hasContradictoryType(entry, normalized.directory, kind) || kind === "symlink" || kind === "other") {
        report.findings.push(archiveFinding("plugin.submission.archive.type_unsupported", "Archive entry type is unsupported.", { entryIndex }));
        continue;
      }
      const packageEntry: SubmissionPackageEntry = {
        packagePath: normalized.path,
        kind,
        resolvedKind: kind,
        size: entry.uncompressedSize,
        safeResolution: "safe"
      };
      if (paths.has(normalized.path)) {
        report.findings.push(archiveFinding("plugin.submission.archive.path_duplicate", "Archive contains duplicate entry paths.", { path: normalized.path }));
        continue;
      }
      if ([...paths.keys()].some((existing) => existing.startsWith(`${normalized.path}/`) || normalized.path.startsWith(`${existing}/`))) {
        report.findings.push(archiveFinding("plugin.submission.archive.path_conflict", "Archive entry paths conflict.", { path: normalized.path }));
        continue;
      }
      const collisionKey = normalized.path.split("/").map((segment) => segment.normalize("NFKC").toLowerCase()).join("/");
      if (normalizedPaths.has(collisionKey)) {
        report.findings.push(archiveFinding("plugin.submission.archive.normalization_collision", "Archive paths collide under Doctor's local normalization check.", { path: normalized.path }, "warn"));
      }
      normalizedPaths.add(collisionKey);
      paths.set(normalized.path, packageEntry);
      if (unicodePathChangesDecodedName(entry, rawName, decodedPath)) {
        report.coverage.push({ id: "plugin.submission.archive.filename_decoding", status: "unavailable", reason: "Unicode Path extra fields may change portal filename decoding." });
      }
      if ((entry.generalPurposeBitFlag & 0x0001) !== 0) {
        report.findings.push(archiveFinding("plugin.submission.archive.encrypted", "Encrypted archive entries cannot be inspected.", { path: normalized.path }));
        continue;
      }
      if (kind !== "file") {
        checked.push({ index: entryIndex, packageEntry, crc32: entry.crc32, compressionMethod: entry.compressionMethod, uncompressedSize: entry.uncompressedSize });
        continue;
      }
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        unsupportedCompression = true;
        continue;
      }
      const streamed = await streamAndValidate(zip, entry, entry.crc32, entry.uncompressedSize, actualTotal);
      if (streamed === null) {
        report.findings.push(archiveFinding("plugin.submission.archive.crc_mismatch", "Archive entry content does not match declared CRC or size.", { path: normalized.path }));
        continue;
      }
      actualTotal = streamed.totalBytes;
      checked.push({ index: entryIndex, packageEntry, crc32: entry.crc32, compressionMethod: entry.compressionMethod, uncompressedSize: entry.uncompressedSize });
    }
    intervals.sort((left, right) => left.start - right.start);
    if (intervals.some((interval, intervalIndex) => interval.end > metadata.metadataStart
      || (intervalIndex > 0 && interval.start < intervals[intervalIndex - 1].end))) {
      report.findings.push(archiveFinding("plugin.submission.archive.range_invalid", "Archive entry data ranges overlap or exceed the archive."));
    }
    report.uncompressedBytes = actualTotal;
    report.entries = checked.map((entry) => entry.packageEntry).sort((left, right) => left.packagePath.localeCompare(right.packagePath));
    if (unsupportedCompression) report.coverage.push(unavailableCoverage("Doctor does not decode this well-formed compression method."));
    if (report.findings.some((finding) => finding.severity === "fail") || unsupportedCompression) return report;
    report.reader = createArchiveReader(zipPath, checked, archiveIdentity(openedDetails));
    return report;
  } catch {
    report.findings.push(archiveFinding("plugin.submission.archive.invalid_zip", "Archive is malformed or truncated."));
    return report;
  } finally {
    zip?.close();
    if (fileDescriptor !== null) await closeFileDescriptor(fileDescriptor).catch(() => undefined);
  }
}
