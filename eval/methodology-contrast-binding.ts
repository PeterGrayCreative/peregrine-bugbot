import { fileURLToPath } from "node:url";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { sha256 } from "../src/core/telemetry.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import {
  readMethodologyAdjudicationArtifact,
  readMethodologyGradeSet,
} from "./methodology-analysis-artifacts.js";
import { readMethodologyAnalysisBinding, verifyMethodologyAnalysisSource } from "./methodology-analysis-binding.js";
import { readMethodologyContrastArtifact } from "./methodology-contrast-artifacts.js";
import type { BuildMethodologyContrastsInput } from "./methodology-contrasts.js";
import { readMethodologyResourceSet } from "./methodology-resource-artifact.js";

export const METHODOLOGY_CONTRAST_BINDING_FILE = "methodology-contrast-binding.json";

// Keep this list explicit. It is the union of the v1 analysis binding's fixed
// dependency list and every new module used to derive/bind this artifact.
const CONTRAST_SOURCE_PATHS_CANONICAL = Object.freeze([
  "eval/artifacts.ts",
  "eval/benchmark-panels.ts",
  "eval/case-curation.ts",
  "eval/case-isolation.ts",
  "eval/case-manifest.ts",
  "eval/case-truth.ts",
  "eval/experiment.ts",
  "eval/experiment-evidence.ts",
  "eval/experiment-seals.ts",
  "eval/historical-curation.ts",
  "eval/historical-methodology-case.ts",
  "eval/historical-curator-policy.ts",
  "eval/historical-metric-eligibility.ts",
  "eval/historical-truth.ts",
  "eval/judge-runtime.ts",
  "eval/methodology-adjudication.ts",
  "eval/methodology-analysis-artifacts.ts",
  "eval/methodology-analysis-binding.ts",
  "eval/methodology-attempt-lifecycle.ts",
  "eval/methodology-contrast-artifacts.ts",
  "eval/methodology-contrast-binding.ts",
  "eval/methodology-contrasts.ts",
  "eval/methodology-execution-evidence.ts",
  "eval/methodology-grading-contract.ts",
  "eval/methodology-grading-projection.ts",
  "eval/methodology-input-plan.ts",
  "eval/methodology-invocations.ts",
  "eval/methodology-lane-activation.ts",
  "eval/methodology-report.ts",
  "eval/methodology-resource-artifact.ts",
  "eval/methodology-resource-report.ts",
  "eval/methodology-run-seal.ts",
  "eval/methodology-runner.ts",
  "eval/methodology-schedule.ts",
  "eval/methodology-terminal.ts",
  "eval/methodology-output.ts",
  "eval/methodology-assets.ts",
  "eval/methodology-prompt-isolation.ts",
  "eval/methodology-prompts.ts",
  "eval/run-matrix.ts",
  "eval/runtime-containment.ts",
  "src/config.ts",
  "src/core/breadth-result.ts",
  "src/core/lanes.ts",
  "src/core/manifest.ts",
  "src/core/method-packet.ts",
  "src/core/paths.ts",
  "src/core/pricing.ts",
  "src/core/prompt.ts",
  "src/core/review-result.ts",
  "src/core/run-failure.ts",
  "src/core/telemetry.ts",
  "src/engines/claude.ts",
  "src/engines/codex.ts",
  "src/engines/engine.ts",
  "src/engines/mock.ts",
  "src/security/provider-env.ts",
  "src/security/secrets.ts",
  "src/types.ts",
  "src/util/exec.ts",
] as const);

// Keep the existing read-only export for consumers that need to compose a
// related source closure, but never expose the canonical value itself.
export const CONTRAST_SOURCE_PATHS = Object.freeze([
  ...CONTRAST_SOURCE_PATHS_CANONICAL,
]) as typeof CONTRAST_SOURCE_PATHS_CANONICAL;

export interface MethodologyContrastBinding {
  schemaVersion: 1;
  protocol: "historical-methodology-contrast-binding-v1";
  runId: string;
  scheduleSha256: string;
  baseAnalysisBindingSha256: string;
  contrastSha256: string;
  contrastSource: Array<{ path: string; bytes: number; sha256: string }>;
  contrastSourceTreeSha256: string;
  boundAt: string;
  claims: {
    sourceClosure: "fixed-explicit-source-list";
    providerIdentity: "not-established";
    efficacy: "not-decided";
  };
  bindingSha256: string;
}

export interface MethodologyContrastBindingWriteInputs {
  repositoryRoot: string;
  expectedBaseAnalysisBindingSha256: string;
  expectedContrastSha256: string;
  boundAt: string;
}

export interface MethodologyContrastBindingReadInputs {
  repositoryRoot: string;
  expectedBaseAnalysisBindingSha256: string;
  expectedContrastSha256: string;
  expectedBindingSha256: string;
}

/** Join the existing v1 analysis seal to a separately derived contrast seal. */
export function writeMethodologyContrastBinding(
  analysisRoot: string,
  input: MethodologyContrastBindingWriteInputs,
): MethodologyContrastBinding {
  const base = readMethodologyAnalysisBinding(analysisRoot, input.expectedBaseAnalysisBindingSha256);
  assertStoredContrastDigest(analysisRoot, input.expectedContrastSha256);
  verifyMethodologyAnalysisSource(base, input.repositoryRoot);
  const gradeSet = readMethodologyGradeSet(analysisRoot, base.gradeSetArtifactSha256);
  const adjudication = readMethodologyAdjudicationArtifact(analysisRoot, {
    expectedLedgerSha256: base.adjudicationLedgerSha256,
    gradeSet,
  });
  const resourceSet = readMethodologyResourceSet(analysisRoot, {
    expectedArtifactSha256: base.resourceSetArtifactSha256,
    schedule: gradeSet.schedule,
  });
  const contrast = readStoredContrast(analysisRoot, {
    schedule: gradeSet.schedule,
    gradeSet,
    adjudication,
    resourceSet,
    expectedContrastSha256: input.expectedContrastSha256,
  });
  if (contrast.runId !== base.runId || contrast.scheduleSha256 !== base.scheduleSha256 ||
      contrast.executionEvidenceSha256 !== base.executionEvidenceSha256 ||
      contrast.inputPlanSha256 !== base.inputPlanSha256 ||
      contrast.gradeSetArtifactSha256 !== base.gradeSetArtifactSha256 ||
      contrast.adjudicationLedgerSha256 !== base.adjudicationLedgerSha256 ||
      contrast.resourceSetArtifactSha256 !== base.resourceSetArtifactSha256) {
    throw new Error("methodology contrast is not bound to the v1 analysis binding");
  }
  const contrastSource = sourceManifest(input.repositoryRoot);
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-contrast-binding-v1" as const,
    runId: base.runId,
    scheduleSha256: base.scheduleSha256,
    baseAnalysisBindingSha256: base.bindingSha256,
    contrastSha256: contrast.contrastSha256,
    contrastSource,
    contrastSourceTreeSha256: canonicalJsonSha256(contrastSource),
    boundAt: timestamp(input.boundAt),
    claims: {
      sourceClosure: "fixed-explicit-source-list" as const,
      providerIdentity: "not-established" as const,
      efficacy: "not-decided" as const,
    },
  };
  const binding = { ...body, bindingSha256: canonicalJsonSha256(body) };
  validateBinding(binding);
  assertNoSecrets(binding, "methodology contrast binding");
  writeExclusiveJson(analysisRoot, join(analysisRoot, METHODOLOGY_CONTRAST_BINDING_FILE), binding);
  return binding;
}

/** Read the derived seal, rederive the contrast, and verify the current source tree. */
export function readMethodologyContrastBinding(
  analysisRoot: string,
  input: MethodologyContrastBindingReadInputs,
): MethodologyContrastBinding {
  const raw = readExperimentJson(join(analysisRoot, METHODOLOGY_CONTRAST_BINDING_FILE)) as MethodologyContrastBinding;
  validateBinding(raw);
  const { bindingSha256, ...body } = raw;
  if (!/^[a-f0-9]{64}$/.test(input.expectedBindingSha256) || bindingSha256 !== input.expectedBindingSha256 ||
      bindingSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology contrast binding digest mismatch");
  }
  const storedBase = readExperimentJson(join(analysisRoot, "methodology-analysis-binding.json")) as { bindingSha256?: unknown };
  if (raw.baseAnalysisBindingSha256 !== input.expectedBaseAnalysisBindingSha256 ||
      raw.contrastSha256 !== input.expectedContrastSha256) {
    throw new Error("methodology contrast binding does not match caller-held artifact digests");
  }
  if (storedBase.bindingSha256 !== input.expectedBaseAnalysisBindingSha256) {
    throw new Error("methodology analysis binding digest mismatch");
  }
  assertStoredContrastDigest(analysisRoot, input.expectedContrastSha256);
  const base = readMethodologyAnalysisBinding(analysisRoot, input.expectedBaseAnalysisBindingSha256);
  if (base.runId !== raw.runId || base.scheduleSha256 !== raw.scheduleSha256) {
    throw new Error("methodology contrast binding base binding mismatch");
  }
  verifyMethodologyAnalysisSource(base, input.repositoryRoot);
  const gradeSet = readMethodologyGradeSet(analysisRoot, base.gradeSetArtifactSha256);
  const adjudication = readMethodologyAdjudicationArtifact(analysisRoot, {
    expectedLedgerSha256: base.adjudicationLedgerSha256,
    gradeSet,
  });
  const resourceSet = readMethodologyResourceSet(analysisRoot, {
    expectedArtifactSha256: base.resourceSetArtifactSha256,
    schedule: gradeSet.schedule,
  });
  const contrast = readMethodologyContrastArtifact(analysisRoot, {
    schedule: gradeSet.schedule,
    gradeSet,
    adjudication,
    resourceSet,
    expectedContrastSha256: raw.contrastSha256,
  });
  if (contrast.runId !== raw.runId || contrast.scheduleSha256 !== raw.scheduleSha256) {
    throw new Error("methodology contrast binding contrast mismatch");
  }
  const current = sourceManifest(input.repositoryRoot);
  if (canonicalJson(current) !== canonicalJson(raw.contrastSource) ||
      canonicalJsonSha256(current) !== raw.contrastSourceTreeSha256) {
    throw new Error("methodology contrast source differs from bound runtime source");
  }
  assertNoSecrets(raw, "methodology contrast binding");
  return raw;
}

function readStoredContrast(root: string, input: {
  schedule: BuildMethodologyContrastsInput["schedule"];
  gradeSet: BuildMethodologyContrastsInput["gradeSet"];
  adjudication: BuildMethodologyContrastsInput["adjudication"];
  resourceSet: BuildMethodologyContrastsInput["resourceSet"];
  expectedContrastSha256: string;
}): ReturnType<typeof readMethodologyContrastArtifact> {
  return readMethodologyContrastArtifact(root, {
    schedule: input.schedule,
    gradeSet: input.gradeSet,
    adjudication: input.adjudication,
    resourceSet: input.resourceSet,
    expectedContrastSha256: input.expectedContrastSha256,
  });
}

function assertStoredContrastDigest(root: string, expectedContrastSha256: string): void {
  const raw = readExperimentJson(join(root, "methodology-contrast.json")) as { contrastSha256?: unknown };
  if (!/^[a-f0-9]{64}$/.test(expectedContrastSha256) || raw.contrastSha256 !== expectedContrastSha256) {
    throw new Error("methodology contrast artifact digest mismatch");
  }
}

function sourceManifest(repositoryRoot: string): MethodologyContrastBinding["contrastSource"] {
  const root = realpathSync(resolve(repositoryRoot));
  const loaded = realpathSync(fileURLToPath(import.meta.url));
  const expectedLoaded = realpathSync(join(root, "eval/methodology-contrast-binding.ts"));
  if (loaded !== expectedLoaded || relative(root, loaded).startsWith("..")) {
    throw new Error("methodology contrast binding module is not loaded from repositoryRoot");
  }
  return CONTRAST_SOURCE_PATHS_CANONICAL.map((path) => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`methodology contrast source is unsafe: ${path}`);
    const bytes = readFileSync(absolute);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function validateBinding(value: MethodologyContrastBinding): void {
  const keys = ["baseAnalysisBindingSha256", "bindingSha256", "boundAt", "claims", "contrastSha256",
    "contrastSource", "contrastSourceTreeSha256", "protocol", "runId", "scheduleSha256", "schemaVersion"].sort();
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys) || value.schemaVersion !== 1 ||
      value.protocol !== "historical-methodology-contrast-binding-v1" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.runId) ||
      canonicalJson(value.claims) !== canonicalJson({
        sourceClosure: "fixed-explicit-source-list",
        providerIdentity: "not-established",
        efficacy: "not-decided",
      })) throw new Error("methodology contrast binding structure is invalid");
  for (const field of ["baseAnalysisBindingSha256", "bindingSha256", "contrastSha256", "scheduleSha256",
    "contrastSourceTreeSha256"] as const) {
    if (!/^[a-f0-9]{64}$/.test(value[field])) throw new Error(`methodology contrast binding ${field} is invalid`);
  }
  timestamp(value.boundAt);
  if (!Array.isArray(value.contrastSource) || value.contrastSource.length !== CONTRAST_SOURCE_PATHS_CANONICAL.length ||
      canonicalJson(value.contrastSource.map((item) => item.path)) !== canonicalJson(CONTRAST_SOURCE_PATHS_CANONICAL)) {
    throw new Error("methodology contrast source manifest paths are invalid");
  }
  for (const item of value.contrastSource) {
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw new Error("methodology contrast source manifest entry is invalid");
    }
  }
  if (value.contrastSourceTreeSha256 !== canonicalJsonSha256(value.contrastSource)) {
    throw new Error("methodology contrast source tree digest mismatch");
  }
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("methodology contrast binding boundAt must be a canonical timestamp");
  }
  return value;
}
