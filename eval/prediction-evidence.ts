import { writeFileSync } from "node:fs";
import { canonicalJson } from "./experiment.js";
import { parseMethodologyReviewOutput, type MethodologyFinding } from "./methodology-output.js";
import { array, digest, exact, freeze, hash, integer, oneOf, PREDICTION_BOUNDARY, same, sha, text, unique } from "./prediction-contract.js";
import { PREDICTION_LIMITS, requireVerifiedPredictionPlan, type PredictionPlan } from "./prediction-plan.js";

export const ATTEMPT_STATUSES = ["completed", "missing", "timeout", "tool-failure", "context-failure", "transport-failure", "parse-failure", "incomplete"] as const;
export type AttemptStatus = typeof ATTEMPT_STATUSES[number];
export interface PredictionUsage { aggregateTokens: number | null; outputTokens: number | null; wallMs: number | null; readCalls: number | null; returnedToolBytes: number | null; costUsd: number | null }
export interface SyntheticAttemptInput {
  attemptId: string; status: AttemptStatus; rawResponse: string | null;
  observedRoute: { model: string; effort: string; version: string } | null;
  usage: PredictionUsage;
}
export interface SyntheticAttempt extends SyntheticAttemptInput {
  findings: MethodologyFinding[]; rawResponseSha256: string | null;
  parseErrors: string[]; routeMatchesRequested: boolean | null; accountingComplete: boolean; exceededLimits: string[];
  sha256: string;
}
export const UNKNOWN_USAGE: PredictionUsage = Object.freeze({ aggregateTokens: null, outputTokens: null, wallMs: null, readCalls: null, returnedToolBytes: null, costUsd: null });

function parseUsage(value: unknown): PredictionUsage {
  const item = exact(value, Object.keys(UNKNOWN_USAGE), "usage");
  const result = { ...UNKNOWN_USAGE };
  for (const key of Object.keys(result) as (keyof PredictionUsage)[]) {
    const observed = item[key];
    if (observed === null) continue;
    if (key === "costUsd") {
      if (typeof observed !== "number" || !Number.isFinite(observed) || observed < 0) throw new Error("invalid observed cost");
      result[key] = observed;
    } else result[key] = integer(observed);
  }
  if (result.aggregateTokens !== null && result.outputTokens !== null && result.outputTokens > result.aggregateTokens) throw new Error("output tokens exceed aggregate tokens");
  return result;
}
function parseAttempt(plan: PredictionPlan, value: SyntheticAttemptInput): SyntheticAttempt {
  const item = exact(value, ["attemptId", "status", "rawResponse", "observedRoute", "usage"], "synthetic attempt");
  const attemptId = text(item.attemptId);
  if (!plan.registration.schedule.some(row => row.id === attemptId)) throw new Error("unscheduled attempt or retry");
  let status = oneOf(item.status, ATTEMPT_STATUSES);
  const rawResponse = item.rawResponse === null ? null : typeof item.rawResponse === "string" ? item.rawResponse : (() => { throw new Error("raw response must be text or null"); })();
  const usage = parseUsage(item.usage);
  let observedRoute: SyntheticAttemptInput["observedRoute"] = null;
  if (item.observedRoute !== null) { const route = exact(item.observedRoute, ["model", "effort", "version"], "observed route"); observedRoute = { model: text(route.model), effort: text(route.effort), version: text(route.version) }; }
  if (status === "missing" && (rawResponse !== null || observedRoute !== null || Object.values(usage).some(value => value !== null))) throw new Error("missing attempt cannot carry observed execution");
  if (status === "completed" && rawResponse === null) throw new Error("completed attempt needs output");
  let findings: MethodologyFinding[] = [];
  const parseErrors: string[] = [];
  if (rawResponse !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(rawResponse); } catch { parseErrors.push("invalid-json"); }
    if (parsed !== undefined) {
      try {
        const output = parseMethodologyReviewOutput(parsed);
        findings = output.findings;
        if (status === "completed" && output.status !== "completed") status = "incomplete";
      } catch {
        parseErrors.push("invalid-review-envelope");
        // Retain individually valid partial findings even when the envelope or a sibling is invalid.
        if (parsed && typeof parsed === "object" && "findings" in parsed && Array.isArray(parsed.findings)) {
          parsed.findings.forEach((finding, index) => {
            try { findings.push(parseMethodologyReviewOutput({ status: "completed", limitations: [], findings: [finding] }).findings[0]!); }
            catch { parseErrors.push(`invalid-finding-${index}`); }
          });
        }
      }
    }
    if (status === "completed" && parseErrors.length > 0) status = "parse-failure";
  }
  // An unknown version cannot erase a known model/effort mismatch.
  const routeMatchesRequested = observedRoute === null ? null
    : observedRoute.model !== plan.requestedRoute.model || observedRoute.effort !== plan.requestedRoute.effort ? false
      : plan.requestedRoute.version === null ? null : observedRoute.version === plan.requestedRoute.version;
  const exceededLimits = (Object.keys(PREDICTION_LIMITS) as (keyof typeof PREDICTION_LIMITS)[]).filter(key => key !== "retries" && usage[key] !== null && usage[key]! > PREDICTION_LIMITS[key]);
  const accountingComplete = ["aggregateTokens", "outputTokens", "wallMs", "readCalls", "returnedToolBytes"].every(key => usage[key as keyof PredictionUsage] !== null);
  // Preserve supplied failure categories. A nominal completion cannot hide a known contract breach.
  if (status === "completed" && (routeMatchesRequested === false || exceededLimits.length > 0)) status = "incomplete";
  const body = { attemptId, status, rawResponse, observedRoute, usage, findings, rawResponseSha256: rawResponse === null ? null : sha(rawResponse), parseErrors, routeMatchesRequested, accountingComplete, exceededLimits };
  return freeze({ ...body, sha256: digest({ planSha256: plan.sha256, ...body }) });
}
export function sealSyntheticPredictionRun(plan: PredictionPlan, runId: string, inputs: SyntheticAttemptInput[]) {
  requireVerifiedPredictionPlan(plan); text(runId); array(inputs);
  unique(inputs.map(item => item.attemptId));
  const supplied = inputs.map(item => parseAttempt(plan, item));
  const attempts = plan.registration.schedule.map(row => supplied.find(item => item.attemptId === row.id) ?? parseAttempt(plan, { attemptId: row.id, status: "missing", rawResponse: null, observedRoute: null, usage: UNKNOWN_USAGE }));
  const body = { kind: "synthetic-prediction-run-v1", boundary: PREDICTION_BOUNDARY, runId, planSha256: plan.sha256, providerCalls: 0, attempts };
  return freeze({ ...body, sha256: digest(body) });
}
export type SyntheticPredictionRun = ReturnType<typeof sealSyntheticPredictionRun>;
export function verifySyntheticPredictionRun(plan: PredictionPlan, run: SyntheticPredictionRun): void {
  const reconstructed = sealSyntheticPredictionRun(plan, run.runId, run.attempts.map(({ attemptId, status, rawResponse, observedRoute, usage }) => ({ attemptId, status, rawResponse, observedRoute, usage })));
  same(run, reconstructed, "synthetic run seal mismatch");
}
/** A content-addressed create-only file preserves prior attempts. No overwrite mode exists. */
export function persistSyntheticPredictionRun(path: string, plan: PredictionPlan, run: SyntheticPredictionRun): void {
  verifySyntheticPredictionRun(plan, run);
  if (!path.endsWith(`/${hash(run.sha256)}.json`)) throw new Error("run filename must be its digest");
  writeFileSync(path, `${canonicalJson(run)}\n`, { flag: "wx", mode: 0o600 });
}

/** Cumulative wrapper accounting only: it cannot establish provider token/wall enforcement.
 * Reserve before dispatch; count failed calls and UTF-8 returned bytes; fail closed on overrun.
 * No tools are invoked here. Bind each ticket's resource event into the synthetic evidence externally. */
export function createPredictionReadBudget(limits: { calls: number; bytes: number } = { calls: 100, bytes: 2_000_000 }) {
  exact(limits, ["calls", "bytes"], "read budget");
  if (integer(limits.calls) > 100 || integer(limits.bytes) > 2_000_000 || limits.calls < 1 || limits.bytes < 1) throw new Error("invalid read limits");
  const cap = { ...limits };
  let calls = 0, bytes = 0, stopped = false;
  const pending = new Set<number>();
  const events: { ticket: number; status: "returned" | "failed" | "over-budget"; bytes: number; responseSha256: string }[] = [];
  return {
    reserve(): number {
      if (stopped || calls >= cap.calls) throw new Error("read call budget exhausted");
      const ticket = ++calls; pending.add(ticket); return ticket;
    },
    settle(ticket: number, returnedBytes: string, failed: boolean): boolean {
      integer(ticket);
      if (!pending.has(ticket) || typeof returnedBytes !== "string" || typeof failed !== "boolean") throw new Error("unknown/already settled read ticket");
      pending.delete(ticket);
      const size = Buffer.byteLength(returnedBytes, "utf8"); bytes += size;
      if (!Number.isSafeInteger(bytes)) throw new Error("byte accounting overflow");
      const deliverable = !stopped && bytes <= cap.bytes;
      if (!deliverable) stopped = true;
      events.push({ ticket, status: deliverable ? failed ? "failed" : "returned" : "over-budget", bytes: size, responseSha256: sha(returnedBytes) });
      return deliverable;
    },
    snapshot() { return freeze({ calls, bytes, stopped, pending: [...pending].sort((a, b) => a - b), events }); },
  };
}
