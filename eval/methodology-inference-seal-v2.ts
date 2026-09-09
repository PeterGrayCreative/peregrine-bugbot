import { fileURLToPath } from "node:url";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { sha256 } from "../src/core/telemetry.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import { readMethodologyInputPlan } from "./methodology-input-plan.js";
import { readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import {
  buildMethodologyInferenceArtifactV2,
  buildMethodologyInferencePlanV2,
  parseMethodologyInferenceArtifactV2,
  parseMethodologyInferencePlanV2,
  type BuildMethodologyInferencePlanV2Input,
  type MethodologyInferenceArtifactV2,
  type MethodologyInferencePlanV2,
} from "./methodology-inference-plan-v2.js";
import {
  assertNoBegunInferenceWork,
  readMethodologyInferenceEvidence,
  type MethodologyInferenceEvidenceSource,
} from "./methodology-inference-seal.js";
import { readR2TruthBindingArtifact } from "./methodology-r2-truth-binding.js";

export const METHODOLOGY_INFERENCE_PLAN_V2_FILE = "methodology-inference-plan.v2.json";
export const METHODOLOGY_INFERENCE_SEAL_V2_DIRECTORY = "methodology-inference-seals-v2";
export const METHODOLOGY_INFERENCE_SEAL_V2_PROTOCOL = "historical-methodology-inference-seal-v2" as const;

const SHA256 = /^[a-f0-9]{64}$/;
export const METHODOLOGY_INFERENCE_V2_SOURCE_PATHS = [
  "eval/historical-truth.ts",
  "eval/methodology-inference-plan-v2.ts",
  "eval/methodology-inference-seal-v2.ts",
  "eval/methodology-inference-seal.ts",
  "eval/methodology-inference.ts",
  "eval/methodology-r2-partition.ts",
  "eval/methodology-r2-truth-binding.ts",
].sort();

type SourceEntry = { path: string; bytes: number; sha256: string };

export interface MethodologyInferenceSealV2 {
  schemaVersion: 2;
  protocol: typeof METHODOLOGY_INFERENCE_SEAL_V2_PROTOCOL;
  version: number;
  previousSealSha256: string | null;
  runId: string;
  inferencePlanSha256: string;
  r2TruthBindingSha256: string;
  r2PartitionArtifactSha256: string;
  sealedAnalysisBindingSha256: string;
  baseAnalysisBindingSha256: string;
  effectiveAdjudicationSha256: string;
  adjudicationResolutionHeadSha256: string | null;
  unmatchedRootLedgerSha256: string;
  inference: MethodologyInferenceArtifactV2;
  inferenceSource: SourceEntry[];
  inferenceSourceTreeSha256: string;
  sealedAt: string;
  claims: {
    sourceClosure: "fixed-explicit-source-list";
    duplicateFamilyBinding: "authenticated-r2-truth-binding";
    rootSeverityBinding: "authenticated-r2-truth-binding";
    reviewerAnswerExposure: "none-from-operator-binding";
    providerIdentity: "inherited-not-established";
    efficacy: "not-decided";
  };
  sealSha256: string;
}

export interface MethodologyInferenceSealV2Source extends MethodologyInferenceEvidenceSource {
  expectedInferencePlanSha256: string;
  truthBindingStorageRoot: string;
  expectedTruthBindingSha256: string;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical timestamp`);
  return value;
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const root = value as Record<string, unknown>;
  if (Object.keys(root).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(root, key))) throw new Error(`${label} has an invalid shape`);
  return root;
}

function directFile(rootValue: string, relativePath: string): string {
  const root = realpathSync(resolve(rootValue));
  const path = join(root, relativePath);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relativePath} must be a direct regular file`);
  return path;
}

export function writeMethodologyInferencePlanV2(
  analysisRoot: string,
  input: Omit<BuildMethodologyInferencePlanV2Input, "truthBinding"> & {
    executionRoot: string;
    truthBindingStorageRoot: string;
    expectedTruthBindingSha256: string;
  },
): MethodologyInferencePlanV2 {
  const registration = readMethodologyInvocationRegistration(input.executionRoot, input.invocationRegistrationSha256);
  const inputPlan = readMethodologyInputPlan(input.executionRoot, input.invocationRegistrationSha256, input.inputPlanSha256);
  const binding = readR2TruthBindingArtifact(input.truthBindingStorageRoot, input.expectedTruthBindingSha256);
  if (registration.runId !== input.runId || canonicalJsonSha256(registration.schedule) !== canonicalJsonSha256(input.schedule) || inputPlan.invocationRegistrationSha256 !== input.invocationRegistrationSha256) throw new Error("inference plan v2 does not match invocation registration/input plan");
  assertNoBegunInferenceWork(input.executionRoot);
  const plan = buildMethodologyInferencePlanV2({ ...input, schedule: registration.schedule, truthBinding: binding });
  assertNoSecrets(plan, "methodology inference plan v2");
  assertNoBegunInferenceWork(input.executionRoot);
  if (existsSync(join(resolve(analysisRoot), METHODOLOGY_INFERENCE_PLAN_V2_FILE))) throw new Error("methodology inference plan v2 already exists");
  writeExclusiveJson(analysisRoot, join(resolve(analysisRoot), METHODOLOGY_INFERENCE_PLAN_V2_FILE), plan);
  return plan;
}

export function readMethodologyInferencePlanV2(
  analysisRoot: string,
  executionRoot: string,
  truthBindingStorageRoot: string,
  expectedPlanSha256: string,
  expectedTruthBindingSha256: string,
): MethodologyInferencePlanV2 {
  const stored = parseMethodologyInferencePlanV2(readExperimentJson(directFile(analysisRoot, METHODOLOGY_INFERENCE_PLAN_V2_FILE)));
  if (stored.planSha256 !== digest(expectedPlanSha256, "expectedPlanSha256") || stored.r2TruthBindingSha256 !== digest(expectedTruthBindingSha256, "expectedTruthBindingSha256")) throw new Error("methodology inference plan v2 digest mismatch");
  const registration = readMethodologyInvocationRegistration(executionRoot, stored.invocationRegistrationSha256);
  readMethodologyInputPlan(executionRoot, stored.invocationRegistrationSha256, stored.inputPlanSha256);
  const binding = readR2TruthBindingArtifact(truthBindingStorageRoot, expectedTruthBindingSha256);
  const rebuilt = buildMethodologyInferencePlanV2({
    runId: stored.runId,
    schedule: registration.schedule,
    invocationRegistrationSha256: stored.invocationRegistrationSha256,
    inputPlanSha256: stored.inputPlanSha256,
    truthBinding: binding,
    analysisStage: stored.analysisStage,
    hypothesis: stored.hypothesis,
    bootstrapSamples: stored.bootstrapSamples,
    bootstrapSeed: stored.bootstrapSeed,
    minIndependentClusters: stored.minIndependentClusters,
  });
  if (canonicalJson(stored) !== canonicalJson(rebuilt)) throw new Error("methodology inference plan v2 differs from its authenticated sources");
  assertNoSecrets(rebuilt, "methodology inference plan v2");
  return rebuilt;
}

function sourceManifest(repositoryRoot: string): SourceEntry[] {
  const root = realpathSync(resolve(repositoryRoot));
  const loaded = realpathSync(fileURLToPath(import.meta.url));
  if (loaded !== realpathSync(join(root, "eval/methodology-inference-seal-v2.ts")) || relative(root, loaded).startsWith("..")) throw new Error("methodology inference seal v2 is not loaded from repositoryRoot");
  return METHODOLOGY_INFERENCE_V2_SOURCE_PATHS.map((path) => {
    const bytes = readFileSync(directFile(root, path));
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function buildSealV2(analysisRoot: string, input: MethodologyInferenceSealV2Source, sealedAtValue: unknown, version: number, previousSealSha256: string | null): MethodologyInferenceSealV2 {
  const evidence = readMethodologyInferenceEvidence(analysisRoot, input);
  const plan = readMethodologyInferencePlanV2(analysisRoot, input.sealedAnalysis.executionRoot, input.truthBindingStorageRoot, input.expectedInferencePlanSha256, input.expectedTruthBindingSha256);
  const binding = readR2TruthBindingArtifact(input.truthBindingStorageRoot, input.expectedTruthBindingSha256);
  if (plan.runId !== evidence.sealedAnalysis.runId || plan.scheduleSha256 !== evidence.sealedAnalysis.scheduleSha256 || plan.invocationRegistrationSha256 !== evidence.sealedAnalysis.invocationRegistrationSha256 || plan.inputPlanSha256 !== evidence.sealedAnalysis.inputPlanSha256) throw new Error("methodology inference v2 sources do not form one bound run");
  for (const caseBinding of plan.caseBindings) {
    const registered = evidence.inputPlan.cases.find((item) => item.caseName === caseBinding.caseName);
    if (!registered || registered.historicalRegistration.registrationSha256 !== caseBinding.registrationSha256 || registered.historicalRegistration.truth.scopeSha256 !== caseBinding.truthScopeSha256 || registered.historicalRegistration.source.repositoryIdentitySha256 !== caseBinding.repositoryFamilySha256) throw new Error(`methodology inference v2 input plan does not bind ${caseBinding.caseName}`);
  }
  const inference = buildMethodologyInferenceArtifactV2({ plan, truthBinding: binding, schedule: evidence.gradeSet.schedule, gradeSet: evidence.gradeSet, adjudication: evidence.adjudication, effectiveAdjudication: evidence.adjudicationResolution.effective, unmatchedRootLedger: evidence.unmatchedRootLedger, resourceSet: evidence.resourceSet });
  const inferenceSource = sourceManifest(input.sealedAnalysis.repositoryRoot);
  const body: Omit<MethodologyInferenceSealV2, "sealSha256"> = {
    schemaVersion: 2,
    protocol: METHODOLOGY_INFERENCE_SEAL_V2_PROTOCOL,
    version,
    previousSealSha256,
    runId: plan.runId,
    inferencePlanSha256: plan.planSha256,
    r2TruthBindingSha256: binding.bindingSha256,
    r2PartitionArtifactSha256: binding.partitionArtifactSha256,
    sealedAnalysisBindingSha256: evidence.sealedAnalysis.bindingSha256,
    baseAnalysisBindingSha256: evidence.baseAnalysis.bindingSha256,
    effectiveAdjudicationSha256: evidence.adjudicationResolution.effective.effectiveSha256,
    adjudicationResolutionHeadSha256: evidence.adjudicationResolution.headResolutionSha256,
    unmatchedRootLedgerSha256: evidence.unmatchedRootLedger.artifactSha256,
    inference,
    inferenceSource,
    inferenceSourceTreeSha256: canonicalJsonSha256(inferenceSource),
    sealedAt: timestamp(sealedAtValue, "sealedAt"),
    claims: { sourceClosure: "fixed-explicit-source-list", duplicateFamilyBinding: "authenticated-r2-truth-binding", rootSeverityBinding: "authenticated-r2-truth-binding", reviewerAnswerExposure: "none-from-operator-binding", providerIdentity: "inherited-not-established", efficacy: "not-decided" },
  };
  return { ...body, sealSha256: canonicalJsonSha256(body) };
}

export function parseMethodologyInferenceSealV2(value: unknown, label = "methodology inference seal v2"): MethodologyInferenceSealV2 {
  const root = exactObject(value, ["schemaVersion", "protocol", "version", "previousSealSha256", "runId", "inferencePlanSha256", "r2TruthBindingSha256", "r2PartitionArtifactSha256", "sealedAnalysisBindingSha256", "baseAnalysisBindingSha256", "effectiveAdjudicationSha256", "adjudicationResolutionHeadSha256", "unmatchedRootLedgerSha256", "inference", "inferenceSource", "inferenceSourceTreeSha256", "sealedAt", "claims", "sealSha256"], label);
  if (root.schemaVersion !== 2 || root.protocol !== METHODOLOGY_INFERENCE_SEAL_V2_PROTOCOL || !Number.isSafeInteger(root.version) || Number(root.version) < 1) throw new Error(`${label} protocol/version is invalid`);
  for (const key of ["inferencePlanSha256", "r2TruthBindingSha256", "r2PartitionArtifactSha256", "sealedAnalysisBindingSha256", "baseAnalysisBindingSha256", "effectiveAdjudicationSha256", "unmatchedRootLedgerSha256", "inferenceSourceTreeSha256", "sealSha256"] as const) digest(root[key], `${label}.${key}`);
  if (root.previousSealSha256 !== null) digest(root.previousSealSha256, `${label}.previousSealSha256`);
  if (root.adjudicationResolutionHeadSha256 !== null) digest(root.adjudicationResolutionHeadSha256, `${label}.adjudicationResolutionHeadSha256`);
  timestamp(root.sealedAt, `${label}.sealedAt`);
  const inference = parseMethodologyInferenceArtifactV2(root.inference, `${label}.inference`);
  if (inference.runId !== root.runId || inference.planSha256 !== root.inferencePlanSha256 || inference.r2TruthBindingSha256 !== root.r2TruthBindingSha256) throw new Error(`${label}.inference bindings are invalid`);
  if (!Array.isArray(root.inferenceSource) || root.inferenceSource.length !== METHODOLOGY_INFERENCE_V2_SOURCE_PATHS.length) throw new Error(`${label}.inferenceSource is invalid`);
  const inferenceSource = root.inferenceSource.map((value, index) => {
    const item = exactObject(value, ["path", "bytes", "sha256"], `${label}.inferenceSource[${index}]`);
    if (item.path !== METHODOLOGY_INFERENCE_V2_SOURCE_PATHS[index] || !Number.isSafeInteger(item.bytes) || Number(item.bytes) < 0) throw new Error(`${label}.inferenceSource roster is invalid`);
    return { path: item.path, bytes: Number(item.bytes), sha256: digest(item.sha256, `${label}.inferenceSource[${index}].sha256`) } as SourceEntry;
  });
  if (root.inferenceSourceTreeSha256 !== canonicalJsonSha256(inferenceSource)) throw new Error(`${label}.inferenceSource tree is invalid`);
  const claims = exactObject(root.claims, ["sourceClosure", "duplicateFamilyBinding", "rootSeverityBinding", "reviewerAnswerExposure", "providerIdentity", "efficacy"], `${label}.claims`);
  if (claims.sourceClosure !== "fixed-explicit-source-list" || claims.duplicateFamilyBinding !== "authenticated-r2-truth-binding" || claims.rootSeverityBinding !== "authenticated-r2-truth-binding" || claims.reviewerAnswerExposure !== "none-from-operator-binding" || claims.providerIdentity !== "inherited-not-established" || claims.efficacy !== "not-decided") throw new Error(`${label}.claims are invalid`);
  const body = { ...root } as Record<string, unknown>;
  delete body.sealSha256;
  if (root.sealSha256 !== canonicalJsonSha256(body)) throw new Error(`${label}.sealSha256 is invalid`);
  return value as MethodologyInferenceSealV2;
}

function directory(rootValue: string, create: boolean): string {
  const root = realpathSync(resolve(rootValue));
  const path = join(root, METHODOLOGY_INFERENCE_SEAL_V2_DIRECTORY);
  if (!existsSync(path)) {
    if (!create) throw Object.assign(new Error("inference seal v2 directory is unavailable"), { code: "ENOENT" });
    mkdirSync(path, { mode: 0o700 });
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("inference seal v2 directory must be a direct directory");
  return path;
}

function inventory(rootValue: string): MethodologyInferenceSealV2[] {
  let path: string;
  try { path = directory(rootValue, false); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !/^methodology-inference-seal\.v\d{6}\.json$/.test(entry.name))) throw new Error("inference seal v2 directory contains unsupported entries");
  const seals = entries.map((entry) => parseMethodologyInferenceSealV2(readExperimentJson(join(path, entry.name))));
  seals.forEach((seal, index) => {
    if (seal.version !== index + 1 || seal.previousSealSha256 !== (index === 0 ? null : seals[index - 1]!.sealSha256) || entries[index]!.name !== `methodology-inference-seal.v${String(index + 1).padStart(6, "0")}.json`) throw new Error("inference seal v2 lineage is not contiguous");
    if (index > 0 && seal.sealedAt <= seals[index - 1]!.sealedAt) throw new Error("inference seal v2 timestamps must increase");
  });
  return seals;
}

function lock(rootValue: string): () => void {
  const path = join(realpathSync(resolve(rootValue)), ".methodology-inference-seal-v2.lock");
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("inference seal v2 storage is already being written"); throw error; }
  return () => { closeSync(descriptor); unlinkSync(path); };
}

export function writeMethodologyInferenceSealV2(analysisRoot: string, input: MethodologyInferenceSealV2Source & { sealedAt: string; expectedPreviousSealSha256: string | null }): MethodologyInferenceSealV2 {
  const release = lock(analysisRoot);
  try {
    const prior = inventory(analysisRoot).at(-1) ?? null;
    if (input.expectedPreviousSealSha256 !== (prior?.sealSha256 ?? null)) throw new Error("inference seal v2 predecessor is not the append-only head");
    if (prior && input.sealedAt <= prior.sealedAt) throw new Error("inference seal v2 timestamps must increase");
    const seal = buildSealV2(analysisRoot, input, input.sealedAt, (prior?.version ?? 0) + 1, prior?.sealSha256 ?? null);
    assertNoSecrets(seal, "methodology inference seal v2");
    const path = directory(analysisRoot, true);
    writeExclusiveJson(analysisRoot, join(path, `methodology-inference-seal.v${String(seal.version).padStart(6, "0")}.json`), seal);
    return seal;
  } finally { release(); }
}

export function readMethodologyInferenceSealV2(analysisRoot: string, input: MethodologyInferenceSealV2Source & { expectedSealSha256: string }): MethodologyInferenceSealV2 {
  const expected = digest(input.expectedSealSha256, "expectedSealSha256");
  const seals = inventory(analysisRoot);
  const found = seals.find((seal) => seal.sealSha256 === expected);
  if (!found) throw new Error("inference seal v2 digest mismatch");
  const rebuilt = buildSealV2(analysisRoot, input, found.sealedAt, found.version, found.previousSealSha256);
  if (canonicalJson(rebuilt) !== canonicalJson(found)) throw new Error("inference seal v2 differs from rederived evidence");
  assertNoSecrets(rebuilt, "methodology inference seal v2");
  return rebuilt;
}
