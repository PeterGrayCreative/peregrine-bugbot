import { codexUsageFromEvents } from "../src/core/telemetry.js";
import { digest, freeze, hash, integer, same, sha } from "./prediction-contract.js";
import { bindPredictionRegistration, PREDICTION_LIMITS } from "./prediction-plan.js";
const registrations = new WeakSet<object>();

/** Prospective amendment, never a reinterpretation of the predecessor's caps. */
export function registerPredictionCliSession(bytes: string, expectedSha256: string, predecessorFreezeSha256: string) {
  const original = bindPredictionRegistration(bytes, expectedSha256);
  const body = { protocol: "prediction-cli-session-correction-v1", originalRegistrationSha256: expectedSha256, predecessorFreezeSha256: hash(predecessorFreezeSha256),
    schedule: original.schedule, requestedRoute: { model: "gpt-5.6-sol", effort: "high", providerAccess: "cli-session" },
    exactServedModel: null, exactServedVersion: null,
    unmetPredecessorGuarantees: { perAttemptAggregateTokens: PREDICTION_LIMITS.aggregateTokens, perAttemptOutputTokens: PREDICTION_LIMITS.outputTokens, exactServedIdentity: true },
    hardLimits: { wallMs: PREDICTION_LIMITS.wallMs, readCalls: PREDICTION_LIMITS.readCalls, returnedBytes: PREDICTION_LIMITS.returnedToolBytes, retries: 0, delegation: false, concurrentAttempts: 1 },
    batchStop: { aggregateReportedTokens: 64 * PREDICTION_LIMITS.aggregateTokens, outputReportedTokens: 64 * PREDICTION_LIMITS.outputTokens,
      units: "sum of terminal CLI-reported input+output; output is not added again as reasoning", evaluation: "after every terminal, before starting the next scheduled attempt",
      missingUsage: "stop batch; retain unknown, never substitute zero", overshoot: "one in-flight attempt can exceed a threshold; retain and report it, never claim a hard provider-token ceiling" },
    analysis: "All 64 planned slots remain in the ledger. Report observed prefix, missing suffix, arm exposure and stopping cause. No equal-compute, exact-served-route, causal efficacy or calibrated-truth claim.",
    requiredBeforeDispatch: ["fresh independent gate and explicit authorization bound to the successor freeze", "accepted runtime image and selected CLI-session access, with no API-key fallback",
      "four-tool prediction policy attached to isolated runtime", "whole-attempt deadline starts before preparation; abort closes reads and kills active exec; container/sidecar/network absence is proved before a next attempt"],
    providerAuthorized: false, executionReady: false, providerCalls: 0 };
  const registration = freeze({ ...body, sha256: digest(body) }); registrations.add(registration); return registration;
}
export type PredictionCliSessionRegistration = ReturnType<typeof registerPredictionCliSession>;

export function observePredictionCliTokens(events: unknown[], completeEventStream: boolean) {
  const usage = codexUsageFromEvents(events, "", { completeEventStream });
  const known = Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens) &&
    Number.isSafeInteger(usage.inputTokens! + usage.outputTokens!);
  return freeze({ kind: "terminal-cli-token-observation-v1", status: known ? "known" : "unknown", rawEventsSha256: digest(events),
    inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, reasoningOutputTokens: usage.reasoningOutputTokens ?? null,
    reportedAggregateTokens: known ? usage.inputTokens! + usage.outputTokens! : null, exactServedModel: null, exactServedVersion: null,
    meaning: "CLI-reported counters only; missing reasoning detail is unknown, not zero; no live cap or total-compute measurement" });
}
export interface PredictionCliTerminal {
  attemptId: string; status: "completed" | "partial" | "failed" | "missing";
  events: unknown[]; completeEventStream: boolean; rawOutput: string | null;
  cleanupProven: boolean; deadlineExceeded: boolean;
}
/** Reconstruct the serial prefix; a stopped batch cannot append, skip or retry. */
export function assessPredictionCliBatch(registration: PredictionCliSessionRegistration, terminals: PredictionCliTerminal[]) {
  if (!registrations.has(registration)) throw new Error("reconstruct CLI registration from trusted original bytes before use");
  const { sha256, ...body } = registration; same(digest(body), sha256, "CLI registration seal drift");
  // Reassert prospective semantics so a resealed caller object cannot relax them.
  same(registration.hardLimits, { wallMs: 1200000, readCalls: 100, returnedBytes: 2000000, retries: 0, delegation: false, concurrentAttempts: 1 }, "CLI hard limits drift");
  same([registration.batchStop.aggregateReportedTokens, registration.batchStop.outputReportedTokens], [7680000, 1024000], "batch ceilings drift");
  if (registration.schedule.length !== 64 || terminals.length > 64) throw new Error("complete 64-slot schedule required");
  let aggregate = 0, output = 0, stop: string | null = null;
  const observed = terminals.map((terminal, index) => {
    if (stop) throw new Error("cannot continue a stopped batch");
    same(terminal.attemptId, registration.schedule[index]!.id, "terminal is not the next exact scheduled attempt");
    if (!["completed", "partial", "failed", "missing"].includes(terminal.status) || typeof terminal.cleanupProven !== "boolean" || typeof terminal.deadlineExceeded !== "boolean" || typeof terminal.completeEventStream !== "boolean" || !Array.isArray(terminal.events)) throw new Error("invalid terminal status");
    if (terminal.status === "missing" && (terminal.rawOutput !== null || terminal.events.length)) throw new Error("missing terminal cannot hide observed work");
    const tokens = observePredictionCliTokens(terminal.events, terminal.completeEventStream);
    if (tokens.status === "known") { aggregate = integer(aggregate + tokens.reportedAggregateTokens!); output = integer(output + tokens.outputTokens!); }
    if (!terminal.cleanupProven) stop = "cleanup-unproven";
    else if (tokens.status === "unknown") stop = "terminal-token-usage-unknown";
    else if (aggregate >= registration.batchStop.aggregateReportedTokens || output >= registration.batchStop.outputReportedTokens) stop = "cumulative-reported-token-ceiling";
    return { attemptId: terminal.attemptId, status: terminal.status, deadlineExceeded: terminal.deadlineExceeded, cleanupProven: terminal.cleanupProven,
      rawOutputSha256: terminal.rawOutput === null ? null : sha(terminal.rawOutput), tokens };
  });
  return freeze({ registrationSha256: registration.sha256, observed, knownReportedAggregateTokens: aggregate, knownReportedOutputTokens: output,
    totalsComplete: observed.every(t => t.tokens.status === "known"), stopReason: stop,
    unstartedAttemptIds: registration.schedule.slice(terminals.length).map(a => a.id), nextAttemptId: stop ? null : registration.schedule[terminals.length]?.id ?? null,
    providerAuthorized: false, executionReady: false, interpretation: "Unknown usage is excluded from known sums, not counted as zero. Batch stopping is prospective and may be imbalanced across arms." });
}
