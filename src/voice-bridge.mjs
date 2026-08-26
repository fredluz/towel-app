import { access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

/**
 * @typedef {{
 *   type: string,
 *   mode?: string,
 *   text?: string,
 *   latestNumber?: number,
 *   context?: string,
 *   message?: string
 * }} VoiceEvent
 */

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {string} label
 * @returns {Promise<void>}
 */
function waitForExit(child, label) {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(undefined);
      } else {
        reject(new Error(`${label} failed (${signal || code || "unknown"})`));
      }
    });
  });
}

export class VoiceBridge {
  /**
   * @param {{
   *   rootDir: string,
   *   onEvent: (event: VoiceEvent) => void | Promise<void>,
   *   onLog?: (line: string) => void,
   *   platform?: NodeJS.Platform,
   *   spawnFn?: typeof spawn
   * }} options
   */
  constructor({
    rootDir,
    onEvent,
    onLog = () => {},
    platform = process.platform,
    spawnFn = spawn,
  }) {
    this.rootDir = resolve(rootDir);
    this.onEvent = onEvent;
    this.onLog = onLog;
    this.platform = platform;
    this.spawnFn = spawnFn;
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
    this.child = null;
    /** @type {Promise<void> | null} */
    this.startPromise = null;
    this.mode = "stopped";
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start();
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  async #start() {
    if (this.platform !== "darwin") {
      throw new Error("Towel voice runtime currently requires macOS");
    }

    const voiceDir = join(this.rootDir, "voice");
    const binary =
      process.env.TOWEL_VOICE_BIN ||
      join(voiceDir, ".build", "release", "towel-voice");

    if (!(await exists(binary))) {
      this.onLog("Building towel-voice...");
      const build = this.spawnFn(
        "swift",
        ["build", "--package-path", voiceDir, "-c", "release"],
        { cwd: this.rootDir, stdio: ["ignore", "inherit", "inherit"] },
      );
      await waitForExit(build, "swift build");
    }

    const child = this.spawnFn(binary, [], {
      cwd: this.rootDir,
      env: {
        ...process.env,
        TOWEL_WAKE_WORD: process.env.TOWEL_WAKE_WORD || "towel",
        TOWEL_LOCALE: process.env.TOWEL_LOCALE || "en_US",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */ (
      child
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) this.onLog(line.trim());
      }
    });

    const lines = createInterface({ input: child.stdout });
    /** @type {() => void} */
    let readyResolve = () => {};
    /** @type {(reason?: unknown) => void} */
    let readyReject = () => {};
    /** @type {Promise<void>} */
    const ready = new Promise((resolvePromise, reject) => {
      readyResolve = resolvePromise;
      readyReject = reject;
    });
    const timeout = setTimeout(() => {
      readyReject(new Error("towel-voice did not become ready"));
    }, 300_000);

    lines.on("line", (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        this.onLog(`Ignoring non-JSON voice output: ${line}`);
        return;
      }

      if (event.type === "ready") {
        clearTimeout(timeout);
        this.mode = event.mode || "wake";
        readyResolve();
      } else if (event.type === "mode") {
        this.mode = event.mode || this.mode;
      }

      void this.onEvent(event);
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      readyReject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      this.child = null;
      this.startPromise = null;
      this.mode = "stopped";
      if (code !== 0 && code !== null) {
        void this.onEvent({
          type: "error",
          message: `towel-voice exited (${signal || code})`,
        });
      }
    });

    this.send({
      command: "configure",
      wakeWord: process.env.TOWEL_WAKE_WORD || "towel",
      aliases: (process.env.TOWEL_WAKE_ALIASES || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    });

    await ready;
  }

  /**
   * @param {"wake" | "rep" | "expected"} mode
   * @param {string} [context]
   */
  setMode(mode, context = "") {
    this.send({ command: "set_mode", mode, context });
    this.mode = mode;
  }

  /** @param {boolean} value */
  setSuppressed(value) {
    if (!this.child) return;
    this.send({ command: "set_suppressed", value });
  }

  /** @param {Record<string, unknown>} command */
  send(command) {
    if (!this.child?.stdin.writable) {
      throw new Error("towel-voice is not running");
    }
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  async close() {
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    this.mode = "stopped";
    if (!child) return;

    child.kill("SIGTERM");
    await Promise.race([
      waitForExit(child, "towel-voice").catch(() => {}),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 1500)),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}
