# Towel

Towel is a voice-first workout runtime for [Pi](https://pi.dev) on macOS.

It keeps the architecture intentionally thin:

- **Pi is the brain.** It reads and edits a workout Markdown file, reasons about
  deviations, and decides what comes next.
- **Markdown is the state.** The plan becomes the log as Pi annotates it. There is no
  workout database or mandatory schema.
- **Towel is the ears and mouth.** A small macOS helper provides wake-gated speech,
  contextual replies, live rep ordinals, exact timers, and `say` output.

The wake word is **“Towel.”**

## Current MVP

After one manual launch, the intended loop is hands-free:

1. Pi reads the selected workout Markdown and speaks the first instruction.
2. Say “Towel, …” for arbitrary commands or corrections.
3. When Pi enables live rep mode, count aloud and say **“done.”** The latest spoken
   ordinal is sent to Pi.
4. You can alternatively say “Towel, eight reps” after a set.
5. Pi edits the same Markdown, then announces the next document-directed action.
6. Timers speak only the milestones written in the plan or explicitly requested.

Example correction:

> Towel, I did six, failed halfway through seven.

Pi records that meaning as Markdown rather than forcing it into a database field.

## Requirements

- Apple-silicon Mac; the initial target is an M4 MacBook Air.
- **macOS 26 or later** and Swift 6.2/Xcode command-line tools.
- Node.js 22.19 or later.
- Pi installed and authenticated:
  ```bash
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent
  pi
  /login
  ```
- Headphones selected as the default macOS audio input and output.
- Internet access for Pi/model calls. Towel is not designed as an offline agent.

The macOS 26 requirement comes from the current Swabble speech pipeline, which uses
Apple's `SpeechAnalyzer` and `SpeechTranscriber`.

## Install

```bash
git clone https://github.com/fredluz/towel-app.git
cd towel-app
npm install
npm run build:voice
```

On the first Pi launch, trust the project so Pi can load `.pi/extensions/towel/index.ts`.

## Run

```bash
npm run towel -- workouts/example.md
```

Or link the launcher:

```bash
npm link
towel workouts/example.md
```

The launcher:

- validates the Markdown path;
- starts Pi from the repository root;
- enables the Towel extension;
- starts the Swift voice helper;
- injects the initial request for Pi to read the document and begin.

Pass Pi arguments after `--`:

```bash
towel workouts/today.md -- --model openai/gpt-5.6
```

The model identifier above is only illustrative; use the provider/model name available
in your Pi installation.

## Voice behavior

### Wake mode

Say the wake word and command together:

> Towel, do rows next.

Or say only “Towel”; it answers “Yes?” and captures the following utterance.

### Rep mode

Pi calls `towel_begin_reps`. Towel listens to partial speech results for ordinals:

> One, two, three, four, five, six, seven, done.

`done` exits rep mode. The latest recognized ordinal—in this example, seven—is sent to
Pi. It is not treated as seven increment events.

### Expected reply mode

When Pi asks for “ready” or another immediate answer, it calls
`towel_expect_reply`. The next utterance is accepted without the wake word, then Towel
returns to wake mode.

### Timers

Pi calls `towel_start_timer` with an exact duration and zero or more exact spoken
milestones. Towel adds no default halfway/ten-second announcements.

## Pi commands

Inside Pi:

- `/towel-start [workout.md]`
- `/towel-stop`
- `/towel-status`

## Extension tools

The model can call:

- `towel_begin_reps`
- `towel_expect_reply`
- `towel_start_timer`
- `towel_cancel_timer`
- `towel_voice_status`

The built-in Pi `read`, `edit`, and `write` tools update the workout Markdown directly.

## Development

```bash
npm test
npm run typecheck
swift test --package-path voice
```

The Node tests cover Markdown-to-speech cleanup and deterministic timer behavior.
The Swift tests cover rep-number parsing. The full microphone path must be smoke-tested
on macOS hardware because the development container is not macOS.

## Known MVP limits

- Wake detection is transcript gating, not a dedicated neural keyword spotter.
- Live number accuracy depends on Apple's speech transcription and the headphone mic.
- Towel suppresses microphone handling while macOS `say` is speaking; **barge-in is not
  implemented yet**.
- The default macOS audio input must already be the intended headphone microphone.
- There is no GUI, phone client, posture analysis, or automatic training programming.
- This is online because Pi/model reasoning is online.
- First-run microphone and speech permissions still require macOS approval.

## Reuse decision

This version does **not** lift workout models or parsing code from Rally, FitVoice,
GymWhisper, or other trackers. That would reintroduce the schema Towel is intentionally
avoiding.

It uses:

- Pi's public extension API for orchestration;
- Swabble as a pinned MIT-licensed Swift Package for the macOS speech pipeline;
- macOS `say` for understandable TTS.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
