import type { CuratorPolicy } from "./case-curation.js";
import { sha256 } from "../src/core/telemetry.js";
import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import {
  readAuthenticatedHistoricalMethodologyCase,
  type HistoricalMethodologyCaseRegistration,
} from "./historical-methodology-case.js";
import { readMethodologyAttemptLifecycleTerminal } from "./methodology-attempt-lifecycle.js";
import { readMethodologyExecutionEvidence } from "./methodology-execution-evidence.js";
import {
  methodologyGradingProjectionSha256,
  methodologyReviewOutputSha256,
  type MethodologyGradingProjection,
} from "./methodology-grading-contract.js";
import type { HistoricalGroundTruth } from "./historical-truth.js";
import { readMethodologyInputPlan } from "./methodology-input-plan.js";
import { readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import type { MethodologyReviewOutput } from "./methodology-output.js";
import { readMethodologyAttemptTerminal } from "./methodology-terminal.js";

export const METHODOLOGY_GRADING_PROJECTION_READER_BOUNDARY =
  "This reader authenticates a lifecycle-terminal schedule and its currently admitted case snapshots. Runner scope remains unverified, so model-completed reviews are projected as incomplete. Missing or stopped schedules require a separate outer closure seal and are never inferred from absent files.";

export interface AuthenticatedMethodologyGradingProjection {
  projection: MethodologyGradingProjection;
  projectionSha256: string;
  truth: HistoricalGroundTruth;
  reviewOutput: MethodologyReviewOutput | null;
  reviewRawOutput: string | null;
}

export interface AuthenticatedMethodologyGradingProjectionSet {
  executionEvidenceSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  projections: AuthenticatedMethodologyGradingProjection[];
}

/**
 * Project every scheduled attempt from a caller-authenticated complete
 * lifecycle composite. The all-at-once API prevents successful-attempt
 * selection and preserves failure-inclusive schedule accounting.
 */
export function readMethodologyGradingProjections(input: {
  root: string;
  expectedExecutionEvidenceSha256: string;
  trustedCuratorPolicy: CuratorPolicy;
}): AuthenticatedMethodologyGradingProjectionSet {
  const execution = readMethodologyExecutionEvidence(input.root, input.expectedExecutionEvidenceSha256);
  const registration = readMethodologyInvocationRegistration(
    input.root,
    execution.invocationRegistrationSha256,
  );
  const plan = readMethodologyInputPlan(
    input.root,
    execution.invocationRegistrationSha256,
    execution.inputPlanSha256,
  );
  const receipts = new Map(execution.lifecycleReceipts.map((receipt) => [receipt.attemptId, receipt]));
  const cases = new Map<string, {
    registration: HistoricalMethodologyCaseRegistration;
    truth: HistoricalGroundTruth;
  }>();

  for (const planned of plan.cases) {
    const authenticated = readAuthenticatedHistoricalMethodologyCase(
      planned.historicalRegistration.caseDirectory,
      input.trustedCuratorPolicy,
    );
    if (canonicalJson(authenticated.registration) !== canonicalJson(planned.historicalRegistration)) {
      throw new Error("methodology grading case registration changed after input-plan authentication");
    }
    cases.set(planned.caseName, authenticated);
  }

  const projections = registration.schedule.attempts.map((attempt): AuthenticatedMethodologyGradingProjection => {
    const receipt = receipts.get(attempt.id);
    if (!receipt) throw new Error("methodology grading projection is missing a scheduled lifecycle receipt");
    const lifecycle = readMethodologyAttemptLifecycleTerminal(
      input.root,
      execution.invocationRegistrationSha256,
      attempt.id,
      receipt.lifecycleTerminalSha256,
    );
    const historicalCase = cases.get(attempt.caseName);
    if (!historicalCase) throw new Error("methodology grading projection lacks an authenticated scheduled case");

    let status: MethodologyGradingProjection["status"] = "failed";
    let statusReason: MethodologyGradingProjection["statusReason"];
    let reviewOutput: MethodologyReviewOutput | null = null;
    let reviewRawOutput: string | null = null;
    if (lifecycle.status === "preflight-failed") {
      statusReason = "preflight-failed";
    } else if (lifecycle.status === "interrupted") {
      statusReason = "interrupted";
    } else {
      const terminal = readMethodologyAttemptTerminal(
        input.root,
        execution.invocationRegistrationSha256,
        attempt.id,
        lifecycle.reviewTerminalSha256!,
      );
      if (terminal.outcome.status === "failed") {
        statusReason = "review-execution-failed";
      } else {
        // The current terminal contract authenticates the model output but
        // explicitly refuses to authenticate runner availability/scope.
        status = "incomplete";
        reviewOutput = terminal.outcome.review;
        statusReason = reviewOutput.status === "unable-to-complete"
          ? "model-unable-to-complete"
          : "runner-scope-unverified";
        reviewRawOutput = terminal.stages.at(-1)!.rawOutput!;
      }
    }

    const projection: MethodologyGradingProjection = {
      schemaVersion: 2,
      kind: "methodology-grading-projection",
      executionEvidenceSha256: execution.recordSha256,
      inputPlanSha256: execution.inputPlanSha256,
      caseRegistrationSha256: historicalCase.registration.registrationSha256,
      truthSha256: canonicalJsonSha256(historicalCase.truth),
      truthScopeSha256: historicalCase.registration.truth.scopeSha256,
      attemptId: attempt.id,
      caseName: attempt.caseName,
      status,
      statusReason,
      lifecycleTerminalSha256: receipt.lifecycleTerminalSha256,
      reviewTerminalSha256: lifecycle.reviewTerminalSha256,
      reviewRawOutputSha256: reviewRawOutput === null ? null : terminalRawOutputSha256(reviewRawOutput),
      reviewOutputSha256: reviewOutput === null ? null : methodologyReviewOutputSha256(reviewOutput),
    };
    return {
      projection,
      projectionSha256: methodologyGradingProjectionSha256(projection),
      truth: historicalCase.truth,
      reviewOutput,
      reviewRawOutput,
    };
  });

  if (projections.length !== execution.accounting.scheduled) {
    throw new Error("methodology grading projection count differs from authenticated schedule accounting");
  }
  return {
    executionEvidenceSha256: execution.recordSha256,
    invocationRegistrationSha256: execution.invocationRegistrationSha256,
    inputPlanSha256: execution.inputPlanSha256,
    projections,
  };
}

function terminalRawOutputSha256(value: string): string {
  return sha256(value);
}
