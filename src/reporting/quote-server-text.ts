// Control, format, and line or paragraph separator characters, which can drive a terminal, end a line,
// reorder text, or hide in it; JSON escapes only the C0 controls among them.
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Quotes server-supplied text, such as a tool name or a JSON Pointer, as a JSON string that only holds printable characters. */
export function quoteServerText(text: string): string {
  return JSON.stringify(text).replace(UNSAFE_TEXT, (character) =>
    Array.from({ length: character.length }, (_, index) => `\\u${character.charCodeAt(index).toString(16).padStart(4, "0")}`).join(""));
}

// Names and pointers come from the server, so they are quoted and put in a code span, where Markdown,
// HTML, mentions, and links stay inert; the fence outgrows any backtick run, and pipes are escaped for the table.
export function markdownCodeSpan(text: string): string {
  const quoted = quoteServerText(text);
  let run = 0;
  let longest = 0;
  for (const character of quoted) {
    run = character === "`" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const fence = "`".repeat(longest + 1);
  return `${fence}${quoted.replace(/\|/gu, "\\|")}${fence}`;
}
