import { deflateRawSync } from "node:zlib";

export interface ZipFixtureEntry {
  name: string | Uint8Array;
  content?: string | Uint8Array;
  method?: 0 | 8 | number;
  flags?: number;
  localMethod?: 0 | 8 | number;
  localFlags?: number;
  descriptor?: "none" | "signed-32" | "unsigned-32" | "signed-64" | "unsigned-64";
  zip64?: boolean;
  localZip64?: boolean;
  centralLocalOffset?: number;
  externalFileAttributes?: number;
  centralName?: string | Uint8Array;
  localName?: string | Uint8Array;
  centralCrc32?: number;
  localCrc32?: number;
  centralCompressedSize?: number;
  centralUncompressedSize?: number;
  localCompressedSize?: number;
  localUncompressedSize?: number;
  extra?: Uint8Array;
}

export interface ZipFixtureOptions {
  comment?: string | Uint8Array;
  diskNumber?: number;
  centralDirectoryDisk?: number;
  entryCountOnDisk?: number;
  centralDirectoryOffset?: number;
  zip64?: boolean;
  zip64EocdOffset?: number;
  zip64RecordSize?: number;
}

function bytes(value: string | Uint8Array | undefined): Buffer {
  if (value === undefined) return Buffer.alloc(0);
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function u16(value: number): Buffer {
  const result = Buffer.alloc(2);
  result.writeUInt16LE(value >>> 0, 0);
  return result;
}

function u32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value >>> 0, 0);
  return result;
}

function u64(value: number): Buffer {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(BigInt(value));
  return result;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320;
  return value >>> 0;
});

export function crc32(content: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of content) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

/** A deterministic minimal ZIP writer for reader tests; it never invokes an archive utility. */
export function createZipFixture(entries: readonly ZipFixtureEntry[], options: ZipFixtureOptions = {}): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const item of entries) {
    const useZip64 = item.zip64 ?? options.zip64 ?? false;
    const useLocalZip64 = item.localZip64 ?? false;
    const payload = bytes(item.content);
    const method = item.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(payload) : payload;
    const descriptor = item.descriptor ?? "none";
    const flags = (item.flags ?? 0) | (descriptor === "none" ? 0 : 0x0008);
    const localMethod = item.localMethod ?? method;
    const localFlags = item.localFlags ?? flags;
    const centralName = bytes(item.centralName ?? item.name);
    const localName = bytes(item.localName ?? item.name);
    const extra = Buffer.from(item.extra ?? []);
    const crc = crc32(payload);
    const centralCrc = item.centralCrc32 ?? crc;
    const localCrc = descriptor === "none" ? (item.localCrc32 ?? crc) : (item.localCrc32 ?? 0);
    const centralCompressedSize = item.centralCompressedSize ?? compressed.length;
    const centralUncompressedSize = item.centralUncompressedSize ?? payload.length;
    const localCompressedSize = descriptor === "none" ? (item.localCompressedSize ?? compressed.length) : (item.localCompressedSize ?? 0);
    const localUncompressedSize = descriptor === "none" ? (item.localUncompressedSize ?? payload.length) : (item.localUncompressedSize ?? 0);
    const zip64Extra = useZip64 ? Buffer.concat([
      u16(0x0001), u16(16), u64(centralUncompressedSize), u64(centralCompressedSize)
    ]) : Buffer.alloc(0);
    const centralExtra = Buffer.concat([zip64Extra, extra]);
    const localZip64Extra = useLocalZip64 && descriptor === "none" ? Buffer.concat([
      u16(0x0001), u16(16), u64(localUncompressedSize), u64(localCompressedSize)
    ]) : Buffer.alloc(0);
    const localExtra = Buffer.concat([localZip64Extra, extra]);
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(useLocalZip64 ? 45 : 20), u16(localFlags), u16(localMethod), u16(0), u16(0),
      u32(localCrc), u32(useLocalZip64 ? 0xffffffff : localCompressedSize), u32(useLocalZip64 ? 0xffffffff : localUncompressedSize), u16(localName.length), u16(localExtra.length), localName, localExtra
    ]);
    const descriptorBytes = descriptor === "none" ? Buffer.alloc(0) : Buffer.concat([
      descriptor.startsWith("signed") ? u32(0x08074b50) : Buffer.alloc(0),
      u32(centralCrc),
      descriptor.endsWith("64") ? u64(centralCompressedSize) : u32(centralCompressedSize),
      descriptor.endsWith("64") ? u64(centralUncompressedSize) : u32(centralUncompressedSize)
    ]);
    localParts.push(localHeader, compressed, descriptorBytes);
    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(0x031e), u16(useZip64 ? 45 : 20), u16(flags), u16(method), u16(0), u16(0),
      u32(centralCrc), u32(useZip64 ? 0xffffffff : centralCompressedSize), u32(useZip64 ? 0xffffffff : centralUncompressedSize),
      u16(centralName.length), u16(centralExtra.length), u16(0), u16(0), u16(0), u32(item.externalFileAttributes ?? 0), u32(item.centralLocalOffset ?? localOffset), centralName, centralExtra
    ]);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + compressed.length + descriptorBytes.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = options.centralDirectoryOffset ?? localOffset;
  const prefix = Buffer.concat(localParts);
  const padding = centralOffset >= prefix.length ? Buffer.alloc(centralOffset - prefix.length) : Buffer.alloc(0);
  const comment = bytes(options.comment);
  const zip64EocdOffset = prefix.length + padding.length + centralDirectory.length;
  const zip64Records = options.zip64 ? Buffer.concat([
    u32(0x06064b50), u64(options.zip64RecordSize ?? 44), u16(45), u16(45), u32(0), u32(0), u64(entries.length), u64(entries.length), u64(centralDirectory.length), u64(centralOffset),
    u32(0x07064b50), u32(0), u64(options.zip64EocdOffset ?? zip64EocdOffset), u32(1)
  ]) : Buffer.alloc(0);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(options.diskNumber ?? 0), u16(options.centralDirectoryDisk ?? 0),
    u16(options.zip64 ? 0xffff : (options.entryCountOnDisk ?? entries.length)), u16(options.zip64 ? 0xffff : entries.length),
    u32(options.zip64 ? 0xffffffff : centralDirectory.length), u32(options.zip64 ? 0xffffffff : centralOffset), u16(comment.length), comment
  ]);
  return Buffer.concat([prefix, padding, centralDirectory, zip64Records, eocd]);
}

export function overwriteUInt32(buffer: Uint8Array, offset: number, value: number): Buffer {
  const result = Buffer.from(buffer);
  result.writeUInt32LE(value >>> 0, offset);
  return result;
}
