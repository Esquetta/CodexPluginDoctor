import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLiveStatusRenderer } from "../src/terminal/live-status-renderer.js";
import { getSpinner } from "../src/terminal/spinner-registry.js";

describe("spinner registry", () => {
  it("provides built-in spinner definitions", () => {
    const spinner = getSpinner("braille");

    expect(spinner.frames.length).toBeGreaterThan(1);
    expect(spinner.intervalMs).toBeGreaterThan(0);
  });

  it("exposes the branded doctor spinner", () => {
    const spinner = getSpinner("doctor");

    expect(spinner.name).toBe("doctor");
    expect(spinner.frames.length).toBeGreaterThan(1);
  });
});

describe("createLiveStatusRenderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders spinner frames to stderr and ends with a success marker", async () => {
    const stderr: string[] = [];
    const renderer = createLiveStatusRenderer(
      {
        writeStderr(message: string) {
          stderr.push(message);
        }
      },
      getSpinner("dots")
    );

    renderer.start("Validating package");
    await vi.advanceTimersByTimeAsync(250);
    renderer.stopSuccess("Validation complete");

    expect(stderr.join("")).toContain("Validating package");
    expect(stderr.join("")).toContain("Validation complete");
    expect(stderr.join("")).toContain("✔");
  });
});
