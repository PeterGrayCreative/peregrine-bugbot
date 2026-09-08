import { fileURLToPath } from "node:url";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { sha256 } from "../src/core/telemetry.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import type { HistoricalCuratorPolicy } from "./historical-curator-policy.js";
import {
  readMethodologyAdjudicationArtifact,
  readMethodologyGradeSet,
  readMethodologyReportArtifact,
} from "./methodology-analysis-artifacts.js";
import {
  readMethodologyAnalysisBinding,
  verifyMethodologyAnalysisSource,
} from "./methodology-analysis-binding.js";
import {
  readMethodologyGradingProjections,
} from "./methodology-grading-projection.js";
import {
  readMethodologyInvocationRegistration,
} from "./methodology-invocations.js";
import {
  readMethodologyJudgeBinding,
  verifyMethodologyJudgeSource,
  type MethodologyJudgeBindingReadInputs,
} from "./methodology-judge-binding.js";
import {
  gradeMethodologySealedJudge,
} from "./methodology-judge-grading.js";
import {
  assertLegacyMethodologyGradeSetMatchesSealed,
  readMethodologySealedJudgeGradeSet,
} from "./methodology-sealed-grade-artifact.js";
import { readMethodologyResourceSet } from "./methodology-resource-artifact.js";
import { readMethodologyResourceReport } from "./methodology-resource-report.js";

export const METHODOLOGY_SEALED_ANALYSIS_BINDING_FILE =
  "methodology-sealed-analysis-binding.json";
export const METHODOLOGY_SEALED_ANALYSIS_BINDING_PROTOCOL =
  "historical-methodology-sealed-analysis-binding-v1" as const;

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * This closure contains this derived join and each directly invoked local
 * implementation not already represented solely as data. The base-analysis
 * and semantic-judge bindings independently verify their larger closures.
 */
export const METHODOLOGY_SEALED_ANALYSIS_SOURCE_PATHS = [
  "eval/experiment.ts",
  "eval/methodology-analysis-artifacts.ts",
  "eval/methodology-analysis-binding.ts",
  "eval/methodology-grading-projection.ts",
  "eval/methodology-invocations.ts",
  "eval/methodology-judge-binding.ts",
  "eval/methodology-judge-grading.ts",
  "eval/methodology-sealed-analysis-binding.ts",
  "eval/methodology-sealed-grade-artifact.ts",
  "eval/methodology-resource-artifact.ts",
  "eval/methodology-resource-report.ts",
  "src/core/telemetry.ts",
  "src/security/secrets.ts",
] as const;

type SourceEntry = { path: string; bytes: number; sha256: string };

export interface MethodologySealedAnalysisBinding {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_SEALED_ANALYSIS_BINDING_PROTOCOL;
  runId: string;
  baseAnalysisBindingSha256: string;
  judgeBindingSha256: string;
  sealedGradeSetArtifactSha256: string;
  legacyGradeSetArtifactSha256: string;
  scheduleSha256: string;
  executionEvidenceSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  projectionSetSha256: string;
  occurrenceArtifactSha256: string;
  judgeManifestSha256: string;
  judgeTerminalSealSha256: string;
  judgeImplementationSha256: string;
  judgeConfigSha256: string;
  analysisSource: SourceEntry[];
  analysisSourceTreeSha256: string;
  boundAt: string;
  claims: {
    sourceClosure: "fixed-explicit-source-list";
    providerIdentity: "not-established";
    semanticCorrectness: "not-established";
    humanCalibration: "required";
    efficacy: "not-decided";
  };
  bindingSha256: string;
}

type CanonicalJudgeInputs = Omit<MethodologyJudgeBindingReadInputs,
  "runDirectory" | "repositoryRoot" | "expectedBindingSha256">;

export interface MethodologySealedAnalysisBindingWriteInputs extends CanonicalJudgeInputs {
  executionRoot: string;
  judgeRunDirectory: string;
  repositoryRoot: string;
  trustedCuratorPolicy: HistoricalCuratorPolicy;
  expectedExecutionEvidenceSha256: string;
  expectedBaseAnalysisBindingSha256: string;
  expectedJudgeBindingSha256: string;
  expectedSealedGradeSetArtifactSha256: string;
  boundAt: string;
}

export interface MethodologySealedAnalysisBindingReadInputs extends CanonicalJudgeInputs {
  executionRoot: string;
  judgeRunDirectory: string;
  repositoryRoot: string;
  trustedCuratorPolicy: HistoricalCuratorPolicy;
  expectedExecutionEvidenceSha256: string;
  expectedBaseAnalysisBindingSha256: string;
  expectedJudgeBindingSha256: string;
  expectedSealedGradeSetArtifactSha256: string;
  expectedBindingSha256: string;
}

/**
 * Bind the existing descriptive v1 analysis to grades independently rederived
 * from one completed, caller-anchored semantic-judge ledger.
 */
export function writeMethodologySealedAnalysisBinding(
  analysisRoot: string,
  input: MethodologySealedAnalysisBindingWriteInputs,
): MethodologySealedAnalysisBinding {
  const dependencies = authenticateDependencies(analysisRoot, input);
  const analysisSource = sourceManifest(input.repositoryRoot);
  const body = bindingBody(input, dependencies, analysisSource);
  const binding: MethodologySealedAnalysisBinding = {
    ...body,
    bindingSha256: canonicalJsonSha256(body),
  };
  validateBinding(binding);
  assertNoSecrets(binding, "methodology sealed analysis binding");
  writeExclusiveJson(
    analysisRoot,
    join(resolve(analysisRoot), METHODOLOGY_SEALED_ANALYSIS_BINDING_FILE),
    binding,
  );
  return binding;
}

/**
 * Accept the derived binding only when every caller-held digest, underlying
 * artifact, sealed grade derivation, and current source closure still agrees.
 */
export function readMethodologySealedAnalysisBinding(
  analysisRoot: string,
  input: MethodologySealedAnalysisBindingReadInputs,
): MethodologySealedAnalysisBinding {
  digest(input.expectedBindingSha256, "expectedBindingSha256");
  const raw = readExperimentJson(
    join(resolve(analysisRoot), METHODOLOGY_SEALED_ANALYSIS_BINDING_FILE),
  );
  const binding = parseBinding(raw);
  const { bindingSha256, ...body } = binding;
  if (bindingSha256 !== input.expectedBindingSha256 ||
      bindingSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology sealed analysis binding digest mismatch");
  }

  const dependencies = authenticateDependencies(analysisRoot, input);
  const analysisSource = sourceManifest(input.repositoryRoot);
  const expectedBody = bindingBody(input, dependencies, analysisSource, binding.boundAt);
  if (canonicalJson(expectedBody) !== canonicalJson(body)) {
    throw new Error("methodology sealed analysis binding does not match caller-held artifacts");
  }
  verifyMethodologySealedAnalysisSource(binding, input.repositoryRoot);
  assertNoSecrets(binding, "methodology sealed analysis binding");
  return binding;
}

/** Verify the binding module's explicit source closure against current files. */
export function verifyMethodologySealedAnalysisSource(
  binding: MethodologySealedAnalysisBinding,
  repositoryRoot: string,
): void {
  const current = sourceManifest(repositoryRoot);
  if (canonicalJson(current) !== canonicalJson(binding.analysisSource) ||
      canonicalJsonSha256(current) !== binding.analysisSourceTreeSha256) {
    throw new Error("methodology sealed analysis source differs from bound runtime source");
  }
}

function authenticateDependencies(
  analysisRoot: string,
  input: Omit<MethodologySealedAnalysisBindingReadInputs, "expectedBindingSha256"> |
    MethodologySealedAnalysisBindingWriteInputs,
) {
  digest(input.expectedExecutionEvidenceSha256, "expectedExecutionEvidenceSha256");
  digest(input.expectedBaseAnalysisBindingSha256, "expectedBaseAnalysisBindingSha256");
  digest(input.expectedJudgeBindingSha256, "expectedJudgeBindingSha256");
  digest(input.expectedSealedGradeSetArtifactSha256, "expectedSealedGradeSetArtifactSha256");

  const projections = readMethodologyGradingProjections({
    root: input.executionRoot,
    expectedExecutionEvidenceSha256: input.expectedExecutionEvidenceSha256,
    trustedCuratorPolicy: input.trustedCuratorPolicy,
  });
  if (canonicalJson(projections) !== canonicalJson(input.projections)) {
    throw new Error("methodology sealed analysis received stale or cross-run projections");
  }

  const base = readMethodologyAnalysisBinding(
    analysisRoot,
    input.expectedBaseAnalysisBindingSha256,
  );
  verifyMethodologyAnalysisSource(base, input.repositoryRoot);

  const judgeReadInputs: MethodologyJudgeBindingReadInputs = {
    runDirectory: input.judgeRunDirectory,
    repositoryRoot: input.repositoryRoot,
    runId: input.runId,
    projections,
    providerAccess: input.providerAccess,
    limits: input.limits,
    judgeImplementationSha256: input.judgeImplementationSha256,
    expectedOccurrenceArtifactSha256: input.expectedOccurrenceArtifactSha256,
    expectedJudgeManifestSha256: input.expectedJudgeManifestSha256,
    expectedJudgeTerminalSealSha256: input.expectedJudgeTerminalSealSha256,
    expectedProjectionSetSha256: input.expectedProjectionSetSha256,
    expectedBindingSha256: input.expectedJudgeBindingSha256,
  };
  const judge = readMethodologyJudgeBinding(analysisRoot, judgeReadInputs);
  verifyMethodologyJudgeSource(judge, input.repositoryRoot);

  const sealed = readMethodologySealedJudgeGradeSet(
    analysisRoot,
    input.expectedSealedGradeSetArtifactSha256,
  );
  const rederived = gradeMethodologySealedJudge({
    runDirectory: input.judgeRunDirectory,
    runId: input.runId,
    projections,
    providerAccess: input.providerAccess,
    limits: input.limits,
    judgeImplementationSha256: input.judgeImplementationSha256,
    expectedOccurrenceArtifactSha256: input.expectedOccurrenceArtifactSha256,
    expectedJudgeManifestSha256: input.expectedJudgeManifestSha256,
    expectedJudgeTerminalSealSha256: input.expectedJudgeTerminalSealSha256,
    expectedProjectionSetSha256: input.expectedProjectionSetSha256,
  });
  if (canonicalJson(sealed) !== canonicalJson(rederived)) {
    throw new Error("stored sealed methodology grades differ from independent rederivation");
  }

  const legacy = readMethodologyGradeSet(analysisRoot, base.gradeSetArtifactSha256);
  assertLegacyMethodologyGradeSetMatchesSealed(legacy, sealed);
  const registration = readMethodologyInvocationRegistration(
    input.executionRoot,
    projections.invocationRegistrationSha256,
  );
  const adjudication = readMethodologyAdjudicationArtifact(analysisRoot, {
    expectedLedgerSha256: base.adjudicationLedgerSha256,
    gradeSet: legacy,
  });
  const report = readMethodologyReportArtifact(analysisRoot, {
    expectedReportSha256: base.reportSha256,
    gradeSet: legacy,
    adjudication,
  });
  const resources = readMethodologyResourceSet(analysisRoot, {
    expectedArtifactSha256: base.resourceSetArtifactSha256,
    schedule: registration.schedule,
  });
  const resourceReport = readMethodologyResourceReport(analysisRoot, {
    expectedReportSha256: base.resourceReportSha256,
    schedule: registration.schedule,
    resources,
  });

  if (input.runId !== projections.runId || input.runId !== registration.runId ||
      base.runId !== input.runId || judge.runId !== input.runId || sealed.runId !== input.runId ||
      legacy.runId !== input.runId ||
      base.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      projections.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      judge.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      sealed.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      legacy.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      base.invocationRegistrationSha256 !== projections.invocationRegistrationSha256 ||
      judge.invocationRegistrationSha256 !== projections.invocationRegistrationSha256 ||
      sealed.invocationRegistrationSha256 !== projections.invocationRegistrationSha256 ||
      base.inputPlanSha256 !== projections.inputPlanSha256 ||
      judge.inputPlanSha256 !== projections.inputPlanSha256 ||
      sealed.inputPlanSha256 !== projections.inputPlanSha256 ||
      legacy.inputPlanSha256 !== projections.inputPlanSha256 ||
      base.scheduleSha256 !== canonicalJsonSha256(registration.schedule) ||
      canonicalJson(legacy.schedule) !== canonicalJson(registration.schedule) ||
      judge.projectionSetSha256 !== sealed.projectionSetSha256 ||
      judge.projectionSetSha256 !== input.expectedProjectionSetSha256 ||
      judge.occurrenceArtifactSha256 !== sealed.occurrenceArtifactSha256 ||
      judge.occurrenceArtifactSha256 !== input.expectedOccurrenceArtifactSha256 ||
      judge.judgeManifestSha256 !== sealed.judgeManifestSha256 ||
      judge.judgeManifestSha256 !== input.expectedJudgeManifestSha256 ||
      judge.judgeTerminalSealSha256 !== sealed.judgeTerminalSealSha256 ||
      judge.judgeTerminalSealSha256 !== input.expectedJudgeTerminalSealSha256 ||
      judge.judgeImplementationSha256 !== input.judgeImplementationSha256) {
    throw new Error("methodology sealed analysis dependencies are inconsistent");
  }

  if (adjudication.runId !== input.runId ||
      adjudication.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      adjudication.inputPlanSha256 !== projections.inputPlanSha256 ||
      adjudication.gradeSetSha256 !== legacy.gradeSetSha256 ||
      report.runId !== input.runId ||
      report.scheduleSha256 !== canonicalJsonSha256(registration.schedule) ||
      report.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      report.inputPlanSha256 !== projections.inputPlanSha256 ||
      report.adjudicationLedgerSha256 !== adjudication.ledgerSha256 ||
      resources.runId !== input.runId ||
      resources.scheduleSha256 !== canonicalJsonSha256(registration.schedule) ||
      resources.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      resources.invocationRegistrationSha256 !== projections.invocationRegistrationSha256 ||
      resources.inputPlanSha256 !== projections.inputPlanSha256 ||
      resourceReport.runId !== input.runId ||
      resourceReport.scheduleSha256 !== canonicalJsonSha256(registration.schedule) ||
      resourceReport.executionEvidenceSha256 !== input.expectedExecutionEvidenceSha256 ||
      resourceReport.inputPlanSha256 !== projections.inputPlanSha256 ||
      resourceReport.resourceSetSha256 !== resources.artifactSha256) {
    throw new Error("methodology sealed analysis downstream artifacts are inconsistent");
  }

  return {
    base,
    judge,
    sealed,
    legacy,
    registration,
    adjudication,
    report,
    resources,
    resourceReport,
  };
}

function bindingBody(
  input: Omit<MethodologySealedAnalysisBindingReadInputs, "expectedBindingSha256"> |
    MethodologySealedAnalysisBindingWriteInputs,
  dependencies: ReturnType<typeof authenticateDependencies>,
  analysisSource: SourceEntry[],
  storedBoundAt?: string,
) {
  const { base, judge, sealed, legacy, registration } = dependencies;
  return {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_SEALED_ANALYSIS_BINDING_PROTOCOL,
    runId: input.runId,
    baseAnalysisBindingSha256: base.bindingSha256,
    judgeBindingSha256: judge.bindingSha256,
    sealedGradeSetArtifactSha256: sealed.artifactSha256,
    legacyGradeSetArtifactSha256: legacy.artifactSha256,
    scheduleSha256: canonicalJsonSha256(registration.schedule),
    executionEvidenceSha256: input.expectedExecutionEvidenceSha256,
    invocationRegistrationSha256: sealed.invocationRegistrationSha256,
    inputPlanSha256: sealed.inputPlanSha256,
    projectionSetSha256: sealed.projectionSetSha256,
    occurrenceArtifactSha256: sealed.occurrenceArtifactSha256,
    judgeManifestSha256: sealed.judgeManifestSha256,
    judgeTerminalSealSha256: sealed.judgeTerminalSealSha256,
    judgeImplementationSha256: judge.judgeImplementationSha256,
    judgeConfigSha256: sealed.judgeConfigSha256,
    analysisSource,
    analysisSourceTreeSha256: canonicalJsonSha256(analysisSource),
    boundAt: timestamp(storedBoundAt ?? ("boundAt" in input ? input.boundAt : undefined)),
    claims: {
      sourceClosure: "fixed-explicit-source-list" as const,
      providerIdentity: "not-established" as const,
      semanticCorrectness: "not-established" as const,
      humanCalibration: "required" as const,
      efficacy: "not-decided" as const,
    },
  };
}

function sourceManifest(repositoryRoot: string): SourceEntry[] {
  const root = checkedRepositoryRoot(repositoryRoot);
  const loaded = realpathSync(fileURLToPath(import.meta.url));
  const expectedLoaded = realpathSync(join(root, "eval/methodology-sealed-analysis-binding.ts"));
  if (loaded !== expectedLoaded || relative(root, loaded).startsWith("..")) {
    throw new Error("methodology sealed analysis binding module is not loaded from repositoryRoot");
  }
  return METHODOLOGY_SEALED_ANALYSIS_SOURCE_PATHS.map((path) => {
    if (isAbsolute(path) || path.split("/").some((part) =>
      part === "" || part === "." || part === "..")) {
      throw new Error(`methodology sealed analysis source path is unsafe: ${path}`);
    }
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
      throw new Error(`methodology sealed analysis source must be a bounded regular file: ${path}`);
    }
    const bytes = readFileSync(absolute);
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
  });
}

function checkedRepositoryRoot(repositoryRoot: string): string {
  const absolute = resolve(repositoryRoot);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("methodology sealed analysis repositoryRoot must be a real non-symlink directory");
  }
  return realpathSync(absolute);
}

function parseBinding(value: unknown): MethodologySealedAnalysisBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("methodology sealed analysis binding must be an object");
  }
  const binding = value as MethodologySealedAnalysisBinding;
  validateBinding(binding);
  return binding;
}

function validateBinding(value: MethodologySealedAnalysisBinding): void {
  const keys = [
    "analysisSource", "analysisSourceTreeSha256", "baseAnalysisBindingSha256", "bindingSha256",
    "boundAt", "claims", "executionEvidenceSha256", "inputPlanSha256",
    "invocationRegistrationSha256", "judgeBindingSha256", "judgeConfigSha256",
    "judgeImplementationSha256", "judgeManifestSha256", "judgeTerminalSealSha256",
    "legacyGradeSetArtifactSha256", "occurrenceArtifactSha256", "projectionSetSha256",
    "protocol", "runId", "scheduleSha256", "schemaVersion", "sealedGradeSetArtifactSha256",
  ].sort();
  if (canonicalJson(Object.keys(value as object).sort()) !== canonicalJson(keys) ||
      value.schemaVersion !== 1 ||
      value.protocol !== METHODOLOGY_SEALED_ANALYSIS_BINDING_PROTOCOL ||
      typeof value.runId !== "string" || !RUN_ID.test(value.runId) ||
      canonicalJson(value.claims) !== canonicalJson({
        sourceClosure: "fixed-explicit-source-list",
        providerIdentity: "not-established",
        semanticCorrectness: "not-established",
        humanCalibration: "required",
        efficacy: "not-decided",
      })) {
    throw new Error("methodology sealed analysis binding structure is invalid");
  }
  for (const field of [
    "baseAnalysisBindingSha256", "judgeBindingSha256", "sealedGradeSetArtifactSha256",
    "legacyGradeSetArtifactSha256", "scheduleSha256", "executionEvidenceSha256",
    "invocationRegistrationSha256", "inputPlanSha256", "projectionSetSha256",
    "occurrenceArtifactSha256", "judgeManifestSha256", "judgeTerminalSealSha256",
    "judgeImplementationSha256", "judgeConfigSha256", "analysisSourceTreeSha256",
    "bindingSha256",
  ] as const) digest(value[field], `methodology sealed analysis binding ${field}`);
  timestamp(value.boundAt);
  if (!Array.isArray(value.analysisSource) ||
      value.analysisSource.length !== METHODOLOGY_SEALED_ANALYSIS_SOURCE_PATHS.length ||
      canonicalJson(value.analysisSource.map((entry) => entry.path)) !==
        canonicalJson(METHODOLOGY_SEALED_ANALYSIS_SOURCE_PATHS)) {
    throw new Error("methodology sealed analysis source manifest paths are invalid");
  }
  for (const entry of value.analysisSource) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        canonicalJson(Object.keys(entry).sort()) !== canonicalJson(["bytes", "path", "sha256"]) ||
        typeof entry.path !== "string" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        !SHA256.test(entry.sha256)) {
      throw new Error("methodology sealed analysis source manifest entry is invalid");
    }
  }
  if (value.analysisSourceTreeSha256 !== canonicalJsonSha256(value.analysisSource)) {
    throw new Error("methodology sealed analysis source tree digest mismatch");
  }
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    throw new Error("methodology sealed analysis binding boundAt must be a canonical timestamp");
  }
  return value;
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}
