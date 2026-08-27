# Towel

Towel is a continuous, voice-first workout companion for macOS headphones. It uses
**OMP Codex Live** for the actual full-duplex conversation and an OMP backend agent for
workout reasoning and Markdown edits.

There is no FaceTime bridge, virtual audio device, wake word, workout database, or
separate TTS engine.

## Architecture

```text
headphone microphone
        │
        ▼
OMP Codex Live (`gpt-live-1-codex` over WebRTC)
        │
        ├── natural continuous conversation and barge-in
        ├── realtime user/assistant transcripts
        └── delegation requests
                    │
                    ▼
            Towel OMP extension
                    │
                    ├── deterministic latest-ordinal rep mode
                    ├── exact plan-directed timers
                    └── backend agent turns
                                │
                                ▼
                         workout Markdown
```

The active Markdown file is both the plan and the log. The backend agent edits that
same file as the workout changes. Towel does not impose a workout schema.

## MVP behavior

After one manual launch, the session is hands-free:

1. Towel opens a direct Codex Live call through the Mac's default microphone and output.
2. The backend reads the selected workout Markdown and sends the first spoken instruction.
3. You talk normally; there is no “Towel” wake word in this version.
4. Workout-state requests are delegated to the backend agent, which reads or edits the
   Markdown and returns a concise answer to the live conversation.
5. For live rep counting, the backend enables deterministic rep mode. Say numbers and
   finish with **“done.”** Towel records the latest spoken number, not a count of
   recognition events.
6. You can instead report a set conversationally: “I did six and failed halfway through
   seven.” The backend preserves that nuance in Markdown.
7. Timers use exactly the duration and spoken milestones in the plan or your request.

## Requirements

- Apple-silicon Mac; the initial target is an M4 MacBook Air.
- Headphones selected as the default macOS input and output.
- [Bun](https://bun.sh) 1.3.14 or newer.
- Internet access.
- A working OMP OpenAI Codex login with Live access. Towel uses the same ChatGPT/Codex
  OAuth credential as OMP's `/live` mode; it does not require an OpenAI Platform API key.
- A configured OMP backend model. This can be your normal GPT-5.6 provider/model.

## Install and authenticate

```bash
git clone https://github.com/fredluz/towel-app.git
cd towel-app
bun install
```

Authenticate the locally pinned OMP installation once:

```bash
./node_modules/.bin/omp
/login
```

Choose the OpenAI Codex/ChatGPT subscription login for Codex Live. Configure or select
whatever backend model you want OMP to use for plan reasoning and file edits, then quit.

## Run

```bash
bun run towel -- workouts/example.md
```

Pass normal OMP arguments after `--`:

```bash
bun run towel -- workouts/today.md -- --model openai/gpt-5.6
```

The exact model selector depends on your OMP configuration. The live voice transport
still uses `gpt-live-1-codex`; the `--model` argument selects the backend agent model.

Link the launcher globally if useful:

```bash
bun link
towel workouts/today.md
```

On first use, macOS may ask for microphone permission. Towel uses the currently selected
default audio devices.

## Conversation examples

```text
Towel: Shoulder circles for twenty seconds. Tell me when you're ready.
You: Ready.
Towel: Starting now.
```

```text
You: Start the bench set.
Towel: Go ahead.
You: One, two, three, four, five, six, seven, done.
Towel: Seven at eighty kilos recorded. What's next follows the Markdown.
```

```text
You: No, correct that. I completed six and failed halfway through seven.
Towel: Corrected.
```

The exact wording is model-generated; the rep ordinal and timer timing are deterministic.

## Towel tools available to the backend

- `towel_begin_reps`
- `towel_start_timer`
- `towel_cancel_timer`
- `towel_voice_status`

OMP commands:

- `/towel-start [workout.md]`
- `/towel-stop`
- `/towel-status`

## Voice selection

Set `TOWEL_VOICE` before launch. OMP's current Codex Live voices include `arbor`,
`breeze`, `cove`, `ember`, `juniper`, `maple`, `sol`, `spruce`, and `vale`.

```bash
TOWEL_VOICE=maple bun run towel -- workouts/example.md
```

The default is `sol`.

## Development

```bash
bun test
bun run typecheck
bun run smoke:imports
```

CI runs these checks on a macOS 26 runner. Pure tests cover transcript coalescing,
latest-number parsing, rep-mode state, and exact timer behavior. The import smoke test
loads OMP's Codex Live transport, protocol, and native audio module.

## Current limits

- The integration intentionally pins OMP `18.0.7` because it imports OMP's live transport
  and protocol modules directly. Upgrade those dependencies together and run the import
  smoke test.
- A real headphone/microphone session still needs a physical smoke test on the target Mac;
  CI cannot exercise microphone permissions or a subscription-authenticated Live call.
- Rep accuracy depends on the realtime input transcript, but missed intermediate numbers
  do not matter when the final ordinal is recognized.
- Towel currently uses the system's default input/output devices rather than selecting a
  device by name.
- No posture analysis, camera input, GUI, phone client, or autonomous programming is in
  this MVP.

## Reuse

Towel imports OMP's MIT-licensed Codex Live WebRTC transport/protocol and native audio
bindings. It does not reuse the earlier Swabble/Apple Speech implementation or workout
schemas from other trackers. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
