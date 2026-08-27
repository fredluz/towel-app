import { TranscriptAccumulator } from "./transcript-accumulator";

const SMALL_NUMBERS: Readonly<Record<string, number>> = {
  zero: 0,
  oh: 0,
  one: 1,
  won: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function numberAt(tokens: readonly string[], index: number): { value: number; consumed: number } | undefined {
  const token = tokens[index];
  if (!token) return undefined;

  if (/^\d{1,4}$/.test(token)) {
    return { value: Number.parseInt(token, 10), consumed: 1 };
  }

  const small = SMALL_NUMBERS[token];
  if (small !== undefined) {
    if (small >= 1 && small <= 9 && tokens[index + 1] === "hundred") {
      let value = small * 100;
      let consumed = 2;
      const nextTens = TENS[tokens[index + 2] ?? ""];
      if (nextTens !== undefined) {
        value += nextTens;
        consumed += 1;
        const unit = SMALL_NUMBERS[tokens[index + 3] ?? ""];
        if (unit !== undefined && unit >= 1 && unit <= 9) {
          value += unit;
          consumed += 1;
        }
      } else {
        const remainder = SMALL_NUMBERS[tokens[index + 2] ?? ""];
        if (remainder !== undefined && remainder >= 1 && remainder <= 19) {
          value += remainder;
          consumed += 1;
        }
      }
      return { value, consumed };
    }
    return { value: small, consumed: 1 };
  }

  const tens = TENS[token];
  if (tens !== undefined) {
    const unit = SMALL_NUMBERS[tokens[index + 1] ?? ""];
    if (unit !== undefined && unit >= 1 && unit <= 9) {
      return { value: tens + unit, consumed: 2 };
    }
    return { value: tens, consumed: 1 };
  }

  if (token === "hundred") return { value: 100, consumed: 1 };
  return undefined;
}

/** Return the final number explicitly spoken in a transcript. */
export function latestSpokenNumber(text: string): number | undefined {
  const tokens = text
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let latest: number | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const parsed = numberAt(tokens, index);
    if (!parsed) continue;
    latest = parsed.value;
    index += parsed.consumed - 1;
  }
  return latest;
}

export function containsRepTerminator(text: string): boolean {
  return /\b(?:done|finished)\b/i.test(text);
}

export interface RepProgress {
  context: string;
  transcript: string;
  latestNumber: number | undefined;
  complete: boolean;
}

/** Deterministic state for one live, spoken-rep set. */
export class RepTracker {
  #context = "";
  #active = false;
  #transcript = new TranscriptAccumulator();

  begin(context: string): void {
    this.#context = context.trim();
    this.#active = true;
    this.#transcript.reset();
  }

  add(text: string): RepProgress | undefined {
    if (!this.#active) return undefined;
    return this.#snapshot(this.#transcript.add(text));
  }

  finishTurn(text: string): RepProgress | undefined {
    if (!this.#active) return undefined;
    return this.#snapshot(this.#transcript.finish(text));
  }

  stop(): RepProgress | undefined {
    if (!this.#active) return undefined;
    const result = this.#snapshot(this.#transcript.text, true);
    this.#active = false;
    return result;
  }

  reset(): void {
    this.#active = false;
    this.#context = "";
    this.#transcript.reset();
  }

  get active(): boolean {
    return this.#active;
  }

  get context(): string {
    return this.#context;
  }

  #snapshot(transcript: string, forceComplete = false): RepProgress {
    return {
      context: this.#context,
      transcript,
      latestNumber: latestSpokenNumber(transcript),
      complete: forceComplete || containsRepTerminator(transcript),
    };
  }
}
