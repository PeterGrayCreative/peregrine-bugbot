import { fileURLToPath } from "node:url";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { sha256 } from "../src/core/telemetry.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import type { HistoricalCuratorPolicy } from "./historical-curator-policy.js";
import {
  readMethodologyAdjudicationArtifact,
  readMethodologyGradeSet,
  readMethodologyReportArtifact,
} from "./methodology-analysis-artifacts.js";
import {
  readMethodologyGradingProjections,
  readStoppedMethodologyGradingProjections,
} from "./methodology-grading-projection.js";
import { readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import { readMethodologyResourceSet } from "./methodology-resource-artifact.js";
import { readMethodologyResourceReport } from "./methodology-resource-report.js";

export const METHODOLOGY_ANALYSIS_BINDING_FILE = "methodology-analysis-binding.json";

const ANALYSIS_SOURCE_PATHS = [
  "eval/experiment.ts",
  "eval/historical-curation.ts",
  "eval/historical-methodology-case.ts",
  "eval/historical-truth.ts",
  "eval/methodology-adjudication.ts",
  "eval/methodology-analysis-artifacts.ts",
  "eval/methodology-analysis-binding.ts",
  "eval/methodology-attempt-lifecycle.ts",
  "eval/methodology-execution-evidence.ts",
  "eval/methodology-grading-contract.ts",
  "eval/methodology-grading-projection.ts",
  "eval/methodology-input-plan.ts",
  "eval/methodology-invocations.ts",
  "eval/methodology-report.ts",
  "eval/methodology-resource-artifact.ts",
  "eval/methodology-resource-report.ts",
  "eval/methodology-schedule.ts",
  "eval/methodology-terminal.ts",
  "src/core/telemetry.ts",
  "src/types.ts",
] as const;

export interface MethodologyAnalysisBinding {
  schemaVersion: 1;
  protocol: "historical-methodology-analysis-binding-v1";
  runId: string;
  scheduleSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  executionEvidenceSha256: string;
  gradeSetArtifactSha256: string;
  adjudicationLedgerSha256: string;
  reportSha256: string;
  resourceSetArtifactSha256: string;
  resourceReportSha256: string;
  analysisSource: Array<{ path: string; bytes: number; sha256: string }>;
  analysisSourceTreeSha256: string;
  boundAt: string;
  claims: {
    scheduleCoverage: "every-scheduled-attempt";
    analysisSource: "binding-module-and-dependencies-hashed-from-runtime-repository";
    providerIdentity: "not-established";
    efficacy: "not-decided";
  };
  bindingSha256: string;
}

/** Final join for one closed execution and its separate append-only analysis store. */
export function writeMethodologyAnalysisBinding(analysisRoot: string, input: {
  executionRoot: string;
  repositoryRoot: string;
  expectedExecutionEvidenceSha256?: string;
  expectedStoppedRunClosureSha256?: string;
  trustedCuratorPolicy: HistoricalCuratorPolicy;
  expectedGradeSetArtifactSha256: string;
  expectedAdjudicationLedgerSha256: string;
  expectedReportSha256: string;
  expectedResourceSetArtifactSha256: string;
  expectedResourceReportSha256: string;
  boundAt: string;
}): MethodologyAnalysisBinding {
  if (realpathSync(resolve(analysisRoot)) === realpathSync(resolve(input.executionRoot))) {
    throw new Error("methodology analysis store must be separate from closed execution evidence");
  }
  const complete = input.expectedExecutionEvidenceSha256 !== undefined;
  if (complete === (input.expectedStoppedRunClosureSha256 !== undefined)) {
    throw new Error("methodology analysis binding requires exactly one execution closure digest");
  }
  const projections = complete
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
  const registration = readMethodologyInvocationRegistration(
    input.executionRoot,
    projections.invocationRegistrationSha256,
  );
  const gradeSet = readMethodologyGradeSet(analysisRoot, input.expectedGradeSetArtifactSha256);
  if (gradeSet.runId !== registration.runId ||
      canonicalJson(gradeSet.schedule) !== canonicalJson(registration.schedule) ||
      gradeSet.executionEvidenceSha256 !== projections.executionEvidenceSha256 ||
      gradeSet.inputPlanSha256 !== projections.inputPlanSha256) {
    throw new Error("methodology analysis grade set is not bound to authenticated registration");
  }
  if (canonicalJson(gradeSet.grades.map((grade) => grade.projection)) !==
      canonicalJson(projections.projections.map((projection) => projection.projection))) {
    throw new Error("methodology analysis grades do not cover authenticated projections");
  }
  const adjudication = readMethodologyAdjudicationArtifact(analysisRoot, {
    expectedLedgerSha256: input.expectedAdjudicationLedgerSha256,
    gradeSet,
  });
  const report = readMethodologyReportArtifact(analysisRoot, {
    expectedReportSha256: input.expectedReportSha256,
    gradeSet,
    adjudication,
  });
  const resources = readMethodologyResourceSet(analysisRoot, {
    expectedArtifactSha256: input.expectedResourceSetArtifactSha256,
    schedule: registration.schedule,
  });
  if (resources.runId !== registration.runId ||
      resources.executionEvidenceSha256 !== projections.executionEvidenceSha256 ||
      resources.invocationRegistrationSha256 !== projections.invocationRegistrationSha256 ||
      resources.inputPlanSha256 !== projections.inputPlanSha256 ||
      canonicalJson(resources.resources) !== canonicalJson(projections.projections.map((item) => item.resource))) {
    throw new Error("methodology resource set is not bound to authenticated execution");
  }
  const resourceReport = readMethodologyResourceReport(analysisRoot, {
    expectedReportSha256: input.expectedResourceReportSha256,
    schedule: registration.schedule,
    resources,
  });
  const analysisSource = sourceManifest(input.repositoryRoot);
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-analysis-binding-v1" as const,
    runId: registration.runId,
    scheduleSha256: canonicalJsonSha256(registration.schedule),
    invocationRegistrationSha256: projections.invocationRegistrationSha256,
    inputPlanSha256: projections.inputPlanSha256,
    executionEvidenceSha256: projections.executionEvidenceSha256,
    gradeSetArtifactSha256: gradeSet.artifactSha256,
    adjudicationLedgerSha256: adjudication.ledgerSha256,
    reportSha256: report.reportSha256,
    resourceSetArtifactSha256: resources.artifactSha256,
    resourceReportSha256: resourceReport.reportSha256,
    analysisSource,
    analysisSourceTreeSha256: canonicalJsonSha256(analysisSource),
    boundAt: timestamp(input.boundAt),
    claims: {
      scheduleCoverage: "every-scheduled-attempt" as const,
      analysisSource: "binding-module-and-dependencies-hashed-from-runtime-repository" as const,
      providerIdentity: "not-established" as const,
      efficacy: "not-decided" as const,
    },
  };
  const binding = { ...body, bindingSha256: canonicalJsonSha256(body) };
  validateBinding(binding);
  assertNoSecrets(binding, "methodology analysis binding");
  writeExclusiveJson(analysisRoot, join(analysisRoot, METHODOLOGY_ANALYSIS_BINDING_FILE), binding);
  return binding;
}

export function readMethodologyAnalysisBinding(analysisRoot: string,
  expectedBindingSha256: string): MethodologyAnalysisBinding {
  const raw = readExperimentJson(join(analysisRoot, METHODOLOGY_ANALYSIS_BINDING_FILE)) as MethodologyAnalysisBinding;
  validateBinding(raw);
  const { bindingSha256, ...body } = raw;
  if (!/^[a-f0-9]{64}$/.test(expectedBindingSha256) || bindingSha256 !== expectedBindingSha256 ||
      bindingSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology analysis binding digest mismatch");
  }
  assertNoSecrets(raw, "methodology analysis binding");
  return raw;
}

export function verifyMethodologyAnalysisSource(binding: MethodologyAnalysisBinding,
  repositoryRoot: string): void {
  const current = sourceManifest(repositoryRoot);
  if (canonicalJson(current) !== canonicalJson(binding.analysisSource) ||
      canonicalJsonSha256(current) !== binding.analysisSourceTreeSha256) {
    throw new Error("methodology analysis source differs from bound runtime source");
  }
}

function sourceManifest(repositoryRoot: string): MethodologyAnalysisBinding["analysisSource"] {
  const root = realpathSync(resolve(repositoryRoot));
  const loaded = realpathSync(fileURLToPath(import.meta.url));
  const expectedLoaded = realpathSync(join(root, "eval/methodology-analysis-binding.ts"));
  if (loaded !== expectedLoaded || relative(root, loaded).startsWith("..")) {
    throw new Error("methodology analysis binding module is not loaded from repositoryRoot");
  }
  return ANALYSIS_SOURCE_PATHS.map((path) => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`methodology analysis source is unsafe: ${path}`);
    const bytes = readFileSync(absolute);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("methodology analysis binding boundAt must be a canonical timestamp");
  }
  return value;
}

function validateBinding(value: MethodologyAnalysisBinding): void {
  const keys = ["adjudicationLedgerSha256", "analysisSource", "analysisSourceTreeSha256", "bindingSha256",
    "boundAt", "claims", "executionEvidenceSha256", "gradeSetArtifactSha256", "inputPlanSha256",
    "invocationRegistrationSha256", "protocol", "reportSha256", "resourceReportSha256",
    "resourceSetArtifactSha256", "runId", "scheduleSha256", "schemaVersion"].sort();
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys) || value.schemaVersion !== 1 ||
      value.protocol !== "historical-methodology-analysis-binding-v1" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.runId) ||
      canonicalJson(value.claims) !== canonicalJson({
        scheduleCoverage: "every-scheduled-attempt",
        analysisSource: "binding-module-and-dependencies-hashed-from-runtime-repository",
        providerIdentity: "not-established",
        efficacy: "not-decided",
      })) {
    throw new Error("methodology analysis binding structure is invalid");
  }
  for (const field of ["scheduleSha256", "invocationRegistrationSha256", "inputPlanSha256",
    "executionEvidenceSha256", "gradeSetArtifactSha256", "adjudicationLedgerSha256", "reportSha256",
    "resourceSetArtifactSha256", "resourceReportSha256", "analysisSourceTreeSha256", "bindingSha256"] as const) {
    if (!/^[a-f0-9]{64}$/.test(value[field])) throw new Error(`methodology analysis binding ${field} is invalid`);
  }
  timestamp(value.boundAt);
  if (!Array.isArray(value.analysisSource) || value.analysisSource.length !== ANALYSIS_SOURCE_PATHS.length ||
      canonicalJson(value.analysisSource.map((item) => item.path)) !== canonicalJson(ANALYSIS_SOURCE_PATHS)) {
    throw new Error("methodology analysis source manifest paths are invalid");
  }
  for (const item of value.analysisSource) {
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw new Error("methodology analysis source manifest entry is invalid");
    }
  }
  if (value.analysisSourceTreeSha256 !== canonicalJsonSha256(value.analysisSource)) {
    throw new Error("methodology analysis source tree digest mismatch");
  }
}
