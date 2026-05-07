import { mkdtemp, readFile } from "node:fs/promises";
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

describe("doctor export bundle command", () => {
  it("renders a redacted bundle with validation, security, compatibility, recommendations, and trust", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "export", "--bundle", "tests/fixtures/security-hardcoded-secret", "--json"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: {
            OPENAI_API_KEY: "SHOULD_NOT_LEAK"
          },
          platform: "win32"
        }
      }
    );
    const rawOutput = stdout.join("");
    const output = JSON.parse(rawOutput);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.export.bundle");
    expect(output.validation.summary.status).toBe("fail");
    expect(output.security.status).toBe("fail");
    expect(output.compatibility.results.length).toBeGreaterThan(0);
    expect(output.recommendations.actions.length).toBeGreaterThan(0);
    expect(output.trust.status).toBe("fail");
    expect(rawOutput).not.toContain("SHOULD_NOT_LEAK");
  });

  it("writes the bundle JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-export-")),
      "doctor-bundle.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "export", "--bundle", "tests/fixtures/security-hardcoded-secret", "--output", outputPath],
      io
    );
    const writtenBundle = JSON.parse(await readFile(outputPath, "utf8"));
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Doctor Export Bundle");
    expect(output).toContain(`Output: ${outputPath}`);
    expect(writtenBundle.kind).toBe("doctor.export.bundle");
    expect(writtenBundle.security.status).toBe("fail");
  });

  it("requires --bundle for doctor export", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "export"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Usage: codex-plugin-doctor doctor export --bundle");
  });
});
