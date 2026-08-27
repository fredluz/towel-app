# Towel development guide

Towel is deliberately thin:

- The active workout Markdown file is both the plan and the evolving log.
- The OMP backend agent reasons, reads/edits Markdown, and uses Towel tools.
- `gpt-live-1-codex` is the continuous headphone conversation surface.
- The runtime owns only deterministic primitives: live transport, microphone PCM,
  transcript routing, latest-ordinal rep mode, and exact plan-directed timers.
- Do not introduce a workout database, exercise ontology, rigid plan schema, or a
  second application-level conversational model.
- Preserve nuanced user language in Markdown. “Six completed; seventh failed halfway”
  should remain prose rather than being flattened into an integer-only record.
- Never invent timer durations, milestones, rest periods, training changes, or weights.
  They come from the workout document or the user.
- The live model delegates any workout-state operation to the backend agent. The
  backend returns short, speech-friendly text.
- During rep mode, the final spoken number is authoritative and `done` terminates the
  mode. Do not ask the model to infer the count.

Run:

```bash
bun test
bun run typecheck
bun run smoke:imports
```
