export interface TimerAnnouncement {
  remainingSeconds: number;
  text: string;
}

export interface StartTimerOptions {
  label: string;
  durationSeconds: number;
  announcements?: readonly TimerAnnouncement[];
  completionMessage?: string;
}

export interface TimerSnapshot {
  id: string;
  label: string;
  durationSeconds: number;
  remainingSeconds: number;
}

interface TimerSink {
  speak(text: string): void | Promise<void>;
  complete(timer: { id: string; label: string; durationSeconds: number }): void | Promise<void>;
}

interface ActiveTimer {
  id: string;
  label: string;
  durationSeconds: number;
  startedAt: number;
  handles: ReturnType<typeof setTimeout>[];
  cancelled: boolean;
  tail: Promise<void>;
}

export function normalizeAnnouncements(
  durationSeconds: number,
  announcements: readonly TimerAnnouncement[] = [],
): TimerAnnouncement[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Timer duration must be a positive number of seconds");
  }

  const seen = new Set<number>();
  const normalized = announcements.map((announcement) => {
    const remainingSeconds = announcement.remainingSeconds;
    const text = announcement.text.trim();
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0 || remainingSeconds > durationSeconds) {
      throw new Error(`Timer announcement ${remainingSeconds} is outside the timer duration`);
    }
    if (!text) throw new Error("Timer announcement text cannot be empty");
    if (seen.has(remainingSeconds)) {
      throw new Error(`Timer has more than one announcement at ${remainingSeconds} seconds remaining`);
    }
    seen.add(remainingSeconds);
    return { remainingSeconds, text };
  });

  return normalized.sort((a, b) => b.remainingSeconds - a.remainingSeconds);
}

/** Exact, plan-directed timers. No duration or announcement is invented here. */
export class TimerService {
  #sink: TimerSink;
  #timers = new Map<string, ActiveTimer>();

  constructor(sink: TimerSink) {
    this.#sink = sink;
  }

  start(options: StartTimerOptions): string {
    const durationSeconds = options.durationSeconds;
    const announcements = normalizeAnnouncements(durationSeconds, options.announcements);
    const label = options.label.trim() || "timer";
    const id = crypto.randomUUID();
    const timer: ActiveTimer = {
      id,
      label,
      durationSeconds,
      startedAt: Date.now(),
      handles: [],
      cancelled: false,
      tail: Promise.resolve(),
    };
    this.#timers.set(id, timer);

    for (const announcement of announcements) {
      const delayMs = Math.max(0, (durationSeconds - announcement.remainingSeconds) * 1000);
      const handle = setTimeout(() => {
        this.#queue(timer, () => this.#sink.speak(announcement.text));
      }, delayMs);
      timer.handles.push(handle);
    }

    const completionHandle = setTimeout(() => {
      this.#timers.delete(id);
      this.#queue(timer, async () => {
        const completionMessage = options.completionMessage?.trim();
        if (completionMessage) await this.#sink.speak(completionMessage);
        await this.#sink.complete({ id, label, durationSeconds });
      });
    }, durationSeconds * 1000);
    timer.handles.push(completionHandle);
    return id;
  }

  cancel(id?: string): number {
    if (id) return this.#cancelOne(id) ? 1 : 0;
    let count = 0;
    for (const timerId of [...this.#timers.keys()]) {
      if (this.#cancelOne(timerId)) count += 1;
    }
    return count;
  }

  list(): TimerSnapshot[] {
    const now = Date.now();
    return [...this.#timers.values()].map((timer) => ({
      id: timer.id,
      label: timer.label,
      durationSeconds: timer.durationSeconds,
      remainingSeconds: Math.max(0, timer.durationSeconds - (now - timer.startedAt) / 1000),
    }));
  }

  #queue(timer: ActiveTimer, action: () => void | Promise<void>): void {
    if (timer.cancelled) return;
    timer.tail = timer.tail
      .then(async () => {
        if (!timer.cancelled) await action();
      })
      .catch(() => {
        // The extension reports runtime failures; a failed announcement must not
        // create an unhandled rejection or stop later timer cleanup.
      });
  }

  #cancelOne(id: string): boolean {
    const timer = this.#timers.get(id);
    if (!timer) return false;
    timer.cancelled = true;
    for (const handle of timer.handles) clearTimeout(handle);
    this.#timers.delete(id);
    return true;
  }
}
