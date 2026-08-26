import test from "node:test";
import assert from "node:assert/strict";
import { assistantText, cleanForSpeech } from "../src/speech-text.mjs";

test("cleanForSpeech removes Markdown mechanics but keeps prose", () => {
  assert.equal(
    cleanForSpeech(
      "## Next\n\n- **Bench press**: [three sets](https://example.com)\n```json\n{\"ignore\":true}\n```",
    ),
    "Next Bench press : three sets",
  );
});

test("assistantText reads Pi-style assistant text blocks", () => {
  assert.equal(
    assistantText({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "First" },
        { type: "text", text: "Second" },
      ],
    }),
    "First\nSecond",
  );
  assert.equal(assistantText({ role: "user", content: "No" }), "");
});
