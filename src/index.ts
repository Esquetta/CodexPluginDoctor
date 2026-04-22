import type { CheckResult } from "./domain/types.js";
import { validatePlugin } from "./core/validate-plugin.js";

export async function runCheck(targetPath: string): Promise<CheckResult> {
  return validatePlugin(targetPath);
}

