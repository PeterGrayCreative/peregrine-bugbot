import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { nonSensitiveEnvironment } from "../src/security/provider-env.js";
import type { HistoricalCaseSpec } from "../src/types.js";
import { exec } from "../src/util/exec.js";
import { directFile, fileSha256, parseCuratorPolicy, type CuratorPolicy } from "./case-curation.js";
import {
  leakagePolicyForCase,
  materializeCase,
  readSanitizedMetadata,
  type MaterializedCase,
} from "./case-isolation.js";
import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import {
  historicalTruthScopeSha256,
  readHistoricalCaseAdmission,
  type HistoricalCaseAdmission,
} from "./historical-curation.js";
import { HISTORICAL_EFFICACY_PROTOCOL, type HistoricalGroundTruth } from "./historical-truth.js";
import {
  createMethodologyAssetPreparer,
  readMethodologyAssetManifest,
  type MethodologyAssetManifest,
} from "./methodology-assets.js";
import type { MethodologyRawScope } from "./methodology-prompts.js";
import {
  METHODOLOGY_ARM_IDS,
  parseMethodologySchedule,
  type MethodologyArmId,
} from "./methodology-schedule.js";
import { loadCaseSpec } from "./run-matrix.js";

export const HISTORICAL_METHODOLOGY_CASE_PROTOCOL = "historical-methodology-case-v1" as const;
const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface HistoricalMethodologyCaseRegistration {
  schemaVersion: 1;
  protocol: typeof HISTORICAL_METHODOLOGY_CASE_PROTOCOL;
  /** Operational locator; case content and policy are independently hash-bound below. */
  caseDirectory: string;
  caseName: string;
  caseId: string;
  corpus: "development" | "validation";
  caseSpecSha256: string;
  curationSha256: string;
  caseBundleSha256: string;
  trustedPolicySha256: string;
  truth: {
    scopeSha256: string;
    truthVersion: string;
    status: "known-roots" | "reviewed-comparison";
    completeness: "partial";
    permittedMetrics: string[];
    /** Distinct causal roots (`rootCauseGroup ?? id`), not observation rows. */
    registeredRootCount: number;
  };
  source: {
    repositoryIdentitySha256: string;
    changeIdentitySha256: string;
    baseCommit: string;
    headCommit: string;
  };
  inputs: {
    diffFile: string;
    metadataFile: string;
    /** Frozen bytes only; contemporaneous source provenance remains an external curator gate. */
    metadataSha256: string;
    leakageExceptionsFile: string | null;
    leakageExceptionsSha256: string | null;
    taskSpecification: string;
    taskSpecificationSha256: string;
  };
  /** This registration intentionally carries no truth-derived lane selection. */
  activatedLanes: null;
  registrationSha256: string;
}

export interface HistoricalMethodologyAdmissionBinding {
  registrationSha256: string;
  caseBundleSha256: string;
  truthScopeSha256: string;
  sourceIdentitySha256: string;
  sourceBaseRef: string;
  sourceHeadRef: string;
  sourceMergeBase: string;
  sourceBaseTree: string;
  sourceHeadTree: string;
  materializedDiffSha256: string;
  /**
   * Verifies the declared curator bundle/policy and reproduced Git objects only.
   * Metadata provenance, curator independence, and schedule sealing remain external gates.
   */
  verificationBoundary: "declared-bundle-policy-and-materialized-source";
}

export interface MaterializedHistoricalMethodologyCase {
  registration: HistoricalMethodologyCaseRegistration;
  materialized: MaterializedCase;
  rawScope: MethodologyRawScope;
  assetsManifest: MethodologyAssetManifest;
  admissionBinding: HistoricalMethodologyAdmissionBinding;
  cleanup(): void;
}

type RunnableHistoricalCaseSpec = HistoricalCaseSpec & { corpus: "development" | "validation" };

export interface AuthenticatedHistoricalMethodologyCase {
  registration: HistoricalMethodologyCaseRegistration;
  truth: HistoricalGroundTruth;
}

export function readHistoricalMethodologyCase(
  caseDir: string,
  trustedPolicy: CuratorPolicy,
): HistoricalMethodologyCaseRegistration {
  return readHistoricalMethodologySnapshot(caseDir, trustedPolicy).registration;
}

/**
 * Detect changes across two complete authenticated reads and return the latter.
 * This is not a transactional filesystem snapshot: callers must keep the
 * trusted corpus store stable while evidence is registered and graded.
 */
export function readAuthenticatedHistoricalMethodologyCase(
  caseDir: string,
  trustedPolicy: CuratorPolicy,
): AuthenticatedHistoricalMethodologyCase {
  const before = readHistoricalMethodologySnapshot(caseDir, trustedPolicy);
  const after = readHistoricalMethodologySnapshot(caseDir, trustedPolicy);
  if (canonicalJson(before) !== canonicalJson(after)) {
    throw new Error("historical methodology case changed across authenticated reads");
  }
  return after;
}

function readHistoricalMethodologySnapshot(
  caseDir: string,
  trustedPolicy: CuratorPolicy,
): AuthenticatedHistoricalMethodologyCase {
  const caseDirectory = realpathSync(resolve(caseDir));
  const spec = historicalSpec(caseDirectory);
  const policy = parseCuratorPolicy(trustedPolicy, "historical methodology trusted policy");
  const admission = readHistoricalCaseAdmission(caseDirectory, spec, policy, { requireAdmitted: true });
  const leakagePolicy = leakagePolicyForCase(caseDirectory, spec);
  if (!spec.metadataFile) throw new Error(`${spec.id} historical methodology case requires authenticated metadata`);
  const metadata = readSanitizedMetadata(caseDirectory, spec, leakagePolicy);
  const taskSpecification = taskSpecificationFromMetadata(metadata, spec.id);
  const caseName = `${spec.corpus}/${spec.id}`;
  const body = {
    schemaVersion: 1 as const,
    protocol: HISTORICAL_METHODOLOGY_CASE_PROTOCOL,
    caseDirectory,
    caseName,
    caseId: spec.id,
    corpus: spec.corpus,
    caseSpecSha256: fileSha256(directFile(caseDirectory, "case.json", `${spec.id} case.json`)),
    curationSha256: fileSha256(directFile(caseDirectory, "curation.json", `${spec.id} curation.json`)),
    caseBundleSha256: admission.caseBundleSha256,
    trustedPolicySha256: canonicalJsonSha256(policy),
    truth: {
      scopeSha256: historicalTruthScopeSha256(admission.truth),
      truthVersion: admission.truth.scope.truthVersion,
      status: admission.truth.scope.status,
      completeness: "partial" as const,
      permittedMetrics: [...admission.truth.scope.permittedMetrics],
      registeredRootCount: registeredRootCount(admission),
    },
    source: {
      repositoryIdentitySha256: admission.curation.source.repositoryIdentitySha256,
      changeIdentitySha256: admission.curation.source.changeIdentitySha256,
      baseCommit: spec.baseCommit,
      headCommit: spec.headCommit,
    },
    inputs: {
      diffFile: spec.diffFile,
      metadataFile: spec.metadataFile,
      metadataSha256: fileSha256(directFile(caseDirectory, spec.metadataFile, `${spec.id} metadata`)),
      leakageExceptionsFile: spec.leakageExceptionsFile ?? null,
      leakageExceptionsSha256: spec.leakageExceptionsFile
        ? fileSha256(directFile(caseDirectory, spec.leakageExceptionsFile, `${spec.id} leakage exceptions`))
        : null,
      taskSpecification,
      taskSpecificationSha256: sha256(taskSpecification),
    },
    activatedLanes: null,
  };
  return {
    registration: { ...body, registrationSha256: registrationDigest(body) },
    truth: admission.truth,
  };
}

export async function materializeHistoricalMethodologyCase(
  registrationValue: unknown,
  scheduleValue: unknown,
  armIdValue: unknown,
  trustedPolicy: CuratorPolicy,
): Promise<MaterializedHistoricalMethodologyCase> {
  const registration = parseHistoricalMethodologyCaseRegistration(registrationValue);
  const armId = methodologyArmId(armIdValue);
  const before = readHistoricalMethodologyCase(registration.caseDirectory, trustedPolicy);
  assertSameRegistration(registration, before, "historical methodology registration is stale before materialization");
  const schedule = parseMethodologySchedule(scheduleValue);
  const descriptor = schedule.cases.find((item) => item.caseName === registration.caseName);
  if (!descriptor || descriptor.corpus !== registration.corpus ||
      descriptor.expectedBugCount !== registration.truth.registeredRootCount) {
    throw new Error("historical methodology case does not match its registered schedule descriptor");
  }
  if (!schedule.attempts.some((attempt) => attempt.caseName === registration.caseName && attempt.armId === armId)) {
    throw new Error("historical methodology arm is not scheduled for this case");
  }

  const spec = historicalSpec(registration.caseDirectory);
  const policy = leakagePolicyForCase(registration.caseDirectory, spec);
  const materialized = await materializeCase(registration.caseDirectory, spec, policy, {
    assetPreparer: createMethodologyAssetPreparer(armId),
  });
  try {
    const after = readHistoricalMethodologyCase(registration.caseDirectory, trustedPolicy);
    assertSameRegistration(registration, after, "historical methodology registration changed during materialization");
    const source = assertMaterializedHistoricalIdentity(materialized, registration);
    const rawChangedPaths = await changedPaths(materialized);
    const rawScope: MethodologyRawScope = {
      baseRef: materialized.baseRef,
      headRef: materialized.headRef,
      diff: materialized.diffText,
      taskSpecification: registration.inputs.taskSpecification,
      rawChangedPaths,
    };
    const assetsManifest = readMethodologyAssetManifest(
      materialized.evaluationIsolation.providerAssetsRoot,
      armId,
    );
    return {
      registration,
      materialized,
      rawScope,
      assetsManifest,
      admissionBinding: {
        registrationSha256: registration.registrationSha256,
        caseBundleSha256: registration.caseBundleSha256,
        truthScopeSha256: registration.truth.scopeSha256,
        sourceIdentitySha256: source.sourceIdentitySha256,
        sourceBaseRef: source.sourceBaseRef,
        sourceHeadRef: source.sourceHeadRef,
        sourceMergeBase: source.sourceMergeBase,
        sourceBaseTree: source.sourceBaseTree,
        sourceHeadTree: source.sourceHeadTree,
        materializedDiffSha256: materialized.materializedDiffSha256,
        verificationBoundary: "declared-bundle-policy-and-materialized-source",
      },
      cleanup: materialized.cleanup,
    };
  } catch (error) {
    materialized.cleanup();
    throw error;
  }
}

export function parseHistoricalMethodologyCaseRegistration(
  value: unknown,
): HistoricalMethodologyCaseRegistration {
  const root = exactObject(value, [
    "schemaVersion", "protocol", "caseDirectory", "caseName", "caseId", "corpus",
    "caseSpecSha256", "curationSha256", "caseBundleSha256", "trustedPolicySha256",
    "truth", "source", "inputs", "activatedLanes", "registrationSha256",
  ]);
  if (root.schemaVersion !== 1 || root.protocol !== HISTORICAL_METHODOLOGY_CASE_PROTOCOL ||
      typeof root.caseDirectory !== "string" || !root.caseDirectory || root.activatedLanes !== null) {
    throw new Error("historical methodology registration identity is invalid");
  }
  const truth = exactObject(root.truth, [
    "scopeSha256", "truthVersion", "status", "completeness", "permittedMetrics", "registeredRootCount",
  ]);
  const source = exactObject(root.source, [
    "repositoryIdentitySha256", "changeIdentitySha256", "baseCommit", "headCommit",
  ]);
  const inputs = exactObject(root.inputs, [
    "diffFile", "metadataFile", "metadataSha256", "leakageExceptionsFile",
    "leakageExceptionsSha256", "taskSpecification", "taskSpecificationSha256",
  ]);
  const parsed = root as unknown as HistoricalMethodologyCaseRegistration;
  if ((parsed.corpus !== "development" && parsed.corpus !== "validation") ||
      parsed.caseName !== `${parsed.corpus}/${parsed.caseId}` ||
      !/^case-[a-f0-9]{8,32}$/.test(parsed.caseId) ||
      !hashFields(parsed.caseSpecSha256, parsed.curationSha256, parsed.caseBundleSha256,
        parsed.trustedPolicySha256, truth.scopeSha256, source.repositoryIdentitySha256,
        source.changeIdentitySha256, inputs.metadataSha256, inputs.taskSpecificationSha256) ||
      !OBJECT_ID.test(String(source.baseCommit)) || !OBJECT_ID.test(String(source.headCommit)) ||
      source.baseCommit === source.headCommit || truth.completeness !== "partial" ||
      (truth.status !== "known-roots" && truth.status !== "reviewed-comparison") ||
      typeof truth.truthVersion !== "string" || !truth.truthVersion ||
      !Array.isArray(truth.permittedMetrics) || truth.permittedMetrics.some((item) => typeof item !== "string") ||
      !Number.isSafeInteger(truth.registeredRootCount) || Number(truth.registeredRootCount) < 0 ||
      (truth.status === "known-roots" && Number(truth.registeredRootCount) < 1) ||
      (truth.status === "reviewed-comparison" && truth.registeredRootCount !== 0) ||
      typeof inputs.diffFile !== "string" || typeof inputs.metadataFile !== "string" ||
      typeof inputs.taskSpecification !== "string" || !inputs.taskSpecification.trim() ||
      inputs.taskSpecificationSha256 !== sha256(inputs.taskSpecification as string) ||
      !optionalFileHashPair(inputs.leakageExceptionsFile, inputs.leakageExceptionsSha256)) {
    throw new Error("historical methodology registration content is invalid");
  }
  const { registrationSha256, ...body } = parsed;
  if (!SHA256.test(registrationSha256) || registrationSha256 !== registrationDigest(body)) {
    throw new Error("historical methodology registration digest is invalid");
  }
  return parsed;
}

function historicalSpec(caseDirectory: string): RunnableHistoricalCaseSpec {
  const spec = loadCaseSpec(caseDirectory);
  if (spec.kind !== "historical" || spec.evaluationProtocol !== HISTORICAL_EFFICACY_PROTOCOL ||
      spec.corpus === "structural-smoke") {
    throw new Error("historical methodology requires an opted-in historical efficacy case");
  }
  return spec as RunnableHistoricalCaseSpec;
}

function registeredRootCount(admission: HistoricalCaseAdmission): number {
  return new Set(admission.truth.bugs.map((bug) => bug.rootCauseGroup ?? bug.id)).size;
}

function taskSpecificationFromMetadata(
  metadata: ReturnType<typeof readSanitizedMetadata>,
  caseId: string,
): string {
  const parts = [
    metadata.title ? `Title: ${metadata.title}` : "",
    metadata.body ? `Description:\n${metadata.body}` : "",
  ].filter(Boolean);
  if (parts.length === 0) throw new Error(`${caseId} historical methodology metadata has no task specification`);
  return parts.join("\n\n");
}

function assertMaterializedHistoricalIdentity(
  materialized: MaterializedCase,
  registration: HistoricalMethodologyCaseRegistration,
): NonNullable<MaterializedCase["historyProvenance"]["historicalSource"]> {
  const history = materialized.historyProvenance;
  const source = history.historicalSource;
  if (history.materialization !== "historical-sanitized-export" || !source ||
      source.sourceIdentitySha256 !== registration.source.repositoryIdentitySha256 ||
      source.sourceBaseRef !== registration.source.baseCommit ||
      source.sourceHeadRef !== registration.source.headCommit ||
      source.sourceMergeBase !== registration.source.baseCommit ||
      !source.baseCommitIsMergeBase || !source.baseTreeMatches || !source.headTreeMatches ||
      !OBJECT_ID.test(source.sourceBaseTree) || !OBJECT_ID.test(source.sourceHeadTree) ||
      history.baseRef !== materialized.baseRef || history.headRef !== materialized.headRef ||
      history.mergeBase !== materialized.baseRef || !history.baseIsMergeBase ||
      !history.treeReproductionVerified || !history.checkedOutTreeMatchesHead ||
      materialized.materializedDiffSha256 !== registration.source.changeIdentitySha256 ||
      history.diffSha256 !== registration.source.changeIdentitySha256) {
    throw new Error("materialized historical source does not match its admitted registration");
  }
  return source;
}

async function changedPaths(materialized: MaterializedCase): Promise<string[]> {
  const environment = nonSensitiveEnvironment();
  for (const name of Object.keys(environment)) if (name.startsWith("GIT_")) delete environment[name];
  const result = await exec("git", [
    "diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--find-renames",
    `${materialized.baseRef}...${materialized.headRef}`, "--",
  ], {
    cwd: materialized.repoPath,
    timeoutMs: 30_000,
    env: {
      ...environment,
      HOME: materialized.evaluationIsolation.providerHome,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    inheritEnv: false,
  });
  if (result.timedOut || result.code !== 0) throw new Error("materialized historical changed paths are unavailable");
  const paths = result.stdout.split("\0").filter(Boolean).sort(compareText);
  if (paths.length === 0 || new Set(paths).size !== paths.length) {
    throw new Error("materialized historical changed paths are empty or duplicated");
  }
  return paths;
}

function methodologyArmId(value: unknown): MethodologyArmId {
  if (!METHODOLOGY_ARM_IDS.includes(value as MethodologyArmId)) throw new Error("historical methodology arm is invalid");
  return value as MethodologyArmId;
}

function assertSameRegistration(
  expected: HistoricalMethodologyCaseRegistration,
  actual: HistoricalMethodologyCaseRegistration,
  message: string,
): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) throw new Error(message);
}

function registrationDigest(value: object): string {
  return createHash("sha256")
    .update("peregrine-historical-methodology-case-registration-v1\0")
    .update(canonicalJson(value))
    .digest("hex");
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error("historical methodology registration has invalid fields");
  }
  return value as Record<string, unknown>;
}

function hashFields(...values: unknown[]): boolean {
  return values.every((value) => typeof value === "string" && SHA256.test(value));
}

function optionalFileHashPair(file: unknown, digest: unknown): boolean {
  return (file === null && digest === null) ||
    (typeof file === "string" && file.length > 0 && typeof digest === "string" && SHA256.test(digest));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
