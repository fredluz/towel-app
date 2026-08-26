import { spawn } from "node:child_process";
import { cleanForSpeech } from "./speech-text.mjs";

/**
 * Serial wrapper around macOS `say`.
 */
export class Speaker {
  /**
   * @param {{
   *   rate?: number,
   *   voice?: string,
   *   onSpeakingChange?: (speaking: boolean) => void | Promise<void>,
   *   spawnFn?: typeof spawn,
   *   platform?: NodeJS.Platform
   * }} options
   */
  constructor({
    rate = Number(process.env.TOWEL_SPEECH_RATE || 190),
    voice = process.env.TOWEL_SPEECH_VOICE || "",
    onSpeakingChange = async () => {},
    spawnFn = spawn,
    platform = process.platform,
  } = {}) {
    this.rate = Number.isFinite(rate) ? rate : 190;
    this.voice = voice;
    this.onSpeakingChange = onSpeakingChange;
    this.spawnFn = spawnFn;
    this.platform = platform;
    this.queue = Promise.resolve();
    /** @type {import("node:child_process").ChildProcess | null} */
    this.current = null;
    this.closed = false;
  }

  /**
   * @param {string} rawText
   * @returns {Promise<void>}
   */
  say(rawText) {
    const text = cleanForSpeech(rawText);
    if (!text || this.closed) return Promise.resolve();

    const job = this.queue.then(() => this.#speak(text));
    this.queue = job.catch(() => {});
    return job;
  }

  async whenIdle() {
    await this.queue;
  }

  async close() {
    this.closed = true;
    this.current?.kill("SIGTERM");
    await this.queue.catch(() => {});
  }

  /** @param {string} text */
  async #speak(text) {
    if (this.platform !== "darwin") return;

    await this.onSpeakingChange(true);
    try {
      const args = ["-r", String(Math.round(this.rate))];
      if (this.voice) args.push("-v", this.voice);
      args.push(text);

      await new Promise((resolve, reject) => {
        const child = this.spawnFn("say", args, {
          stdio: ["ignore", "ignore", "pipe"],
        });
        this.current = child;
        let stderr = "";

        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          this.current = null;
          if (code === 0) {
            resolve(undefined);
          } else {
            reject(
              new Error(
                `say failed (${signal || code || "unknown"}): ${stderr.trim()}`,
              ),
            );
          }
        });
      });
    } finally {
      // Give the headphone/microphone path a moment to drain before listening again.
      await new Promise((resolve) => setTimeout(resolve, 350));
      await this.onSpeakingChange(false);
    }
  }
}
