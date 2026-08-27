import { describe, expect, test } from "bun:test";
import { normalizeAnnouncements, TimerService } from "../src/timer-service";

describe("normalizeAnnouncements", () => {
  test("keeps only supplied plan milestones and sorts them chronologically", () => {
    expect(
      normalizeAnnouncements(30, [
        { remainingSeconds: 5, text: "Five seconds" },
        { remainingSeconds: 15, text: "Fifteen seconds" },
      ]),
    ).toEqual([
      { remainingSeconds: 15, text: "Fifteen seconds" },
      { remainingSeconds: 5, text: "Five seconds" },
    ]);
  });

  test("rejects milestones outside the exact timer", () => {
    expect(() =>
      normalizeAnnouncements(10, [{ remainingSeconds: 11, text: "Impossible" }]),
    ).toThrow();
  });
});

describe("TimerService", () => {
  test("speaks supplied messages and emits completion", async () => {
    const spoken: string[] = [];
    const completed: string[] = [];
    const timers = new TimerService({
      speak: (text) => {
        spoken.push(text);
      },
      complete: ({ label }) => {
        completed.push(label);
      },
    });

    timers.start({
      label: "stretch",
      durationSeconds: 0.04,
      announcements: [{ remainingSeconds: 0.02, text: "Halfway" }],
      completionMessage: "Stretch done",
    });

    await Bun.sleep(90);
    expect(spoken).toEqual(["Halfway", "Stretch done"]);
    expect(completed).toEqual(["stretch"]);
    expect(timers.list()).toEqual([]);
  });
});
