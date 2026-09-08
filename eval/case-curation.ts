import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { CORE_LANE_IDS, isCoreLaneId, type CoreLaneId } from "../src/core/lanes.js";
import type { CaseSpec, GroundTruth } from "../src/types.js";
import { parseBehavioralGroundTruth } from "./case-truth.js";

const SHA256 = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[^\0]+$/;
const CHANGE_SHAPES = ["direct", "large-diff", "multi-observation", "seam"] as const;
const PROOF_KINDS = ["clean-control-review", "reasoned-analysis", "regression-test", "reproduction"] as const;
const SOURCE_ACCESS = ["curator-local-private", "public", "sanitized-private"] as const;
const SIZE_STRATA = ["large", "medium", "small"] as const;
const ARCHITECTURE_FAMILIES = [
  "backend-service",
  "cli-tool",
  "data-pipeline",
  "frontend-application",
  "infrastructure",
  "library",
  "worker-service",
] as const;
export const SMALL_DIFF_MAX_LINES = 250;
export const LARGE_DIFF_MIN_LINES = 1_501;
const BUG_CONFIRMATION_CHECKS = [
  "classification",
  "consequentiality",
  "disposition",
  "line-range",
  "provenance",
  "reachability",
  "root-cause",
  "severity",
  "source-authenticity",
  "truth-completeness",
] as const;
const CLEAN_CONFIRMATION_CHECKS = [
  "classification",
  "clean-control",
  "line-range",
  "provenance",
  "source-authenticity",
  "truth-completeness",
] as const;

export type ChangeShape = (typeof CHANGE_SHAPES)[number];
export type ConfirmationCheck = (typeof BUG_CONFIRMATION_CHECKS)[number] | (typeof CLEAN_CONFIRMATION_CHECKS)[number];
export type ArchitectureFamily = (typeof ARCHITECTURE_FAMILIES)[number];

export interface CaseCuration {
  schemaVersion: 1;
  caseId: string;
  status: "draft" | "admitted";
  curatorPolicyId: "protected-git-review-v1";
  source: {
    kind: CaseSpec["kind"];
    repositoryAlias: string;
    repositoryIdentitySha256: string;
    changeIdentitySha256: string;
    access: (typeof SOURCE_ACCESS)[number];
  };
  strata: {
    languageFamily: string;
    architectureFamily: ArchitectureFamily;
    size: (typeof SIZE_STRATA)[number];
    changeShapes: ChangeShape[];
    surfaceLanes: CoreLaneId[];
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
    checks: ConfirmationCheck[];
  }>;
}

export interface HoldoutCommitment {
  schemaVersion: 1;
  kind: "sealed-holdout-commitment";
  status: "unopened";
  stewardIdentitySha256: string;
  storageBoundary: "external-access-controlled";
  corpusCommitmentSha256: string;
  caseCount: number;
  committedAt: string;
}

export interface CuratorPolicy {
  schemaVersion: 1;
  policyId: "protected-git-review-v1";
  trustRoot: "protected-git-review";
  minimumIndependentConfirmations: 2;
  curatorIdentitySha256s: string[];
}

export interface BehavioralCaseAdmission {
  truth: GroundTruth;
  curation: CaseCuration;
  diffLines: number;
}

export function readBehavioralCaseAdmission(
  caseDir: string,
  spec: CaseSpec,
  options: { requireAdmitted?: boolean } = {},
): BehavioralCaseAdmission {
  if (spec.corpus === "structural-smoke") throw new Error(`${spec.id} is not a behavioral case`);
  const caseRoot = realpathSync(resolve(caseDir));
  const truth = parseBehavioralGroundTruth(
    readJson(directFile(caseRoot, "ground_truth.json", `${spec.id} ground_truth.json`), `${spec.id} ground_truth.json`),
    `${spec.id} ground truth`,
  );
  const curation = parseCaseCuration(
    readJson(directFile(caseRoot, "curation.json", `${spec.id} curation.json`), `${spec.id} curation.json`),
    spec,
    truth,
    `${spec.id} curation`,
  );
  if (options.requireAdmitted !== false && curation.status !== "admitted") {
    throw new Error(`${spec.id} is not admitted to the behavioral corpus`);
  }
  verifyCurationProof(caseDir, curation);

  const resolvedDiff = directFile(caseRoot, spec.diffFile, `${spec.id} diff`);
  const diff = readFileSync(resolvedDiff);
  const actual = createHash("sha256").update(diff).digest("hex");
  if (actual !== curation.source.changeIdentitySha256) {
    throw new Error(`${spec.id} source change identity does not match the checked-in diff`);
  }
  if (spec.kind !== "historical") {
    const fixtureIdentity = fixtureSourceIdentitySha256(caseRoot, spec.fixtureDir);
    if (curation.source.repositoryIdentitySha256 !== fixtureIdentity) {
      throw new Error(`${spec.id} fixture source identity does not match its authenticated fixture tree`);
    }
  }
  const text = diff.toString("utf8");
  const diffLines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const expectedSize = diffSizeStratum(diffLines);
  if (curation.strata.size !== expectedSize) {
    throw new Error(`${spec.id} size stratum does not match its ${diffLines}-line diff`);
  }
  const declaresLarge = curation.strata.changeShapes.includes("large-diff");
  if (declaresLarge !== (diffLines >= LARGE_DIFF_MIN_LINES)) {
    throw new Error(`${spec.id} large-diff shape does not match its ${diffLines}-line diff`);
  }
  const bundleSha256 = caseBundleSha256(caseRoot, spec, curation);
  for (const [index, confirmation] of curation.confirmations.entries()) {
    if (confirmation.caseBundleSha256 !== bundleSha256) {
      throw new Error(`${spec.id} confirmation ${index} does not authenticate the current case bundle`);
    }
  }
  return { truth, curation, diffLines };
}

export function caseBundleSha256(caseDir: string, spec: CaseSpec, curation: CaseCuration): string {
  const caseRoot = realpathSync(resolve(caseDir));
  const proofPath = directFile(caseRoot, curation.proof.artifact, `${spec.id} curation proof`);
  const artifacts = {
    caseJsonSha256: fileSha256(directFile(caseRoot, "case.json", `${spec.id} case.json`)),
    groundTruthSha256: fileSha256(directFile(caseRoot, "ground_truth.json", `${spec.id} ground_truth.json`)),
    diffSha256: fileSha256(directFile(caseRoot, spec.diffFile, `${spec.id} diff`)),
    proofSha256: fileSha256(proofPath),
    fixtureTreeSha256: spec.kind === "historical" ? null : fixtureTreeSha256(caseRoot, spec.fixtureDir),
  };
  return createHash("sha256").update(JSON.stringify({
    version: "case-bundle-v1",
    caseId: spec.id,
    artifacts,
    curation: {
      source: curation.source,
      strata: curation.strata,
      proof: curation.proof,
      curatorPolicyId: curation.curatorPolicyId,
    },
  })).digest("hex");
}

export function diffSizeStratum(diffLines: number): CaseCuration["strata"]["size"] {
  if (!Number.isSafeInteger(diffLines) || diffLines < 0) throw new Error("diff line count must be a non-negative integer");
  return diffLines <= SMALL_DIFF_MAX_LINES
    ? "small"
    : diffLines < LARGE_DIFF_MIN_LINES ? "medium" : "large";
}

export function parseCaseCuration(
  value: unknown,
  spec: CaseSpec,
  truth: GroundTruth,
  label = "case curation",
): CaseCuration {
  const root = strictObject(value, label, [
    "schemaVersion", "caseId", "status", "curatorPolicyId", "source", "strata", "proof", "confirmations",
  ]);
  if (root.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  if (root.caseId !== spec.id) throw new Error(`${label}.caseId must match case.json`);
  if (root.status !== "draft" && root.status !== "admitted") throw new Error(`${label}.status is invalid`);
  if (root.curatorPolicyId !== "protected-git-review-v1") {
    throw new Error(`${label}.curatorPolicyId must be protected-git-review-v1`);
  }

  const source = strictObject(root.source, `${label}.source`, [
    "kind", "repositoryAlias", "repositoryIdentitySha256", "changeIdentitySha256", "access",
  ]);
  if (source.kind !== spec.kind) throw new Error(`${label}.source.kind must match case.json`);
  const repositoryAlias = slug(source.repositoryAlias, `${label}.source.repositoryAlias`);
  const repositoryIdentitySha256 = sha256(source.repositoryIdentitySha256, `${label}.source.repositoryIdentitySha256`);
  const changeIdentitySha256 = sha256(source.changeIdentitySha256, `${label}.source.changeIdentitySha256`);
  if (!SOURCE_ACCESS.includes(source.access as never)) throw new Error(`${label}.source.access is invalid`);

  const strata = strictObject(root.strata, `${label}.strata`, [
    "languageFamily", "architectureFamily", "size", "changeShapes", "surfaceLanes",
  ]);
  const languageFamily = slug(strata.languageFamily, `${label}.strata.languageFamily`);
  if (!ARCHITECTURE_FAMILIES.includes(strata.architectureFamily as never)) {
    throw new Error(`${label}.strata.architectureFamily is invalid`);
  }
  const architectureFamily = strata.architectureFamily as ArchitectureFamily;
  if (!SIZE_STRATA.includes(strata.size as never)) throw new Error(`${label}.strata.size is invalid`);
  const declaredShapes = enumArray(strata.changeShapes, CHANGE_SHAPES, `${label}.strata.changeShapes`);
  const changeShapes = CHANGE_SHAPES.filter((shape) => declaredShapes.includes(shape));
  const surfaceLanes = coreLaneArray(strata.surfaceLanes, `${label}.strata.surfaceLanes`);
  if (changeShapes.includes("direct") === changeShapes.includes("seam")) {
    throw new Error(`${label}.strata.changeShapes must contain exactly one of direct or seam`);
  }

  const proof = strictObject(root.proof, `${label}.proof`, ["kind", "artifact", "sha256"]);
  if (!PROOF_KINDS.includes(proof.kind as never)) throw new Error(`${label}.proof.kind is invalid`);
  const artifact = safePath(proof.artifact, `${label}.proof.artifact`);
  const proofSha256 = sha256(proof.sha256, `${label}.proof.sha256`);
  const reservedArtifacts = new Set([
    "case.json", "ground_truth.json", "curation.json", spec.diffFile,
    ...(spec.metadataFile ? [spec.metadataFile] : []),
    ...(spec.leakageExceptionsFile ? [spec.leakageExceptionsFile] : []),
  ]);
  if (reservedArtifacts.has(artifact) ||
    (spec.kind !== "historical" &&
      (artifact === spec.fixtureDir || artifact.startsWith(`${spec.fixtureDir}/`)))) {
    throw new Error(`${label}.proof.artifact must remain outside every model-visible or runner input`);
  }

  if (!Array.isArray(root.confirmations)) throw new Error(`${label}.confirmations must be an array`);
  const expectedChecks = spec.kind === "clean" ? CLEAN_CONFIRMATION_CHECKS : BUG_CONFIRMATION_CHECKS;
  const curators = new Set<string>();
  const confirmations = root.confirmations.map((raw, index) => {
    const confirmation = strictObject(raw, `${label}.confirmations[${index}]`, [
      "curatorIdentitySha256", "confirmedAt", "caseBundleSha256", "checks",
    ]);
    const curatorIdentitySha256 = sha256(
      confirmation.curatorIdentitySha256,
      `${label}.confirmations[${index}].curatorIdentitySha256`,
    );
    if (curators.has(curatorIdentitySha256)) throw new Error(`${label}.confirmations has a duplicate curator`);
    curators.add(curatorIdentitySha256);
    const confirmedAt = timestamp(confirmation.confirmedAt, `${label}.confirmations[${index}].confirmedAt`);
    const caseBundleSha256 = sha256(
      confirmation.caseBundleSha256,
      `${label}.confirmations[${index}].caseBundleSha256`,
    );
    if (!Array.isArray(confirmation.checks) ||
      confirmation.checks.length !== expectedChecks.length ||
      confirmation.checks.some((check, checkIndex) => check !== expectedChecks[checkIndex])) {
      throw new Error(`${label}.confirmations[${index}].checks must equal the required ordered checklist`);
    }
    return { curatorIdentitySha256, confirmedAt, caseBundleSha256, checks: [...expectedChecks] };
  });
  if (root.status === "admitted" && confirmations.length < 2) {
    throw new Error(`${label} admitted cases need two independent curator confirmations`);
  }

  if (spec.kind === "clean" && truth.bugs.length !== 0) throw new Error(`${label} clean cases must have empty ground truth`);
  if (spec.kind !== "clean" && truth.bugs.length === 0) throw new Error(`${label} bug cases need non-empty ground truth`);
  if (spec.kind === "clean" && proof.kind !== "clean-control-review") {
    throw new Error(`${label} clean cases require a clean-control-review proof`);
  }
  if (spec.kind === "clean" && surfaceLanes.length !== 1) {
    throw new Error(`${label} clean controls must declare exactly one comparable surface lane`);
  }
  if (spec.kind !== "clean" && proof.kind === "clean-control-review") {
    throw new Error(`${label} bug cases cannot use a clean-control-review proof`);
  }

  const truthLanes = new Set(truth.bugs.map((bug) => bug.lane));
  for (const lane of truthLanes) {
    if (!surfaceLanes.includes(lane)) throw new Error(`${label}.strata.surfaceLanes omits truth lane ${lane}`);
  }
  assertRootCauseObservations(truth, changeShapes, label);

  return {
    schemaVersion: 1,
    caseId: spec.id,
    status: root.status,
    curatorPolicyId: "protected-git-review-v1",
    source: {
      kind: spec.kind,
      repositoryAlias,
      repositoryIdentitySha256,
      changeIdentitySha256,
      access: source.access as CaseCuration["source"]["access"],
    },
    strata: {
      languageFamily,
      architectureFamily,
      size: strata.size as CaseCuration["strata"]["size"],
      changeShapes,
      surfaceLanes,
    },
    proof: { kind: proof.kind as CaseCuration["proof"]["kind"], artifact, sha256: proofSha256 },
    confirmations,
  };
}

export function parseCuratorPolicy(value: unknown, label = "curator policy"): CuratorPolicy {
  const root = strictObject(value, label, [
    "schemaVersion", "policyId", "trustRoot", "minimumIndependentConfirmations", "curatorIdentitySha256s",
  ]);
  if (root.schemaVersion !== 1 || root.policyId !== "protected-git-review-v1" || root.trustRoot !== "protected-git-review") {
    throw new Error(`${label} must use the protected-git-review-v1 trust root`);
  }
  if (root.minimumIndependentConfirmations !== 2) {
    throw new Error(`${label}.minimumIndependentConfirmations must be 2`);
  }
  if (!Array.isArray(root.curatorIdentitySha256s)) throw new Error(`${label}.curatorIdentitySha256s must be an array`);
  const curatorIdentitySha256s = root.curatorIdentitySha256s.map((identity, index) =>
    sha256(identity, `${label}.curatorIdentitySha256s[${index}]`));
  if (new Set(curatorIdentitySha256s).size !== curatorIdentitySha256s.length) {
    throw new Error(`${label}.curatorIdentitySha256s must not contain duplicates`);
  }
  return {
    schemaVersion: 1,
    policyId: "protected-git-review-v1",
    trustRoot: "protected-git-review",
    minimumIndependentConfirmations: 2,
    curatorIdentitySha256s,
  };
}

export function fixtureSourceIdentitySha256(caseDir: string, fixtureDir: string): string {
  return createHash("sha256").update(JSON.stringify({
    version: "fixture-source-v1",
    fixtureTreeSha256: fixtureTreeSha256(realpathSync(resolve(caseDir)), fixtureDir),
  })).digest("hex");
}

export function fixtureTreeSha256(caseRoot: string, fixtureDir: string): string {
  const root = directDirectory(caseRoot, fixtureDir, "fixture tree");
  const entries: Array<
    { type: "directory"; path: string } |
    { type: "file"; path: string; executable: boolean; sha256: string }
  > = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (name === ".git") throw new Error("fixture tree cannot contain Git metadata");
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("fixture tree cannot contain symlinks");
      const resolved = realpathSync(path);
      if (!resolved.startsWith(`${root}${sep}`)) throw new Error("fixture tree entry escapes its root");
      const relativePath = relative(root, resolved).split(sep).join("/");
      if (stat.isDirectory()) {
        entries.push({ type: "directory", path: relativePath });
        visit(resolved);
      } else if (stat.isFile()) entries.push({
        type: "file",
        path: relativePath,
        executable: (stat.mode & 0o111) !== 0,
        sha256: fileSha256(resolved),
      });
      else throw new Error("fixture tree can contain only directories and regular files");
    }
  };
  visit(root);
  return createHash("sha256").update(JSON.stringify({ version: "fixture-tree-v1", entries })).digest("hex");
}

export function verifyCurationProof(caseDir: string, curation: CaseCuration): void {
  const root = realpathSync(resolve(caseDir));
  const resolved = directFile(root, curation.proof.artifact, "curation proof");
  const actual = createHash("sha256").update(readFileSync(resolved)).digest("hex");
  if (actual !== curation.proof.sha256) throw new Error("curation proof digest does not match its artifact");
}

export function parseHoldoutCommitment(value: unknown, label = "holdout commitment"): HoldoutCommitment {
  const root = strictObject(value, label, [
    "schemaVersion", "kind", "status", "stewardIdentitySha256", "storageBoundary",
    "corpusCommitmentSha256", "caseCount", "committedAt",
  ]);
  if (root.schemaVersion !== 1 || root.kind !== "sealed-holdout-commitment" || root.status !== "unopened") {
    throw new Error(`${label} must describe an unopened schema-v1 sealed holdout commitment`);
  }
  if (root.storageBoundary !== "external-access-controlled") {
    throw new Error(`${label}.storageBoundary must be external-access-controlled`);
  }
  if (!Number.isSafeInteger(root.caseCount) || Number(root.caseCount) < 1) {
    throw new Error(`${label}.caseCount must be a positive integer`);
  }
  return {
    schemaVersion: 1,
    kind: "sealed-holdout-commitment",
    status: "unopened",
    stewardIdentitySha256: sha256(root.stewardIdentitySha256, `${label}.stewardIdentitySha256`),
    storageBoundary: "external-access-controlled",
    corpusCommitmentSha256: sha256(root.corpusCommitmentSha256, `${label}.corpusCommitmentSha256`),
    caseCount: Number(root.caseCount),
    committedAt: timestamp(root.committedAt, `${label}.committedAt`),
  };
}

export function requiredConfirmationChecks(kind: CaseSpec["kind"]): readonly ConfirmationCheck[] {
  return kind === "clean" ? CLEAN_CONFIRMATION_CHECKS : BUG_CONFIRMATION_CHECKS;
}

function assertRootCauseObservations(truth: GroundTruth, shapes: readonly ChangeShape[], label: string): void {
  const groups = new Map<string, Set<string>>();
  for (const bug of truth.bugs) {
    if (!bug.rootCauseGroup) continue;
    const observations = groups.get(bug.rootCauseGroup) ?? new Set<string>();
    const key = JSON.stringify([bug.file, bug.startLine, bug.endLine]);
    if (observations.has(key)) throw new Error(`${label} repeats a root-cause observation`);
    observations.add(key);
    groups.set(bug.rootCauseGroup, observations);
  }
  for (const [group, observations] of groups) {
    if (observations.size < 2) throw new Error(`${label} root-cause group ${group} needs at least two distinct observations`);
  }
  if (groups.size > 0 && !shapes.includes("multi-observation")) {
    throw new Error(`${label} grouped truth requires the multi-observation change shape`);
  }
  if (groups.size === 0 && shapes.includes("multi-observation")) {
    throw new Error(`${label} multi-observation shape requires grouped truth observations`);
  }
}

function strictObject(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const root = value as Record<string, unknown>;
  const expected = new Set(keys);
  const unexpected = Object.keys(root).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !Object.hasOwn(root, key));
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported field ${unexpected[0]}`);
  if (missing.length > 0) throw new Error(`${label} is missing ${missing[0]}`);
  return root;
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
  if (typeof value !== "string" || value.length > 512 || value !== value.trim() || !SAFE_PATH.test(value)) {
    throw new Error(`${label} must be a safe case-relative path`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an RFC3339 UTC timestamp`);
  }
  const canonical = new Date(value).toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) {
    throw new Error(`${label} must be a real canonical UTC timestamp`);
  }
  return value;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[], label: string): T[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !allowed.includes(item as T))) {
    throw new Error(`${label} must be a non-empty enum array`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
  return [...value] as T[];
}

function coreLaneArray(value: unknown, label: string): CoreLaneId[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((lane) => !isCoreLaneId(lane))) {
    throw new Error(`${label} must contain core lane IDs`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
  return CORE_LANE_IDS.filter((lane) => value.includes(lane));
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function directFile(root: string, name: string, label: string): string {
  const path = resolve(root, name);
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`${label} path escapes its case directory`);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct regular non-symlink file`);
  const resolved = realpathSync(path);
  if (resolved !== path || !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`${label} must be confined directly inside its case directory`);
  }
  return resolved;
}

function directDirectory(root: string, name: string, label: string): string {
  const path = resolve(root, name);
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`${label} path escapes its case directory`);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct regular non-symlink directory`);
  const resolved = realpathSync(path);
  if (resolved !== path || !resolved.startsWith(`${root}${sep}`)) throw new Error(`${label} must be confined inside its case directory`);
  return resolved;
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Shared with the versioned historical admission reader so both protocols use
// identical regular-file confinement and byte-digest semantics.
export { directFile, fileSha256 };
