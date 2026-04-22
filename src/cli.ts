#!/usr/bin/env node

import { runCli } from "./run-cli.js";

runCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`codex-plugin-doctor failed: ${message}`);
  process.exitCode = 2;
});
