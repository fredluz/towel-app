import { describe, expect, test } from "bun:test";
import { TranscriptAccumulator } from "../src/transcript-accumulator";

describe("TranscriptAccumulator", () => {
  test("coalesces expanding partial transcripts", () => {
    const transcript = new TranscriptAccumulator();
    transcript.add("one two");
    transcript.add("one two three");
    expect(transcript.text).toBe("one two three");
  });

  test("preserves completed turns", () => {
    const transcript = new TranscriptAccumulator();
    transcript.add("one two");
    transcript.finish("one two");
    transcript.add("three four");
    transcript.finish("three four");
    expect(transcript.text).toBe("one two three four");
  });
});
