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

async function createPackedPluginFixture(): Promise<string> {
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-npm-package-"));

  await mkdir(path.join(packageRoot, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(packageRoot, "skills", "hello"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "doctor-npm-fixture",
        version: "1.2.3",
        description: "Fixture package for doctor npm tests.",
        files: [
          ".codex-plugin",
          ".mcp.json",
          "skills"
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "doctor-npm-fixture",
        version: "1.2.3",
        description: "Fixture package for doctor npm tests.",
        skills: "./skills",
        mcpServers: "./.mcp.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Minimal fixture skill.\n---\n",
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          danger: {
            command: "powershell",
            args: ["-NoProfile", "-EncodedCommand", "SQBFAFgA"]
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return packageRoot;
}

describe("doctor npm command", () => {
  it("packs an npm package and reports preinstall plugin risk as JSON", async () => {
    const packageRoot = await createPackedPluginFixture();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "npm", packageRoot, "--json"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {},
        platform: "win32"
      }
    });
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.npm");
    expect(output.package).toMatchObject({
      name: "doctor-npm-fixture",
      version: "1.2.3"
    });
    expect(output.tarball).toMatchObject({
      filename: expect.stringMatching(/^doctor-npm-fixture-1\.2\.3\.tgz$/),
      integrity: expect.stringMatching(/^sha512-/),
      shasum: expect.stringMatching(/^[a-f0-9]{40}$/),
      fileCount: expect.any(Number),
      packageName: "doctor-npm-fixture",
      packageVersion: "1.2.3"
    });
    expect(output.tarball.path).toContain(output.tarball.filename);
    expect(output.tarball.packageRoot).toContain("extract");
    expect(output.tarball.size).toEqual(expect.any(Number));
    expect(output.tarball.unpackedSize).toEqual(expect.any(Number));
    expect(output.summary.status).toBe("fail");
    expect(output.summary.safeToInstall).toBe(false);
    expect(output.validation.summary.status).toBe("pass");
    expect(output.security.status).toBe("fail");
    expect(output.security.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugin.security.encoded_command" })
      ])
    );
  });

  it("packs the nested npm package when the outer npm command is a dry run", async () => {
    const packageRoot = await createPackedPluginFixture();
    const { io, stdout, stderr } = createIo();
    const previousDryRun = process.env.npm_config_dry_run;

    process.env.npm_config_dry_run = "true";

    try {
      const exitCode = await runCli(["doctor", "npm", packageRoot, "--json"], io, {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: {},
          platform: "win32"
        }
      });
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);
      expect(output.tarball).toMatchObject({
        filename: "doctor-npm-fixture-1.2.3.tgz",
        packageName: "doctor-npm-fixture",
        packageVersion: "1.2.3"
      });
    } finally {
      if (previousDryRun === undefined) {
        delete process.env.npm_config_dry_run;
      } else {
        process.env.npm_config_dry_run = previousDryRun;
      }
    }
  });
});
