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
    it("scopes bash submission flags to doctor submission", () => {
      const output = generateCompletion("bash");

      expect(output).toContain("_codex_plugin_doctor");
      expect(output).toContain("complete -F");
      expect(output).toContain("check");
      expect(output).toContain("audit");
      expect(output).toContain("init-git-hooks");
      expect(output).toContain("submission");
      expect(output).toContain('local submission_flags="--json --markdown --output --require-ready"');
      expect(output).toContain('local flags="--json --output --runtime --policy --help"');
      expect(output).toContain('${COMP_WORDS[1]} == "doctor"');
    });

    it("scopes zsh submission flags to doctor submission", () => {
      const output = generateCompletion("zsh");

      expect(output).toContain("#compdef codex-plugin-doctor");
      expect(output).toContain("_arguments");
      expect(output).toContain("check");
      expect(output).toContain("submission");
      expect(output).toContain('[[ "$words[2]" == "doctor" && "$words[3]" == "submission" ]]');
      expect(output).toContain("'*--require-ready[Fail when automatic checks are blocked]'");
      expect(output).toContain("'*--runtime[Enable runtime probes]'");
    });

    it("scopes fish submission flags to doctor submission", () => {
      const output = generateCompletion("fish");

      expect(output).toContain("complete -c codex-plugin-doctor");
      expect(output).toContain("__fish_seen_subcommand_from");
      expect(output).toContain("codex-publish");
      expect(output).toContain("submission");
      expect(output).toContain('__fish_seen_subcommand_from doctor; and __fish_seen_subcommand_from submission');
      expect(output).toContain('-l require-ready');
      expect(output).not.toContain('complete -c codex-plugin-doctor -l require-ready');
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
