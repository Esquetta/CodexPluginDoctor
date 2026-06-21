import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  readRawDoctorConfig,
  resolveDoctorConfigPath,
  writeRawDoctorConfig
} from "../src/core/doctor-config-store.js";

async function createTempDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "doctor-config-store-"));
}

describe("resolveDoctorConfigPath", () => {
  it("prefers an explicit config path and resolves it absolutely", () => {
    expect(
      resolveDoctorConfigPath("D:\\repo\\plugin", ".\\configs\\doctor.json")
    ).toBe(path.resolve(".\\configs\\doctor.json"));
  });

  it("uses the target path when no explicit path is provided", () => {
    expect(resolveDoctorConfigPath("D:\\repo\\plugin")).toBe(
      path.join(path.resolve("D:\\repo\\plugin"), ".codex-doctor.json")
    );
  });
});

describe("readRawDoctorConfig", () => {
  it("returns an empty object when the config file is missing", async () => {
    const targetPath = await createTempDirectory();
    const configPath = path.join(targetPath, ".codex-doctor.json");

    await expect(readRawDoctorConfig(targetPath)).resolves.toEqual({
      configPath,
      exists: false,
      value: {}
    });
  });

  it("returns exact top-level fields from a valid JSON object", async () => {
    const targetPath = await createTempDirectory();
    const configPath = path.join(targetPath, ".codex-doctor.json");
    const rawValue = {
      ignoreRules: ["plugin.example"],
      failOnWarnings: true,
      suppressions: [{ fingerprint: "abc" }],
      unknownField: { nested: "kept" }
    };

    await writeFile(configPath, `${JSON.stringify(rawValue)}\n`, "utf8");

    await expect(readRawDoctorConfig(targetPath)).resolves.toEqual({
      configPath,
      exists: true,
      value: rawValue
    });
  });

  it("returns the resolved explicit config path", async () => {
    const targetPath = await createTempDirectory();
    const explicitConfigPath = path.join(targetPath, "configs", "doctor.json");
    const rawValue = {
      custom: true
    };

    await mkdir(path.dirname(explicitConfigPath), { recursive: true });
    await writeFile(explicitConfigPath, `${JSON.stringify(rawValue)}\n`, "utf8");

    await expect(
      readRawDoctorConfig(targetPath, explicitConfigPath)
    ).resolves.toEqual({
      configPath: path.resolve(explicitConfigPath),
      exists: true,
      value: rawValue
    });
  });

  it("throws a parse error for malformed JSON", async () => {
    const targetPath = await createTempDirectory();
    const configPath = path.join(targetPath, ".codex-doctor.json");

    await writeFile(configPath, "{not-json", "utf8");

    await expect(readRawDoctorConfig(targetPath)).rejects.toThrow(
      /Unable to parse Doctor config/
    );
  });

  it("propagates non-ENOENT filesystem read errors", async () => {
    const targetPath = await createTempDirectory();
    const directoryPath = path.join(targetPath, "as-directory");

    await writeFile(
      path.join(targetPath, ".codex-doctor.json"),
      "{}\n",
      "utf8"
    );
    await writeRawDoctorConfig(path.join(directoryPath, "child.json"), {
      ignored: true
    });

    try {
      await readRawDoctorConfig(targetPath, directoryPath);
      throw new Error("expected readRawDoctorConfig to reject");
    } catch (error) {
      expect(error).toMatchObject({
        code: expect.any(String)
      });
      expect(error).not.toMatchObject({
        code: "ENOENT"
      });
    }
  });

  it.each([
    ["array", []],
    ["null", null],
    ["string", "hello"],
    ["number", 42],
    ["boolean", false]
  ])("rejects a %s root value", async (_label, rootValue) => {
    const targetPath = await createTempDirectory();
    const configPath = path.join(targetPath, ".codex-doctor.json");

    await writeFile(configPath, JSON.stringify(rootValue), "utf8");

    await expect(readRawDoctorConfig(targetPath)).rejects.toThrow(
      "Doctor config root must be a JSON object"
    );
  });
});

describe("writeRawDoctorConfig", () => {
  it("writes the exact raw object fields and keeps a trailing newline", async () => {
    const configPath = path.join(
      await createTempDirectory(),
      "nested",
      ".codex-doctor.json"
    );
    const rawValue = {
      ignoreRules: ["plugin.example"],
      extra: {
        enabled: true
      }
    };

    await writeRawDoctorConfig(configPath, rawValue);

    expect(await readFile(configPath, "utf8")).toBe(`{
  "ignoreRules": [
    "plugin.example"
  ],
  "extra": {
    "enabled": true
  }
}
`);
    await expect(
      readRawDoctorConfig(path.dirname(configPath), configPath)
    ).resolves.toEqual({
      configPath,
      exists: true,
      value: rawValue
    });
  });

  it("preserves the original file when rename fails and cleans up the temp file", async () => {
    const directoryPath = await createTempDirectory();
    const configPath = path.join(directoryPath, ".codex-doctor.json");
    const originalBytes = "{\n  \"baseline\": true\n}\n";

    await writeFile(configPath, originalBytes, "utf8");

    await expect(
      writeRawDoctorConfig(
        configPath,
        { baseline: false },
        {
          rename: async () => {
            throw new Error("rename failed");
          }
        }
      )
    ).rejects.toThrow("rename failed");

    expect(await readFile(configPath, "utf8")).toBe(originalBytes);
    expect(await readdir(directoryPath)).toEqual([".codex-doctor.json"]);
  });
});
