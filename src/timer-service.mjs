/**
 * @typedef {{remainingSeconds: number, text: string}} TimerAnnouncement
 * @typedef {{
 *   id?: string,
 *   label: string,
 *   durationSeconds: number,
 *   announcements?: TimerAnnouncement[],
 *   completionMessage?: string
 * }} TimerSpec
 */

/**
 * Validate, normalize, sort, and de-duplicate announcement milestones.
 *
 * @param {number} durationSeconds
 * @param {TimerAnnouncement[] | undefined} announcements
 * @returns {TimerAnnouncement[]}
 */
export function normalizeAnnouncements(durationSeconds, announcements = []) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("durationSeconds must be greater than zero");
  }

  const byRemaining = new Map();

  for (const item of announcements) {
    const remaining = Number(item?.remainingSeconds);
    const text = typeof item?.text === "string" ? item.text.trim() : "";

    if (!Number.isFinite(remaining) || remaining < 0 || remaining > durationSeconds) {
      throw new Error(
        `announcement remainingSeconds must be between 0 and ${durationSeconds}`,
      );
    }
    if (!text) {
      throw new Error("announcement text cannot be empty");
    }

    byRemaining.set(remaining, { remainingSeconds: remaining, text });
  }

  return [...byRemaining.values()].sort(
    (a, b) => b.remainingSeconds - a.remainingSeconds,
  );
}

/**
 * Deterministic timer registry. Towel never invents milestones; it speaks only the
 * texts Pi supplies.
 */
export class TimerService {
  /**
   * @param {{
   *   speaker: {say(text: string): Promise<void>},
   *   onComplete: (event: {id: string, label: string, durationSeconds: number}) => void | Promise<void>,
   *   setTimeoutFn?: typeof setTimeout,
   *   clearTimeoutFn?: typeof clearTimeout
   * }} options
   */
  constructor({
    speaker,
    onComplete,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    this.speaker = speaker;
    this.onComplete = onComplete;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    /** @type {Map<string, {spec: Required<Pick<TimerSpec, "label" | "durationSeconds">> & TimerSpec, handles: ReturnType<typeof setTimeout>[]}>} */
    this.timers = new Map();
    this.sequence = 0;
  }

  /**
   * @param {TimerSpec} rawSpec
   * @returns {string}
   */
  start(rawSpec) {
    const durationSeconds = Number(rawSpec.durationSeconds);
    const announcements = normalizeAnnouncements(
      durationSeconds,
      rawSpec.announcements,
    );
    const label = String(rawSpec.label || "timer").trim() || "timer";
    const id =
      rawSpec.id?.trim() ||
      `timer-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;

    if (this.timers.has(id)) {
      throw new Error(`timer already exists: ${id}`);
    }

    const spec = {
      ...rawSpec,
      id,
      label,
      durationSeconds,
      announcements,
    };
    /** @type {ReturnType<typeof setTimeout>[]} */
    const handles = [];

    for (const milestone of announcements) {
      const delayMs = Math.max(
        0,
        Math.round((durationSeconds - milestone.remainingSeconds) * 1000),
      );
      handles.push(
        this.setTimeoutFn(() => {
          void this.speaker.say(milestone.text);
        }, delayMs),
      );
    }

    handles.push(
      this.setTimeoutFn(() => {
        void this.#finish(id);
      }, Math.round(durationSeconds * 1000)),
    );

    this.timers.set(id, { spec, handles });
    return id;
  }

  /**
   * @param {string | undefined} id
   * @returns {string[]}
   */
  cancel(id) {
    const ids = id ? [id] : [...this.timers.keys()];
    const cancelled = [];

    for (const timerId of ids) {
      const timer = this.timers.get(timerId);
      if (!timer) continue;
      for (const handle of timer.handles) this.clearTimeoutFn(handle);
      this.timers.delete(timerId);
      cancelled.push(timerId);
    }

    return cancelled;
  }

  /** @returns {{id: string, label: string, durationSeconds: number}[]} */
  list() {
    return [...this.timers.entries()].map(([id, timer]) => ({
      id,
      label: timer.spec.label,
      durationSeconds: timer.spec.durationSeconds,
    }));
  }

  async close() {
    this.cancel();
  }

  /** @param {string} id */
  async #finish(id) {
    const timer = this.timers.get(id);
    if (!timer) return;
    this.timers.delete(id);

    if (timer.spec.completionMessage?.trim()) {
      await this.speaker.say(timer.spec.completionMessage.trim());
    }

    await this.onComplete({
      id,
      label: timer.spec.label,
      durationSeconds: timer.spec.durationSeconds,
    });
  }
}
