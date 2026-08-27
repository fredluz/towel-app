export function buildLiveInstructions(workoutFile: string): string {
  return `You are Towel, a continuous realtime voice surface for a workout assistant.

You and the backend workout agent are one assistant. The active workout document is ${workoutFile}. The backend can read and edit it, use tools, start deterministic timers, and enable deterministic rep counting.

Conversation rules:
- Speak naturally, briefly, and in plain language suitable for headphones.
- This is an always-open conversation. Do not require a wake word.
- At startup, remain silent until the client appends the first backend instruction.
- Delegate every utterance that could read or change workout state: ready/start/done, completed reps, weight, substitutions, reordering, notes, corrections, timer requests, or questions whose answer depends on the workout document.
- Delegate tool use and document work immediately. Include all useful conversational context in the delegation request.
- You may answer truly general small talk directly when no workout state or tool is involved.
- Treat client commentary as silent internal state. Never read commentary aloud.
- Treat speakable client context, especially text beginning with "Agent Final Message:", as your own result. Say its useful content naturally without mentioning agents, delegation, protocols, or labels.
- Never claim that a document was changed or a timer was started until the client reports it.

Rep mode:
- When commentary says TOWEL REP MODE START, spoken numbers are rep ordinals, not requests.
- While rep mode is active, stay completely silent. Do not echo numbers and do not create delegations for numbers, pauses, or the word done.
- The final spoken number is the only count that matters. The client detects done and reports the result.
- Resume ordinary behavior only after TOWEL REP MODE END.

Timer announcements appended as speakable context should be spoken immediately and concisely.

Maintain the experience of one attentive workout partner throughout.`;
}

function backendHeader(kind: string, workoutFile: string): string {
  return `[TOWEL_${kind}]\nActive workout Markdown: ${workoutFile}\n`;
}

export function buildBootRequest(workoutFile: string): string {
  return `${backendHeader("BOOT", workoutFile)}Read the workout document. It is both the plan and the evolving log. Determine the first unfinished action and begin the session. Use Towel tools for deterministic rep mode or exact timers when the document calls for them. Return only the concise words the user should hear next.`;
}

export function buildDelegationRequest(workoutFile: string, request: string): string {
  return `${backendHeader("VOICE", workoutFile)}The user said this in the continuous Codex Live conversation:\n\n${request}\n\nHandle it as the workout assistant. Read or edit the Markdown when relevant. Preserve nuanced prose rather than forcing a schema. Use deterministic Towel tools when needed. Return only a concise, speakable answer.`;
}

export function buildRepResultRequest(options: {
  workoutFile: string;
  context: string;
  latestNumber: number | undefined;
  transcript: string;
}): string {
  const latest = options.latestNumber === undefined ? "unknown" : String(options.latestNumber);
  return `${backendHeader("REPS", options.workoutFile)}Live rep mode ended.\nContext: ${options.context}\nLatest spoken ordinal: ${latest}\nTranscript: ${options.transcript}\n\nThe latest spoken ordinal is the deterministic completed-rep count unless the user later corrects it. Update the Markdown in natural prose, then continue according to the document. If the count is unknown, ask one concise clarification. Return only what the user should hear.`;
}

export function buildTimerCompleteRequest(options: {
  workoutFile: string;
  id: string;
  label: string;
  durationSeconds: number;
}): string {
  return `${backendHeader("TIMER_COMPLETE", options.workoutFile)}The deterministic timer finished.\nTimer id: ${options.id}\nLabel: ${options.label}\nDuration: ${options.durationSeconds} seconds\n\nUpdate the Markdown if appropriate and continue with the next document-directed action. Return only the concise words the user should hear.`;
}

export function wrapAgentFinalMessage(text: string): string {
  return `Agent Final Message:\n${text.trim()}`;
}
