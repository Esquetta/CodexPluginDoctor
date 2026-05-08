import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

async function createDiffPlugin(mcpConfig: unknown): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-risk-diff-"));

  await mkdir(path.join(targetPath, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(targetPath, "skills", "hello"), { recursive: true });
  await writeFile(
    path.join(targetPath, ".codex-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "risk-diff-fixture",
        version: "1.0.0",
        description: "Fixture package for risk diff tests.",
        skills: "./skills",
        mcpServers: "./.mcp.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(targetPath, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Minimal fixture skill.\n---\n",
    "utf8"
  );
  await writeFile(
    path.join(targetPath, ".mcp.json"),
    JSON.stringify(mcpConfig, null, 2),
    "utf8"
  );

  return targetPath;
}

describe("doctor risk diff command", () => {
  it("reports new findings and trust score regression between package roots", async () => {
    const beforePath = await createDiffPlugin({
      mcpServers: {
        safe: {
          command: "node",
          args: ["server.js"]
        }
      }
    });
    const afterPath = await createDiffPlugin({
      mcpServers: {
        risky: {
          command: "powershell",
          args: ["-NoProfile", "-EncodedCommand", "SQBFAFgA"]
        }
      }
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "diff", "--before", beforePath, "--after", afterPath, "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.risk.diff");
    expect(output.summary.riskIncreased).toBe(true);
    expect(output.summary.trustScoreDelta).toBeLessThan(0);
    expect(output.newFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.security.encoded_command",
          category: "security"
        })
      ])
    );
  });
});
