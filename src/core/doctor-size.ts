import { readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";

export interface DoctorSizeReport {
  targetPath: string;
  status: "pass" | "warn" | "fail";
  totalSize: number;
  totalSizeHuman: string;
  fileCount: number;
  largeFiles: Array<{ path: string; size: number; sizeHuman: string }>;
  warnings: string[];
  npmPackSize?: number;
  npmPackSizeHuman?: string;
}

const skippedDirs = new Set([
  "node_modules",
  ".git",
  ".cache",
  "dist",
  "coverage",
  "__pycache__",
  ".turbo",
  ".next",
  ".nuxt"
]);

const largeFileThreshold = 1024 * 1024;
const packageSizeWarnThreshold = 10 * 1024 * 1024;
const packageSizeFailThreshold = 50 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function scanDirectory(
  rootPath: string,
  currentPath: string = rootPath
): Promise<{ totalSize: number; fileCount: number; largeFiles: Array<{ path: string; size: number; sizeHuman: string }> }> {
  let totalSize = 0;
  let fileCount = 0;
  const largeFiles: Array<{ path: string; size: number; sizeHuman: string }> = [];

  let entries;

  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return { totalSize: 0, fileCount: 0, largeFiles: [] };
  }

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (skippedDirs.has(entry.name)) {
        continue;
      }

      const subResult = await scanDirectory(rootPath, entryPath);
      totalSize += subResult.totalSize;
      fileCount += subResult.fileCount;
      largeFiles.push(...subResult.largeFiles);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    let details;

    try {
      details = await stat(entryPath);
    } catch {
      continue;
    }

    totalSize += details.size;
    fileCount += 1;

    if (details.size >= largeFileThreshold) {
      largeFiles.push({
        path: path.relative(rootPath, entryPath).replace(/\\/g, "/"),
        size: details.size,
        sizeHuman: formatSize(details.size)
      });
    }
  }

  return { totalSize, fileCount, largeFiles };
}

export async function buildDoctorSize(
  targetPath: string,
  options: { npmPack?: boolean } = {}
): Promise<DoctorSizeReport> {
  const resolvedPath = path.resolve(targetPath);
  const { totalSize, fileCount, largeFiles } = await scanDirectory(resolvedPath);

  const warnings: string[] = [];

  let status: DoctorSizeReport["status"] = "pass";
  let npmPackSize: number | undefined;
  let npmPackSizeHuman: string | undefined;

  if (options.npmPack) {
    try {
      const packOutput = await new Promise<string>((resolve, reject) => {
        execFile(
          "npm",
          ["pack", "--dry-run"],
          { cwd: resolvedPath, timeout: 30000, shell: process.platform === "win32" },
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr.trim() || error.message));
              return;
            }
            resolve(stdout);
          }
        );
      });

      const tarballLine = packOutput.split("\n").find((line) => line.includes("total files") || line.includes("package size"));

      if (tarballLine) {
        const totalMatch = tarballLine.match(/(\d[\d.]*)\s*([KMG]?B)/i);

        if (totalMatch) {
          const value = Number.parseFloat(totalMatch[1]);
          const unit = totalMatch[2].toUpperCase();

          switch (unit) {
            case "KB":
              npmPackSize = Math.round(value * 1024);
              break;
            case "MB":
              npmPackSize = Math.round(value * 1024 * 1024);
              break;
            case "GB":
              npmPackSize = Math.round(value * 1024 * 1024 * 1024);
              break;
            default:
              npmPackSize = Math.round(value);
          }

          npmPackSizeHuman = formatSize(npmPackSize);
        }
      }

      if (npmPackSize === undefined) {
        warnings.push("Could not determine npm pack size from output.");
      } else {
        const diffPercent = totalSize > 0
          ? Math.abs(Math.round(((npmPackSize - totalSize) / totalSize) * 100))
          : 0;

        if (diffPercent > 50 && npmPackSize > totalSize) {
          warnings.push(`npm pack size (${npmPackSizeHuman}) differs from local size (${formatSize(totalSize)}) by ${diffPercent}%.`);
        }
      }
    } catch (error) {
      warnings.push(`npm pack failed: ${(error as Error).message}`);
    }
  }

  if (totalSize >= packageSizeFailThreshold) {
    status = "fail";
    warnings.push(`Package size (${formatSize(totalSize)}) exceeds ${formatSize(packageSizeFailThreshold)}.`);
  } else if (totalSize >= packageSizeWarnThreshold) {
    status = "warn";
    warnings.push(`Package size (${formatSize(totalSize)}) exceeds ${formatSize(packageSizeWarnThreshold)}.`);
  }

  if (largeFiles.length > 0) {
    if (status === "pass") status = "warn";
    warnings.push(`${largeFiles.length} file(s) exceed ${formatSize(largeFileThreshold)}.`);
  }

  largeFiles.sort((a, b) => b.size - a.size);

  return {
    targetPath: resolvedPath,
    status,
    totalSize,
    totalSizeHuman: formatSize(totalSize),
    fileCount,
    largeFiles: largeFiles.slice(0, 10),
    warnings,
    npmPackSize,
    npmPackSizeHuman
  };
}

export function renderDoctorSize(report: DoctorSizeReport): string {
  const lines = [
    "Codex Plugin Doctor Size Analysis",
    "=================================",
    `Path: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Total size: ${report.totalSizeHuman} (${report.fileCount} files)`,
    report.npmPackSizeHuman ? `npm pack size: ${report.npmPackSizeHuman}` : "",
    ""
  ];

  if (report.warnings.length > 0) {
    lines.push("Warnings", "--------");

    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }

    lines.push("");
  }

  if (report.largeFiles.length > 0) {
    lines.push("Large Files", "-----------");

    for (const file of report.largeFiles) {
      lines.push(`  ${file.sizeHuman.padEnd(8)}  ${file.path}`);
    }

    lines.push("");
  }

  if (report.status === "pass") {
    lines.push("Package size within acceptable limits.");
  }

  return lines.join("\n");
}

export function renderDoctorSizeJson(report: DoctorSizeReport): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      targetPath: report.targetPath,
      status: report.status,
      totalSize: report.totalSize,
      totalSizeHuman: report.totalSizeHuman,
      fileCount: report.fileCount,
      largeFiles: report.largeFiles,
      warnings: report.warnings,
      ...(report.npmPackSize !== undefined ? {
        npmPackSize: report.npmPackSize,
        npmPackSizeHuman: report.npmPackSizeHuman
      } : {})
    },
    null,
    2
  );
}
