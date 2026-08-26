import test from "node:test";
import assert from "node:assert/strict";
import {
  TimerService,
  normalizeAnnouncements,
} from "../src/timer-service.mjs";

test("normalizes timer milestones without inventing any", () => {
  assert.deepEqual(
    normalizeAnnouncements(90, [
      { remainingSeconds: 10, text: "Ten seconds" },
      { remainingSeconds: 45, text: "Halfway" },
      { remainingSeconds: 10, text: "Ten remain" },
    ]),
    [
      { remainingSeconds: 45, text: "Halfway" },
      { remainingSeconds: 10, text: "Ten remain" },
    ],
  );
});

test("rejects milestones outside the exact timer", () => {
  assert.throws(
    () =>
      normalizeAnnouncements(30, [
        { remainingSeconds: 31, text: "Impossible" },
      ]),
    /between 0 and 30/,
  );
});

test("timer speaks supplied completion text and emits completion", async () => {
  /** @type {string[]} */
  const spoken = [];
  /** @type {{id: string, label: string, durationSeconds: number}[]} */
  const completed = [];
  const timer = new TimerService({
    speaker: {
      say: async (text) => {
        spoken.push(text);
      },
    },
    onComplete: async (event) => {
      completed.push(event);
    },
  });

  const id = timer.start({
    label: "test stretch",
    durationSeconds: 0.02,
    completionMessage: "Stretch complete",
  });

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(spoken, ["Stretch complete"]);
  assert.equal(completed[0].id, id);
  assert.equal(completed[0].label, "test stretch");
  assert.deepEqual(timer.list(), []);
});
