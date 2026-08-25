import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

describe("submission archive dispatch", () => {
  it("preserves archive as a legacy directory target when it exists", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-directory-target-"));
    const previousDirectory = process.cwd();
    const { io, stdout, stderr } = createIo();
    try {
      await mkdir(path.join(directory, "archive"));
      process.chdir(directory);

      expect(await runCli(["doctor", "submission", "archive"], io)).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join("")).toContain("Submission preflight");
      expect(stdout.join("")).not.toContain("Submission archive preflight");
    } finally {
      process.chdir(previousDirectory);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses archive-aware file completion after the archive target", () => {
    const bash = generateCompletion("bash");
    const zsh = generateCompletion("zsh");
    const fish = generateCompletion("fish");

    expect(bash).toContain('${COMP_WORDS[3]} == "archive"');
    expect(bash).toContain('COMPREPLY=( $(compgen -f -- "${cur}") )');
    expect(zsh).toContain("'4:ZIP archive:_files'");
    expect(fish).toContain('__fish_seen_subcommand_from archive" -F');
  });
});
