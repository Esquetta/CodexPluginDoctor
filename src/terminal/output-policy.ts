export interface OutputPolicyInput {
  jsonOutput: boolean;
  markdownOutput: boolean;
  outputPath: string | null;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  env: Record<string, string | undefined>;
}

export interface OutputPolicy {
  interactive: boolean;
  reason:
    | "tty"
    | "machine_output"
    | "redirected_output"
    | "ci"
    | "dumb_terminal"
    | "non_tty";
}

export function determineOutputPolicy(
  input: OutputPolicyInput
): OutputPolicy {
  if (input.jsonOutput || input.markdownOutput) {
    return {
      interactive: false,
      reason: "machine_output"
    };
  }

  if (input.outputPath) {
    return {
      interactive: false,
      reason: "redirected_output"
    };
  }

  if (input.env.CI) {
    return {
      interactive: false,
      reason: "ci"
    };
  }

  if (input.env.TERM === "dumb") {
    return {
      interactive: false,
      reason: "dumb_terminal"
    };
  }

  if (!input.stdoutIsTTY || !input.stderrIsTTY) {
    return {
      interactive: false,
      reason: "non_tty"
    };
  }

  return {
    interactive: true,
    reason: "tty"
  };
}

