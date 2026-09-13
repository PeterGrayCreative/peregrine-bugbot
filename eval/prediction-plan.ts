import { CORE_LANE_IDS } from "../src/core/lanes.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../src/core/paths.js";
import { compileMethodologyReviewPrompt, parseMethodologyRawScope, type CompiledMethodologyPrompt, type MethodologyRawScope } from "./methodology-prompts.js";
import { array, digest, exact, freeze, hash, oneOf, PREDICTION_BOUNDARY, same, sha, text, unique } from "./prediction-contract.js";

export type PredictionArm = "A" | "B";
export interface PredictionCase {
  caseId: string; repository: string; family: string;
  proposedClass: "bug-bearing" | "reviewed-comparison"; contract: string;
}
export interface PredictionScheduleEntry { id: string; caseId: string; repeat: number; arm: PredictionArm; status: "not-executed"; providerCalls: 0 }
export const PREDICTION_LIMITS = Object.freeze({ aggregateTokens: 120_000, readCalls: 100, returnedToolBytes: 2_000_000, outputTokens: 16_000, wallMs: 1_200_000, retries: 0 });
const ROOT_KEYS = ["schemaVersion", "protocol", "evidenceClass", "parentOutcome", "supersedesFailedManifest", "sources", "cases", "retainedLosses", "repositoryCounts", "caseCount", "sourceFamilyCount", "repeats", "schedule", "concentrationPolicy", "contrast", "outcomeUnit", "incompleteAttemptCoverage", "retryCount", "allowedLabelInvalidationCounts", "status", "providerExecutionAuthorized", "historicalRunnerMaterializationComplete", "providerCalls", "blockers", "forbiddenClaims"];

/** expectedSha256 must come from the separately frozen registration, never from untrusted bytes. */
export function bindPredictionRegistration(bytes: string, expectedSha256: string) {
  if (sha(bytes) !== hash(expectedSha256)) throw new Error("registration byte digest mismatch");
  const root = exact(JSON.parse(bytes), ROOT_KEYS, "registration");
  for (const [key, value] of Object.entries({ schemaVersion: 1, protocol: "ai-prediction-development-v1", evidenceClass: "registration-and-synthetic-analysis-only", parentOutcome: "Section3-FAIL-preserved", caseCount: 16, sourceFamilyCount: 15, repeats: 2, contrast: "B-minus-A-single-session-method-portability", outcomeUnit: "bounded-predicted-contract-bundle-per-case", incompleteAttemptCoverage: 0, retryCount: 0, status: "registration-integrity-only", providerExecutionAuthorized: false, historicalRunnerMaterializationComplete: false, providerCalls: 0 })) same(root[key], value, `registration ${key} drift`);
  same(root.allowedLabelInvalidationCounts, Array.from({ length: 10 }, (_, i) => i), "label budgets drift");
  same(root.concentrationPolicy, { scope: "this-fixed-development-set-only", maximumCasesFromOneRepository: 5, maximumShare: 0.3125, priorCapSatisfied: false, resamplingOrRebalancingAllowed: false }, "concentration policy drift");
  const supersedes = exact(root.supersedesFailedManifest, ["path", "sha256", "reason"], "preserved failed manifest");
  text(supersedes.path); hash(supersedes.sha256); text(supersedes.reason);
  if (!root.sources || typeof root.sources !== "object" || Array.isArray(root.sources) || Object.keys(root.sources).length !== 3) throw new Error("three source bindings required");
  Object.entries(root.sources).forEach(([path, value]) => { text(path); hash(value); });
  array(root.blockers).forEach(text);
  same(root.forbiddenClaims, ["human-verified", "calibrated-label-accuracy", "known-root-recall", "whole-PR-cleanliness", "independent-confirmation", "holdout", "efficacy", "superiority", "safety"], "claim boundary drift");
  const all = array(root.cases).map(value => {
    const item = exact(value, ["caseId", "disposition", "proposedClass", "proof", "contract", "repository", "family", "exposure", "label", "included"], "prediction case");
    const disposition = oneOf(item.disposition, ["approve", "unresolved", "reject"]);
    same(item.included, disposition === "approve", "selection mismatch");
    same(item.exposure, "visible-historical-development", "exposure drift");
    same(item.label, "uncalibrated-ai-prediction", "truth promotion prohibited");
    if (disposition === "approve") same(item.proof, "static", "approved prediction must remain static"); else text(item.proof);
    return { caseId: text(item.caseId), repository: text(item.repository), family: text(item.family), proposedClass: oneOf(item.proposedClass, ["bug-bearing", "reviewed-comparison", "other/unclassified"]), contract: text(item.contract), disposition };
  });
  unique(all.map(item => item.caseId));
  if (all.length !== 36 || all.filter(item => item.disposition === "unresolved").length !== 19 || all.filter(item => item.disposition === "reject").length !== 1) throw new Error("disposition frame drift");
  const cases: PredictionCase[] = all.filter(item => item.disposition === "approve").map(({ disposition: _, ...item }) => ({ ...item, proposedClass: oneOf(item.proposedClass, ["bug-bearing", "reviewed-comparison"]) }));
  if (cases.length !== 16 || cases.filter(item => item.proposedClass === "bug-bearing").length !== 9 || new Set(cases.map(item => item.family)).size !== 15) throw new Error("included frame drift");
  if (cases.some(item => cases.some(other => other.family === item.family && other.repository !== item.repository))) throw new Error("source family crosses repositories");
  const losses = array(root.retainedLosses).map(value => { const item = exact(value, ["caseId", "classification", "evidencePath"], "loss"); same(item.classification, "reconstruction-loss", "loss drift"); text(item.evidencePath); return text(item.caseId); });
  unique([...all.map(item => item.caseId), ...losses]);
  if (losses.length !== 11) throw new Error("loss count drift");
  const counts = Object.fromEntries([...new Set(cases.map(item => item.repository))].sort().map(repo => [repo, cases.filter(item => item.repository === repo).length]));
  same(root.repositoryCounts, counts, "repository count mismatch");
  same(Object.values(counts).sort((a, b) => a - b), [1, 1, 2, 3, 4, 5], "repository frame drift");
  // Order is normative, including alternation. No replacement schedule or retry exists.
  const schedule: PredictionScheduleEntry[] = cases.flatMap((item, index) => [1, 2].flatMap(repeat => ((index + repeat) % 2 ? ["A", "B"] : ["B", "A"]).map(arm => ({ id: `${item.caseId}/${repeat}/${arm}`, caseId: item.caseId, repeat, arm: arm as PredictionArm, status: "not-executed" as const, providerCalls: 0 as const }))));
  same(root.schedule, schedule, "exact 64-attempt schedule mismatch");
  return freeze({ registrationSha256: expectedSha256, cases, schedule });
}
export type PredictionRegistration = ReturnType<typeof bindPredictionRegistration>;
export interface PredictionSource {
  caseId: string; scope: MethodologyRawScope;
  /** Synthetic asset binding only. Neither digest authenticates a real mount. */
  inventorySha256: string; toolPolicySha256: string;
  conditions: { id: string; text: string }[];
}
export interface PredictionPlan {
  boundary: string; kind: "synthetic-prediction-plan-v1"; registration: PredictionRegistration;
  requestedRoute: { model: "gpt-5.6-sol"; effort: "high"; version: string | null };
  limits: typeof PREDICTION_LIMITS;
  outputSchemaSha256: string;
  cases: { source: PredictionSource; prompts: { A: CompiledMethodologyPrompt; B: CompiledMethodologyPrompt } }[];
  sha256: string;
}
// Authentication is a capability, not a claim supplied by JSON. Persisted plans must
// be reconstructed against separately trusted registration bytes before use.
const authenticatedPlans = new WeakSet<PredictionPlan>();
export async function buildSyntheticPredictionPlan(registrationBytes: string, registrationSha256: string, sources: PredictionSource[], version: string | null): Promise<PredictionPlan> {
  const registration = bindPredictionRegistration(registrationBytes, registrationSha256);
  if (version !== null) text(version);
  const sourceInputs = freeze(sources);
  same(sourceInputs.map(item => item.caseId), registration.cases.map(item => item.caseId), "sources must follow complete registered frame");
  const cases = [];
  for (const input of sourceInputs) {
    exact(input, ["caseId", "scope", "inventorySha256", "toolPolicySha256", "conditions"], "synthetic source");
    const conditions = array(input.conditions).map(value => { const item = exact(value, ["id", "text"], "frozen condition"); return { id: text(item.id), text: text(item.text) }; });
    unique(conditions.map(item => item.id));
    if (conditions.length === 0) throw new Error("bounded contract conditions required; they are supplementary, not independent cases");
    const source = { caseId: input.caseId, scope: parseMethodologyRawScope(input.scope), inventorySha256: hash(input.inventorySha256), toolPolicySha256: hash(input.toolPolicySha256), conditions };
    const A = await compileMethodologyReviewPrompt({ armId: "A", scope: source.scope });
    const B = await compileMethodologyReviewPrompt({ armId: "B", scope: source.scope, activatedLanes: [...CORE_LANE_IDS] });
    same(A.rawScopeSha256, B.rawScopeSha256, "raw prompt scope inequality");
    same(A.schemaPath, B.schemaPath, "output schema inequality");
    if (A.methodSourceSha256 !== null || B.methodSourceSha256 === null || A.handoffSha256 !== null || B.handoffSha256 !== null) throw new Error("method isolation failure");
    cases.push({ source, prompts: { A, B } });
  }
  const body = { boundary: PREDICTION_BOUNDARY, kind: "synthetic-prediction-plan-v1" as const, registration, requestedRoute: { model: "gpt-5.6-sol" as const, effort: "high" as const, version }, limits: PREDICTION_LIMITS, outputSchemaSha256: sha(readFileSync(join(packageRoot(), "schemas/methodology-review.schema.json"))), cases };
  const plan = freeze({ ...body, sha256: digest(body) });
  authenticatedPlans.add(plan);
  return plan;
}
/** Returns a new immutable authenticated plan. The authority arguments must come
 * from the separately frozen registration, not the plan being authenticated.
 * Source inventories remain synthetic claims; this does not authenticate mounts. */
export async function verifyPredictionPlan(plan: PredictionPlan, registrationBytes: string, expectedRegistrationSha256: string): Promise<PredictionPlan> {
  const snapshot = freeze(plan);
  const rebuilt = await buildSyntheticPredictionPlan(registrationBytes, expectedRegistrationSha256, snapshot.cases.map(item => item.source), snapshot.requestedRoute.version);
  same(snapshot, rebuilt, "prediction plan differs from normative registration or compiler reconstruction");
  return rebuilt;
}
export function requireVerifiedPredictionPlan(plan: PredictionPlan): void {
  if (!authenticatedPlans.has(plan)) throw new Error("prediction plan requires trusted registration and compiler authentication before use");
}
