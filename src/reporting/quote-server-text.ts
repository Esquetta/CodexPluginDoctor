// Characters that JSON leaves as they are but that can still drive a terminal, end a line, or reorder text.
const UNSAFE_TEXT = /[\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;

/** Quotes server-supplied text, such as a tool name or a JSON Pointer, as a JSON string that only holds printable characters. */
export function quoteServerText(text: string): string {
  return JSON.stringify(text).replace(UNSAFE_TEXT, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
