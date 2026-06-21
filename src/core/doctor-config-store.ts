import {
  mkdir,
  readFile,
  rename as renameFile,
  rm,
  writeFile
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { parseJsonText } from "./read-json-file.js";

export type RawDoctorConfig = Record<string, unknown>;

export interface LoadedDoctorConfig {
  configPath: string;
  exists: boolean;
  value: RawDoctorConfig;
}

export function resolveDoctorConfigPath(
  targetPath: string,
  explicitConfigPath?: string | null
): string {
  return explicitConfigPath
    ? path.resolve(explicitConfigPath)
    : path.join(path.resolve(targetPath), ".codex-doctor.json");
}

function isRawDoctorConfig(value: unknown): value is RawDoctorConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readRawDoctorConfig(
  targetPath: string,
  explicitConfigPath?: string | null
): Promise<LoadedDoctorConfig> {
  const configPath = resolveDoctorConfigPath(targetPath, explicitConfigPath);

  try {
    const parsed = parseJsonText<unknown>(await readFile(configPath, "utf8"));

    if (!isRawDoctorConfig(parsed)) {
      throw new Error("Doctor config root must be a JSON object");
    }

    return {
      configPath,
      exists: true,
      value: parsed
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        configPath,
        exists: false,
        value: {}
      };
    }

    if (error instanceof SyntaxError) {
      throw new Error(
        `Unable to parse Doctor config at ${configPath}: ${error.message}`,
        { cause: error }
      );
    }

    throw error;
  }
}

export async function writeRawDoctorConfig(
  configPath: string,
  value: RawDoctorConfig,
  options: { rename?: typeof renameFile } = {}
): Promise<void> {
  const rename = options.rename ?? renameFile;
  const directoryPath = path.dirname(configPath);
  const tempPath = path.join(
    directoryPath,
    `${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`
  );

  await mkdir(directoryPath, { recursive: true });

  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, configPath);
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch {
      // Best effort cleanup should not replace the original failure.
    }

    throw error;
  }
}
