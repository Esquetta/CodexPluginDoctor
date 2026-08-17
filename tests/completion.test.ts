import { describe, expect, it } from "vitest";
import { generateCompletion } from "../src/core/shell-completion.js";
import { runCli } from "../src/run-cli.js";

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

describe("shell completion", () => {
  describe("generateCompletion", () => {
    it("generates bash completion script", () => {
      const output = generateCompletion("bash");

      expect(output).toContain("_codex_plugin_doctor");
      expect(output).toContain("complete -F");
      expect(output).toContain("check");
      expect(output).toContain("audit");
      expect(output).toContain("init-git-hooks");
      expect(output).toContain("submission");
      expect(output).toContain("--markdown");
      expect(output).toContain("--require-ready");
    });

    it("generates zsh completion script", () => {
      const output = generateCompletion("zsh");

      expect(output).toContain("#compdef codex-plugin-doctor");
      expect(output).toContain("_arguments");
      expect(output).toContain("check");
      expect(output).toContain("submission");
      expect(output).toContain("--markdown");
    });

    it("generates fish completion script", () => {
      const output = generateCompletion("fish");

      expect(output).toContain("complete -c codex-plugin-doctor");
      expect(output).toContain("__fish_seen_subcommand_from");
      expect(output).toContain("codex-publish");
      expect(output).toContain("submission");
      expect(output).toContain("-l markdown");
    });
  });

  describe("CLI", () => {
    it("outputs bash completion", async () => {
      const { io, stdout } = createIo();

      const exitCode = await runCli(["completion", "bash"], io);

      expect(exitCode).toBe(0);
      expect(stdout.join("")).toContain("_codex_plugin_doctor");
    });

    it("outputs zsh completion", async () => {
      const { io, stdout } = createIo();

      const exitCode = await runCli(["completion", "zsh"], io);

      expect(exitCode).toBe(0);
      expect(stdout.join("")).toContain("#compdef");
    });

    it("outputs fish completion", async () => {
      const { io, stdout } = createIo();

      const exitCode = await runCli(["completion", "fish"], io);

      expect(exitCode).toBe(0);
      expect(stdout.join("")).toContain("complete -c codex-plugin-doctor");
    });

    it("rejects invalid shell", async () => {
      const { io, stderr } = createIo();

      const exitCode = await runCli(["completion", "invalid"], io);

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("Usage");
    });

    it("rejects missing shell argument", async () => {
      const { io, stderr } = createIo();

      const exitCode = await runCli(["completion"], io);

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("Usage");
    });
  });
});
