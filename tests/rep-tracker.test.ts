import { describe, expect, test } from "bun:test";
import {
  containsRepTerminator,
  latestSpokenNumber,
  RepTracker,
} from "../src/rep-tracker";


describe("latestSpokenNumber", () => {
  test("uses the final spoken rep ordinal", () => {
    expect(latestSpokenNumber("one two three four five six seven done")).toBe(7);
    expect(latestSpokenNumber("1, 2, 3, 4, 6, 7")).toBe(7);
  });

  test("supports compound numbers", () => {
    expect(latestSpokenNumber("eighteen nineteen twenty twenty one done")).toBe(21);
    expect(latestSpokenNumber("ninety nine finished")).toBe(99);
  });

  test("detects the explicit terminator", () => {
    expect(containsRepTerminator("seven, done")).toBe(true);
    expect(containsRepTerminator("not done yet")).toBe(true);
    expect(containsRepTerminator("seven")).toBe(false);
  });
});

describe("RepTracker", () => {
  test("preserves ordinals across separate speech turns", () => {
    const tracker = new RepTracker();
    tracker.begin("bench set one");
    tracker.add("one two three");
    tracker.finishTurn("one two three");
    tracker.add("four five six");
    tracker.finishTurn("four five six");
    const result = tracker.add("seven done");

    expect(result?.latestNumber).toBe(7);
    expect(result?.complete).toBe(true);
    expect(result?.context).toBe("bench set one");
  });
});
