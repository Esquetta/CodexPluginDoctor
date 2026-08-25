import { describe, expect, it } from "vitest";

import { generateCompletion } from "../src/core/shell-completion.js";

describe("submission archive shell completion", () => {
  it("uses standalone Bash file completion after archive while retaining scoped flags", () => {
    const output = generateCompletion("bash");

    expect(output).toContain('COMPREPLY=( $(compgen -f -- "${cur}") )');
    expect(output).not.toContain("_filedir");
    expect(output).toContain('local submission_flags="--json --markdown --output --require-ready"');
  });

  it("uses real CLI argument positions for Zsh archive and ZIP completion", () => {
    const output = generateCompletion("zsh");

    expect(output).toContain("'3:archive target:(archive)'");
    expect(output).toContain("'4:ZIP archive:_files'");
    expect(output).not.toContain("'1:archive target:(archive)'");
    expect(output).not.toContain("'2:ZIP archive:_files'");
  });
});
