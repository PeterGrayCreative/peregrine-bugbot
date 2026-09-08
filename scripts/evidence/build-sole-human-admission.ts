import { resolve } from "node:path";
import type { HistoricalCaseSpec } from "../../src/types.js";
import {
  historicalCaseBundleSha256,
  parseHistoricalCuration,
  readHistoricalCaseAdmission,
  requiredHistoricalConfirmationChecks,
  type HistoricalCurationV3,
} from "../../eval/historical-curation.js";
import {
  parseHistoricalCuratorPolicy,
  type SoleHumanHistoricalCuratorPolicy,
} from "../../eval/historical-curator-policy.js";
import { verifyHumanReviewResponse } from "./verify-human-review-response.js";

export type SoleHumanCaseDecisionResult =
  | {
      status: "admitted";
      dossierId: string;
      curation: HistoricalCurationV3;
      curationBytes: Buffer;
      caseBundleSha256: string;
      responseSha256: string;
    }
  | {
      status: "rejected" | "unresolved";
      dossierId: string;
      reason: string;
      correction: string | null;
      responseSha256: string;
    };

/**
 * Derive, but never write, one case decision from an authenticated sole-human
 * packet response. The caller chooses a new append-only destination and must
 * re-read that persisted case through `readHistoricalCaseAdmission`.
 */
export function buildSoleHumanAdmissionFromResponse(input: {
  caseDirectory: string;
  caseSpec: HistoricalCaseSpec;
  trustedPolicy: SoleHumanHistoricalCuratorPolicy;
  packetDirectory: string;
  responseDirectory: string;
}): SoleHumanCaseDecisionResult {
  const policy = parseHistoricalCuratorPolicy(input.trustedPolicy, "sole-human admission policy");
  if (policy.schemaVersion !== 2) throw new Error("sole-human admission requires policy schema version 2");
  const caseDirectory = resolve(input.caseDirectory);
  const draft = readHistoricalCaseAdmission(caseDirectory, input.caseSpec, policy, { requireAdmitted: false });
  if (draft.curation.schemaVersion !== 3 || draft.curation.status !== "draft" || draft.curation.humanDecision !== null) {
    throw new Error(`${input.caseSpec.id} must be an undecided sole-human v3 draft`);
  }
  const response = verifyHumanReviewResponse(
    input.packetDirectory,
    input.responseDirectory,
    policy.registeredHumanIdentitySha256,
  );
  const dossierId = draft.curation.reviewDossierId;
  const decision = response.decisions.find((item) => item.dossierId === dossierId);
  if (!decision) throw new Error(`${input.caseSpec.id} has no authenticated decision for dossier ${dossierId}`);
  if (decision.decision !== "approve") {
    return {
      status: decision.decision === "reject" ? "rejected" : "unresolved",
      dossierId,
      reason: decision.reason,
      correction: decision.correction,
      responseSha256: response.responseSha256,
    };
  }

  const admittedWithoutDecision: HistoricalCurationV3 = {
    ...draft.curation,
    status: "admitted",
    humanDecision: null,
  };
  const caseBundleSha256 = historicalCaseBundleSha256(
    caseDirectory,
    input.caseSpec,
    admittedWithoutDecision,
  );
  const candidate: HistoricalCurationV3 = {
    ...admittedWithoutDecision,
    humanDecision: {
      decision: "approve",
      humanReviewerIdentitySha256: response.humanReviewerIdentitySha256,
      reviewedAt: decision.reviewedAt,
      packetSha256: response.packetSha256,
      dossierBundleSha256: decision.dossierBundleSha256,
      responseSha256: response.responseSha256,
      responseDecisionSha256: decision.responseFileSha256,
      caseBundleSha256,
      truthScopeSha256: draft.curation.truth.scopeSha256,
      checks: [...requiredHistoricalConfirmationChecks(draft.truth.scope.status)],
    },
  };
  const parsed = parseHistoricalCuration(candidate, input.caseSpec, draft.truth, `${input.caseSpec.id} derived curation`);
  if (parsed.schemaVersion !== 3 || parsed.humanDecision?.caseBundleSha256 !== caseBundleSha256) {
    throw new Error(`${input.caseSpec.id} derived curation did not preserve its case binding`);
  }
  const curationBytes = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  return {
    status: "admitted",
    dossierId,
    curation: parsed,
    curationBytes,
    caseBundleSha256,
    responseSha256: response.responseSha256,
  };
}
