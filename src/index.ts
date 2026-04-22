import type { CheckOptions, CheckResult } from "./domain/types.js";
import { validatePlugin } from "./core/validate-plugin.js";

export async function runCheck(
  targetPath: string,
  options: CheckOptions = {}
): Promise<CheckResult> {
  return validatePlugin(targetPath, options);
}
