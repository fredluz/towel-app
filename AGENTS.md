# Towel development guide

Towel is deliberately thin:

- The active workout Markdown file is the plan and the log.
- Pi is responsible for reasoning, conversation, and editing that Markdown.
- The runtime owns only deterministic real-time primitives: microphone transcription,
  wake gating, contextual reply capture, rep ordinal capture, timers, and speech output.
- Do not introduce a workout database, exercise ontology, or rigid workout schema.
- Do not infer training decisions. Execute the document and the user's changes.
- Timer durations and announcement milestones must come from Pi/the workout document.
- Keep the macOS voice process isolated behind JSON Lines over stdin/stdout.
- Preserve the ability to replace the speech implementation without changing the Pi
  extension contract.

Run:

```bash
npm test
npm run typecheck
swift test --package-path voice
```
