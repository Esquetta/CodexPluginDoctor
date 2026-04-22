import type { CliIo } from "../run-cli.js";
import type { SpinnerDefinition } from "./spinner-registry.js";

export interface LiveStatusRenderer {
  start(label: string): void;
  update(label: string): void;
  stopSuccess(label: string): void;
  stopFailure(label: string): void;
}

function clearLine(): string {
  return "\r\x1B[2K";
}

export function createLiveStatusRenderer(
  io: Pick<CliIo, "writeStderr">,
  spinner: SpinnerDefinition
): LiveStatusRenderer {
  let frameIndex = 0;
  let currentLabel = "";
  let timer: NodeJS.Timeout | null = null;

  const renderFrame = () => {
    const frame = spinner.frames[frameIndex % spinner.frames.length];
    frameIndex += 1;
    io.writeStderr(`${clearLine()}${frame} ${currentLabel}`);
  };

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    start(label: string) {
      currentLabel = label;
      renderFrame();
      timer = setInterval(renderFrame, spinner.intervalMs);
    },
    update(label: string) {
      currentLabel = label;
      renderFrame();
    },
    stopSuccess(label: string) {
      stopTimer();
      io.writeStderr(`${clearLine()}✔ ${label}\n`);
    },
    stopFailure(label: string) {
      stopTimer();
      io.writeStderr(`${clearLine()}✖ ${label}\n`);
    }
  };
}

