export interface SpinnerDefinition {
  name: string;
  frames: string[];
  intervalMs: number;
}

const spinners: Record<string, SpinnerDefinition> = {
  braille: {
    name: "braille",
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    intervalMs: 80
  },
  dots: {
    name: "dots",
    frames: ["⠁", "⠂", "⠄", "⠂"],
    intervalMs: 90
  },
  scan: {
    name: "scan",
    frames: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"],
    intervalMs: 70
  },
  ascii: {
    name: "ascii",
    frames: ["-", "\\", "|", "/"],
    intervalMs: 90
  }
};

export function getSpinner(name: keyof typeof spinners): SpinnerDefinition {
  return spinners[name];
}

