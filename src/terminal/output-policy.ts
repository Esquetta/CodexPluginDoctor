export interface OutputPolicyInput {
  jsonOutput: boolean;
  markdownOutput: boolean;
  outputPath: string | null;
  noAnimations: boolean;
  asciiMode: boolean;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  env: Record<string, string | undefined>;
}

export interface OutputPolicy {
  interactive: boolean;
  style: "unicode" | "ascii";
  reason:
    | "tty"
    | "machine_output"
    | "redirected_output"
    | "ci"
    | "dumb_terminal"
    | "non_tty"
    | "disabled_by_flag";
}

export function determineOutputPolicy(
  input: OutputPolicyInput
): OutputPolicy {
  const style = input.asciiMode ? "ascii" : "unicode";

  if (input.jsonOutput || input.markdownOutput) {
    return {
      interactive: false,
      style,
      reason: "machine_output"
    };
  }

  if (input.outputPath) {
    return {
      interactive: false,
      style,
      reason: "redirected_output"
    };
  }

  if (input.env.CI) {
    return {
      interactive: false,
      style,
      reason: "ci"
    };
  }

  if (input.env.TERM === "dumb") {
    return {
      interactive: false,
      style: "ascii",
      reason: "dumb_terminal"
    };
  }

  if (!input.stdoutIsTTY || !input.stderrIsTTY) {
    return {
      interactive: false,
      style,
      reason: "non_tty"
    };
  }

  if (input.noAnimations) {
    return {
      interactive: false,
      style,
      reason: "disabled_by_flag"
    };
  }

  return {
    interactive: true,
    style,
    reason: "tty"
  };
}
