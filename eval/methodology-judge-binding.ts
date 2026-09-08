import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import {
  CODEX_SEMANTIC_JUDGE,
  semanticJudgeArguments,
} from "./judge-runtime.js";
import {
  readMethodologyJudgeLedger,
  type MethodologyJudgeInputs,
} from "./methodology-judge-ledger.js";

export const METHODOLOGY_JUDGE_BINDING_FILE = "methodology-judge-binding.json";
export const METHODOLOGY_JUDGE_BINDING_PROTOCOL = "historical-methodology-judge-binding-v1" as const;

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const JUDGE_RESULT_SCHEMA_PATH = "schemas/judge-result.schema.json";

// This is intentionally explicit and closed. It includes the methodology
// judge boundary, the generic judge ledger/runtime, every local module used to
// derive prompt/projection/hash/parse/security behavior, and the schemas that
// define the generic judge wire format. Do not replace this with a directory
// walk: unrelated files must not silently change the judge identity.
export const METHODOLOGY_JUDGE_SOURCE_PATHS = [
  "eval/artifacts.ts",
  "eval/benchmark-panels.ts",
  "eval/case-curation.ts",
  "eval/case-isolation.ts",
  "eval/case-manifest.ts",
  "eval/case-truth.ts",
  "eval/experiment.ts",
  "eval/experiment-evidence.ts",
  "eval/experiment-seals.ts",
  "eval/grading-contract.ts",
  "eval/historical-curation.ts",
  "eval/historical-methodology-case.ts",
  "eval/historical-curator-policy.ts",
  "eval/historical-metric-eligibility.ts",
  "eval/historical-truth.ts",
  "eval/judge-ledger.ts",
  "eval/judge-runtime.ts",
  "eval/methodology-attempt-lifecycle.ts",
  "eval/methodology-execution-evidence.ts",
  "eval/methodology-grading-contract.ts",
  "eval/methodology-grading-projection.ts",
  "eval/methodology-input-plan.ts",
  "eval/methodology-invocations.ts",
  "eval/methodology-judge-binding.ts",
  "eval/methodology-judge-ledger.ts",
  "eval/methodology-judge-prompt.ts",
  "eval/methodology-assets.ts",
  "eval/methodology-lane-activation.ts",
  "eval/methodology-output.ts",
  "eval/methodology-prompt-isolation.ts",
  "eval/methodology-prompts.ts",
  "eval/methodology-resource-artifact.ts",
  "eval/methodology-resource-report.ts",
  "eval/methodology-run-seal.ts",
  "eval/methodology-runner.ts",
  "eval/methodology-schedule.ts",
  "eval/methodology-terminal.ts",
  "eval/run-matrix.ts",
  "eval/runtime-containment.ts",
  "schemas/judge-attempt.schema.json",
  "schemas/judge-manifest.schema.json",
  "schemas/judge-result.schema.json",
  "schemas/judge-stop.schema.json",
  "schemas/judge-terminal-seal.schema.json",
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
] as const;

type SourceEntry = { path: string; bytes: number; sha256: string };

export interface MethodologyJudgeBinding {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_JUDGE_BINDING_PROTOCOL;
  runId: string;
  executionEvidenceSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  projectionSetSha256: string;
  occurrenceArtifactSha256: string;
  judgeManifestSha256: string;
  judgeTerminalSealSha256: string;
  judgeImplementationSha256: string;
  judgeSource: SourceEntry[];
  judgeSourceTreeSha256: string;
  boundAt: string;
  claims: {
    sourceClosure: "fixed-explicit-source-list";
    providerIdentity: "not-established";
    semanticCorrectness: "not-established";
    humanCalibration: "required";
  };
  bindingSha256: string;
}

export interface MethodologyJudgeBindingWriteInputs extends MethodologyJudgeInputs {
  runDirectory: string;
  repositoryRoot: string;
  expectedOccurrenceArtifactSha256: string;
  expectedJudgeManifestSha256: string;
  expectedJudgeTerminalSealSha256: string;
  expectedProjectionSetSha256: string;
  boundAt: string;
}

export interface MethodologyJudgeBindingReadInputs extends MethodologyJudgeInputs {
  runDirectory: string;
  repositoryRoot: string;
  expectedOccurrenceArtifactSha256: string;
  expectedJudgeManifestSha256: string;
  expectedJudgeTerminalSealSha256: string;
  expectedProjectionSetSha256: string;
  expectedBindingSha256: string;
}

/**
 * Content address of the exact methodology semantic-judge implementation.
 * The source manifest is runtime-bound to this repository, while the explicit
 * identity/config and result-schema bytes prevent an invented implementation
 * digest from being accepted by a binding.
 */
export function methodologyJudgeImplementationSha256(repositoryRoot: string): string {
  const source = sourceManifest(repositoryRoot);
  const resultSchema = source.find((entry) => entry.path === JUDGE_RESULT_SCHEMA_PATH);
  if (!resultSchema) throw new Error("methodology judge source closure omits the judge-result schema");
  return canonicalJsonSha256({
    protocol: METHODOLOGY_JUDGE_BINDING_PROTOCOL,
    source,
    judge: CODEX_SEMANTIC_JUDGE,
    judgeConfig: {
      identity: CODEX_SEMANTIC_JUDGE,
      arguments: semanticJudgeArguments(),
    },
    judgeResultSchema: resultSchema,
  });
}

/** Write one immutable binding only after the generic judge is complete. */
export function writeMethodologyJudgeBinding(
  analysisRoot: string,
  input: MethodologyJudgeBindingWriteInputs,
): MethodologyJudgeBinding {
  const implementation = methodologyJudgeImplementationSha256(input.repositoryRoot);
  if (input.judgeImplementationSha256 !== implementation) {
    throw new Error("methodology judge manifest uses an invented or stale implementation digest");
  }
  const ledger = readLedger(input);
  const source = sourceManifest(input.repositoryRoot);
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_JUDGE_BINDING_PROTOCOL,
    runId: ledger.runId,
    executionEvidenceSha256: input.projections.executionEvidenceSha256,
    invocationRegistrationSha256: input.projections.invocationRegistrationSha256,
    inputPlanSha256: input.projections.inputPlanSha256,
    projectionSetSha256: ledger.artifact.projectionSetSha256,
    occurrenceArtifactSha256: ledger.artifact.artifactSha256,
    judgeManifestSha256: ledger.manifest.manifestSha256,
    judgeTerminalSealSha256: input.expectedJudgeTerminalSealSha256,
    judgeImplementationSha256: implementation,
    judgeSource: source,
    judgeSourceTreeSha256: canonicalJsonSha256(source),
    boundAt: timestamp(input.boundAt),
    claims: {
      sourceClosure: "fixed-explicit-source-list" as const,
      providerIdentity: "not-established" as const,
      semanticCorrectness: "not-established" as const,
      humanCalibration: "required" as const,
    },
  };
  const binding: MethodologyJudgeBinding = { ...body, bindingSha256: canonicalJsonSha256(body) };
  validateBinding(binding);
  assertNoSecrets(binding, "methodology judge binding");
  writeExclusiveJson(analysisRoot, join(resolve(analysisRoot), METHODOLOGY_JUDGE_BINDING_FILE), binding);
  return binding;
}

/** Re-derive the ledger and source closure before accepting the immutable binding. */
export function readMethodologyJudgeBinding(
  analysisRoot: string,
  input: MethodologyJudgeBindingReadInputs,
): MethodologyJudgeBinding {
  const raw = readExperimentJson(join(resolve(analysisRoot), METHODOLOGY_JUDGE_BINDING_FILE));
  const binding = parseBinding(raw);
  if (binding.bindingSha256 !== input.expectedBindingSha256 ||
      binding.bindingSha256 !== canonicalJsonSha256(withoutBindingDigest(binding))) {
    throw new Error("methodology judge binding digest mismatch");
  }
  if (binding.runId !== input.runId ||
      binding.executionEvidenceSha256 !== input.projections.executionEvidenceSha256 ||
      binding.invocationRegistrationSha256 !== input.projections.invocationRegistrationSha256 ||
      binding.inputPlanSha256 !== input.projections.inputPlanSha256 ||
      binding.projectionSetSha256 !== input.expectedProjectionSetSha256 ||
      binding.occurrenceArtifactSha256 !== input.expectedOccurrenceArtifactSha256 ||
      binding.judgeManifestSha256 !== input.expectedJudgeManifestSha256 ||
      binding.judgeTerminalSealSha256 !== input.expectedJudgeTerminalSealSha256 ||
      binding.judgeImplementationSha256 !== input.judgeImplementationSha256) {
    throw new Error("methodology judge binding does not match caller-held artifact digests");
  }
  const implementation = methodologyJudgeImplementationSha256(input.repositoryRoot);
  if (binding.judgeImplementationSha256 !== implementation) {
    throw new Error("methodology judge implementation differs from bound runtime source");
  }
  const ledger = readLedger(input);
  if (ledger.runId !== binding.runId ||
      ledger.artifact.projectionSetSha256 !== binding.projectionSetSha256 ||
      ledger.artifact.artifactSha256 !== binding.occurrenceArtifactSha256 ||
      ledger.manifest.manifestSha256 !== binding.judgeManifestSha256) {
    throw new Error("methodology judge binding does not match rederived ledger");
  }
  verifyMethodologyJudgeSource(binding, input.repositoryRoot);
  assertNoSecrets(binding, "methodology judge binding");
  return binding;
}

/** Verify the fixed source closure against the source captured by a binding. */
export function verifyMethodologyJudgeSource(
  binding: MethodologyJudgeBinding,
  repositoryRoot: string,
): void {
  const current = sourceManifest(repositoryRoot);
  if (canonicalJson(current) !== canonicalJson(binding.judgeSource) ||
      canonicalJsonSha256(current) !== binding.judgeSourceTreeSha256) {
    throw new Error("methodology judge source differs from bound runtime source");
  }
}

function readLedger(input: {
  runDirectory: string;
  runId: string;
  projections: MethodologyJudgeInputs["projections"];
  providerAccess: MethodologyJudgeInputs["providerAccess"];
  limits: MethodologyJudgeInputs["limits"];
  judgeImplementationSha256: string;
  expectedOccurrenceArtifactSha256: string;
  expectedJudgeManifestSha256: string;
  expectedJudgeTerminalSealSha256: string;
  expectedProjectionSetSha256: string;
}) {
  return readMethodologyJudgeLedger({
    runDirectory: input.runDirectory,
    runId: input.runId,
    projections: input.projections,
    providerAccess: input.providerAccess,
    limits: input.limits,
    judgeImplementationSha256: input.judgeImplementationSha256,
    expectedOccurrenceArtifactSha256: input.expectedOccurrenceArtifactSha256,
    expectedJudgeManifestSha256: input.expectedJudgeManifestSha256,
    expectedJudgeTerminalSealSha256: input.expectedJudgeTerminalSealSha256,
    expectedProjectionSetSha256: input.expectedProjectionSetSha256,
  });
}

function sourceManifest(repositoryRoot: string): SourceEntry[] {
  const root = checkedRepositoryRoot(repositoryRoot);
  const loaded = realpathSync(fileURLToPath(import.meta.url));
  const expectedLoaded = realpathSync(join(root, "eval/methodology-judge-binding.ts"));
  if (loaded !== expectedLoaded || relative(root, loaded).startsWith("..")) {
    throw new Error("methodology judge binding module is not loaded from repositoryRoot");
  }
  return METHODOLOGY_JUDGE_SOURCE_PATHS.map((path) => {
    if (isAbsolute(path) || path.split("/").some((part) => part === ".." || part === "." || part === "")) {
      throw new Error(`methodology judge source path is unsafe: ${path}`);
    }
    const absolute = join(root, path);
    const bytes = readBoundedRegularFile(absolute, `methodology judge source ${path}`);
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
  });
}

function checkedRepositoryRoot(repositoryRoot: string): string {
  const absolute = resolve(repositoryRoot);
  const rootStat = lstatSync(absolute);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("methodology judge repositoryRoot must be a real non-symlink directory");
  }
  return realpathSync(absolute);
}

function readBoundedRegularFile(path: string, label: string): Buffer {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
    throw new Error(`${label} must be a bounded regular non-symlink file`);
  }
  return readFileSync(path);
}

function parseBinding(value: unknown): MethodologyJudgeBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("methodology judge binding must be an object");
  }
  const binding = value as MethodologyJudgeBinding;
  validateBinding(binding);
  return binding;
}

function validateBinding(value: MethodologyJudgeBinding): void {
  const keys = [
    "bindingSha256", "boundAt", "claims", "executionEvidenceSha256", "inputPlanSha256",
    "invocationRegistrationSha256", "judgeImplementationSha256", "judgeManifestSha256",
    "judgeSource", "judgeSourceTreeSha256", "judgeTerminalSealSha256", "occurrenceArtifactSha256",
    "projectionSetSha256", "protocol", "runId", "schemaVersion",
  ].sort();
  if (canonicalJson(Object.keys(value as object).sort()) !== canonicalJson(keys) ||
      value.schemaVersion !== 1 || value.protocol !== METHODOLOGY_JUDGE_BINDING_PROTOCOL ||
      typeof value.runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.runId) ||
      canonicalJson(value.claims) !== canonicalJson({
        sourceClosure: "fixed-explicit-source-list",
        providerIdentity: "not-established",
        semanticCorrectness: "not-established",
        humanCalibration: "required",
      })) {
    throw new Error("methodology judge binding structure is invalid");
  }
  for (const field of [
    "executionEvidenceSha256", "invocationRegistrationSha256", "inputPlanSha256", "projectionSetSha256",
    "occurrenceArtifactSha256", "judgeManifestSha256", "judgeTerminalSealSha256", "judgeImplementationSha256",
    "judgeSourceTreeSha256", "bindingSha256",
  ] as const) {
    if (!SHA256.test(value[field])) throw new Error(`methodology judge binding ${field} is invalid`);
  }
  timestamp(value.boundAt);
  if (!Array.isArray(value.judgeSource) || value.judgeSource.length !== METHODOLOGY_JUDGE_SOURCE_PATHS.length ||
      canonicalJson(value.judgeSource.map((item) => item.path)) !== canonicalJson(METHODOLOGY_JUDGE_SOURCE_PATHS)) {
    throw new Error("methodology judge source manifest paths are invalid");
  }
  for (const entry of value.judgeSource) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        canonicalJson(Object.keys(entry).sort()) !== canonicalJson(["bytes", "path", "sha256"]) ||
        typeof entry.path !== "string" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        !SHA256.test(entry.sha256)) throw new Error("methodology judge source manifest entry is invalid");
  }
  if (value.judgeSourceTreeSha256 !== canonicalJsonSha256(value.judgeSource)) {
    throw new Error("methodology judge source tree digest mismatch");
  }
}

function withoutBindingDigest(value: MethodologyJudgeBinding): Omit<MethodologyJudgeBinding, "bindingSha256"> {
  const { bindingSha256: _ignored, ...body } = value;
  return body;
}

function timestamp(value: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("methodology judge binding boundAt must be a canonical timestamp");
  }
  return value;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
