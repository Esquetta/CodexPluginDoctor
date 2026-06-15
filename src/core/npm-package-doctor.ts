import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import type { CompatibilityEnvironment } from "../compatibility/compatibility-matrix.js";
import type { JsonReport } from "../domain/types.js";
import type { SecurityAudit } from "../security/security-audit.js";
import type { TrustScoreReport } from "../security/trust-score.js";
import {
  buildDoctorRecommendationsFromAnalysis,
  buildPackageAnalysis
} from "./package-analysis.js";
import type { DoctorRecommendationsReport } from "./doctor-recommendations.js";

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);

export interface DoctorNpmPackageReport {
  schemaVersion: "1.0.0";
  generatedAt: string;
  kind: "doctor.npm";
  packageSpec: string;
  package: {
    name: string | null;
    version: string | null;
    fileCount: number | null;
  };
  tarball: {
    filename: string;
    path: string;
    integrity: string | null;
    shasum: string | null;
    size: number | null;
    unpackedSize: number | null;
    fileCount: number | null;
    packageRoot: string;
    packageName: string | null;
    packageVersion: string | null;
  };
  summary: {
    status: "pass" | "warn" | "fail";
    exitCode: 0 | 1;
    safeToInstall: boolean;
  };
  validation: JsonReport;
  security: SecurityAudit;
  trust: TrustScoreReport;
  recommendations: DoctorRecommendationsReport;
}

export interface BuildDoctorNpmPackageReportOptions {
  environment?: CompatibilityEnvironment;
}

interface NpmPackEntry {
  filename?: string;
  name?: string;
  version?: string;
  files?: unknown[];
  integrity?: string;
  shasum?: string;
  size?: number;
  unpackedSize?: number;
}

interface CommandSpec {
  command: string;
  args: string[];
}

function npmCommand(args: string[]): CommandSpec {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args]
    };
  }

  return { command: "npm", args };
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function readTarString(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  const finalSlice = end === -1 ? slice : slice.subarray(0, end);

  return finalSlice.toString("utf8").trim();
}

function readTarSize(buffer: Buffer): number {
  const rawSize = readTarString(buffer, 124, 12).replace(/\0/g, "").trim();
  const parsedSize = Number.parseInt(rawSize, 8);

  return Number.isFinite(parsedSize) ? parsedSize : 0;
}

function isEmptyHeader(header: Buffer): boolean {
  return header.every((byte) => byte === 0);
}

async function extractTarGz(tarballPath: string, destinationPath: string): Promise<void> {
  const tarBuffer = await gunzipAsync(await readFile(tarballPath));
  let offset = 0;

  await mkdir(destinationPath, { recursive: true });

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);

    if (isEmptyHeader(header)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const size = readTarSize(header);
    const typeFlag = readTarString(header, 156, 1);
    const fileStart = offset + 512;
    const fileEnd = fileStart + size;
    const targetPath = path.resolve(destinationPath, entryName);

    if (!isPathWithinRoot(destinationPath, targetPath)) {
      throw new Error(`Refusing to extract tar entry outside destination: ${entryName}`);
    }

    if (typeFlag === "5") {
      await mkdir(targetPath, { recursive: true });
    } else if (typeFlag === "" || typeFlag === "0") {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, tarBuffer.subarray(fileStart, fileEnd));
    }

    offset = fileStart + Math.ceil(size / 512) * 512;
  }
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);

    return details.isDirectory();
  } catch {
    return false;
  }
}

async function resolvePackageSpecForPack(packageSpec: string): Promise<string> {
  const candidatePath = path.resolve(packageSpec);

  try {
    await stat(candidatePath);

    return candidatePath;
  } catch {
    return packageSpec;
  }
}

async function packNpmPackage(packageSpec: string, destinationPath: string): Promise<{
  tarballPath: string;
  metadata: NpmPackEntry;
}> {
  const resolvedPackageSpec = await resolvePackageSpecForPack(packageSpec);
  const npmPackCommand = npmCommand([
    "pack",
    resolvedPackageSpec,
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    destinationPath
  ]);
  const { stdout } = await execFileAsync(
    npmPackCommand.command,
    npmPackCommand.args,
    {
      cwd: destinationPath,
      maxBuffer: 10 * 1024 * 1024
    }
  );
  const packEntries = JSON.parse(stdout) as NpmPackEntry[];
  const metadata = packEntries[0];

  if (!metadata?.filename) {
    throw new Error(`npm pack did not return a tarball for ${packageSpec}`);
  }

  return {
    tarballPath: path.isAbsolute(metadata.filename)
      ? metadata.filename
      : path.join(destinationPath, metadata.filename),
    metadata
  };
}

export async function buildDoctorNpmPackageReport(
  packageSpec: string,
  options: BuildDoctorNpmPackageReportOptions = {}
): Promise<DoctorNpmPackageReport> {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-npm-"));

  try {
    const { tarballPath, metadata } = await packNpmPackage(packageSpec, workspacePath);
    const extractPath = path.join(workspacePath, "extract");

    await extractTarGz(tarballPath, extractPath);

    const packageRoot = await directoryExists(path.join(extractPath, "package"))
      ? path.join(extractPath, "package")
      : extractPath;
    const packageName = typeof metadata.name === "string" ? metadata.name : null;
    const packageVersion = typeof metadata.version === "string" ? metadata.version : null;
    const fileCount = Array.isArray(metadata.files) ? metadata.files.length : null;
    const analysis = await buildPackageAnalysis(packageRoot, {
      environment: options.environment
    });
    const recommendations = buildDoctorRecommendationsFromAnalysis(analysis);

    return {
      schemaVersion: "1.0.0",
      generatedAt: analysis.generatedAt,
      kind: "doctor.npm",
      packageSpec,
      package: {
        name: packageName,
        version: packageVersion,
        fileCount
      },
      tarball: {
        filename: path.basename(tarballPath),
        path: tarballPath,
        integrity: typeof metadata.integrity === "string" ? metadata.integrity : null,
        shasum: typeof metadata.shasum === "string" ? metadata.shasum : null,
        size: typeof metadata.size === "number" ? metadata.size : null,
        unpackedSize: typeof metadata.unpackedSize === "number" ? metadata.unpackedSize : null,
        fileCount,
        packageRoot,
        packageName,
        packageVersion
      },
      summary: {
        status: recommendations.status,
        exitCode: recommendations.exitCode,
        safeToInstall: recommendations.status === "pass"
      },
      validation: analysis.validationJson,
      security: analysis.security,
      trust: analysis.trust,
      recommendations
    };
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

export function renderDoctorNpmPackageReportJson(report: DoctorNpmPackageReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorNpmPackageReport(
  report: DoctorNpmPackageReport,
  options: { outputPath?: string | null } = {}
): string {
  const packageLabel = report.package.name
    ? `${report.package.name}${report.package.version ? `@${report.package.version}` : ""}`
    : report.packageSpec;
  const lines = [
    "Doctor npm Preinstall Scan",
    "==========================",
    `Package: ${packageLabel}`,
    `Spec: ${report.packageSpec}`,
    `Tarball: ${report.tarball.filename}`,
    `Status: ${report.summary.status.toUpperCase()}`,
    `Safe to install: ${report.summary.safeToInstall ? "yes" : "no"}`,
    `Security: ${report.security.status.toUpperCase()} (${report.security.score}/100)`,
    `Trust: ${report.trust.status.toUpperCase()} (${report.trust.score}/100)`,
    `Actions: ${report.recommendations.actions.length}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  if (report.recommendations.actions.length > 0) {
    lines.push("", "Top Actions", "-----------");

    for (const action of report.recommendations.actions.slice(0, 5)) {
      lines.push(`[${action.priority.toUpperCase()}] ${action.title}`);
    }
  }

  return lines.join("\n");
}
