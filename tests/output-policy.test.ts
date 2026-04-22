import { describe, expect, it } from "vitest";

import { determineOutputPolicy } from "../src/terminal/output-policy.js";

describe("determineOutputPolicy", () => {
  it("enables interactive mode for human text output in a TTY", () => {
    const policy = determineOutputPolicy({
      jsonOutput: false,
      markdownOutput: false,
      outputPath: null,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      env: {}
    });

    expect(policy.interactive).toBe(true);
    expect(policy.reason).toBe("tty");
  });

  it("disables interactive mode for JSON output", () => {
    const policy = determineOutputPolicy({
      jsonOutput: true,
      markdownOutput: false,
      outputPath: null,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      env: {}
    });

    expect(policy.interactive).toBe(false);
    expect(policy.reason).toBe("machine_output");
  });

  it("disables interactive mode when writing to a file", () => {
    const policy = determineOutputPolicy({
      jsonOutput: false,
      markdownOutput: false,
      outputPath: "report.txt",
      stdoutIsTTY: true,
      stderrIsTTY: true,
      env: {}
    });

    expect(policy.interactive).toBe(false);
    expect(policy.reason).toBe("redirected_output");
  });

  it("disables interactive mode in CI", () => {
    const policy = determineOutputPolicy({
      jsonOutput: false,
      markdownOutput: false,
      outputPath: null,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      env: { CI: "true" }
    });

    expect(policy.interactive).toBe(false);
    expect(policy.reason).toBe("ci");
  });

  it("disables interactive mode for non-TTY stderr", () => {
    const policy = determineOutputPolicy({
      jsonOutput: false,
      markdownOutput: false,
      outputPath: null,
      stdoutIsTTY: true,
      stderrIsTTY: false,
      env: {}
    });

    expect(policy.interactive).toBe(false);
    expect(policy.reason).toBe("non_tty");
  });
});

