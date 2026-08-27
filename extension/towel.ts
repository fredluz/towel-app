import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexLiveRuntime, type TowelLiveEvent } from "../src/live-runtime";
import { TimerService } from "../src/timer-service";
import {
  buildBootRequest,
  buildDelegationRequest,
  buildLiveInstructions,
  buildRepResultRequest,
  buildTimerCompleteRequest,
  wrapAgentFinalMessage,
} from "../src/towel-instructions";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(extensionDir, "..");

type ResponseRoute =
  | { kind: "delegation"; id: string }
  | { kind: "session"; source: "boot" | "reps" | "timer" | "command" };

function resolveWorkoutFile(path: string, cwd: string): string {
  return resolve(isAbsolute(path) ? path : resolve(cwd, path));
}

function extractAssistantText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as { role?: unknown; content?: unknown };
    if (record.role !== "assistant") continue;
    if (typeof record.content === "string") return record.content.trim();
    if (!Array.isArray(record.content)) continue;
    const text = record.content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const item = block as { type?: unknown; text?: unknown };
        return item.type === "text" && typeof item.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

export default function towelExtension(pi: ExtensionAPI) {
  const z = pi.zod;
  let active = process.env.TOWEL_ACTIVE === "1";
  let workoutFile = resolveWorkoutFile(
    process.env.TOWEL_WORKOUT_FILE || "workouts/example.md",
    rootDir,
  );
  let ctx: ExtensionContext | undefined;
  let runtime: CodexLiveRuntime | undefined;
  let bootSent = false;
  const routes: ResponseRoute[] = [];

  const notifyError = (message: string): void => {
    pi.logger.error(message);
    ctx?.ui.notify(message, "error");
  };

  const requireRuntime = (): CodexLiveRuntime => {
    if (!active || !runtime) throw new Error("Towel Codex Live is not running");
    return runtime;
  };

  const dispatchAgent = (text: string, route: ResponseRoute): void => {
    if (!active || !ctx) return;
    routes.push(route);
    try {
      pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "steer" });
    } catch (cause) {
      const index = routes.indexOf(route);
      if (index >= 0) routes.splice(index, 1);
      notifyError(`Could not send Towel work to the backend agent: ${String(cause)}`);
    }
  };

  const timers = new TimerService({
    speak: async (text) => {
      await requireRuntime().sendSessionText(text, "speakable");
    },
    complete: async ({ id, label, durationSeconds }) => {
      dispatchAgent(
        buildTimerCompleteRequest({ workoutFile, id, label, durationSeconds }),
        { kind: "session", source: "timer" },
      );
    },
  });

  const sendBoot = (): void => {
    if (!active || bootSent) return;
    bootSent = true;
    dispatchAgent(buildBootRequest(workoutFile), { kind: "session", source: "boot" });
  };

  const handleLiveEvent = async (event: TowelLiveEvent): Promise<void> => {
    switch (event.type) {
      case "phase":
        ctx?.ui.setStatus("towel", `Towel: ${event.phase}`);
        return;

      case "ready":
        ctx?.ui.setStatus("towel", "Towel: listening");
        setTimeout(sendBoot, 50);
        return;

      case "delegation":
        dispatchAgent(buildDelegationRequest(workoutFile, event.request), {
          kind: "delegation",
          id: event.id,
        });
        return;

      case "rep_update":
        ctx?.ui.setStatus(
          "towel",
          `Towel: reps ${event.progress.latestNumber ?? "?"}`,
        );
        return;

      case "rep_complete":
        dispatchAgent(
          buildRepResultRequest({
            workoutFile,
            context: event.progress.context,
            latestNumber: event.progress.latestNumber,
            transcript: event.progress.transcript,
          }),
          { kind: "session", source: "reps" },
        );
        return;

      case "transcript":
        if (event.final && event.role === "user") {
          pi.logger.debug("Towel user transcript", { text: event.text });
        }
        return;

      case "error":
        notifyError(`Towel Codex Live error: ${event.error.message}`);
        return;
    }
  };

  const startRuntime = async (
    currentCtx: ExtensionContext,
    requestedFile = workoutFile,
    sendInitialBoot = true,
  ): Promise<void> => {
    workoutFile = resolveWorkoutFile(requestedFile, currentCtx.cwd);
    if (!existsSync(workoutFile)) throw new Error(`Workout Markdown not found: ${workoutFile}`);

    if (runtime) await runtime.close();
    active = true;
    ctx = currentCtx;
    bootSent = !sendInitialBoot;
    routes.length = 0;

    const sessionId = currentCtx.sessionManager.getSessionId();
    runtime = new CodexLiveRuntime({
      authStorage: currentCtx.modelRegistry.authStorage,
      sessionId,
      instructions: buildLiveInstructions(workoutFile),
      voice: process.env.TOWEL_VOICE?.trim() || "sol",
      onEvent: handleLiveEvent,
    });

    currentCtx.ui.setStatus("towel", "Towel: connecting Codex Live");
    await runtime.start();
    currentCtx.ui.setStatus("towel", "Towel: listening");
    if (sendInitialBoot) setTimeout(sendBoot, 50);
  };

  const stopRuntime = async (): Promise<void> => {
    active = false;
    bootSent = false;
    routes.length = 0;
    timers.cancel();
    const current = runtime;
    runtime = undefined;
    if (current) await current.close();
    ctx?.ui.setStatus("towel", undefined);
  };

  pi.on("session_start", async (_event, currentCtx) => {
    ctx = currentCtx;
    if (!active) return;
    try {
      await startRuntime(currentCtx, workoutFile, true);
    } catch (cause) {
      notifyError(`Towel failed to start Codex Live: ${String(cause)}`);
      currentCtx.ui.setStatus("towel", "Towel: failed");
    }
  });

  pi.on("session_shutdown", async () => {
    await stopRuntime();
  });

  pi.on("agent_end", async (event) => {
    if (event.willContinue) return;
    const route = routes.shift();
    if (!route || !runtime) return;

    const text = extractAssistantText(event.messages) || "I finished that step but have no spoken update.";
    const finalMessage = wrapAgentFinalMessage(text);
    try {
      if (route.kind === "delegation") {
        await runtime.sendDelegationText(route.id, finalMessage, "speakable");
      } else {
        await runtime.sendSessionText(finalMessage, "speakable");
      }
      runtime.markListening();
    } catch (cause) {
      notifyError(`Could not return the backend result to Codex Live: ${String(cause)}`);
    }
  });

  pi.registerCommand("towel-start", {
    description: "Start the Codex Live workout runtime: /towel-start [workout.md]",
    handler: async (args, currentCtx) => {
      try {
        await startRuntime(currentCtx, args.trim() || workoutFile, true);
        currentCtx.ui.notify(`Towel started with ${workoutFile}`, "info");
      } catch (cause) {
        currentCtx.ui.notify(String(cause), "error");
      }
    },
  });

  pi.registerCommand("towel-stop", {
    description: "Stop Codex Live, rep mode, and all Towel timers",
    handler: async (_args, currentCtx) => {
      await stopRuntime();
      currentCtx.ui.notify("Towel stopped", "info");
    },
  });

  pi.registerCommand("towel-status", {
    description: "Show Towel Codex Live status",
    handler: async (_args, currentCtx) => {
      currentCtx.ui.notify(
        JSON.stringify(
          {
            active,
            workoutFile,
            live: runtime?.status() ?? { phase: "stopped" },
            timers: timers.list(),
            queuedBackendResponses: routes.length,
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
    label: "Begin deterministic rep mode",
    description:
      "Enable silent live rep counting. The user speaks numbers and says done; Towel reports only the latest spoken number back to the backend.",
    parameters: z.object({
      context: z.string().describe("Concise set context, for example bench press set 2 at 80 kg"),
    }),
    async execute(_toolCallId, params) {
      requireRuntime().beginReps(params.context);
      return {
        content: [{ type: "text", text: `Rep mode is active for ${params.context}.` }],
        details: { context: params.context, mode: "reps" },
      };
    },
  });

  pi.registerTool({
    name: "towel_start_timer",
    label: "Start exact workout timer",
    description:
      "Start a deterministic timer using exactly the duration and announcements from the workout Markdown or user. Do not invent milestones.",
    parameters: z.object({
      label: z.string().describe("Human-readable timer label"),
      durationSeconds: z.number().positive().describe("Exact duration in seconds"),
      announcements: z
        .array(
          z.object({
            remainingSeconds: z.number().nonnegative(),
            text: z.string(),
          }),
        )
        .optional(),
      completionMessage: z.string().optional(),
    }),
    async execute(_toolCallId, params) {
      if (!active) throw new Error("Towel is not active");
      const id = timers.start(params);
      return {
        content: [{ type: "text", text: `Timer ${id} started for ${params.durationSeconds} seconds.` }],
        details: { id, ...params },
      };
    },
  });

  pi.registerTool({
    name: "towel_cancel_timer",
    label: "Cancel workout timer",
    description: "Cancel one Towel timer by id, or all timers when id is omitted.",
    parameters: z.object({
      id: z.string().optional(),
    }),
    async execute(_toolCallId, params) {
      const cancelled = timers.cancel(params.id);
      return {
        content: [{ type: "text", text: `Cancelled ${cancelled} timer${cancelled === 1 ? "" : "s"}.` }],
        details: { cancelled, id: params.id },
      };
    },
  });

  pi.registerTool({
    name: "towel_voice_status",
    label: "Inspect Towel live state",
    description: "Return Codex Live, rep-mode, and timer status.",
    parameters: z.object({}),
    async execute() {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                active,
                workoutFile,
                live: runtime?.status() ?? { phase: "stopped" },
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
          live: runtime?.status() ?? { phase: "stopped" },
          timers: timers.list(),
        },
      };
    },
  });
}
