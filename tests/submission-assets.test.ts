import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { DiscoveredPackage } from "../src/domain/types.js";
import { type SubmissionAssetResult, validateSubmissionAssets } from "../src/core/submission-assets.js";

type AssetFiles = Record<string, string | Uint8Array>;

const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, content: Uint8Array) => {
  const chunk = new Uint8Array(content.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, content.length);
  chunk.set(type.split("").map((character) => character.charCodeAt(0)), 4);
  chunk.set(content, 8);
  view.setUint32(content.length + 8, crc32(chunk.slice(4, content.length + 8)));
  return chunk;
};

const png = (width: number, height: number) => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header.set([1, 0, 0, 0, 0], 8);
  const scanlines = new Uint8Array(width > 4096 || height > 4096 ? 1 : (1 + Math.ceil(width / 8)) * height);
  const idat = new Uint8Array(deflateSync(scanlines));
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array())];
  const image = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { image.set(part, offset); offset += part.length; }
  return image;
};

const pngWithIdat = (idat: Uint8Array) => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 48); view.setUint32(4, 48);
  header.set([1, 0, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array())];
  const image = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { image.set(part, offset); offset += part.length; }
  return image;
};

const jpegSof = (width: number, height: number) => {
  const data = new Uint8Array(21);
  data.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]);
  const view = new DataView(data.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  data.set([3, 1, 17, 0, 2, 17, 0, 3, 17, 0], 11);
  return data;
};

const jpegWithSos = (width: number, height: number, includeEoi: boolean) => {
  const sof = jpegSof(width, height);
  const data = new Uint8Array(sof.length + 15 + (includeEoi ? 2 : 0));
  data.set(sof);
  data.set([0xff, 0xda, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0, 0], sof.length);
  if (includeEoi) data.set([0xff, 0xd9], data.length - 2);
  return data;
};

const jpeg = (width: number, height: number) => jpegWithSos(width, height, true);

const webp = (variant: "VP8X" | "VP8L" | "VP8", width: number, height: number) => {
  const payload = variant === "VP8X" ? new Uint8Array(10) : variant === "VP8L" ? new Uint8Array(5) : new Uint8Array(10);
  const view = new DataView(payload.buffer);
  if (variant === "VP8X") {
    payload.set([0, 0, 0, 0]);
    payload[4] = (width - 1) & 0xff; payload[5] = ((width - 1) >>> 8) & 0xff; payload[6] = ((width - 1) >>> 16) & 0xff;
    payload[7] = (height - 1) & 0xff; payload[8] = ((height - 1) >>> 8) & 0xff; payload[9] = ((height - 1) >>> 16) & 0xff;
  } else if (variant === "VP8L") {
    payload[0] = 0x2f;
    const packed = (width - 1) | ((height - 1) << 14);
    view.setUint32(1, packed, true);
  } else {
    payload.set([0, 0, 0, 0x9d, 0x01, 0x2a]);
    view.setUint16(6, width, true); view.setUint16(8, height, true);
  }
  const data = new Uint8Array(20 + payload.length + (payload.length % 2));
  data.set([82, 73, 70, 70]);
  new DataView(data.buffer).setUint32(4, data.length - 8, true);
  data.set([87, 69, 66, 80, ...variant.padEnd(4, " ").split("").map((character) => character.charCodeAt(0))], 8);
  new DataView(data.buffer).setUint32(16, payload.length, true);
  data.set(payload, 20);
  return data;
};

const svg = (attributes: string) => `<svg ${attributes} xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`;

async function packageWithAssets(interfaceValues: Record<string, unknown>, files: AssetFiles = {}): Promise<DiscoveredPackage> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-assets-"));
  await mkdir(path.join(rootPath, ".codex-plugin"));
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(rootPath, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  return { rootPath, manifestPath: path.join(rootPath, ".codex-plugin", "plugin.json"), manifest: { interface: interfaceValues } } as DiscoveredPackage;
}

async function findingIds(interfaceValues: Record<string, unknown>, files: AssetFiles = {}): Promise<string[]> {
  const result: SubmissionAssetResult = await validateSubmissionAssets(await packageWithAssets(interfaceValues, files));
  return result.findings.map((finding) => finding.id);
}

describe("submission assets", () => {
  it.each([
    ["PNG", "./logo.png", png(48, 48)],
    ["JPEG", "./logo.jpg", jpeg(48, 48)],
    ["WebP VP8X", "./logo.webp", webp("VP8X", 48, 48)],
    ["WebP VP8L", "./logo.webp", webp("VP8L", 48, 48)],
    ["WebP VP8", "./logo.webp", webp("VP8", 48, 48)],
    ["largest PNG", "./logo.png", png(4096, 4096)],
    ["SVG viewBox", "./logo.svg", svg('viewBox="0 0 48 48"')],
    ["SVG comma viewBox", "./logo.svg", svg('viewBox="0,0,48,48"')],
    ["SVG dimensions", "./logo.svg", svg('width="48" height="48"')]
  ])("accepts a valid %s asset", async (_name, assetPath, content) => {
    expect(await findingIds({ logo: assetPath, composerIcon: assetPath }, { [assetPath.slice(2)]: content })).toEqual([]);
  });

  it("requires both branding assets", async () => {
    expect(await findingIds({}, {})).toEqual(["plugin.submission.asset.required", "plugin.submission.asset.required"]);
  });

  it("rejects a PNG whose declared IHDR is truncated", async () => {
    const truncated = new Uint8Array(24);
    truncated.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(truncated.buffer).setUint32(16, 48);
    new DataView(truncated.buffer).setUint32(20, 48);
    expect(await findingIds({ logo: "./logo.png", composerIcon: "./logo.png" }, { "logo.png": truncated }))
      .toEqual(["plugin.submission.asset.decode_failed", "plugin.submission.asset.decode_failed"]);
  });

  it("rejects a CRC-valid PNG with invalid IDAT zlib data", async () => {
    expect(await findingIds({ logo: "./logo.png", composerIcon: "./logo.png" }, { "logo.png": pngWithIdat(new Uint8Array([1, 2, 3])) }))
      .toEqual(["plugin.submission.asset.decode_failed", "plugin.submission.asset.decode_failed"]);
  });

  it("rejects an unpadded odd-length VP8L payload", async () => {
    expect(await findingIds({ logo: "./logo.webp", composerIcon: "./logo.webp" }, { "logo.webp": webp("VP8L", 48, 48).slice(0, -1) }))
      .toEqual(["plugin.submission.asset.decode_failed", "plugin.submission.asset.decode_failed"]);
  });

  it("rejects a JPEG scan without terminal EOI", async () => {
    expect(await findingIds({ logo: "./logo.jpg", composerIcon: "./logo.jpg" }, { "logo.jpg": jpegWithSos(48, 48, false) }))
      .toEqual(["plugin.submission.asset.decode_failed", "plugin.submission.asset.decode_failed"]);
  });

  it("rejects a JPEG with an invalid SOS header", async () => {
    const malformed = jpegWithSos(48, 48, true);
    malformed[25] = 0;
    expect(await findingIds({ logo: "./logo.jpg", composerIcon: "./logo.jpg" }, { "logo.jpg": malformed }))
      .toEqual(["plugin.submission.asset.decode_failed", "plugin.submission.asset.decode_failed"]);
  });

  it.each([undefined, "logo.png", "../logo.png", "./../logo.png", "/logo.png", 42])("rejects invalid asset paths", async (value) => {
    const ids = await findingIds({ logo: value, composerIcon: "./icon.png" }, { "icon.png": png(48, 48) });
    expect(ids).toContain(value === undefined ? "plugin.submission.asset.required" : "plugin.submission.asset.invalid_path");
  });

  it.each([
    ["missing", "./missing.png", {}],
    ["directory", "./assets", { assets: "" }],
    ["empty", "./logo.png", { "logo.png": new Uint8Array() }],
    ["unsupported extension", "./logo.gif", { "logo.gif": png(48, 48) }],
    ["unsupported content", "./logo.png", { "logo.png": new Uint8Array([1, 2, 3]) }],
    ["extension mismatch", "./logo.jpg", { "logo.jpg": png(48, 48) }],
    ["malformed PNG IHDR", "./logo.png", { "logo.png": (() => { const image = png(48, 48); image[11] = 12; return image; })() }],
    ["truncated png", "./logo.png", { "logo.png": png(48, 48).slice(0, 20) }],
    ["overflow dimensions", "./logo.png", { "logo.png": png(0xffffffff, 48) }],
    ["rectangle", "./logo.png", { "logo.png": png(48, 49) }],
    ["one pixel under", "./logo.png", { "logo.png": png(47, 47) }],
    ["one pixel over", "./logo.png", { "logo.png": png(4097, 4097) }]
  ])("rejects %s", async (_name, assetPath, files) => {
    const ids = await findingIds({ logo: assetPath, composerIcon: assetPath }, files as AssetFiles);
    expect(ids.some((id) => id.startsWith("plugin.submission.asset."))).toBe(true);
  });

  it("rejects a directory, truncated JPEG and malformed WebP", async () => {
    const directoryPackage = await packageWithAssets({ logo: "./assets", composerIcon: "./icon.png" }, { "icon.png": png(48, 48) });
    await mkdir(path.join(directoryPackage.rootPath, "assets"));
    expect((await validateSubmissionAssets(directoryPackage)).findings.map((finding) => finding.id))
      .toContain("plugin.submission.asset.unsupported_format");
    expect(await findingIds({ logo: "./logo.jpg", composerIcon: "./logo.jpg" }, { "logo.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17]) }))
      .toContain("plugin.submission.asset.decode_failed");
    const malformed = webp("VP8X", 48, 48);
    new DataView(malformed.buffer).setUint32(4, 0, true);
    expect(await findingIds({ logo: "./logo.webp", composerIcon: "./logo.webp" }, { "logo.webp": malformed }))
      .toContain("plugin.submission.asset.decode_failed");
  });

  it("rejects an oversized asset before decoding it", async () => {
    const ids = await findingIds({ logo: "./logo.png", composerIcon: "./logo.png" }, { "logo.png": new Uint8Array(5 * 1024 * 1024 + 1) });
    expect(ids).toEqual(["plugin.submission.asset.too_large", "plugin.submission.asset.too_large"]);
  });

  it.each([
    ["invalid XML", "<svg"],
    ["wrong root", "<html/>"],
    ["missing dimensions", "<svg/>"],
    ["units", svg('width="48px" height="48px"')],
    ["percent", svg('width="100%" height="100%"')],
    ["nonpositive", svg('width="0" height="48"'), "plugin.submission.asset.dimensions"],
    ["rectangle", svg('width="48" height="49"'), "plugin.submission.asset.not_square"],
    ["doctype", '<!DOCTYPE svg><svg width="48" height="48"/>'],
    ["entity", '<!ENTITY x "x"><svg width="48" height="48"/>'],
    ["external href", '<svg width="48" height="48"><image href="https://example.com/x"/></svg>'],
    ["relative external href", '<svg width="48" height="48"><image href="other.svg"/></svg>'],
    ["external xlink", '<svg width="48" height="48" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="//example.com/x"/></svg>', "plugin.submission.asset.unsafe_svg"]
  ].map(([name, content, expected = "plugin.submission.asset.unsafe_svg"]) => [name, content, expected] as const))("rejects unsafe SVG %s", async (_name, content, expected) => {
    const ids = await findingIds({ logo: "./logo.svg", composerIcon: "./logo.svg" }, { "logo.svg": content });
    expect(ids).toContain(expected);
  });

  it.each([
    ["CSS import", '<svg width="48" height="48"><style>@import url(https://example.com/a.css)</style></svg>'],
    ["CSS url", '<svg width="48" height="48"><style>fill:url(https://example.com/a.svg)</style></svg>'],
    ["inline CSS url", '<svg width="48" height="48" style="fill:url(https://example.com/a.svg)"/>'],
    ["non-fragment CSS url", '<svg width="48" height="48"><style>fill:url(#gradient https://example.com/a.svg)</style></svg>'],
    ["case and whitespace import", '<svg width="48" height="48"><style>@ IMPORT url(https://example.com/a.css)</style></svg>']
  ])("rejects SVG %s remote CSS", async (_name, content) => {
    expect(await findingIds({ logo: "./logo.svg", composerIcon: "./logo.svg" }, { "logo.svg": content }))
      .toEqual(["plugin.submission.asset.unsafe_svg", "plugin.submission.asset.unsafe_svg"]);
  });

  it("allows fragment-only SVG CSS URLs", async () => {
    expect(await findingIds({ logo: "./logo.svg", composerIcon: "./logo.svg" }, { "logo.svg": '<svg width="48" height="48"><style>fill:url(#gradient)</style></svg>' }))
      .toEqual([]);
  });

  it("rejects invalid UTF-8 SVG", async () => {
    const ids = await findingIds({ logo: "./logo.svg", composerIcon: "./logo.svg" }, { "logo.svg": new Uint8Array([0xc3, 0x28]) });
    expect(ids).toContain("plugin.submission.asset.unsafe_svg");
  });

  it("rejects a junction that canonically escapes the package", async () => {
    const assetPackage = await packageWithAssets({ logo: "./outside/logo.png", composerIcon: "./icon.png" }, { "icon.png": png(48, 48) });
    const external = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-assets-escape-"));
    await writeFile(path.join(external, "logo.png"), png(48, 48));
    await symlink(external, path.join(assetPackage.rootPath, "outside"), "junction");
    const findings = await validateSubmissionAssets(assetPackage);
    expect(findings.findings.map((finding) => finding.id)).toContain("plugin.submission.asset.invalid_path");
    expect(JSON.stringify(findings)).not.toContain(external);
  });

  it("keeps findings package-relative and its validator offline", async () => {
    const assetPackage = await packageWithAssets({ logo: "./secret.png", composerIcon: "./secret.png" }, { "secret.png": new Uint8Array([1]) });
    const result = await validateSubmissionAssets(assetPackage);
    expect(JSON.stringify(result)).not.toContain(assetPackage.rootPath);
    expect(JSON.stringify(result)).not.toContain("secret.png\u0000");
    expect(JSON.stringify(result)).toContain('"path":"secret.png"');
    const source = await readFile(new URL("../src/core/submission-assets.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(fetch|exec|spawn|http|https)\b/u);
  });
});
