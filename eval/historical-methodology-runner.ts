import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PeregrineConfig, ProviderExec, ReviewContext } from "../src/types.js";
import { leakagePolicyForCase } from "./case-isolation.js";
import type { CuratorPolicy } from "./case-curation.js";
import {
  materializeHistoricalMethodologyCase,
  type MaterializedHistoricalMethodologyCase,
} from "./historical-methodology-case.js";
import {
  runMethodologyAttemptLifecycle,
  type MethodologyAttemptLifecycleReceipt,
} from "./methodology-attempt-lifecycle.js";
import {
  readMethodologyInputPlan,
  verifyMethodologyInputPlanPreparation,
  verifyMethodologyPlannedInvocation,
} from "./methodology-input-plan.js";
import { createMethodologyInvocationRecorder, readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import { prepareMethodologyLaneActivation } from "./methodology-lane-activation.js";
import { loadCaseSpec } from "./run-matrix.js";

export interface HistoricalMethodologyProviderAttachmentRequest {
  attemptId: string;
  armId: "A" | "B" | "C" | "D";
  repoPath: string;
  providerHome: string;
  providerAssetsRoot: string;
  providerOutputRoot: string;
}

export interface HistoricalMethodologyProviderAttachment {
  runProvider: ProviderExec;
  readProviderOutput(path: string): string;
}

export interface RegisteredHistoricalMethodologyAttemptInput {
  evidenceRoot: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  attemptId: string;
  trustedCuratorPolicy: CuratorPolicy;
  config: PeregrineConfig;
  /** Trusted runtime adapter only; this module never chooses or launches a provider. */
  attachProvider(
    request: HistoricalMethodologyProviderAttachmentRequest,
  ): HistoricalMethodologyProviderAttachment | Promise<HistoricalMethodologyProviderAttachment>;
  now?: () => number;
}

/**
 * Execute one plan-bound historical methodology attempt through the existing
 * materializer, prompt verifier, invocation recorder, and lifecycle wrapper.
 * The plan and curator evidence remain host-side and are never mounted into the
 * provider-visible repository, home, assets, or output roots.
 */
export async function runRegisteredHistoricalMethodologyAttempt(
  input: RegisteredHistoricalMethodologyAttemptInput,
): Promise<MethodologyAttemptLifecycleReceipt> {
  // Required before the lifecycle start artifact: no attempt may begin from an
  // unreadable, stale, cross-registration, or locally rewritten input plan.
  const plan = readMethodologyInputPlan(
    input.evidenceRoot,
    input.invocationRegistrationSha256,
    input.inputPlanSha256,
  );
  const invocationRegistration = readMethodologyInvocationRegistration(
    input.evidenceRoot,
    input.invocationRegistrationSha256,
  );
  const attempt = invocationRegistration.schedule.attempts.find((candidate) => candidate.id === input.attemptId);
  if (!attempt) throw new Error("registered historical methodology attempt is not scheduled");
  const plannedCase = plan.cases.find((candidate) => candidate.caseName === attempt.caseName);
  if (!plannedCase) throw new Error("registered historical methodology attempt lacks a planned case");
  if (typeof input.attachProvider !== "function") {
    throw new Error("registered historical methodology attempt requires a trusted provider attachment");
  }
  const recordInvocation = createMethodologyInvocationRecorder(
    input.evidenceRoot,
    input.invocationRegistrationSha256,
  );
  const holder: { materialized: MaterializedHistoricalMethodologyCase | null } = { materialized: null };
  try {
    return await runMethodologyAttemptLifecycle({
      evidenceRoot: input.evidenceRoot,
      registrationSha256: input.invocationRegistrationSha256,
      attemptId: input.attemptId,
      beforeInvocation: (invocation) => {
        verifyMethodologyPlannedInvocation({
          root: input.evidenceRoot,
          invocationRegistrationSha256: input.invocationRegistrationSha256,
          inputPlanSha256: input.inputPlanSha256,
          invocation,
        });
        return recordInvocation(invocation);
      },
      prepare: async () => {
        const leakagePolicy = leakagePolicyForMaterialized(
          plannedCase.historicalRegistration.caseDirectory,
        );
        const materialized = await materializeHistoricalMethodologyCase(
          plannedCase.historicalRegistration,
          invocationRegistration.schedule,
          attempt.armId,
          input.trustedCuratorPolicy,
        );
        holder.materialized = materialized;
        const baseContext = reviewContext(materialized, input.config);
        const laneActivation = attempt.armId === "B" || attempt.armId === "D"
          ? await prepareMethodologyLaneActivation({
            armId: attempt.armId,
            context: baseContext,
            rawScope: materialized.rawScope,
          })
          : plannedCase.laneActivation;
        verifyMethodologyInputPlanPreparation({
          root: input.evidenceRoot,
          invocationRegistrationSha256: input.invocationRegistrationSha256,
          inputPlanSha256: input.inputPlanSha256,
          historicalRegistration: materialized.registration,
          admissionBinding: materialized.admissionBinding,
          rawScope: materialized.rawScope,
          laneActivation,
        });
        assertEvidenceOutsideProviderRoots(
          input.evidenceRoot,
          plannedCase.historicalRegistration.caseDirectory,
          materialized,
        );
        const isolation = materialized.materialized.evaluationIsolation;
        if (!isolation.providerOutputRoot) {
          throw new Error("historical methodology materialization lacks a provider output root");
        }
        const attachment = await input.attachProvider({
          attemptId: input.attemptId,
          armId: attempt.armId,
          repoPath: materialized.materialized.repoPath,
          providerHome: isolation.providerHome,
          providerAssetsRoot: isolation.providerAssetsRoot,
          providerOutputRoot: isolation.providerOutputRoot,
        });
        assertProviderAttachment(attachment);
        return {
          assetManifest: materialized.assetsManifest,
          rawScope: materialized.rawScope,
          ...(attempt.armId === "B" || attempt.armId === "D"
            ? { activatedLanes: laneActivation.activatedLanes }
            : {}),
          leakagePolicy,
          context: {
            ...baseContext,
            evaluationIsolation: {
              ...isolation,
              runProvider: attachment.runProvider,
              readProviderOutput: attachment.readProviderOutput,
            },
          },
        };
      },
      ...(input.now ? { now: input.now } : {}),
    });
  } finally {
    holder.materialized?.cleanup();
  }
}

function reviewContext(
  prepared: MaterializedHistoricalMethodologyCase,
  config: PeregrineConfig,
): ReviewContext {
  const materialized = prepared.materialized;
  return {
    repoPath: materialized.repoPath,
    diffPath: materialized.diffPath,
    diffText: materialized.diffText,
    baseRef: materialized.baseRef,
    headRef: materialized.headRef,
    config,
    evaluationIsolation: materialized.evaluationIsolation,
  };
}

function leakagePolicyForMaterialized(caseDirectory: string) {
  // The case reader already authenticated the exact spec; this independent
  // parser supplies the runner-only leakage guard and is never model-visible.
  return leakagePolicyForCase(caseDirectory, loadCaseSpec(caseDirectory));
}

function assertProviderAttachment(value: unknown): asserts value is HistoricalMethodologyProviderAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort(compareText).join("\0") !== ["readProviderOutput", "runProvider"].sort(compareText).join("\0") ||
      typeof (value as HistoricalMethodologyProviderAttachment).runProvider !== "function" ||
      typeof (value as HistoricalMethodologyProviderAttachment).readProviderOutput !== "function") {
    throw new Error("trusted methodology provider attachment is invalid");
  }
}

function assertEvidenceOutsideProviderRoots(
  evidenceRoot: string,
  caseDirectory: string,
  prepared: MaterializedHistoricalMethodologyCase,
): void {
  const isolation = prepared.materialized.evaluationIsolation;
  const sensitive = [realpathSync(resolve(evidenceRoot)), realpathSync(resolve(caseDirectory))];
  const visible = [
    prepared.materialized.repoPath,
    isolation.providerHome,
    isolation.providerAssetsRoot,
    isolation.providerOutputRoot,
  ].filter((value): value is string => typeof value === "string").map((value) => realpathSync(resolve(value)));
  if (sensitive.some((left) => visible.some((right) => overlaps(left, right)))) {
    throw new Error("truth or input-plan evidence overlaps a provider-visible root");
  }
}

function overlaps(left: string, right: string): boolean {
  return left === right || inside(left, right) || inside(right, left);
}

function inside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
