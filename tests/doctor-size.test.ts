import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessMocks.execFile
}));

import { runCli } from "../src/run-cli.js";
import { buildDoctorSize, renderDoctorSize, renderDoctorSizeJson } from "../src/core/doctor-size.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      writeStdout(message: string) { stdout.push(message); },
      writeStderr(message: string) { stderr.push(message); }
    }
  };
}

describe("doctor size", () => {
  beforeEach(() => {
    childProcessMocks.execFile.mockReset();
  });

  describe("buildDoctorSize", () => {
    it("analyzes a small package", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-size-"));
      await writeFile(path.join(dir, "file.txt"), "hello", "utf8");

      const report = await buildDoctorSize(dir);

      expect(report.status).toBe("pass");
      expect(report.fileCount).toBe(1);
      expect(report.totalSize).toBe(5);
      expect(report.largeFiles).toEqual([]);
    });

    it("flags a large file", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-size-"));
      const largeContent = Buffer.alloc(2 * 1024 * 1024, "x");
      await writeFile(path.join(dir, "big.bin"), largeContent);

      const report = await buildDoctorSize(dir);

      expect(report.largeFiles.length).toBe(1);
      expect(report.largeFiles[0].path).toBe("big.bin");
    });

    it("skips node_modules directories", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-size-"));
      const nmDir = path.join(dir, "node_modules");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(nmDir, { recursive: true });
      await writeFile(path.join(nmDir, "dep.js"), "console.log('dep');");
      await writeFile(path.join(dir, "index.js"), "console.log('main');");

      const report = await buildDoctorSize(dir);

      expect(report.fileCount).toBe(1);
    });

    it("launches npm pack on Windows with explicit Node arguments and no shell", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-size-"));
      const npmCliPath = path.join(dir, "npm-cli.js");
      const originalNpmExecPath = process.env.npm_execpath;
      const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
      childProcessMocks.execFile.mockImplementation(
        (
          _command: string,
          _args: string[],
          _options: object,
          callback: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          callback(null, "package size: 1.0 kB", "");
          return {};
        }
      );

      try {
        process.env.npm_execpath = npmCliPath;
        Object.defineProperty(process, "platform", { value: "win32", configurable: true });

        await buildDoctorSize(dir, { npmPack: true });

        expect(childProcessMocks.execFile).toHaveBeenCalledWith(
          process.execPath,
          [npmCliPath, "pack", "--dry-run"],
          expect.objectContaining({ cwd: path.resolve(dir), timeout: 30_000 }),
          expect.any(Function)
        );
        expect(childProcessMocks.execFile.mock.calls[0][2]).not.toHaveProperty("shell");
      } finally {
        if (originalNpmExecPath === undefined) {
          delete process.env.npm_execpath;
        } else {
          process.env.npm_execpath = originalNpmExecPath;
        }

        if (originalPlatformDescriptor) {
          Object.defineProperty(process, "platform", originalPlatformDescriptor);
        } else {
          Reflect.deleteProperty(process, "platform");
        }
      }
    });
  });

  describe("renderers", () => {
    it("renders a pass report", () => {
      const report = {
        targetPath: "/test",
        status: "pass" as const,
        totalSize: 1024,
        totalSizeHuman: "1.0 KB",
        fileCount: 10,
        largeFiles: [],
        warnings: []
      };

      const output = renderDoctorSize(report);

      expect(output).toContain("Status: PASS");
      expect(output).toContain("1.0 KB");
      expect(output).toContain("10 files");
      expect(output).toContain("within acceptable limits");
    });

    it("renders a warn report with large files", () => {
      const report = {
        targetPath: "/test",
        status: "warn" as const,
        totalSize: 15 * 1024 * 1024,
        totalSizeHuman: "15.0 MB",
        fileCount: 100,
        largeFiles: [{ path: "assets/large.bin", size: 5 * 1024 * 1024, sizeHuman: "5.0 MB" }],
        warnings: ["1 file(s) exceed 1.0 MB."]
      };

      const output = renderDoctorSize(report);

      expect(output).toContain("Status: WARN");
      expect(output).toContain("large.bin");
      expect(output).toContain("Warnings");
    });

    it("renders JSON output", () => {
      const report = {
        targetPath: "/test",
        status: "pass" as const,
        totalSize: 512,
        totalSizeHuman: "512 B",
        fileCount: 5,
        largeFiles: [],
        warnings: []
      };

      const json = JSON.parse(renderDoctorSizeJson(report));

      expect(json).toMatchObject({
        schemaVersion: "1.0.0",
        status: "pass",
        fileCount: 5,
        totalSize: 512
      });
    });
  });

  describe("CLI", () => {
    it("runs doctor size via CLI", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-size-"));
      await writeFile(path.join(dir, "test.txt"), "hello", "utf8");
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["doctor", "size", dir], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join("")).toContain("Size Analysis");
      expect(stdout.join("")).toContain("within acceptable limits");
    });

    it("runs doctor size with JSON output", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-size-"));
      await writeFile(path.join(dir, "test.txt"), "hello", "utf8");
      const { io, stdout } = createIo();

      const exitCode = await runCli(["doctor", "size", dir, "--json"], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(0);
      expect(output).toMatchObject({ schemaVersion: "1.0.0", status: "pass" });
      expect(output.totalSize).toBe(5);
    });
  });
});
