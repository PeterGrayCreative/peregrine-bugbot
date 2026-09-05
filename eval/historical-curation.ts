import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { CORE_LANE_IDS, isCoreLaneId, type CoreLaneId } from "../src/core/lanes.js";
import type { HistoricalCaseSpec } from "../src/types.js";
import {
  directFile,
  diffSizeStratum,
  fileSha256,
  LARGE_DIFF_MIN_LINES,
  parseCuratorPolicy,
  type ArchitectureFamily,
  type ChangeShape,
  type CuratorPolicy,
} from "./case-curation.js";
import {
  HISTORICAL_EFFICACY_PROTOCOL,
  parseHistoricalGroundTruth,
  type HistoricalGroundTruth,
  type HistoricalTruthStatus,
} from "./historical-truth.js";

const SHA256 = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[^\0]+$/;
const ARCHITECTURE_FAMILIES = [
  "backend-service", "cli-tool", "data-pipeline", "frontend-application",
  "infrastructure", "library", "worker-service",
] as const satisfies readonly ArchitectureFamily[];
const CHANGE_SHAPES = ["direct", "large-diff", "multi-observation", "seam"] as const satisfies readonly ChangeShape[];
const SOURCE_ACCESS = ["curator-local-private", "public", "sanitized-private"] as const;
const PROOF_KINDS = ["reasoned-analysis", "regression-test", "reproduction", "reviewed-comparison-analysis"] as const;
const KNOWN_ROOT_CHECKS = [
  "source-authenticity",
  "revision-identity",
  "diff-identity",
  "proof-integrity",
  "truth-status",
  "truth-scope",
  "partial-truth",
  "root-evidence",
] as const;
const COMPARISON_CHECKS = [
  "source-authenticity",
  "revision-identity",
  "diff-identity",
  "proof-integrity",
  "truth-status",
  "truth-scope",
  "partial-truth",
  "reviewed-comparison-scope",
] as const;

type HistoricalConfirmationCheck =
  | (typeof KNOWN_ROOT_CHECKS)[number]
  | (typeof COMPARISON_CHECKS)[number];

export interface HistoricalCuration {
  schemaVersion: 2;
  protocol: typeof HISTORICAL_EFFICACY_PROTOCOL;
  caseId: string;
  status: "draft" | "admitted";
  curatorPolicyId: "protected-git-review-v1";
  truth: {
    truthVersion: string;
    status: HistoricalTruthStatus;
    completeness: "partial";
    scopeSha256: string;
  };
  source: {
    kind: "historical";
    repositoryAlias: string;
    repositoryIdentitySha256: string;
    changeIdentitySha256: string;
    access: (typeof SOURCE_ACCESS)[number];
  };
  strata: {
    languageFamily: "javascript" | "typescript";
    architectureFamily: ArchitectureFamily;
    size: "small" | "medium" | "large";
    changeShapes: ChangeShape[];
    secondarySurfaceLanes: CoreLaneId[];
    mechanismFamilies: string[];
  };
  proof: {
    kind: (typeof PROOF_KINDS)[number];
    artifact: string;
    sha256: string;
  };
  confirmations: Array<{
    curatorIdentitySha256: string;
    confirmedAt: string;
    caseBundleSha256: string;
    truthScopeSha256: string;
    checks: HistoricalConfirmationCheck[];
  }>;
}

export interface HistoricalCaseAdmission {
  truth: HistoricalGroundTruth;
  curation: HistoricalCuration;
  /** Bundle derived with the digest of the exact bytes parsed into `truth`. */
  caseBundleSha256: string;
  diffLines: number;
  /** Declared identities and caller-supplied roster were verified; source reconstruction and human independence remain external gates. */
  verificationBoundary: "declared-bundle-and-policy-only";
}

export function historicalTruthScopeSha256(truth: HistoricalGroundTruth): string {
  return createHash("sha256")
    .update("peregrine-historical-truth-scope-v1\0")
    .update(JSON.stringify(truth.scope))
    .digest("hex");
}

export function requiredHistoricalConfirmationChecks(
  status: HistoricalTruthStatus,
): readonly HistoricalConfirmationCheck[] {
  return status === "known-roots" ? KNOWN_ROOT_CHECKS : COMPARISON_CHECKS;
}

export function readHistoricalCaseAdmission(
  caseDir: string,
  spec: HistoricalCaseSpec,
  trustedPolicy: CuratorPolicy,
  options: { requireAdmitted?: boolean } = {},
): HistoricalCaseAdmission {
  if (spec.evaluationProtocol !== HISTORICAL_EFFICACY_PROTOCOL) {
    throw new Error(`${spec.id} is not opted into ${HISTORICAL_EFFICACY_PROTOCOL}`);
  }
  if (spec.corpus === "structural-smoke") throw new Error(`${spec.id} is not a historical efficacy case`);
  const policy = parseCuratorPolicy(trustedPolicy, "caller-supplied curator policy");
  const caseRoot = realpathSync(resolve(caseDir));
  const caseJsonPath = directFile(caseRoot, "case.json", `${spec.id} case.json`);
  const rawCase = readJson(caseJsonPath, `${spec.id} case.json`);
  assertCaseSpecMatches(rawCase, spec);
  const truthPath = directFile(caseRoot, "ground_truth.json", `${spec.id} ground_truth.json`);
  const truthBytes = readFileSync(truthPath);
  const truth = parseHistoricalGroundTruth(
    parseJsonBytes(truthBytes, `${spec.id} ground_truth.json`),
    `${spec.id} ground truth`,
  );
  const curationPath = directFile(caseRoot, "curation.json", `${spec.id} curation.json`);
  const curation = parseHistoricalCuration(
    readJson(curationPath, `${spec.id} curation.json`), spec, truth, `${spec.id} curation`,
  );
  if (options.requireAdmitted !== false && curation.status !== "admitted") {
    throw new Error(`${spec.id} is not admitted to the historical efficacy corpus`);
  }

  const proofPath = directFile(caseRoot, curation.proof.artifact, `${spec.id} curation proof`);
  const reservedInputs = [
    "case.json", "ground_truth.json", "curation.json", spec.diffFile,
    ...(spec.metadataFile ? [spec.metadataFile] : []),
    ...(spec.leakageExceptionsFile ? [spec.leakageExceptionsFile] : []),
  ];
  if (reservedInputs.some((name) => resolve(caseRoot, name) === proofPath)) {
    throw new Error(`${spec.id} curation proof resolves to a reserved runner input`);
  }
  if (fileSha256(proofPath) !== curation.proof.sha256) {
    throw new Error(`${spec.id} curation proof digest does not match its artifact`);
  }
  const diffPath = directFile(caseRoot, spec.diffFile, `${spec.id} diff`);
  const diff = readFileSync(diffPath);
  if (fileSha256(diffPath) !== curation.source.changeIdentitySha256) {
    throw new Error(`${spec.id} source change identity does not match the checked-in diff`);
  }
  const diffText = diff.toString("utf8");
  const diffLines = diffText.length === 0 ? 0 : diffText.split("\n").length - (diffText.endsWith("\n") ? 1 : 0);
  if (curation.strata.size !== diffSizeStratum(diffLines)) {
    throw new Error(`${spec.id} size stratum does not match its ${diffLines}-line diff`);
  }
  const declaresLarge = curation.strata.changeShapes.includes("large-diff");
  if (declaresLarge !== (diffLines >= LARGE_DIFF_MIN_LINES)) {
    throw new Error(`${spec.id} large-diff shape does not match its ${diffLines}-line diff`);
  }

  const bundleSha256 = historicalCaseBundleSha256FromTruthDigest(
    caseRoot,
    spec,
    curation,
    createHash("sha256").update(truthBytes).digest("hex"),
  );
  const trustedIdentities = new Set(policy.curatorIdentitySha256s);
  for (const [index, confirmation] of curation.confirmations.entries()) {
    if (!trustedIdentities.has(confirmation.curatorIdentitySha256)) {
      throw new Error(`${spec.id} confirmation ${index} is not registered by the caller-supplied curator policy`);
    }
    if (confirmation.caseBundleSha256 !== bundleSha256) {
      throw new Error(`${spec.id} confirmation ${index} does not authenticate the current historical case bundle`);
    }
    if (confirmation.truthScopeSha256 !== curation.truth.scopeSha256) {
      throw new Error(`${spec.id} confirmation ${index} does not authenticate the current truth scope`);
    }
  }
  if (curation.status === "admitted" &&
    curation.confirmations.length < policy.minimumIndependentConfirmations) {
    throw new Error(`${spec.id} does not meet the caller-supplied confirmation policy`);
  }
  return { truth, curation, caseBundleSha256: bundleSha256, diffLines,
    verificationBoundary: "declared-bundle-and-policy-only" };
}

export function historicalCaseBundleSha256(
  caseDir: string,
  spec: HistoricalCaseSpec,
  curation: HistoricalCuration,
): string {
  const caseRoot = realpathSync(resolve(caseDir));
  return historicalCaseBundleSha256FromTruthDigest(
    caseRoot,
    spec,
    curation,
    fileSha256(directFile(caseRoot, "ground_truth.json", `${spec.id} ground_truth.json`)),
  );
}

function historicalCaseBundleSha256FromTruthDigest(
  caseRoot: string,
  spec: HistoricalCaseSpec,
  curation: HistoricalCuration,
  groundTruthSha256: string,
): string {
  const artifacts = {
    caseJsonSha256: fileSha256(directFile(caseRoot, "case.json", `${spec.id} case.json`)),
    groundTruthSha256,
    diffSha256: fileSha256(directFile(caseRoot, spec.diffFile, `${spec.id} diff`)),
    proofSha256: fileSha256(directFile(caseRoot, curation.proof.artifact, `${spec.id} curation proof`)),
  };
  return createHash("sha256")
    .update("peregrine-historical-case-bundle-v2\0")
    .update(JSON.stringify({
      caseId: spec.id,
      artifacts,
      curation: {
        protocol: curation.protocol,
        status: curation.status,
        curatorPolicyId: curation.curatorPolicyId,
        truth: curation.truth,
        source: curation.source,
        strata: curation.strata,
        proof: curation.proof,
      },
    }))
    .digest("hex");
}

function parseJsonBytes(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseHistoricalCuration(
  value: unknown,
  spec: HistoricalCaseSpec,
  truth: HistoricalGroundTruth,
  label = "historical curation",
): HistoricalCuration {
  const root = strictObject(value, label, [
    "schemaVersion", "protocol", "caseId", "status", "curatorPolicyId",
    "truth", "source", "strata", "proof", "confirmations",
  ]);
  if (root.schemaVersion !== 2) throw new Error(`${label}.schemaVersion must be 2`);
  if (root.protocol !== HISTORICAL_EFFICACY_PROTOCOL) throw new Error(`${label}.protocol is invalid`);
  if (root.caseId !== spec.id) throw new Error(`${label}.caseId must match case.json`);
  if (root.status !== "draft" && root.status !== "admitted") throw new Error(`${label}.status is invalid`);
  if (root.curatorPolicyId !== "protected-git-review-v1") throw new Error(`${label}.curatorPolicyId is invalid`);
  if (spec.kind !== "historical" || spec.evaluationProtocol !== HISTORICAL_EFFICACY_PROTOCOL) {
    throw new Error(`${label} requires an opted-in historical case spec`);
  }

  const rawTruth = strictObject(root.truth, `${label}.truth`, [
    "truthVersion", "status", "completeness", "scopeSha256",
  ]);
  if (rawTruth.truthVersion !== truth.scope.truthVersion) throw new Error(`${label}.truthVersion is stale`);
  if (rawTruth.status !== truth.scope.status) throw new Error(`${label}.truth.status does not match ground truth`);
  if (rawTruth.completeness !== "partial" || truth.scope.completeness !== "partial") {
    throw new Error(`${label}.truth.completeness must remain partial`);
  }
  const scopeSha256 = sha256(rawTruth.scopeSha256, `${label}.truth.scopeSha256`);
  if (scopeSha256 !== historicalTruthScopeSha256(truth)) throw new Error(`${label}.truth.scopeSha256 is stale`);

  const rawSource = strictObject(root.source, `${label}.source`, [
    "kind", "repositoryAlias", "repositoryIdentitySha256", "changeIdentitySha256", "access",
  ]);
  if (rawSource.kind !== "historical") throw new Error(`${label}.source.kind must be historical`);
  if (!SOURCE_ACCESS.includes(rawSource.access as never)) throw new Error(`${label}.source.access is invalid`);
  const source: HistoricalCuration["source"] = {
    kind: "historical",
    repositoryAlias: slug(rawSource.repositoryAlias, `${label}.source.repositoryAlias`),
    repositoryIdentitySha256: sha256(rawSource.repositoryIdentitySha256, `${label}.source.repositoryIdentitySha256`),
    changeIdentitySha256: sha256(rawSource.changeIdentitySha256, `${label}.source.changeIdentitySha256`),
    access: rawSource.access as HistoricalCuration["source"]["access"],
  };

  const rawStrata = strictObject(root.strata, `${label}.strata`, [
    "languageFamily", "architectureFamily", "size", "changeShapes",
    "secondarySurfaceLanes", "mechanismFamilies",
  ]);
  if (rawStrata.languageFamily !== "javascript" && rawStrata.languageFamily !== "typescript") {
    throw new Error(`${label}.strata.languageFamily must be javascript or typescript`);
  }
  if (!ARCHITECTURE_FAMILIES.includes(rawStrata.architectureFamily as never)) {
    throw new Error(`${label}.strata.architectureFamily is invalid`);
  }
  if (rawStrata.size !== "small" && rawStrata.size !== "medium" && rawStrata.size !== "large") {
    throw new Error(`${label}.strata.size is invalid`);
  }
  const changeShapes = enumArray(rawStrata.changeShapes, CHANGE_SHAPES, `${label}.strata.changeShapes`, false);
  if (changeShapes.includes("direct") === changeShapes.includes("seam")) {
    throw new Error(`${label}.strata.changeShapes must contain exactly one of direct or seam`);
  }
  const secondarySurfaceLanes = enumArray(
    rawStrata.secondarySurfaceLanes, CORE_LANE_IDS, `${label}.strata.secondarySurfaceLanes`, true,
  );
  const mechanismFamilies = slugArray(rawStrata.mechanismFamilies, `${label}.strata.mechanismFamilies`);
  const expectedMechanisms = [...new Set(truth.bugs.map((bug) => bug.mechanismFamily))].sort(lexicalCompare);
  if (JSON.stringify(mechanismFamilies) !== JSON.stringify(expectedMechanisms)) {
    throw new Error(`${label}.strata.mechanismFamilies must equal the source-derived truth mechanisms`);
  }
  assertMultiObservationShape(truth, changeShapes, label);

  const rawProof = strictObject(root.proof, `${label}.proof`, ["kind", "artifact", "sha256"]);
  if (!PROOF_KINDS.includes(rawProof.kind as never)) throw new Error(`${label}.proof.kind is invalid`);
  if (truth.scope.status === "reviewed-comparison" && rawProof.kind !== "reviewed-comparison-analysis") {
    throw new Error(`${label} reviewed comparisons require reviewed-comparison-analysis proof`);
  }
  if (truth.scope.status === "known-roots" && rawProof.kind === "reviewed-comparison-analysis") {
    throw new Error(`${label} known-root cases cannot use comparison proof`);
  }
  const artifact = safePath(rawProof.artifact, `${label}.proof.artifact`);
  const reserved = new Set([
    "case.json", "ground_truth.json", "curation.json", spec.diffFile,
    ...(spec.metadataFile ? [spec.metadataFile] : []),
    ...(spec.leakageExceptionsFile ? [spec.leakageExceptionsFile] : []),
  ]);
  if (reserved.has(artifact)) throw new Error(`${label}.proof.artifact must remain outside runner inputs`);
  const proof: HistoricalCuration["proof"] = {
    kind: rawProof.kind as HistoricalCuration["proof"]["kind"],
    artifact,
    sha256: sha256(rawProof.sha256, `${label}.proof.sha256`),
  };

  if (!Array.isArray(root.confirmations)) throw new Error(`${label}.confirmations must be an array`);
  const expectedChecks = requiredHistoricalConfirmationChecks(truth.scope.status);
  const curatorIds = new Set<string>();
  const confirmations = root.confirmations.map((value, index) => {
    const source = `${label}.confirmations[${index}]`;
    const item = strictObject(value, source, [
      "curatorIdentitySha256", "confirmedAt", "caseBundleSha256", "truthScopeSha256", "checks",
    ]);
    const curatorIdentitySha256 = sha256(item.curatorIdentitySha256, `${source}.curatorIdentitySha256`);
    if (curatorIds.has(curatorIdentitySha256)) throw new Error(`${label}.confirmations has a duplicate curator`);
    curatorIds.add(curatorIdentitySha256);
    if (!Array.isArray(item.checks) || item.checks.length !== expectedChecks.length ||
      item.checks.some((check, checkIndex) => check !== expectedChecks[checkIndex])) {
      throw new Error(`${source}.checks must equal the required ordered checklist`);
    }
    return {
      curatorIdentitySha256,
      confirmedAt: timestamp(item.confirmedAt, `${source}.confirmedAt`),
      caseBundleSha256: sha256(item.caseBundleSha256, `${source}.caseBundleSha256`),
      truthScopeSha256: sha256(item.truthScopeSha256, `${source}.truthScopeSha256`),
      checks: [...expectedChecks],
    };
  });
  if (root.status === "admitted" && confirmations.length < 2) {
    throw new Error(`${label} admitted cases need two distinct accountable confirmations`);
  }

  return {
    schemaVersion: 2,
    protocol: HISTORICAL_EFFICACY_PROTOCOL,
    caseId: spec.id,
    status: root.status,
    curatorPolicyId: "protected-git-review-v1",
    truth: {
      truthVersion: truth.scope.truthVersion,
      status: truth.scope.status,
      completeness: "partial",
      scopeSha256,
    },
    source,
    strata: {
      languageFamily: rawStrata.languageFamily,
      architectureFamily: rawStrata.architectureFamily as ArchitectureFamily,
      size: rawStrata.size,
      changeShapes,
      secondarySurfaceLanes,
      mechanismFamilies,
    },
    proof,
    confirmations,
  };
}

function assertCaseSpecMatches(value: unknown, spec: HistoricalCaseSpec): void {
  const raw = strictObject(value, `${spec.id} case.json`, [
    "id", "corpus", "kind", "evaluationProtocol", "repoSource", "baseCommit", "headCommit", "diffFile",
  ], ["metadataFile", "leakageExceptionsFile"]);
  for (const key of Object.keys(raw)) {
    if (raw[key] !== (spec as unknown as Record<string, unknown>)[key]) {
      throw new Error(`${spec.id} supplied case spec does not match case.json field ${key}`);
    }
  }
  for (const key of Object.keys(spec)) {
    if (!Object.hasOwn(raw, key)) throw new Error(`${spec.id} supplied case spec does not match case.json field ${key}`);
  }
}

function strictObject(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(object).find((key) => !allowed.has(key));
  if (unexpected !== undefined) throw new Error(`${label} contains unsupported field ${unexpected}`);
  const missing = required.find((key) => !Object.hasOwn(object, key));
  if (missing !== undefined) throw new Error(`${label} is missing ${missing}`);
  return object;
}

function enumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  allowEmpty: boolean,
): T[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
    value.some((item) => !allowed.includes(item as T))) {
    throw new Error(`${label} is invalid`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
  return allowed.filter((item) => value.includes(item));
}

function slugArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const values = value.map((item, index) => slug(item, `${label}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`);
  return values.sort(lexicalCompare);
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
  return value;
}

function slug(value: unknown, label: string): string {
  if (typeof value !== "string" || !SLUG.test(value)) throw new Error(`${label} must be a lowercase slug`);
  return value;
}

function safePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 512 || value !== value.trim() || !SAFE_PATH.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a safe case-relative path`);
  }
  return value;
}

function assertMultiObservationShape(
  truth: HistoricalGroundTruth,
  shapes: readonly ChangeShape[],
  label: string,
): void {
  const observationsByRoot = new Map<string, Set<string>>();
  for (const bug of truth.bugs) {
    const root = bug.rootCauseGroup ?? bug.id;
    const observations = observationsByRoot.get(root) ?? new Set<string>();
    const observation = JSON.stringify([bug.file, bug.startLine, bug.endLine]);
    if (observations.has(observation)) throw new Error(`${label} repeats a root-cause observation`);
    observations.add(observation);
    observationsByRoot.set(root, observations);
  }
  const hasMultiObservationRoot = [...observationsByRoot.values()].some((observations) => observations.size >= 2);
  if (shapes.includes("multi-observation") !== hasMultiObservationRoot) {
    throw new Error(`${label} multi-observation shape must exactly match a root with multiple locations`);
  }
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an RFC3339 UTC timestamp`);
  const canonical = new Date(value).toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) {
    throw new Error(`${label} must be a real canonical UTC timestamp`);
  }
  return value;
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
