import path from "node:path";

import type { RuntimeExecutionEvidence, RuntimeSandboxMode } from "../domain/types.js";

export interface RuntimeLaunchInput {
  sandbox: RuntimeSandboxMode;
  packageRoot: string;
  cwd: string;
  command: string;
  args: string[];
  containerName: string;
}

export interface RuntimeLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  containerName: string;
  evidence: RuntimeExecutionEvidence;
}

export class RuntimeSandboxError extends Error {}

export const DOCKER_RUNTIME_STARTUP_TIMEOUT_MS = 60_000;
export const DOCKER_RUNTIME_IMAGE =
  "node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3";

export function buildRuntimeLaunch(input: RuntimeLaunchInput): RuntimeLaunchSpec {
  if (input.sandbox !== "docker") {
    throw new RuntimeSandboxError("Unsupported sandbox mode.");
  }

  if (!/^(node|node\.exe)$/i.test(path.basename(input.command))) {
    throw new RuntimeSandboxError("Docker sandbox supports Node.js stdio commands only.");
  }

  const relativeCwd = path.relative(input.packageRoot, input.cwd);

  if (relativeCwd.startsWith("..") || path.isAbsolute(relativeCwd)) {
    throw new RuntimeSandboxError("Runtime cwd escapes the package root.");
  }

  if (input.packageRoot.includes(",")) {
    throw new RuntimeSandboxError("Docker sandbox does not support commas in package paths.");
  }

  const workdir = relativeCwd
    ? `/workspace/${relativeCwd.split(path.sep).join("/")}`
    : "/workspace";

  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      "-i",
      "--init",
      "--name",
      input.containerName,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "65532:65532",
      "--pids-limit",
      "64",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m",
      "--mount",
      `type=bind,source=${input.packageRoot},target=/workspace,readonly`,
      "--workdir",
      workdir,
      DOCKER_RUNTIME_IMAGE,
      "node",
      ...input.args
    ],
    cwd: input.packageRoot,
    containerName: input.containerName,
    evidence: {
      backend: "docker",
      image: DOCKER_RUNTIME_IMAGE,
      network: "none",
      packageMount: "read_only"
    }
  };
}
