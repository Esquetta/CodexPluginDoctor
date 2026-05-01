import { readFile } from "node:fs/promises";

export function parseJsonText<T>(text: string): T {
  const normalizedText = text.startsWith("\uFEFF") ? text.slice(1) : text;

  return JSON.parse(normalizedText) as T;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return parseJsonText<T>(await readFile(filePath, "utf8"));
}
