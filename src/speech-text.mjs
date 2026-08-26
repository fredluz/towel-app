/**
 * Convert an assistant Markdown response into speech-friendly plain text.
 *
 * This is intentionally conservative: it preserves prose while removing markup and
 * code that would be painful for macOS `say` to read aloud.
 *
 * @param {string} input
 * @returns {string}
 */
export function cleanForSpeech(input) {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract text blocks from a Pi assistant message without depending on an exact
 * provider message implementation.
 *
 * @param {unknown} message
 * @returns {string}
 */
export function assistantText(message) {
  if (!message || typeof message !== "object") return "";

  const value = /** @type {{role?: unknown, content?: unknown}} */ (message);
  if (value.role !== "assistant") return "";

  if (typeof value.content === "string") return value.content;

  if (Array.isArray(value.content)) {
    return value.content
      .filter(
        (block) =>
          block &&
          typeof block === "object" &&
          /** @type {{type?: unknown}} */ (block).type === "text",
      )
      .map((block) => {
        const text = /** @type {{text?: unknown}} */ (block).text;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}
