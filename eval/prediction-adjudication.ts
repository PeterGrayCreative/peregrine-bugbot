import { randomUUID } from "node:crypto";
import type { MethodologyFinding } from "./methodology-output.js";
import { array, digest, exact, freeze, oneOf, same, text, unique } from "./prediction-contract.js";
import { verifySyntheticPredictionRun, type SyntheticPredictionRun } from "./prediction-evidence.js";
import type { PredictionPlan } from "./prediction-plan.js";
import { screenPredictionDisclosure } from "./prediction-disclosure.js";

export const PREDICTION_CATEGORIES = ["predicted-matched", "predicted-additional-supported", "predicted-unsupported", "unresolved"] as const;
export type PredictionCategory = typeof PREDICTION_CATEGORIES[number];
export const PREDICTION_RUBRIC = "Every finding, including failed/partial output and out-of-contract comparison findings, requires an initial Astra xhigh prediction and a distinct fresh Astra medium review. Predict matched, additional supported, unsupported, or unresolved from reviewed source. Absence from a bounded contract never implies unsupported. Deduplicate causal roots within a case. Record evidence, abstention and dissent. No category is confirmed truth; unresolved disagreements stay unresolved unless explicit source-based resolution is recorded.";
export interface MetadataBlindedFinding { id: string; caseId: string; finding: MethodologyFinding }
/** Mapping and sealed raw run are administrator-only and MUST NOT be sent to an
 * assessor. Packet metadata is blinded; free-form content is only screened for
 * listed disclosure patterns. No semantic blinding or reviewed redaction claim. */
export function buildSyntheticAdjudicationPacket(plan: PredictionPlan, run: SyntheticPredictionRun) {
  verifySyntheticPredictionRun(plan, run);
  const mapping: { id: string; caseId: string; attemptId: string; findingIndex: number; attemptSha256: string; rawResponseSha256: string; findingSha256: string }[] = [];
  const findings: MetadataBlindedFinding[] = [];
  for (const attempt of run.attempts) {
    const caseId = plan.registration.schedule.find(row => row.id === attempt.attemptId)!.caseId;
    attempt.findings.forEach((finding, findingIndex) => {
      const id = randomUUID();
      mapping.push({ id, caseId, attemptId: attempt.attemptId, findingIndex, attemptSha256: attempt.sha256, rawResponseSha256: attempt.rawResponseSha256!, findingSha256: digest(finding) });
      findings.push({ id, caseId, finding });
    });
  }
  findings.sort((a, b) => a.id.localeCompare(b.id));
  const sources = plan.cases.map(({ source }) => ({ caseId: source.caseId, scope: source.scope, sourceSha256: digest(source), contract: plan.registration.cases.find(item => item.caseId === source.caseId)!.contract, conditions: source.conditions }));
  const disclosureScreen = screenPredictionDisclosure({ sources, findings });
  if (disclosureScreen.status !== "no-listed-pattern-detected") throw new Error("assessor packet blocked by detectable arm/method/winner disclosure; preserve raw run and obtain separate reviewed redaction");
  const body = { kind: "synthetic-metadata-blinded-prediction-packet-v1", blinding: "metadata-only", freeTextBlindnessEstablished: false, disclosureScreen, rubric: PREDICTION_RUBRIC, rubricSha256: digest(PREDICTION_RUBRIC), sources, findings };
  const packet = { ...body, sha256: digest(body) };
  const binding = { planSha256: plan.sha256, runSha256: run.sha256, packetSha256: packet.sha256, mapping };
  return freeze({ packet, binding: { ...binding, sha256: digest(binding) } });
}
export type SyntheticAdjudicationBundle = ReturnType<typeof buildSyntheticAdjudicationPacket>;
export function verifySyntheticAdjudicationBundle(plan: PredictionPlan, run: SyntheticPredictionRun, bundle: SyntheticAdjudicationBundle): void {
  verifySyntheticPredictionRun(plan, run);
  exact(bundle, ["packet", "binding"], "adjudication bundle");
  exact(bundle.packet, ["kind", "blinding", "freeTextBlindnessEstablished", "disclosureScreen", "rubric", "rubricSha256", "sources", "findings", "sha256"], "metadata-blinded packet");
  exact(bundle.binding, ["planSha256", "runSha256", "packetSha256", "mapping", "sha256"], "administrator binding");
  bundle.packet.findings.forEach(item => exact(item, ["id", "caseId", "finding"], "blind finding"));
  bundle.binding.mapping.forEach(item => exact(item, ["id", "caseId", "attemptId", "findingIndex", "attemptSha256", "rawResponseSha256", "findingSha256"], "finding binding"));
  const { sha256: packetHash, ...packetBody } = bundle.packet;
  const { sha256: bindingHash, ...bindingBody } = bundle.binding;
  same(packetHash, digest(packetBody), "packet digest mismatch"); same(bindingHash, digest(bindingBody), "packet binding digest mismatch");
  same(bundle.binding.planSha256, plan.sha256, "packet plan mismatch"); same(bundle.binding.runSha256, run.sha256, "packet run mismatch"); same(bundle.binding.packetSha256, packetHash, "packet binding mismatch");
  // Reconstruct each binding independently; cardinality and identities prevent omission,
  // duplication, orphan mappings, swapped outputs, or inclusion only of matched findings.
  const expected = run.attempts.flatMap(attempt => attempt.findings.map((finding, findingIndex) => ({ caseId: plan.registration.schedule.find(row => row.id === attempt.attemptId)!.caseId, attemptId: attempt.attemptId, findingIndex, attemptSha256: attempt.sha256, rawResponseSha256: attempt.rawResponseSha256!, findingSha256: digest(finding) })));
  unique(bundle.binding.mapping.map(row => row.id)); unique(bundle.packet.findings.map(row => row.id));
  same(bundle.binding.mapping.map(({ id: _, ...rest }) => rest), expected, "not all findings bound in order");
  for (const row of bundle.binding.mapping) {
    const finding = bundle.packet.findings.find(item => item.id === row.id);
    if (!finding || finding.caseId !== row.caseId || digest(finding.finding) !== row.findingSha256) throw new Error("blind finding mismatch");
  }
  if (bundle.packet.findings.length !== expected.length) throw new Error("orphan packet finding");
  const skeleton = buildSyntheticAdjudicationPacket(plan, { ...run, attempts: run.attempts });
  same(bundle.packet.sources, skeleton.packet.sources, "source or bounded contract drift");
  same(bundle.packet.rubric, PREDICTION_RUBRIC, "rubric drift"); same(bundle.packet.rubricSha256, digest(PREDICTION_RUBRIC), "rubric binding drift");
  same(bundle.packet.kind, "synthetic-metadata-blinded-prediction-packet-v1", "packet kind mismatch");
  same(bundle.packet.blinding, "metadata-only", "blinding boundary mismatch");
  same(bundle.packet.freeTextBlindnessEstablished, false, "unproven free-text blinding claim");
  same(bundle.packet.disclosureScreen, screenPredictionDisclosure({ sources: bundle.packet.sources, findings: bundle.packet.findings }), "disclosure screen mismatch");
  if (bundle.packet.disclosureScreen.status !== "no-listed-pattern-detected") throw new Error("detectable disclosure in assessor packet");
}
export interface PredictionVote {
  category: PredictionCategory; causalRoot: string; matchedConditions: string[];
  evidence: string; abstention: string | null; dissent: string | null;
}
export interface PredictionJudgmentInput {
  findingId: string; initial: PredictionVote; review: PredictionVote;
  resolution: { vote: PredictionVote; sourceEvidence: string } | null;
}
export interface PredictionAssessor { sessionId: string; model: "gpt-6-astra"; effort: "xhigh" | "medium" }
export function sealSyntheticPredictionLedger(bundle: SyntheticAdjudicationBundle, assessors: { initial: PredictionAssessor; review: PredictionAssessor }, inputs: PredictionJudgmentInput[], previous: SyntheticPredictionLedger | null = null, predecessorChain: SyntheticPredictionLedger[] = []): SyntheticPredictionLedger {
  exact(assessors, ["initial", "review"], "assessors");
  for (const stage of ["initial", "review"] as const) {
    const assessor = exact(assessors[stage], ["sessionId", "model", "effort"], "assessor");
    text(assessor.sessionId); same(assessor.model, "gpt-6-astra", "Astra assessor required"); same(assessor.effort, stage === "initial" ? "xhigh" : "medium", "assessor effort mismatch");
  }
  if (assessors.initial.sessionId === assessors.review.sessionId) throw new Error("fresh distinct review session required");
  unique(inputs.map(row => row.findingId));
  same(inputs.map(row => row.findingId).sort(), bundle.packet.findings.map(row => row.id).sort(), "every finding needs both assessments");
  if (previous) {
    verifySyntheticPredictionLedger(bundle, previous, predecessorChain);
    preserveJudgmentHistory(previous, assessors, inputs);
  } else if (predecessorChain.length > 0) throw new Error("predecessor chain requires immediate previous ledger");
  function vote(value: unknown, caseId: string): PredictionVote {
    const item = exact(value, ["category", "causalRoot", "matchedConditions", "evidence", "abstention", "dissent"], "prediction vote");
    const category = oneOf(item.category, PREDICTION_CATEGORIES);
    const matchedConditions = array(item.matchedConditions).map(text).sort(); unique(matchedConditions);
    const allowed = bundle.packet.sources.find(item => item.caseId === caseId)!.conditions.map(item => item.id);
    if (matchedConditions.some(id => !allowed.includes(id))) throw new Error("unknown condition");
    if ((category === "predicted-matched") !== (matchedConditions.length > 0)) throw new Error("matched category requires bounded condition matches only");
    const abstention = item.abstention === null ? null : text(item.abstention);
    if (abstention !== null && category !== "unresolved") throw new Error("abstention must remain unresolved");
    return { category, causalRoot: text(item.causalRoot), matchedConditions, evidence: text(item.evidence), abstention, dissent: item.dissent === null ? null : text(item.dissent) };
  }
  const judgments = inputs.map(input => {
    exact(input, ["findingId", "initial", "review", "resolution"], "judgment");
    const caseId = bundle.packet.findings.find(item => item.id === input.findingId)!.caseId;
    const initial = vote(input.initial, caseId), review = vote(input.review, caseId);
    let resolution: { vote: PredictionVote; sourceEvidence: string } | null = null;
    if (input.resolution !== null) { const item = exact(input.resolution, ["vote", "sourceEvidence"], "resolution"); resolution = { vote: vote(item.vote, caseId), sourceEvidence: text(item.sourceEvidence) }; }
    const agree = digest({ category: initial.category, causalRoot: initial.causalRoot, matchedConditions: initial.matchedConditions }) === digest({ category: review.category, causalRoot: review.causalRoot, matchedConditions: review.matchedConditions });
    const final = resolution?.vote ?? (agree ? review : { category: "unresolved" as const, causalRoot: `unresolved:${input.findingId}`, matchedConditions: [], evidence: "Initial and review predictions disagree; source-based resolution absent.", abstention: "unresolved-disagreement", dissent: null });
    return { findingId: input.findingId, initial, review, resolution, final };
  }).sort((a, b) => a.findingId.localeCompare(b.findingId));
  const body = { kind: "synthetic-prediction-ledger-v1", bundleSha256: bundle.binding.sha256, packetSha256: bundle.packet.sha256, version: previous ? previous.version + 1 : 1, previousSha256: previous?.sha256 ?? null, assessors, judgments };
  return freeze({ ...body, sha256: digest(body) });
}
export interface SyntheticPredictionLedger {
  kind: string; bundleSha256: string; packetSha256: string; version: number; previousSha256: string | null;
  assessors: { initial: PredictionAssessor; review: PredictionAssessor };
  judgments: (PredictionJudgmentInput & { final: PredictionVote })[]; sha256: string;
}
export function verifyLedgerSeal(ledger: SyntheticPredictionLedger): void {
  exact(ledger, ["kind", "bundleSha256", "packetSha256", "version", "previousSha256", "assessors", "judgments", "sha256"], "prediction ledger");
  const { sha256, ...body } = ledger;
  same(sha256, digest(body), "ledger seal mismatch");
}
function preserveJudgmentHistory(previous: SyntheticPredictionLedger, assessors: SyntheticPredictionLedger["assessors"], inputs: PredictionJudgmentInput[]): void {
  same(previous.assessors, assessors, "append-only ledger cannot replace initial assessors");
  same(inputs.map(item => item.findingId).sort(), previous.judgments.map(item => item.findingId).sort(), "append-only finding frame mismatch");
  for (const row of inputs) {
    const original = previous.judgments.find(item => item.findingId === row.findingId)!;
    same(row.initial, original.initial, "append-only ledger cannot replace initial prediction");
    same(row.review, original.review, "append-only ledger cannot replace review prediction");
    if (original.resolution !== null) same(row.resolution, original.resolution, "preserve prior resolution; register a distinct reassessment artifact");
  }
}
/** Later versions require the complete ordered predecessor chain, including v1.
 * A self-hash proves byte integrity only, never that an alleged predecessor exists. */
export function verifySyntheticPredictionLedger(bundle: SyntheticAdjudicationBundle, ledger: SyntheticPredictionLedger, predecessors: SyntheticPredictionLedger[] = []): void {
  if (!Number.isSafeInteger(ledger.version) || ledger.version < 1 || predecessors.length !== ledger.version - 1) throw new Error("complete ledger predecessor chain required");
  let previous: SyntheticPredictionLedger | null = null;
  for (const [index, current] of [...predecessors, ledger].entries()) {
    verifyLedgerSeal(current);
    same(current.version, index + 1, "ledger version must increment exactly once");
    same(current.previousSha256, previous?.sha256 ?? null, "ledger predecessor hash mismatch");
    const inputs = current.judgments.map(({ final: _, ...input }) => input);
    const rebuilt = sealSyntheticPredictionLedger(bundle, current.assessors, inputs);
    same(current.judgments, rebuilt.judgments, "ledger adjudication mismatch");
    same(current.bundleSha256, bundle.binding.sha256, "ledger binding mismatch"); same(current.packetSha256, bundle.packet.sha256, "ledger packet mismatch");
    same(current.kind, rebuilt.kind, "ledger kind mismatch");
    if (previous) preserveJudgmentHistory(previous, current.assessors, inputs);
    previous = current;
  }
}
