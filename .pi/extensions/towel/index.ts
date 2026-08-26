import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assistantText } from "../../../src/speech-text.mjs";
import { Speaker } from "../../../src/speaker.mjs";
import { TimerService } from "../../../src/timer-service.mjs";
import { VoiceBridge } from "../../../src/voice-bridge.mjs";
import {
  buildBootMessage,
  buildTowelSystemPrompt,
} from "../../../src/towel-prompt.mjs";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(extensionDir, "../../..");

type VoiceEvent = {
  type: string;
  mode?: string;
  text?: string;
  latestNumber?: number;
  context?: string;
  message?: string;
};

export default function towelExtension(pi: ExtensionAPI) {
  let active = process.env.TOWEL_ACTIVE === "1";
  let workoutFile = resolveWorkoutFile(
    process.env.TOWEL_WORKOUT_FILE || "workouts/example.md",
    rootDir,
  );
  let ctx: ExtensionContext | undefined;
  let bridge: VoiceBridge | undefined;
  let lastAssistantText = "";
  let bootSent = false;
  let expectedReplyTimeout: NodeJS.Timeout | undefined;

  const speaker = new Speaker({
    onSpeakingChange: async (speaking) => {
      bridge?.setSuppressed(speaking);
      if (ctx) {
        ctx.ui.setStatus(
          "towel",
          speaking ? "Towel: speaking" : `Towel: ${bridge?.mode || "listening"}`,
        );
      }
    },
  });

  const inject = async (text: string) => {
    if (!active || !text.trim()) return;
    try {
      if (ctx?.isIdle()) {
        await pi.sendUserMessage(text);
      } else {
        await pi.sendUserMessage(text, { deliverAs: "steer" });
      }
    } catch (error) {
      ctx?.ui.notify(
        `Towel could not deliver voice input: ${String(error)}`,
        "error",
      );
    }
  };

  const timers = new TimerService({
    speaker,
    onComplete: async ({ id, label, durationSeconds }) => {
      await inject(
        `[TOWEL_TIMER_COMPLETE id=${JSON.stringify(id)} label=${JSON.stringify(label)} duration_seconds=${durationSeconds}] The deterministic timer finished. Read and update the workout Markdown as needed, then continue with the next step.`,
      );
    },
  });

  const clearExpectedTimeout = () => {
    if (expectedReplyTimeout) clearTimeout(expectedReplyTimeout);
    expectedReplyTimeout = undefined;
  };

  const handleVoiceEvent = async (event: VoiceEvent) => {
    if (!active) return;

    switch (event.type) {
      case "ready":
      case "mode":
        ctx?.ui.setStatus("towel", `Towel: ${event.mode || bridge?.mode || "wake"}`);
        return;

      case "wake_detected":
        await speaker.say("Yes?");
        return;

      case "utterance": {
        clearExpectedTimeout();
        const prefix =
          event.context && event.context.trim()
            ? `[TOWEL_EXPECTED context=${JSON.stringify(event.context)}]`
            : "[TOWEL_VOICE]";
        await inject(`${prefix} ${event.text || ""}`.trim());
        return;
      }

      case "rep_update":
        ctx?.ui.setStatus(
          "towel",
          `Towel: reps ${event.latestNumber ?? "?"}`,
        );
        return;

      case "rep_complete":
        await inject(
          `[TOWEL_REPS context=${JSON.stringify(event.context || "")} latest_spoken_ordinal=${event.latestNumber ?? "unknown"} transcript=${JSON.stringify(event.text || "")}] Live rep counting ended. The latest spoken ordinal is the completed rep count unless the user subsequently corrects it. Update the workout Markdown and continue from the document.`,
        );
        return;

      case "error":
        ctx?.ui.notify(event.message || "Unknown towel-voice error", "error");
        ctx?.ui.setStatus("towel", "Towel: voice error");
        return;
    }
  };

  const startRuntime = async (
    currentCtx: ExtensionContext,
    requestedFile = workoutFile,
    sendBoot = true,
  ) => {
    workoutFile = resolveWorkoutFile(requestedFile, currentCtx.cwd);
    if (!existsSync(workoutFile)) {
      throw new Error(`Workout Markdown not found: ${workoutFile}`);
    }

    active = true;
    ctx = currentCtx;

    if (!bridge) {
      bridge = new VoiceBridge({
        rootDir,
        onEvent: handleVoiceEvent,
        onLog: (line) => currentCtx.ui.notify(`towel-voice: ${line}`, "info"),
      });
    }

    currentCtx.ui.setStatus("towel", "Towel: starting voice");
    await bridge.start();
    bridge.setMode("wake");
    currentCtx.ui.setStatus("towel", "Towel: wake");

    if (sendBoot && !bootSent) {
      bootSent = true;
      // Return from session_start before initiating the first agent turn.
      setTimeout(() => {
        void inject(buildBootMessage(workoutFile));
      }, 100);
    }
  };

  const stopRuntime = async () => {
    clearExpectedTimeout();
    active = false;
    bootSent = false;
    timers.cancel();
    await bridge?.close();
    bridge = undefined;
    ctx?.ui.setStatus("towel", undefined);
  };

  pi.on("session_start", async (event, currentCtx) => {
    ctx = currentCtx;
    if (active && event.reason === "startup") {
      try {
        await startRuntime(currentCtx, workoutFile, true);
      } catch (error) {
        currentCtx.ui.notify(`Towel failed to start: ${String(error)}`, "error");
        currentCtx.ui.setStatus("towel", "Towel: failed");
      }
    }
  });

  pi.on("session_shutdown", async (event) => {
    await stopRuntime();
    if (event.reason === "quit" || event.reason === "reload") {
      await speaker.close();
    }
  });

  pi.on("before_agent_start", async (event, currentCtx) => {
    if (!active) return undefined;
    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n" +
        buildTowelSystemPrompt({
          cwd: currentCtx.cwd,
          workoutFile,
        }),
    };
  });

  pi.on("agent_start", async () => {
    lastAssistantText = "";
  });

  pi.on("message_end", async (event) => {
    const text = assistantText(event.message);
    if (text) lastAssistantText = text;
  });

  pi.on("agent_settled", async () => {
    if (!active || !lastAssistantText.trim()) return;
    const text = lastAssistantText;
    lastAssistantText = "";
    try {
      await speaker.say(text);
    } catch (error) {
      ctx?.ui.notify(`Towel speech failed: ${String(error)}`, "error");
    }
  });

  pi.registerCommand("towel-start", {
    description: "Start the hands-free workout runtime: /towel-start [workout.md]",
    handler: async (args, currentCtx) => {
      try {
        bootSent = false;
        await startRuntime(currentCtx, args.trim() || workoutFile, true);
        currentCtx.ui.notify(`Towel started with ${workoutFile}`, "info");
      } catch (error) {
        currentCtx.ui.notify(String(error), "error");
      }
    },
  });

  pi.registerCommand("towel-stop", {
    description: "Stop Towel voice input, speech, and timers",
    handler: async (_args, currentCtx) => {
      await stopRuntime();
      currentCtx.ui.notify("Towel stopped", "info");
    },
  });

  pi.registerCommand("towel-status", {
    description: "Show Towel runtime status",
    handler: async (_args, currentCtx) => {
      currentCtx.ui.notify(
        JSON.stringify(
          {
            active,
            workoutFile,
            voiceMode: bridge?.mode || "stopped",
            timers: timers.list(),
          },
          null,
          2,
        ),
        "info",
      );
    },
  });

  pi.registerTool({
    name: "towel_begin_reps",
    label: "Begin live rep counting",
    description:
      "Put Towel into live rep mode. The user says ordinal numbers and ends with 'done'; Towel then sends the latest spoken ordinal back as a voice event.",
    parameters: Type.Object({
      context: Type.String({
        description:
          "Concise human-readable context, such as 'bench press set 2 at 80 kg'.",
      }),
    }),
    async execute(_toolCallId, params) {
      assertActive(bridge);
      clearExpectedTimeout();
      bridge.setMode("rep", params.context);
      return {
        content: [
          {
            type: "text",
            text: `Live rep mode active for ${params.context}. The user can count and say "done".`,
          },
        ],
        details: { mode: "rep", context: params.context },
      };
    },
  });

  pi.registerTool({
    name: "towel_expect_reply",
    label: "Expect contextual voice reply",
    description:
      "Accept the next final utterance without requiring the Towel wake word. Use after asking for ready, a correction, or a clarification.",
    parameters: Type.Object({
      context: Type.String({
        description: "What the forthcoming answer means.",
      }),
      timeoutSeconds: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 3600,
          description:
            "Optional timeout before returning to wake-word mode. Default 300 seconds.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      assertActive(bridge);
      clearExpectedTimeout();
      bridge.setMode("expected", params.context);

      const timeoutSeconds = params.timeoutSeconds ?? 300;
      expectedReplyTimeout = setTimeout(() => {
        bridge?.setMode("wake");
        ctx?.ui.setStatus("towel", "Towel: wake");
      }, timeoutSeconds * 1000);

      return {
        content: [
          {
            type: "text",
            text: `The next utterance will be captured as: ${params.context}`,
          },
        ],
        details: {
          mode: "expected",
          context: params.context,
          timeoutSeconds,
        },
      };
    },
  });

  pi.registerTool({
    name: "towel_start_timer",
    label: "Start plan-directed timer",
    description:
      "Start a deterministic timer using exactly the duration and spoken milestone texts from the workout Markdown or user. Towel does not invent announcements.",
    parameters: Type.Object({
      label: Type.String({ description: "Human-readable timer label." }),
      durationSeconds: Type.Number({
        exclusiveMinimum: 0,
        description: "Exact timer duration in seconds.",
      }),
      announcements: Type.Optional(
        Type.Array(
          Type.Object({
            remainingSeconds: Type.Number({
              minimum: 0,
              description:
                "Speak when this many seconds remain. Must be within the duration.",
            }),
            text: Type.String({
              description: "Exact text to speak at this milestone.",
            }),
          }),
        ),
      ),
      completionMessage: Type.Optional(
        Type.String({
          description:
            "Optional exact text spoken at completion before Pi receives the completion event.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      if (!active) throw new Error("Towel is not active");
      const id = timers.start({
        label: params.label,
        durationSeconds: params.durationSeconds,
        announcements: params.announcements,
        completionMessage: params.completionMessage,
      });
      return {
        content: [
          {
            type: "text",
            text: `Timer ${id} started for ${params.durationSeconds} seconds.`,
          },
        ],
        details: { id, ...params },
      };
    },
  });

  pi.registerTool({
    name: "towel_cancel_timer",
    label: "Cancel workout timer",
    description:
      "Cancel one deterministic Towel timer by id, or all timers when id is omitted.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Timer id to cancel." })),
    }),
    async execute(_toolCallId, params) {
      const cancelled = timers.cancel(params.id);
      return {
        content: [
          {
            type: "text",
            text: cancelled.length
              ? `Cancelled: ${cancelled.join(", ")}`
              : "No matching active timer.",
          },
        ],
        details: { cancelled },
      };
    },
  });

  pi.registerTool({
    name: "towel_voice_status",
    label: "Inspect Towel runtime",
    description:
      "Return current voice mode, workout Markdown path, and active timers.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                active,
                workoutFile,
                voiceMode: bridge?.mode || "stopped",
                timers: timers.list(),
              },
              null,
              2,
            ),
          },
        ],
        details: {
          active,
          workoutFile,
          voiceMode: bridge?.mode || "stopped",
          timers: timers.list(),
        },
      };
    },
  });
}

function resolveWorkoutFile(value: string, cwd: string) {
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function assertActive(bridge: VoiceBridge | undefined): asserts bridge is VoiceBridge {
  if (!bridge) throw new Error("Towel voice runtime is not active");
}
