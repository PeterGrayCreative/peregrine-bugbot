import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { parseUsage } from "../src/core/telemetry.js";
import type { Usage } from "../src/types.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import type { HistoricalCuratorPolicy } from "./historical-curator-policy.js";
import {
  readMethodologyGradingProjections,
  readStoppedMethodologyGradingProjections,
  type MethodologyAttemptResource,
} from "./methodology-grading-projection.js";
import { parseMethodologySchedule } from "./methodology-schedule.js";

export const METHODOLOGY_RESOURCE_SET_FILE = "methodology-resource-set.json";

export interface MethodologyResourceSetArtifact {
  schemaVersion: 1;
  protocol: "historical-methodology-resource-set-v1";
  runId: string;
  scheduleSha256: string;
  executionEvidenceSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  resources: MethodologyAttemptResource[];
  recordedAt: string;
  artifactSha256: string;
}

/** Build from authenticated execution files, never caller-supplied counters. */
export function writeMethodologyResourceSet(root: string, input: {
  executionRoot: string;
  runId: string;
  schedule: unknown;
  expectedExecutionEvidenceSha256?: string;
  expectedStoppedRunClosureSha256?: string;
  trustedCuratorPolicy: HistoricalCuratorPolicy;
  recordedAt: string;
}): MethodologyResourceSetArtifact {
  const complete = input.expectedExecutionEvidenceSha256 !== undefined;
  if (complete === (input.expectedStoppedRunClosureSha256 !== undefined)) {
    throw new Error("methodology resource set requires exactly one execution closure digest");
  }
  const authenticated = complete
    ? readMethodologyGradingProjections({
      root: input.executionRoot,
      expectedExecutionEvidenceSha256: input.expectedExecutionEvidenceSha256!,
      trustedCuratorPolicy: input.trustedCuratorPolicy,
    })
    : readStoppedMethodologyGradingProjections({
      root: input.executionRoot,
      expectedStoppedRunClosureSha256: input.expectedStoppedRunClosureSha256!,
      trustedCuratorPolicy: input.trustedCuratorPolicy,
    });
  const artifact = buildMethodologyResourceSet({
    runId: input.runId,
    schedule: input.schedule,
    executionEvidenceSha256: authenticated.executionEvidenceSha256,
    invocationRegistrationSha256: authenticated.invocationRegistrationSha256,
    inputPlanSha256: authenticated.inputPlanSha256,
    resources: authenticated.projections.map((projection) => projection.resource),
    recordedAt: input.recordedAt,
  });
  assertNoSecrets(artifact, "methodology resource set");
  writeExclusiveJson(root, join(root, METHODOLOGY_RESOURCE_SET_FILE), artifact);
  return artifact;
}

export function readMethodologyResourceSet(root: string, input: {
  expectedArtifactSha256: string;
  schedule: unknown;
}): MethodologyResourceSetArtifact {
  const raw = readExperimentJson(join(root, METHODOLOGY_RESOURCE_SET_FILE)) as MethodologyResourceSetArtifact;
  const artifact = buildMethodologyResourceSet({
    runId: raw.runId,
    schedule: input.schedule,
    executionEvidenceSha256: raw.executionEvidenceSha256,
    invocationRegistrationSha256: raw.invocationRegistrationSha256,
    inputPlanSha256: raw.inputPlanSha256,
    resources: raw.resources,
    recordedAt: raw.recordedAt,
  });
  if (artifact.artifactSha256 !== input.expectedArtifactSha256 || canonicalJson(artifact) !== canonicalJson(raw)) {
    throw new Error("methodology resource-set artifact digest mismatch");
  }
  assertNoSecrets(artifact, "methodology resource set");
  return artifact;
}

export function buildMethodologyResourceSet(input: {
  runId: string;
  schedule: unknown;
  executionEvidenceSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  resources: readonly MethodologyAttemptResource[];
  recordedAt: string;
}): MethodologyResourceSetArtifact {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.runId)) {
    throw new Error("methodology resource-set runId is invalid");
  }
  const schedule = parseMethodologySchedule(input.schedule, "methodology resource-set schedule");
  const resources = input.resources.map((resource) => validateResource(resource));
  if (canonicalJson(resources.map((resource) => resource.attemptId)) !==
      canonicalJson(schedule.attempts.map((attempt) => attempt.id))) {
    throw new Error("methodology resource set must contain every scheduled attempt in order");
  }
  for (const [index, resource] of resources.entries()) {
    const attempt = schedule.attempts[index]!;
    if (resource.caseName !== attempt.caseName || resource.armId !== attempt.armId ||
        resource.expectedStages !== attempt.expectedStages) {
      throw new Error("methodology resource set differs from scheduled attempt identity");
    }
  }
  const recordedAt = timestamp(input.recordedAt);
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-resource-set-v1" as const,
    runId: input.runId,
    scheduleSha256: canonicalJsonSha256(schedule),
    executionEvidenceSha256: digest(input.executionEvidenceSha256),
    invocationRegistrationSha256: digest(input.invocationRegistrationSha256),
    inputPlanSha256: digest(input.inputPlanSha256),
    resources,
    recordedAt,
  };
  return { ...body, artifactSha256: canonicalJsonSha256(body) };
}

function validateResource(value: MethodologyAttemptResource): MethodologyAttemptResource {
  const duration = (candidate: number | null, name: string): number | null => {
    if (candidate !== null && (!Number.isSafeInteger(candidate) || candidate < 0)) {
      throw new Error(`methodology resource ${name} is invalid`);
    }
    return candidate;
  };
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([
        "armId", "attemptId", "caseName", "expectedStages", "lifecycleTerminalSha256", "observedStages",
        "outcome", "reviewDurationMs", "reviewTerminalSha256", "usage", "wallDurationMs",
      ]) || !/^attempt-[0-9]{6}$/.test(value.attemptId) ||
      typeof value.caseName !== "string" ||
      !["A", "B", "C", "D"].includes(value.armId) ||
      ![1, 2].includes(value.expectedStages) ||
      !Number.isSafeInteger(value.observedStages) || value.observedStages < 0 ||
      value.observedStages > value.expectedStages ||
      !["completed", "review-failed", "preflight-failed", "interrupted", "missing"].includes(value.outcome)) {
    throw new Error("methodology resource entry is invalid");
  }
  if (value.outcome === "missing" &&
      (value.wallDurationMs !== null || value.reviewDurationMs !== null || value.usage !== null)) {
    throw new Error("missing methodology resource cannot claim observed work");
  }
  for (const binding of [value.lifecycleTerminalSha256, value.reviewTerminalSha256]) {
    if (binding !== null && !/^[a-f0-9]{64}$/.test(binding)) {
      throw new Error("methodology resource terminal digest is invalid");
    }
  }
  if ((value.outcome === "completed" || value.outcome === "review-failed") !==
      (value.reviewTerminalSha256 !== null)) {
    throw new Error("methodology resource review terminal does not match outcome");
  }
  if ((value.outcome === "missing") !== (value.lifecycleTerminalSha256 === null)) {
    throw new Error("methodology resource lifecycle terminal does not match outcome");
  }
  if (value.outcome === "completed" &&
      (value.observedStages !== value.expectedStages || value.reviewDurationMs === null || value.usage === null)) {
    throw new Error("completed methodology resource lacks complete observed work");
  }
  if (value.outcome === "review-failed" && value.reviewDurationMs === null) {
    throw new Error("failed methodology review lacks observed runner duration");
  }
  return {
    ...value,
    wallDurationMs: duration(value.wallDurationMs, "wallDurationMs"),
    reviewDurationMs: duration(value.reviewDurationMs, "reviewDurationMs"),
    usage: value.usage === null ? null : parseUsage(value.usage as Usage, "methodology resource usage"),
  };
}

function digest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("methodology resource set requires sha256 bindings");
  return value;
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("methodology resource-set recordedAt must be a canonical timestamp");
  }
  return value;
}
