import { realpath } from "node:fs/promises";
import path from "node:path";

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export async function resolveContainedPackagePath(
  rootPath: string,
  candidatePath: string
): Promise<string | null> {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedCandidatePath = path.resolve(resolvedRootPath, candidatePath);

  if (!isPathWithinRoot(resolvedRootPath, resolvedCandidatePath)) {
    return null;
  }

  try {
    const [canonicalRootPath, canonicalCandidatePath] = await Promise.all([
      realpath(resolvedRootPath),
      realpath(resolvedCandidatePath)
    ]);

    return isPathWithinRoot(canonicalRootPath, canonicalCandidatePath)
      ? resolvedCandidatePath
      : null;
  } catch {
    return resolvedCandidatePath;
  }
}
