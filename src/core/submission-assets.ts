import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { XMLParser, XMLValidator } from "fast-xml-parser";

import type { DiscoveredPackage } from "../domain/types.js";
import { resolveSafePackagePath } from "./plugin-components.js";
import type { SubmissionFinding } from "./submission-preflight.js";

const maxAssetBytes = 5 * 1024 * 1024;
const minimumDimension = 48;
const maximumDimension = 4096;
const assetFields = ["logo", "composerIcon"] as const;
const extensions = new Map([[".png", "png"], [".jpg", "jpeg"], [".jpeg", "jpeg"], [".webp", "webp"], [".svg", "svg"]] as const);
const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

type AssetFormat = "png" | "jpeg" | "webp" | "svg";
type Dimensions = { width: number; height: number };
type Evidence = SubmissionFinding["evidence"];

export interface SubmissionAssetResult {
  findings: SubmissionFinding[];
}

function finding(
  id: `plugin.submission.asset.${string}`,
  message: string,
  evidence: Evidence
): SubmissionFinding {
  return { id, severity: "fail", message, evidence };
}

function assetEvidence(field: string, packagePath?: string, format?: AssetFormat, dimensions?: Dimensions): Evidence {
  return {
    field,
    ...(packagePath === undefined ? {} : { path: packagePath }),
    ...(format === undefined ? {} : { format }),
    ...(dimensions === undefined ? {} : dimensions)
  };
}

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readPng(buffer: Uint8Array): Dimensions | null {
  if (buffer.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => buffer[index] === byte)) {
    return null;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let dimensions: Dimensions | null = null;
  let sawIdat = false;
  let offset = 8;
  for (let chunks = 0; chunks < 128 && offset + 12 <= buffer.length; chunks += 1) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    if (length > buffer.length - dataOffset - 4) return null;
    const dataEnd = dataOffset + length;
    if (crc32(buffer.slice(typeOffset, dataEnd)) !== view.getUint32(dataEnd)) return null;
    const type = fourCc(buffer, typeOffset);
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      dimensions = { width: view.getUint32(dataOffset), height: view.getUint32(dataOffset + 4) };
    } else if (type === "IDAT") {
      sawIdat ||= length > 0;
    } else if (type === "IEND") {
      return length === 0 && sawIdat && dataEnd + 4 === buffer.length ? dimensions : null;
    }
    offset = dataEnd + 4;
  }
  return null;
}

function readJpeg(buffer: Uint8Array): Dimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 2;
  for (let steps = 0; steps < 128 && offset < buffer.length; steps += 1) {
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= buffer.length) {
      return null;
    }
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) {
      return null;
    }
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > buffer.length) {
      return null;
    }
    if (sofMarkers.has(marker)) {
      const start = offset + 2;
      if (start + 5 > offset + length) {
        return null;
      }
      return { height: view.getUint16(start + 1), width: view.getUint16(start + 3) };
    }
    offset += length;
  }
  return null;
}

function fourCc(buffer: Uint8Array, offset: number): string {
  return String.fromCharCode(...buffer.slice(offset, offset + 4));
}

function readWebp(buffer: Uint8Array): Dimensions | null {
  if (buffer.length < 20 || fourCc(buffer, 0) !== "RIFF" || fourCc(buffer, 8) !== "WEBP") {
    return null;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize !== buffer.length - 8) {
    return null;
  }
  const chunkType = fourCc(buffer, 12);
  const chunkLength = view.getUint32(16, true);
  const payload = 20;
  if (chunkLength > buffer.length - payload) {
    return null;
  }
  if (chunkType === "VP8X") {
    if (chunkLength < 10) return null;
    const width = 1 + buffer[payload + 4] + (buffer[payload + 5] << 8) + (buffer[payload + 6] << 16);
    const height = 1 + buffer[payload + 7] + (buffer[payload + 8] << 8) + (buffer[payload + 9] << 16);
    return { width, height };
  }
  if (chunkType === "VP8L") {
    if (chunkLength < 5 || buffer[payload] !== 0x2f) return null;
    const packed = view.getUint32(payload + 1, true);
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
  }
  if (chunkType === "VP8 ") {
    if (chunkLength < 10 || buffer[payload + 3] !== 0x9d || buffer[payload + 4] !== 0x01 || buffer[payload + 5] !== 0x2a) return null;
    return { width: view.getUint16(payload + 6, true) & 0x3fff, height: view.getUint16(payload + 8, true) & 0x3fff };
  }
  return null;
}

function rasterAsset(buffer: Uint8Array): { format: Exclude<AssetFormat, "svg">; dimensions: Dimensions } | null {
  const candidates: Array<[Exclude<AssetFormat, "svg">, (source: Uint8Array) => Dimensions | null]> = [
    ["png", readPng], ["jpeg", readJpeg], ["webp", readWebp]
  ];
  for (const [format, reader] of candidates) {
    const dimensions = reader(buffer);
    if (dimensions !== null) return { format, dimensions };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFrom(value: unknown): number | null {
  if (typeof value !== "string" || !numeric.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function svgDimensions(content: string): Dimensions | null {
  if (/<!DOCTYPE|<!ENTITY/iu.test(content) || /\b(?:xlink:)?href\s*=\s*(["'])\s*(?!#)[^"']+\1/iu.test(content)) {
    return null;
  }
  if (XMLValidator.validate(content) !== true) return null;
  try {
    const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(content);
    if (!isRecord(parsed) || !isRecord(parsed.svg)) return null;
    const root = parsed.svg;
    const viewBox = root["@_viewBox"];
    if (typeof viewBox === "string") {
      const parts = viewBox.trim().split(/\s+/u).map(numberFrom);
      if (parts.length !== 4 || parts.some((part) => part === null)) return null;
      return { width: parts[2]!, height: parts[3]! };
    }
    const width = numberFrom(root["@_width"]);
    const height = numberFrom(root["@_height"]);
    return width === null || height === null ? null : { width, height };
  } catch {
    return null;
  }
}

function dimensionFinding(field: string, packagePath: string, format: AssetFormat, dimensions: Dimensions): SubmissionFinding | null {
  const evidence = assetEvidence(field, packagePath, format, dimensions);
  if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
    return finding("plugin.submission.asset.dimensions", "Asset dimensions must be positive integers.", evidence);
  }
  if (dimensions.width !== dimensions.height) {
    return finding("plugin.submission.asset.not_square", "Asset dimensions must be square.", evidence);
  }
  if (dimensions.width < minimumDimension || dimensions.width > maximumDimension) {
    return finding("plugin.submission.asset.dimensions", "Asset dimensions are outside the allowed range.", { ...evidence, limit: minimumDimension });
  }
  return null;
}

async function validateAsset(rootPath: string, field: typeof assetFields[number], value: unknown): Promise<SubmissionFinding[]> {
  if (value === undefined) {
    return [finding("plugin.submission.asset.required", "Branding asset is required.", assetEvidence(field))];
  }
  if (typeof value !== "string") {
    return [finding("plugin.submission.asset.invalid_path", "Branding asset path is invalid.", assetEvidence(field))];
  }
  const resolved = await resolveSafePackagePath(rootPath, value);
  if (resolved === null) {
    return [finding("plugin.submission.asset.invalid_path", "Branding asset path is invalid.", assetEvidence(field))];
  }
  const extension = extensions.get(path.extname(resolved.packagePath).toLowerCase() as ".png" | ".jpg" | ".jpeg" | ".webp" | ".svg");
  if (extension === undefined) {
    return [finding("plugin.submission.asset.unsupported_format", "Branding asset format is unsupported.", assetEvidence(field, resolved.packagePath))];
  }
  let details;
  try {
    details = await stat(resolved.path);
  } catch {
    return [finding("plugin.submission.asset.missing", "Branding asset is missing.", assetEvidence(field, resolved.packagePath, extension))];
  }
  if (!details.isFile()) {
    return [finding("plugin.submission.asset.unsupported_format", "Branding asset must be a regular file.", assetEvidence(field, resolved.packagePath, extension))];
  }
  if (details.size > maxAssetBytes) {
    return [finding("plugin.submission.asset.too_large", "Branding asset exceeds the size limit.", { ...assetEvidence(field, resolved.packagePath, extension), limit: maxAssetBytes })];
  }
  let content: Uint8Array;
  try {
    content = await readFile(resolved.path);
  } catch {
    return [finding("plugin.submission.asset.missing", "Branding asset cannot be read.", assetEvidence(field, resolved.packagePath, extension))];
  }
  if (extension === "svg") {
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return [finding("plugin.submission.asset.unsafe_svg", "SVG must be valid UTF-8.", assetEvidence(field, resolved.packagePath, extension))];
    }
    const dimensions = svgDimensions(source);
    if (dimensions === null) {
      return [finding("plugin.submission.asset.unsafe_svg", "SVG is unsafe or lacks valid dimensions.", assetEvidence(field, resolved.packagePath, extension))];
    }
    const invalidDimensions = dimensionFinding(field, resolved.packagePath, extension, dimensions);
    return invalidDimensions === null ? [] : [invalidDimensions];
  }
  const decoded = rasterAsset(content);
  if (decoded === null) {
    return [finding("plugin.submission.asset.decode_failed", "Branding asset could not be decoded.", assetEvidence(field, resolved.packagePath, extension))];
  }
  if (decoded.format !== extension) {
    return [finding("plugin.submission.asset.extension_mismatch", "Branding asset extension does not match its content.", assetEvidence(field, resolved.packagePath, decoded.format, decoded.dimensions))];
  }
  const invalidDimensions = dimensionFinding(field, resolved.packagePath, decoded.format, decoded.dimensions);
  return invalidDimensions === null ? [] : [invalidDimensions];
}

export async function validateSubmissionAssets(discoveredPackage: DiscoveredPackage): Promise<SubmissionAssetResult> {
  const listing = discoveredPackage.manifest.interface;
  const interfaceValues = isRecord(listing) ? listing : {};
  const result = await Promise.all(assetFields.map((field) => validateAsset(discoveredPackage.rootPath, field, interfaceValues[field])));
  return { findings: result.flat() };
}
