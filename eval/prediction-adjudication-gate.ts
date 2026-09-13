import { array, digest, exact, freeze, hash, same, text, unique } from "./prediction-contract.js";
import { sealSyntheticPredictionLedger, verifySyntheticAdjudicationBundle, type PredictionJudgmentInput, type SyntheticAdjudicationBundle, type SyntheticPredictionLedger } from "./prediction-adjudication.js";
import type { PredictionPlan } from "./prediction-plan.js";
import type { SyntheticPredictionRun } from "./prediction-evidence.js";

interface TrustedRecord { bytes: string; expectedSha256: string }
export interface PredictionAdjudicationEvidence { assessorIdentities: TrustedRecord; reviewedBlinding: TrustedRecord }
export interface PredictionAdjudicationGate { readonly kind: "prediction-adjudication-gate"; readonly sha256: string }
const gates = new WeakMap<PredictionAdjudicationGate, { bundleSha256: string; completeBundleSha256: string; assessors: SyntheticPredictionLedger["assessors"]; evidence: PredictionAdjudicationEvidence }>();

function authenticated(record: TrustedRecord, keys: string[], label: string) {
  // The control plane must obtain this digest from the authenticated observer or
  // independent blinding review, never copy it from the packet being checked.
  const value: unknown = JSON.parse(record.bytes);
  same(digest(value), hash(record.expectedSha256), `trusted ${label} digest mismatch`);
  return exact(value, keys, label);
}
/** No default receipt exists. Metadata hiding and a clean regular-expression
 * screen cannot satisfy this gate. Receipts are external trust inputs; this
 * verifier does not claim cryptographic proof of a provider session or truth. */
export function authenticatePredictionAdjudicationGate(plan: PredictionPlan, run: SyntheticPredictionRun, bundle: SyntheticAdjudicationBundle, evidence: PredictionAdjudicationEvidence | null): PredictionAdjudicationGate {
  if (evidence === null) throw new Error("authenticated assessor identities and reviewed free-text blinding are required");
  exact(evidence, ["assessorIdentities", "reviewedBlinding"], "adjudication prerequisites");
  verifySyntheticAdjudicationBundle(plan, run, bundle);
  const identity = authenticated(evidence.assessorIdentities, ["kind", "packetSha256", "runSha256", "observerReference", "sessions"], "assessor identity");
  same(identity.kind, "authenticated-assessor-sessions-v1", "session attestation kind mismatch");
  same(identity.packetSha256, bundle.packet.sha256, "assessor packet mismatch"); same(identity.runSha256, run.sha256, "assessor run mismatch"); text(identity.observerReference);
  const sessions = array(identity.sessions).map(value => {
    const session = exact(value, ["role", "sessionId", "model", "effort", "transcriptSha256"], "assessor session");
    const role = text(session.role);
    if (role !== "initial" && role !== "review") throw new Error("unexpected assessor role");
    same(session.model, "gpt-6-astra", "Astra assessor required"); same(session.effort, role === "initial" ? "xhigh" : "medium", "assessor effort mismatch");
    hash(session.transcriptSha256);
    return { role, sessionId: text(session.sessionId), model: "gpt-6-astra" as const, effort: role === "initial" ? "xhigh" as const : "medium" as const };
  });
  same(sessions.map(s => s.role).sort(), ["initial", "review"], "both fresh assessor roles required"); unique(sessions.map(s => s.sessionId));
  const blind = authenticated(evidence.reviewedBlinding, ["kind", "packetSha256", "runSha256", "reviewSessionId", "reviewEvidenceSha256", "findingIds", "decision"], "free-text blinding review");
  same(blind.kind, "reviewed-prediction-packet-blinding-v1", "reviewed blinding required");
  same(blind.packetSha256, bundle.packet.sha256, "blinding packet mismatch"); same(blind.runSha256, run.sha256, "blinding run mismatch");
  same(blind.decision, "no-arm-or-expected-winner-disclosure-in-reviewed-packet", "arm blinding unresolved");
  const blindReviewer = text(blind.reviewSessionId); hash(blind.reviewEvidenceSha256);
  if (sessions.some(s => s.sessionId === blindReviewer)) throw new Error("arm-aware blinding reviewer cannot assess outcomes");
  same(array(blind.findingIds).map(text).sort(), bundle.packet.findings.map(f => f.id).sort(), "every finding requires blinding review");
  const body = { kind: "prediction-adjudication-gate" as const, bundleSha256: bundle.binding.sha256,
    identitySha256: evidence.assessorIdentities.expectedSha256, blindingSha256: evidence.reviewedBlinding.expectedSha256 };
  const gate = freeze({ kind: body.kind, sha256: digest(body) });
  const assessor = (role: string) => { const { role: _, ...person } = sessions.find(s => s.role === role)!; return person; };
  gates.set(gate, { bundleSha256: bundle.binding.sha256, completeBundleSha256: digest(bundle), assessors: { initial: assessor("initial"), review: assessor("review") }, evidence: freeze(evidence) });
  return gate;
}
export function sealGuardedPredictionLedger(gate: PredictionAdjudicationGate | null, bundle: SyntheticAdjudicationBundle, inputs: PredictionJudgmentInput[], previous: SyntheticPredictionLedger | null = null, predecessors: SyntheticPredictionLedger[] = []) {
  const bound = gate && gates.get(gate);
  if (!bound || bound.bundleSha256 !== bundle.binding.sha256 || bound.completeBundleSha256 !== digest(bundle)) throw new Error("adjudication blocked: trusted identity/blinding gate absent or mismatched");
  const ledger = sealSyntheticPredictionLedger(bundle, bound.assessors, inputs, previous, predecessors);
  return freeze({ kind: "guarded-ai-prediction-ledger-v1", ledger, gateSha256: gate!.sha256, prerequisiteEvidence: bound.evidence,
    interpretation: "AI predictions with externally authenticated review receipts; no calibrated truth, efficacy or semantic independence claim" });
}
