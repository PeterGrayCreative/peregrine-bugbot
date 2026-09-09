import { fileURLToPath } from "node:url";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { sha256 } from "../src/core/telemetry.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import {
  readMethodologyAdjudicationArtifact,
  readMethodologyGradeSet,
} from "./methodology-analysis-artifacts.js";
import { readMethodologyAnalysisBinding } from "./methodology-analysis-binding.js";
import { CONTRAST_SOURCE_PATHS } from "./methodology-contrast-binding.js";
import {
  readMethodologyAdjudicationResolutionChain,
} from "./methodology-adjudication-resolution.js";
import {
  buildMethodologyInferenceArtifact,
  buildMethodologyInferencePlan,
  parseMethodologyInferenceArtifact,
  parseMethodologyInferencePlan,
  type BuildMethodologyInferencePlanInput,
  type MethodologyInferenceArtifact,
  type MethodologyInferencePlan,
} from "./methodology-inference.js";
import { readMethodologyInputPlan } from "./methodology-input-plan.js";
import { readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import { readMethodologyResourceSet } from "./methodology-resource-artifact.js";
import {
  readMethodologyUnmatchedRootLedger,
  readStoredMethodologyUnmatchedRootLedger,
} from "./methodology-unmatched-root-ledger.js";
import {
  readMethodologySealedAnalysisBinding,
  type MethodologySealedAnalysisBindingReadInputs,
} from "./methodology-sealed-analysis-binding.js";

export const METHODOLOGY_INFERENCE_PLAN_FILE = "methodology-inference-plan.json";
export const METHODOLOGY_INFERENCE_SEAL_FILE = "methodology-inference-seal.json";
export const METHODOLOGY_INFERENCE_SEALS_DIRECTORY = "methodology-inference-seals";
export const METHODOLOGY_INFERENCE_SEAL_PROTOCOL =
  "historical-methodology-inference-seal-v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const INFERENCE_SOURCE_PATHS = [...new Set([
  ...CONTRAST_SOURCE_PATHS,
  "eval/methodology-inference.ts",
  "eval/methodology-inference-seal.ts",
  "eval/methodology-adjudication-resolution.ts",
  "eval/methodology-unmatched-root-ledger.ts",
  "eval/methodology-sealed-analysis-binding.ts",
])].sort();

type SourceEntry = { path: string; bytes: number; sha256: string };

export interface MethodologyInferenceSeal {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_INFERENCE_SEAL_PROTOCOL;
  runId: string;
  inferencePlanSha256: string;
  sealedAnalysisBindingSha256: string;
  baseAnalysisBindingSha256: string;
  effectiveAdjudicationSha256: string;
  adjudicationResolutionHeadSha256: string | null;
  unmatchedRootLedgerSha256: string;
  inference: MethodologyInferenceArtifact;
  inferenceSource: SourceEntry[];
  inferenceSourceTreeSha256: string;
  sealedAt: string;
  claims: {
    sourceClosure: "fixed-explicit-source-list";
    duplicateFamilyBinding: "curator-supplied-not-authenticated";
    providerIdentity: "inherited-not-established";
    efficacy: "not-decided";
  };
  sealSha256: string;
  sealVersion?: number;
  previousSealSha256?: string | null;
  regrade?: {
    sealedGradeSetArtifactSha256: string;
    legacyGradeSetArtifactSha256: string;
    truthScopeSha256ByCase: Record<string, string>;
    adjudicationResolutionHeadSha256: string | null;
    unmatchedRootLedgerSha256: string;
  };
}

export interface MethodologyInferenceSealSource {
  sealedAnalysis: MethodologySealedAnalysisBindingReadInputs;
  expectedInferencePlanSha256: string;
  expectedAdjudicationResolutionHeadSha256: string | null;
  expectedUnmatchedRootLedgerSha256: string;
}

/** Persist the preregistered estimator before provider work starts. */
export function writeMethodologyInferencePlan(
  root: string,
  input: BuildMethodologyInferencePlanInput,
): MethodologyInferencePlan {
  if (!input.invocationRegistrationSha256 || !input.inputPlanSha256 || !input.executionRoot) {
    throw new Error("methodology inference plan requires invocation registration, input-plan, and execution-root preregistration bindings");
  }
  const registration = readMethodologyInvocationRegistration(input.executionRoot, input.invocationRegistrationSha256);
  const inputPlan = readMethodologyInputPlan(input.executionRoot, input.invocationRegistrationSha256, input.inputPlanSha256);
  if (registration.runId !== input.runId || canonicalJsonSha256(registration.schedule) !==
      canonicalJsonSha256(input.schedule ?? registration.schedule) || inputPlan.invocationRegistrationSha256 !==
      input.invocationRegistrationSha256) {
    throw new Error("methodology inference plan preregistration does not match invocation registration/input plan");
  }
  assertNoBegunInferenceWork(input.executionRoot);
  const registeredScheduleSha256 = canonicalJsonSha256(registration.schedule);
  if (input.scheduleSha256 !== undefined && input.scheduleSha256 !== registeredScheduleSha256) {
    throw new Error("methodology inference plan scheduleSha256 does not match invocation registration");
  }
  const plan = buildMethodologyInferencePlan({
    ...input,
    schedule: registration.schedule,
    scheduleSha256: undefined,
    invocationRegistrationSha256: input.invocationRegistrationSha256,
    inputPlanSha256: input.inputPlanSha256,
  });
  assertNoSecrets(plan, "methodology inference plan");
  assertNoBegunInferenceWork(input.executionRoot);
  writeExclusiveJson(root, join(resolve(root), METHODOLOGY_INFERENCE_PLAN_FILE), plan);
  return plan;
}

export function readMethodologyInferencePlan(
  root: string,
  expectedPlanSha256: string,
): MethodologyInferencePlan {
  digest(expectedPlanSha256, "expectedPlanSha256");
  const path = safeStoredFile(root, METHODOLOGY_INFERENCE_PLAN_FILE);
  const plan = parseMethodologyInferencePlan(readExperimentJson(path), path);
  if (plan.planSha256 !== expectedPlanSha256) {
    throw new Error("methodology inference plan digest mismatch");
  }
  assertNoSecrets(plan, "methodology inference plan");
  return plan;
}

/**
 * Bind the estimator output to the source-authenticated semantic analysis.
 * The nested inference is always rebuilt from those sealed artifacts.
 */
export function writeMethodologyInferenceSeal(
  analysisRoot: string,
  input: MethodologyInferenceSealSource & {
    sealedAt: string;
    /** Required optimistic-concurrency guard for the append-only decision chain. */
    expectedPreviousSealSha256: string | null;
  },
): MethodologyInferenceSeal {
  const storage = inspectSealStorage(analysisRoot);
  if (storage.legacyPath !== null) {
    throw new Error("cannot create a versioned methodology inference seal chain while legacy seal storage exists");
  }
  const seals = readVersionedSealInventory(analysisRoot);
  validateStoredSealChain(analysisRoot, seals, input.sealedAnalysis);
  const head = seals.at(-1) ?? null;
  const expectedPrevious = input.expectedPreviousSealSha256 === null
    ? null
    : digest(input.expectedPreviousSealSha256, "expectedPreviousSealSha256");
  if (expectedPrevious !== head?.sealSha256 && !(expectedPrevious === null && head === null)) {
    throw new Error("methodology inference seal predecessor is not the current append-only head");
  }
  const sealedAt = timestamp(input.sealedAt, "sealedAt");
  if (head !== null && sealedAt <= head.sealedAt) {
    throw new Error("methodology inference seal timestamps must increase with sequence");
  }
  const seal = buildSeal(analysisRoot, input, sealedAt, (head?.sealVersion ?? 0) + 1, expectedPrevious);
  assertNoSecrets(seal, "methodology inference seal");
  if (seal.sealVersion === undefined) throw new Error("versioned inference seal is missing its version");
  mkdirSync(join(resolve(analysisRoot), METHODOLOGY_INFERENCE_SEALS_DIRECTORY), { recursive: true, mode: 0o700 });
  safeSealsDirectory(analysisRoot);
  writeExclusiveJson(analysisRoot, join(resolve(analysisRoot), METHODOLOGY_INFERENCE_SEALS_DIRECTORY,
    sealFilename(seal.sealVersion)), seal);
  return seal;
}

export function readMethodologyInferenceSeal(
  analysisRoot: string,
  input: MethodologyInferenceSealSource & { expectedSealSha256: string },
): MethodologyInferenceSeal {
  digest(input.expectedSealSha256, "expectedSealSha256");
  const located = locateSeal(analysisRoot, input.expectedSealSha256);
  const path = located.path;
  const raw = located.seal;
  if (raw.sealSha256 !== input.expectedSealSha256) {
    throw new Error("methodology inference seal digest mismatch");
  }
  if (raw.sealVersion === undefined || raw.previousSealSha256 === undefined) {
    const rebuiltLegacy = buildLegacySeal(analysisRoot, input, raw.sealedAt);
    if (canonicalJson(raw) !== canonicalJson(rebuiltLegacy)) throw new Error("legacy methodology inference seal differs from rederived evidence");
    assertNoSecrets(rebuiltLegacy, "legacy methodology inference seal");
    return rebuiltLegacy;
  }
  const inventory = readVersionedSealInventory(analysisRoot);
  validateStoredSealChain(analysisRoot, inventory, input.sealedAnalysis);
  const rebuilt = buildSeal(analysisRoot, input, raw.sealedAt, raw.sealVersion, raw.previousSealSha256);
  if (canonicalJson(raw) !== canonicalJson(rebuilt)) {
    throw new Error("methodology inference seal differs from rederived evidence");
  }
  assertNoSecrets(rebuilt, "methodology inference seal");
  return rebuilt;
}

function buildSeal(
  analysisRoot: string,
  input: MethodologyInferenceSealSource,
  sealedAtValue: unknown,
  sealVersion: number,
  previousSealSha256: string | null,
  forceDuplicateFamilyBlock = true,
): MethodologyInferenceSeal {
  const root = realpathSync(resolve(analysisRoot));
  const plan = readMethodologyInferencePlan(root, input.expectedInferencePlanSha256);
  const sealedAnalysis = readMethodologySealedAnalysisBinding(root, input.sealedAnalysis);
  const baseAnalysis = readMethodologyAnalysisBinding(
    root,
    sealedAnalysis.baseAnalysisBindingSha256,
  );
  const gradeSet = readMethodologyGradeSet(root, sealedAnalysis.legacyGradeSetArtifactSha256);
  const inputPlan = readMethodologyInputPlan(
    input.sealedAnalysis.executionRoot,
    sealedAnalysis.invocationRegistrationSha256,
    sealedAnalysis.inputPlanSha256,
  );
  if ((plan.invocationRegistrationSha256 !== undefined || plan.inputPlanSha256 !== undefined) &&
      (plan.invocationRegistrationSha256 !== sealedAnalysis.invocationRegistrationSha256 ||
       plan.inputPlanSha256 !== sealedAnalysis.inputPlanSha256)) {
    throw new Error("methodology inference plan is not preregistered against the sealed invocation/input evidence");
  }
  const adjudication = readMethodologyAdjudicationArtifact(root, {
    expectedLedgerSha256: baseAnalysis.adjudicationLedgerSha256,
    gradeSet,
  });
  const resourceSet = readMethodologyResourceSet(root, {
    expectedArtifactSha256: baseAnalysis.resourceSetArtifactSha256,
    schedule: gradeSet.schedule,
  });
  const adjudicationResolution = readMethodologyAdjudicationResolutionChain(root, {
    baseLedger: adjudication,
    gradeSet,
    expectedHeadResolutionSha256: input.expectedAdjudicationResolutionHeadSha256,
    allowHistoricalHead: true,
  });
  const storedUnmatchedRoots = readStoredMethodologyUnmatchedRootLedger(
    root,
    input.expectedUnmatchedRootLedgerSha256,
  );
  const unmatchedRootLedger = readMethodologyUnmatchedRootLedger(
    root,
    input.expectedUnmatchedRootLedgerSha256,
    {
      runId: plan.runId,
      schedule: gradeSet.schedule,
      gradeSet,
      effectiveAdjudication: adjudicationResolution.effective,
      assignments: storedUnmatchedRoots.roots.flatMap((rootGroup) => rootGroup.occurrences.map((occurrence) => ({
        attemptId: occurrence.attemptId,
        findingIndex: occurrence.findingIndex,
        findingEvidenceSha256: occurrence.findingEvidenceSha256,
        rootIdentitySha256: rootGroup.rootIdentitySha256,
      }))),
      roots: storedUnmatchedRoots.roots.map((rootGroup) => ({
        rootIdentitySha256: rootGroup.rootIdentitySha256,
        reviewerIdentitySha256s: rootGroup.reviewerIdentitySha256s,
        reviewerIndependence: rootGroup.reviewerIndependence,
        source: rootGroup.source,
        evidence: rootGroup.evidence,
        rationale: rootGroup.rationale,
      })),
      recordedAt: storedUnmatchedRoots.recordedAt,
      baseLedgerSha256: adjudication.ledgerSha256,
      effectiveAdjudicationSha256: adjudicationResolution.effective.effectiveSha256,
      headResolutionSha256: adjudicationResolution.headResolutionSha256,
      gradeSetSha256: gradeSet.gradeSetSha256,
      scheduleSha256: canonicalJsonSha256(gradeSet.schedule),
    },
  );
  const gradesByAttempt = new Map(gradeSet.grades.map((grade) => [grade.projection.attemptId, grade]));
  for (const resolution of adjudicationResolution.resolutions) {
    const grade = gradesByAttempt.get(resolution.occurrence.attemptId);
    if (!grade || grade.metricEligibility.truthVersion !== resolution.truthVersion) {
      throw new Error("methodology adjudication resolution truth version does not match its authenticated grade");
    }
  }
  if (sealedAnalysis.baseAnalysisBindingSha256 !== baseAnalysis.bindingSha256 ||
      sealedAnalysis.legacyGradeSetArtifactSha256 !== gradeSet.artifactSha256 ||
      sealedAnalysis.runId !== gradeSet.runId ||
      sealedAnalysis.scheduleSha256 !== canonicalJsonSha256(gradeSet.schedule) ||
      baseAnalysis.gradeSetArtifactSha256 !== gradeSet.artifactSha256 ||
      baseAnalysis.adjudicationLedgerSha256 !== adjudication.ledgerSha256 ||
      baseAnalysis.resourceSetArtifactSha256 !== resourceSet.artifactSha256 ||
      plan.runId !== sealedAnalysis.runId ||
      plan.scheduleSha256 !== sealedAnalysis.scheduleSha256) {
    throw new Error("methodology inference source artifacts do not form one bound run");
  }
  for (const cluster of plan.caseClusters) {
    const registered = inputPlan.cases.find((item) => item.caseName === cluster.caseName);
    if (!registered || registered.historicalRegistration.source.repositoryIdentitySha256 !==
      cluster.repositoryFamilySha256) {
      throw new Error(`methodology inference repository family is not bound to ${cluster.caseName}`);
    }
  }
  const derivedInference = buildMethodologyInferenceArtifact({
    plan,
    schedule: gradeSet.schedule,
    gradeSet,
    adjudication,
    effectiveAdjudication: adjudicationResolution.effective,
    unmatchedRootLedger,
    resourceSet,
  });
  // Duplicate-family IDs currently have no authenticated curation artifact in
  // the input-plan protocol. Keep the descriptive artifact, but make every
  // inferential seal explicitly blocked until that evidence is added.
  const inference = forceDuplicateFamilyBlock
    ? blockUnauthenticatedDuplicateFamilies(derivedInference)
    : derivedInference;
  const inferenceSource = sourceManifest(input.sealedAnalysis.repositoryRoot);
  const truthScopeSha256ByCase = Object.fromEntries(inputPlan.cases.map((item) => [
    item.caseName, item.historicalRegistration.truth.scopeSha256,
  ]));
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_INFERENCE_SEAL_PROTOCOL,
    runId: plan.runId,
    inferencePlanSha256: plan.planSha256,
    sealedAnalysisBindingSha256: sealedAnalysis.bindingSha256,
    baseAnalysisBindingSha256: baseAnalysis.bindingSha256,
    effectiveAdjudicationSha256: adjudicationResolution.effective.effectiveSha256,
    adjudicationResolutionHeadSha256: adjudicationResolution.headResolutionSha256,
    unmatchedRootLedgerSha256: unmatchedRootLedger.artifactSha256,
    inference,
    inferenceSource,
    inferenceSourceTreeSha256: canonicalJsonSha256(inferenceSource),
    sealedAt: timestamp(sealedAtValue, "sealedAt"),
    claims: {
      sourceClosure: "fixed-explicit-source-list" as const,
      duplicateFamilyBinding: "curator-supplied-not-authenticated" as const,
      providerIdentity: "inherited-not-established" as const,
      efficacy: "not-decided" as const,
    },
    sealVersion: positiveInteger(sealVersion, "sealVersion"),
    previousSealSha256: previousSealSha256 === null ? null : digest(previousSealSha256, "previousSealSha256"),
    regrade: {
      sealedGradeSetArtifactSha256: sealedAnalysis.sealedGradeSetArtifactSha256,
      legacyGradeSetArtifactSha256: sealedAnalysis.legacyGradeSetArtifactSha256,
      truthScopeSha256ByCase,
      adjudicationResolutionHeadSha256: adjudicationResolution.headResolutionSha256,
      unmatchedRootLedgerSha256: unmatchedRootLedger.artifactSha256,
    },
  };
  return { ...body, sealSha256: canonicalJsonSha256(body) };
}

function parseSeal(value: unknown, source: string): MethodologyInferenceSeal {
  const root = exactObject(value, [
    "schemaVersion", "protocol", "runId", "inferencePlanSha256",
    "sealedAnalysisBindingSha256", "baseAnalysisBindingSha256", "effectiveAdjudicationSha256",
    "adjudicationResolutionHeadSha256", "unmatchedRootLedgerSha256", "inference",
    "inferenceSource", "inferenceSourceTreeSha256", "sealedAt", "claims", "sealSha256",
  ], source, ["sealVersion", "previousSealSha256", "regrade"]);
  if (root.schemaVersion !== 1 || root.protocol !== METHODOLOGY_INFERENCE_SEAL_PROTOCOL) {
    throw new Error(`${source} protocol/version is invalid`);
  }
  const runId = runIdValue(root.runId, `${source}.runId`);
  for (const key of [
    "inferencePlanSha256", "sealedAnalysisBindingSha256", "baseAnalysisBindingSha256", "effectiveAdjudicationSha256", "unmatchedRootLedgerSha256",
    "inferenceSourceTreeSha256", "sealSha256",
  ]) digest(root[key], `${source}.${key}`);
  if (root.adjudicationResolutionHeadSha256 !== null) {
    digest(root.adjudicationResolutionHeadSha256, `${source}.adjudicationResolutionHeadSha256`);
  }
  if (root.sealVersion !== undefined || root.previousSealSha256 !== undefined || root.regrade !== undefined) {
    const sealVersion = positiveInteger(root.sealVersion, `${source}.sealVersion`);
    const previousSealSha256 = root.previousSealSha256 === null ? null : digest(root.previousSealSha256, `${source}.previousSealSha256`);
    if (sealVersion === 1 && previousSealSha256 !== null) throw new Error(`${source}.first seal cannot have a predecessor`);
    const regrade = exactObject(root.regrade, [
      "sealedGradeSetArtifactSha256", "legacyGradeSetArtifactSha256", "truthScopeSha256ByCase",
      "adjudicationResolutionHeadSha256", "unmatchedRootLedgerSha256",
    ], `${source}.regrade`);
    digest(regrade.sealedGradeSetArtifactSha256, `${source}.regrade.sealedGradeSetArtifactSha256`);
    digest(regrade.legacyGradeSetArtifactSha256, `${source}.regrade.legacyGradeSetArtifactSha256`);
    digest(regrade.unmatchedRootLedgerSha256, `${source}.regrade.unmatchedRootLedgerSha256`);
    if (regrade.adjudicationResolutionHeadSha256 !== null) digest(regrade.adjudicationResolutionHeadSha256, `${source}.regrade.adjudicationResolutionHeadSha256`);
    if (!regrade.truthScopeSha256ByCase || typeof regrade.truthScopeSha256ByCase !== "object" || Array.isArray(regrade.truthScopeSha256ByCase)) throw new Error(`${source}.regrade.truthScopeSha256ByCase is invalid`);
    for (const [caseName, truth] of Object.entries(regrade.truthScopeSha256ByCase)) { if (!CASE_NAME.test(caseName)) throw new Error(`${source}.regrade truth case is invalid`); digest(truth, `${source}.regrade.truthScopeSha256ByCase.${caseName}`); }
  }
  timestamp(root.sealedAt, `${source}.sealedAt`);
  const claims = exactObject(root.claims, ["sourceClosure", "duplicateFamilyBinding", "providerIdentity", "efficacy"], `${source}.claims`);
  if (claims.sourceClosure !== "fixed-explicit-source-list" ||
      claims.duplicateFamilyBinding !== "curator-supplied-not-authenticated" ||
      claims.providerIdentity !== "inherited-not-established" || claims.efficacy !== "not-decided") {
    throw new Error(`${source}.claims are invalid`);
  }
  if (!Array.isArray(root.inferenceSource) || root.inferenceSource.length === 0) {
    throw new Error(`${source}.inferenceSource is invalid`);
  }
  const inference = parseMethodologyInferenceArtifact(root.inference, `${source}.inference`);
  if (inference.runId !== runId || inference.planSha256 !== root.inferencePlanSha256 ||
      inference.upstream.effectiveAdjudicationSha256 !== root.effectiveAdjudicationSha256 ||
      inference.upstream.unmatchedRootLedgerSha256 !== root.unmatchedRootLedgerSha256) {
    throw new Error(`${source}.inference bindings are invalid`);
  }
  const inferenceSource = root.inferenceSource.map((value: unknown, index: number) => {
    const entry = exactObject(value, ["path", "bytes", "sha256"], `${source}.inferenceSource[${index}]`);
    if (entry.path !== INFERENCE_SOURCE_PATHS[index]) {
      throw new Error(`${source}.inferenceSource path roster is invalid`);
    }
    return {
      path: entry.path as string,
      bytes: nonnegativeInteger(entry.bytes, `${source}.inferenceSource[${index}].bytes`),
      sha256: digest(entry.sha256, `${source}.inferenceSource[${index}].sha256`),
    };
  });
  if (inferenceSource.length !== INFERENCE_SOURCE_PATHS.length ||
      root.inferenceSourceTreeSha256 !== canonicalJsonSha256(inferenceSource)) {
    throw new Error(`${source}.inferenceSource tree is invalid`);
  }
  const { sealSha256, ...body } = root;
  if (sealSha256 !== canonicalJsonSha256(body)) throw new Error(`${source}.sealSha256 is invalid`);
  return value as MethodologyInferenceSeal;
}

function buildLegacySeal(
  analysisRoot: string,
  input: MethodologyInferenceSealSource,
  sealedAt: string,
): MethodologyInferenceSeal {
  const versioned = buildSeal(analysisRoot, input, sealedAt, 1, null, false);
  const { sealVersion: _version, previousSealSha256: _previous, regrade: _regrade, sealSha256: _seal, ...body } = versioned;
  return { ...body, sealSha256: canonicalJsonSha256(body) };
}

function blockUnauthenticatedDuplicateFamilies(
  inference: MethodologyInferenceSeal["inference"],
): MethodologyInferenceSeal["inference"] {
  const { inferenceSha256: _priorInferenceSha256, ...authenticated } = inference;
  const blockers = [...inference.blockers];
  if (!blockers.some((item) => item.includes("duplicate-family"))) {
    blockers.push("duplicate-family assignments are not bound to an authenticated curation/input artifact");
  }
  const metrics = Object.fromEntries(Object.entries(inference.metrics).map(([name, metric]) => [name, {
    ...metric,
    interval95: null,
    reason: metric.reason === "none"
      ? "unauthenticated-duplicate-families" as const
      : metric.reason,
  }])) as MethodologyInferenceSeal["inference"]["metrics"];
  const body = { ...authenticated, status: "blocked" as const, blockers, metrics };
  return { ...body, inferenceSha256: canonicalJsonSha256(body) };
}

function sourceManifest(repositoryRoot: string): SourceEntry[] {
  const root = realpathSync(resolve(repositoryRoot));
  const loaded = realpathSync(fileURLToPath(import.meta.url));
  const expected = realpathSync(join(root, "eval/methodology-inference-seal.ts"));
  if (loaded !== expected || relative(root, loaded).startsWith("..")) {
    throw new Error("methodology inference seal is not loaded from repositoryRoot");
  }
  return INFERENCE_SOURCE_PATHS.map((path) => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`methodology inference source is unsafe: ${path}`);
    }
    const bytes = readFileSync(absolute);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function assertNoBegunInferenceWork(executionRootValue: string): void {
  const root = realpathSync(resolve(executionRootValue));
  const forbidden = /(?:^|\/)(?:attempt-[0-9]{6}(?:\.|\/)|methodology-(?:execution-evidence|run-|stopped-run-closure))/;
  const visit = (directory: string, prefix = ""): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error("methodology inference preregistration evidence tree must not contain symlinks");
      if (entry.isDirectory()) visit(join(directory, entry.name), relativePath);
      else if (!entry.isFile()) throw new Error("methodology inference preregistration evidence tree contains an unsupported entry");
      else if (forbidden.test(relativePath)) throw new Error("methodology inference plan cannot be registered after methodology work has begun; existing work evidence is present");
    }
  };
  visit(root);
}

function sealFilename(version: number): string {
  return "methodology-inference-seal.v" + String(version).padStart(6, "0") + ".json";
}

function readVersionedSealInventory(rootValue: string): MethodologyInferenceSeal[] {
  const root = realpathSync(resolve(rootValue));
  const storage = inspectSealStorage(root);
  const directory = storage.versionedDirectory;
  if (directory === null) return [];
  const numbered = readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error("methodology inference seal directory contains a non-regular entry");
    }
    const match = /^methodology-inference-seal\.v([0-9]{6})\.json$/.exec(entry.name);
    if (!match) throw new Error("methodology inference seal directory contains an unsupported file");
    return { name: entry.name, version: Number(match[1]) };
  }).sort((left, right) => left.version - right.version);
  const seals = numbered.map((entry, index) => {
    if (entry.version !== index + 1) throw new Error("methodology inference seal versions must be contiguous");
    const path = join(METHODOLOGY_INFERENCE_SEALS_DIRECTORY, entry.name);
    const seal = parseSeal(readExperimentJson(safeStoredFile(root, path)), path);
    if (seal.sealVersion !== entry.version) throw new Error("methodology inference seal filename/version mismatch");
    return seal;
  });
  for (let index = 0; index < seals.length; index += 1) {
    const seal = seals[index]!;
    const previous = index === 0 ? null : seals[index - 1]!.sealSha256;
    if (seal.previousSealSha256 !== previous) throw new Error("methodology inference seal lineage is not contiguous");
    if (index > 0 && seal.sealedAt <= seals[index - 1]!.sealedAt) {
      throw new Error("methodology inference seal timestamps must increase with sequence");
    }
  }
  return seals;
}

function locateSeal(rootValue: string, expectedSealSha256: string): { path: string; seal: MethodologyInferenceSeal } {
  const root = realpathSync(resolve(rootValue));
  const storage = inspectSealStorage(root);
  for (const seal of readVersionedSealInventory(root)) {
    if (seal.sealSha256 === expectedSealSha256) {
      return {
        path: safeStoredFile(
          root,
          join(METHODOLOGY_INFERENCE_SEALS_DIRECTORY, sealFilename(seal.sealVersion!)),
        ),
        seal,
      };
    }
  }
  const legacy = storage.legacyPath;
  if (legacy) {
    const seal = parseSeal(readExperimentJson(legacy), legacy);
    if (seal.sealSha256 === expectedSealSha256) return { path: legacy, seal };
  }
  throw new Error("methodology inference seal digest mismatch: digest does not identify a stored version");
}

type SealStorage = {
  legacyPath: string | null;
  versionedDirectory: string | null;
};

/**
 * A run has one seal storage format. A legacy file and a versioned directory
 * are separate histories, so accepting both would make reads ambiguous.
 */
function inspectSealStorage(rootValue: string): SealStorage {
  const root = realpathSync(resolve(rootValue));
  const legacyPath = safeStoredFileIfPresent(root, METHODOLOGY_INFERENCE_SEAL_FILE);
  const versionedDirectory = safeSealsDirectoryIfPresent(root);
  if (legacyPath !== null && versionedDirectory !== null) {
    throw new Error("methodology inference seal storage cannot mix legacy seal file and versioned seal directory");
  }
  return { legacyPath, versionedDirectory };
}

function validateStoredSealChain(
  analysisRoot: string,
  seals: readonly MethodologyInferenceSeal[],
  sealedAnalysis: MethodologySealedAnalysisBindingReadInputs,
): void {
  for (const seal of seals) {
    if (seal.sealVersion === undefined || seal.previousSealSha256 === undefined ||
        seal.sealedAnalysisBindingSha256 !== sealedAnalysis.expectedBindingSha256) {
      throw new Error("methodology inference seal chain does not share one authenticated analysis binding");
    }
    const rebuilt = buildSeal(analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: seal.inferencePlanSha256,
      expectedAdjudicationResolutionHeadSha256: seal.adjudicationResolutionHeadSha256,
      expectedUnmatchedRootLedgerSha256: seal.unmatchedRootLedgerSha256,
    }, seal.sealedAt, seal.sealVersion, seal.previousSealSha256);
    if (canonicalJson(rebuilt) !== canonicalJson(seal)) {
      throw new Error("methodology inference seal chain contains evidence that does not rederive");
    }
  }
}

function safeStoredFileIfPresent(rootValue: string, file: string): string | null {
  try { return safeStoredFile(rootValue, file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function safeSealsDirectory(rootValue: string): string {
  const root = realpathSync(resolve(rootValue));
  const path = join(root, METHODOLOGY_INFERENCE_SEALS_DIRECTORY);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("methodology inference seal directory must be a regular non-symlink directory");
  return path;
}

function safeSealsDirectoryIfPresent(rootValue: string): string | null {
  try { return safeSealsDirectory(rootValue); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function safeStoredFile(rootValue: string, file: string): string {
  const root = realpathSync(resolve(rootValue));
  const path = join(root, file);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${file} must be a regular non-symlink file`);
  return path;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(label + " must be a positive integer");
  return Number(value);
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(label + " must be a non-negative integer");
  return Number(value);
}

function runIdValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp`);
  }
  return value;
}

function exactObject(value: unknown, keys: readonly string[], source: string, optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const object = value as Record<string, any>;
  const actual = Object.keys(object).sort();
  const expected = [...keys, ...actual.filter((key) => optional.includes(key))].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${source} has an invalid shape`);
  }
  return object;
}
