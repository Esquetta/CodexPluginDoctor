import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

import { runCli } from "../src/run-cli.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      writeStdout(message: string) {
        stdout.push(message);
      },
      writeStderr(message: string) {
        stderr.push(message);
      }
    }
  };
}

const codexHomeFixture = path.resolve("tests/fixtures/codex-home");

describe("doctor snapshot command", () => {
  it("renders a redacted diagnostics snapshot as JSON", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "snapshot", "--json"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {
          CODEX_HOME: codexHomeFixture,
          npm_config_prefix: "C:\\npm-global",
          OPENAI_API_KEY: "SHOULD_NOT_LEAK"
        },
        platform: "win32"
      }
    });
    const rawOutput = stdout.join("");
    const output = JSON.parse(rawOutput);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toMatchObject({
      schemaVersion: "1.0.0",
      version: packageJson.version,
      environment: {
        platform: "win32",
        npmGlobalPrefix: "C:\\npm-global",
        codexHome: {
          status: "pass",
          path: codexHomeFixture
        }
      },
      installedPlugins: {
        count: 2
      }
    });
    expect(output.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(output.clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: "Codex", status: "pass" })
      ])
    );
    expect(rawOutput).not.toContain("SHOULD_NOT_LEAK");
    expect(rawOutput).not.toContain("OPENAI_API_KEY");
  });

  it("writes a diagnostics snapshot bundle to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-snapshot-")),
      "snapshot.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "snapshot", "--output", outputPath], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {
          CODEX_HOME: codexHomeFixture
        },
        platform: "win32"
      }
    });
    const writtenSnapshot = JSON.parse(await readFile(outputPath, "utf8"));
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Codex Plugin Doctor Snapshot");
    expect(output).toContain(`Output: ${outputPath}`);
    expect(writtenSnapshot.schemaVersion).toBe("1.0.0");
    expect(writtenSnapshot.installedPlugins.count).toBe(2);
  });

  it("requires a path after doctor snapshot --output", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "snapshot", "--output"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing path after --output.");
  });
});
