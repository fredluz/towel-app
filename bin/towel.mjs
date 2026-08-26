#!/usr/bin/env node
import { access } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.log(`Usage: towel [workout.md] [-- <pi arguments>]

Starts Pi in the towel-app project with the macOS voice runtime enabled.

Examples:
  towel workouts/example.md
  npm run towel -- workouts/today.md
  towel workouts/today.md -- --model openai/gpt-5.6
`);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  usage();
  process.exit(0);
}

const separator = argv.indexOf("--");
const towelArgs = separator === -1 ? argv : argv.slice(0, separator);
const piArgs = separator === -1 ? [] : argv.slice(separator + 1);
const requestedWorkout = towelArgs[0] || "workouts/example.md";
const workoutFile = isAbsolute(requestedWorkout)
  ? requestedWorkout
  : resolve(process.cwd(), requestedWorkout);

if (process.platform !== "darwin") {
  console.error("Towel's voice runtime currently requires macOS 26 or later.");
  process.exit(1);
}

try {
  await access(workoutFile);
} catch {
  console.error(`Workout Markdown not found: ${workoutFile}`);
  process.exit(1);
}

const piLookup = spawnSync("which", ["pi"], { encoding: "utf8" });
if (piLookup.status !== 0 || !piLookup.stdout.trim()) {
  console.error(
    "Pi is not installed. Install @earendil-works/pi-coding-agent, authenticate it, then retry.",
  );
  process.exit(1);
}

const child = spawn(piLookup.stdout.trim(), piArgs, {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    TOWEL_ACTIVE: "1",
    TOWEL_WORKOUT_FILE: workoutFile,
    TOWEL_WAKE_WORD: process.env.TOWEL_WAKE_WORD || "towel",
    TOWEL_LOCALE: process.env.TOWEL_LOCALE || "en_US",
  },
});

child.once("error", (error) => {
  console.error(`Could not start Pi: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
