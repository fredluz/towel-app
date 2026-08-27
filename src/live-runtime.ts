import { AudioCapture } from "@oh-my-pi/pi-natives";
import {
  buildDelegationContextAppend,
  buildSessionClose,
  buildSessionContextAppend,
  chunkLiveContext,
  type LiveContextChannel,
  type LiveServerEvent,
} from "@oh-my-pi/pi-coding-agent/live/protocol";
import { CodexLiveTransport } from "@oh-my-pi/pi-coding-agent/live/transport";
import { RepTracker, type RepProgress } from "./rep-tracker";

const OUTPUT_ACTIVE_LEVEL = 0.015;
const MIN_BARGE_IN_LEVEL = 0.04;
const OUTPUT_ECHO_RATIO = 0.65;

export type TowelLivePhase = "idle" | "connecting" | "listening" | "working" | "closing" | "closed" | "error";

export type TowelLiveEvent =
  | { type: "phase"; phase: TowelLivePhase }
  | { type: "ready" }
  | { type: "delegation"; id: string; request: string }
  | { type: "rep_update"; progress: RepProgress }
  | { type: "rep_complete"; progress: RepProgress }
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "error"; error: Error };

type AuthStorage = ConstructorParameters<typeof CodexLiveTransport>[0]["authStorage"];

export interface CodexLiveRuntimeOptions {
  authStorage: AuthStorage;
  sessionId: string;
  instructions: string;
  voice: string;
  onEvent(event: TowelLiveEvent): void | Promise<void>;
}

function errorFrom(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(1, level);
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return clampLevel(Math.sqrt(sum / samples.length));
}

/**
 * Headphone microphone + Codex Live WebRTC + transcript/delegation bridge.
 * GPT-Live owns conversation and playback; this class owns deterministic rep mode.
 */
export class CodexLiveRuntime {
  #options: CodexLiveRuntimeOptions;
  #transport: CodexLiveTransport | undefined;
  #recorder: AudioCapture | undefined;
  #reps = new RepTracker();
  #phase: TowelLivePhase = "idle";
  #outputLevel = 0;
  #startPromise: Promise<void> | undefined;
  #closePromise: Promise<void> | undefined;

  constructor(options: CodexLiveRuntimeOptions) {
    this.#options = options;
  }

  get phase(): TowelLivePhase {
    return this.#phase;
  }

  get repMode(): boolean {
    return this.#reps.active;
  }

  get repContext(): string {
    return this.#reps.context;
  }

  start(): Promise<void> {
    if (!this.#startPromise) this.#startPromise = this.#start();
    return this.#startPromise;
  }

  async #start(): Promise<void> {
    if (this.#transport) return;
    this.#setPhase("connecting");

    try {
      const transport = new CodexLiveTransport({
        authStorage: this.#options.authStorage,
        sessionId: this.#options.sessionId,
        instructions: this.#options.instructions,
        voice: this.#options.voice,
        callbacks: {
          onEvent: (event) => {
            void this.#handleServerEvent(event);
          },
          onOutputLevel: (level) => {
            this.#outputLevel = clampLevel(level);
          },
        },
      });
      this.#transport = transport;
      await transport.connect();

      this.#recorder = new AudioCapture(16_000, (error, samples) => {
        if (error) {
          this.#fail(error);
          return;
        }
        this.#pushMicrophoneAudio(samples);
      });

      if (this.#phase === "connecting") this.#setPhase("listening");
    } catch (cause) {
      const error = errorFrom(cause);
      this.#fail(error);
      await this.close();
      throw error;
    }
  }

  beginReps(context: string): void {
    if (!this.#transport) throw new Error("Codex Live is not connected");
    this.#reps.begin(context);
    void this.sendSessionText(
      `[TOWEL REP MODE START] Context: ${context}. Spoken numbers are rep ordinals. Stay completely silent, do not echo numbers, and do not create delegations for numbers or the word done. The client will report the deterministic result.`,
      "commentary",
    );
  }

  cancelReps(): void {
    if (!this.#reps.active) return;
    this.#reps.reset();
    void this.sendSessionText(
      "[TOWEL REP MODE CANCELLED] Resume normal conversation and delegation behavior.",
      "commentary",
    );
  }

  async sendSessionText(text: string, channel: LiveContextChannel = "speakable"): Promise<void> {
    const transport = this.#requireTransport();
    for (const chunk of chunkLiveContext(text)) {
      await transport.send(buildSessionContextAppend(chunk, channel));
    }
  }

  async sendDelegationText(
    delegationId: string,
    text: string,
    channel: LiveContextChannel = "speakable",
  ): Promise<void> {
    const transport = this.#requireTransport();
    for (const chunk of chunkLiveContext(text)) {
      await transport.send(buildDelegationContextAppend(delegationId, chunk, channel));
    }
  }

  markListening(): void {
    if (this.#phase !== "closing" && this.#phase !== "closed" && this.#phase !== "error") {
      this.#setPhase("listening");
    }
  }

  status(): {
    phase: TowelLivePhase;
    repMode: boolean;
    repContext: string;
  } {
    return {
      phase: this.#phase,
      repMode: this.#reps.active,
      repContext: this.#reps.context,
    };
  }

  close(): Promise<void> {
    if (!this.#closePromise) this.#closePromise = this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    if (this.#phase !== "closed") this.#setPhase("closing");
    this.#reps.reset();

    const recorder = this.#recorder;
    this.#recorder = undefined;
    if (recorder) {
      try {
        recorder.stop();
      } catch {
        // Continue transport cleanup.
      }
    }

    const transport = this.#transport;
    this.#transport = undefined;
    if (transport) {
      try {
        await transport.send(buildSessionClose());
      } catch {
        // Closing the peer still releases the native devices.
      }
      try {
        await transport.close();
      } catch {
        // Nothing else can be released from JavaScript.
      }
    }

    this.#setPhase("closed");
  }

  async #handleServerEvent(event: LiveServerEvent): Promise<void> {
    switch (event.type) {
      case "session.started":
        this.#setPhase("listening");
        await this.#emit({ type: "ready" });
        return;

      case "session.updated":
      case "output_audio.delta":
      case "unknown":
        return;

      case "input_transcript.added":
        await this.#emit({ type: "transcript", role: "user", text: event.item.text, final: false });
        await this.#ingestRepPartial(event.item.text);
        return;

      case "output_transcript.added":
        await this.#emit({ type: "transcript", role: "assistant", text: event.item.text, final: false });
        return;

      case "turn.done":
        await this.#emit({
          type: "transcript",
          role: event.turn.role,
          text: event.turn.transcript,
          final: true,
        });
        if (event.turn.role === "user") await this.#ingestRepFinal(event.turn.transcript);
        return;

      case "delegation.created": {
        const request = event.item.content.map((item) => item.text).join("\n").trim();
        if (!request) return;
        if (this.#reps.active) {
          await this.sendDelegationText(
            event.item.id,
            "Rep mode is being handled deterministically by the client. Stay silent and wait for the result.",
            "commentary",
          );
          return;
        }
        this.#setPhase("working");
        await this.#emit({ type: "delegation", id: event.item.id, request });
        return;
      }

      case "error":
        this.#fail(new Error(event.message));
        return;
    }
  }

  async #ingestRepPartial(text: string): Promise<void> {
    const progress = this.#reps.add(text);
    if (!progress) return;
    await this.#emit({ type: "rep_update", progress });
    if (progress.complete) await this.#completeReps();
  }

  async #ingestRepFinal(text: string): Promise<void> {
    const progress = this.#reps.finishTurn(text);
    if (!progress) return;
    await this.#emit({ type: "rep_update", progress });
    if (progress.complete) await this.#completeReps();
  }

  async #completeReps(): Promise<void> {
    const progress = this.#reps.stop();
    if (!progress) return;
    await this.sendSessionText(
      "[TOWEL REP MODE END] Resume normal conversation and delegation behavior. Stay silent until the workout backend sends the next instruction.",
      "commentary",
    );
    await this.#emit({ type: "rep_complete", progress });
  }

  #pushMicrophoneAudio(samples: Float32Array): void {
    const transport = this.#transport;
    if (!transport || samples.length === 0) return;

    const inputLevel = rms(samples);
    const outputActive = this.#outputLevel > OUTPUT_ACTIVE_LEVEL;
    const echoThreshold = Math.max(MIN_BARGE_IN_LEVEL, this.#outputLevel * OUTPUT_ECHO_RATIO);
    if (outputActive && inputLevel < echoThreshold) return;

    try {
      transport.pushAudio(samples);
    } catch (cause) {
      this.#fail(errorFrom(cause));
    }
  }

  #requireTransport(): CodexLiveTransport {
    if (!this.#transport) throw new Error("Codex Live is not connected");
    return this.#transport;
  }

  #setPhase(phase: TowelLivePhase): void {
    if (this.#phase === phase) return;
    this.#phase = phase;
    void this.#emit({ type: "phase", phase });
  }

  #fail(error: Error): void {
    this.#phase = "error";
    void this.#emit({ type: "phase", phase: "error" });
    void this.#emit({ type: "error", error });
  }

  async #emit(event: TowelLiveEvent): Promise<void> {
    try {
      await this.#options.onEvent(event);
    } catch {
      // Event consumers must not break the native realtime transport callbacks.
    }
  }
}
