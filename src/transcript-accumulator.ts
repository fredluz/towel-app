function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function mergeIncremental(current: string, incoming: string): string {
  if (!current) return incoming;
  if (!incoming || incoming === current || current.endsWith(incoming)) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  return `${current} ${incoming}`;
}

/**
 * Coalesces streaming transcript updates while preserving completed speech turns.
 * Realtime providers may emit either full partials or small appended fragments.
 */
export class TranscriptAccumulator {
  #completed: string[] = [];
  #partial = "";

  add(text: string): string {
    const incoming = normalize(text);
    if (!incoming) return this.text;
    this.#partial = mergeIncremental(this.#partial, incoming);
    return this.text;
  }

  finish(text = ""): string {
    const incoming = normalize(text);
    const finalTurn = mergeIncremental(this.#partial, incoming);
    if (finalTurn) this.#completed.push(finalTurn);
    this.#partial = "";
    return this.text;
  }

  get text(): string {
    return [...this.#completed, ...(this.#partial ? [this.#partial] : [])].join(" ").trim();
  }

  reset(): void {
    this.#completed = [];
    this.#partial = "";
  }
}
