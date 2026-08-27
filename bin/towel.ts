#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Bun.argv.slice(2);
const workoutArg = args.shift();

if (!workoutArg || workoutArg === "--help" || workoutArg === "-h") {
  console.log(`Usage: towel <workout.md> [-- <omp arguments>]

Starts one continuous Codex Live headphone conversation and the Towel OMP
extension. The active Markdown file is both the workout plan and the log.

Examples:
  towel workouts/example.md
  towel workouts/today.md -- --model openai/gpt-5.6

Environment:
  TOWEL_VOICE   Codex Live voice (default: sol)`);
  process.exit(workoutArg ? 0 : 1);
}

const separator = args.indexOf("--");
const ompArgs = separator >= 0 ? args.slice(separator + 1) : args;
const workoutFile = resolve(isAbsolute(workoutArg) ? workoutArg : resolve(process.cwd(), workoutArg));
if (!existsSync(workoutFile)) {
  console.error(`Workout Markdown not found: ${workoutFile}`);
  process.exit(1);
}

const ompBinary = join(rootDir, "node_modules", ".bin", "omp");
if (!existsSync(ompBinary)) {
  console.error("Local OMP is not installed. Run: bun install");
  process.exit(1);
}

const extensionPath = join(rootDir, "extension", "towel.ts");
const child = Bun.spawn({
  cmd: [ompBinary, "--extension", extensionPath, ...ompArgs],
  cwd: rootDir,
  env: {
    ...process.env,
    TOWEL_ACTIVE: "1",
    TOWEL_WORKOUT_FILE: workoutFile,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

process.exit(await child.exited);
