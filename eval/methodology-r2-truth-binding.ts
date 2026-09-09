import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import { readAuthenticatedHistoricalMethodologyCase } from "./historical-methodology-case.js";
import { parseHistoricalCuratorPolicy, type HistoricalCuratorPolicy } from "./historical-curator-policy.js";
import { historicalRootCauseKey } from "./historical-truth.js";
import { readR2PartitionArtifact, type R2CaseClass, type R2Partition } from "./methodology-r2-partition.js";

export const R2_TRUTH_BINDING_PROTOCOL = "r2-operator-truth-binding-v1" as const;
export const R2_TRUTH_BINDING_DIRECTORY = "methodology-r2-truth-bindings";

const SHA256 = /^[a-f0-9]{64}$/;
const FILE_NAME = /^binding\.v(\d{6})\.json$/;
const ISO_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const OPAQUE_ROOT = /^(?:bug|root)-[a-f0-9]{8,32}$/;
const TRUTH_VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type R2RegisteredSeverity = "high" | "medium" | "low";

export interface R2TruthBindingRoot {
  rootCause: string;
  expectedSeverity: R2RegisteredSeverity;
}

export interface R2TruthBindingCase {
  caseName: string;
  partition: R2Partition;
  caseClass: R2CaseClass;
  repositoryIdentitySha256: string;
  duplicateFamilySha256: string;
  registrationSha256: string;
  curationSha256: string;
  caseBundleSha256: string;
  truthScopeSha256: string;
  canonicalTruthSha256: string;
  truthVersion: string;
  roots: R2TruthBindingRoot[];
}

export interface R2TruthBindingArtifact {
  schemaVersion: 1;
  protocol: typeof R2_TRUTH_BINDING_PROTOCOL;
  version: number;
  previousBindingSha256: string | null;
  partitionArtifactSha256: string;
  packetSha256: string;
  responseSha256: string;
  partitionAttestationSelfSha256: string;
  humanReviewerIdentitySha256: string;
  claims: {
    operatorOnly: true;
    reviewerVisible: false;
    truthDerived: true;
    independentVerificationClaimed: false;
  };
  cases: R2TruthBindingCase[];
  counts: {
    cases: number;
    bugBearing: number;
    reviewedComparison: number;
    registeredRoots: number;
    highSeverityRoots: number;
  };
  recordedAt: string;
  bindingSha256: string;
}

export interface R2TruthBindingInput {
  partitionStorageRoot: string;
  expectedPartitionArtifactSha256: string;
  trustedPolicy: HistoricalCuratorPolicy;
  caseDirectories: readonly string[];
  recordedAt: string;
  expectedPreviousBindingSha256: string | null;
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(object, key))) throw new Error(`${label} has an invalid shape`);
  return object;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !ISO_UTC_MILLISECONDS.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO-8601 UTC timestamp with milliseconds`);
  return value;
}

function validateRootCause(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; }
  catch { throw new Error(`${label} is invalid`); }
  if (!Array.isArray(parsed) || parsed.length !== 2 ||
      (parsed[0] !== "bug" && parsed[0] !== "group") ||
      typeof parsed[1] !== "string" || !OPAQUE_ROOT.test(parsed[1]) ||
      (parsed[0] === "bug" && !parsed[1].startsWith("bug-")) ||
      (parsed[0] === "group" && !parsed[1].startsWith("root-"))) throw new Error(`${label} is invalid`);
  return value;
}

function bodyOf(value: R2TruthBindingArtifact): Omit<R2TruthBindingArtifact, "bindingSha256"> {
  const { bindingSha256: _bindingSha256, ...body } = value;
  return body;
}

function deriveRoots(caseName: string, bugs: ReturnType<typeof readAuthenticatedHistoricalMethodologyCase>["truth"]["bugs"]): R2TruthBindingRoot[] {
  const severities = new Map<string, R2RegisteredSeverity>();
  for (const bug of bugs) {
    const rootCause = historicalRootCauseKey(bug);
    const prior = severities.get(rootCause);
    if (prior !== undefined && prior !== bug.expectedSeverity) throw new Error(`${caseName} gives grouped root ${rootCause} conflicting severities`);
    severities.set(rootCause, bug.expectedSeverity);
  }
  return [...severities.entries()]
    .map(([rootCause, expectedSeverity]) => ({ rootCause, expectedSeverity }))
    .sort((left, right) => left.rootCause.localeCompare(right.rootCause));
}

export function buildR2TruthBindingArtifact(
  input: R2TruthBindingInput,
  version = 1,
  previousBindingSha256: string | null = null,
): R2TruthBindingArtifact {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("truth binding version must be a positive integer");
  if (previousBindingSha256 !== null) digest(previousBindingSha256, "previousBindingSha256");
  timestamp(input.recordedAt, "recordedAt");
  const policy = parseHistoricalCuratorPolicy(input.trustedPolicy, "R2 truth binding policy");
  const partition = readR2PartitionArtifact(input.partitionStorageRoot, input.expectedPartitionArtifactSha256);
  if (partition.result !== "admitted" || partition.deficits.length !== 0) throw new Error("R2 truth binding requires an admitted, deficit-free partition");
  if (Date.parse(input.recordedAt) <= Date.parse(partition.recordedAt)) throw new Error("R2 truth binding must be recorded after its partition artifact");
  if (policy.schemaVersion !== 2 || policy.registeredHumanIdentitySha256 !== partition.humanReviewerIdentitySha256) throw new Error("R2 truth binding policy identity does not match the partition");
  if (new Set(input.caseDirectories).size !== input.caseDirectories.length) throw new Error("R2 truth binding case directories must be unique");

  const partitionByName = new Map(partition.cases.map((item) => [item.caseName, item]));
  const cases: R2TruthBindingCase[] = input.caseDirectories.map((caseDirectory) => {
    const authenticated = readAuthenticatedHistoricalMethodologyCase(resolve(caseDirectory), policy);
    const registration = authenticated.registration;
    const partitionCase = partitionByName.get(registration.caseName);
    if (!partitionCase) throw new Error(`${registration.caseName} is not present in the exact R2 partition`);
    if (
      registration.registrationSha256 !== partitionCase.registrationSha256 ||
      registration.curationSha256 !== partitionCase.curationSha256 ||
      registration.caseBundleSha256 !== partitionCase.caseBundleSha256 ||
      registration.truth.scopeSha256 !== partitionCase.truthScopeSha256 ||
      registration.source.repositoryIdentitySha256 !== partitionCase.repositoryIdentitySha256
    ) throw new Error(`${registration.caseName} no longer matches its R2 partition identities`);
    const expectedClass: R2CaseClass = authenticated.truth.scope.status === "known-roots" ? "bug-bearing" : "reviewed-comparison";
    if (expectedClass !== partitionCase.caseClass) throw new Error(`${registration.caseName} truth status no longer matches its R2 class`);
    const roots = deriveRoots(registration.caseName, authenticated.truth.bugs);
    if ((expectedClass === "bug-bearing") !== (roots.length > 0)) throw new Error(`${registration.caseName} truth roots do not match its R2 class`);
    return {
      caseName: registration.caseName,
      partition: partitionCase.partition,
      caseClass: partitionCase.caseClass,
      repositoryIdentitySha256: partitionCase.repositoryIdentitySha256,
      duplicateFamilySha256: partitionCase.duplicateFamilySha256,
      registrationSha256: registration.registrationSha256,
      curationSha256: registration.curationSha256,
      caseBundleSha256: registration.caseBundleSha256,
      truthScopeSha256: registration.truth.scopeSha256,
      canonicalTruthSha256: canonicalJsonSha256(authenticated.truth),
      truthVersion: authenticated.truth.scope.truthVersion,
      roots,
    };
  }).sort((left, right) => left.caseName.localeCompare(right.caseName));

  const names = cases.map((item) => item.caseName);
  const expectedNames = partition.cases.map((item) => item.caseName);
  if (canonicalJson(names) !== canonicalJson(expectedNames)) throw new Error("R2 truth binding cases must cover the exact partition without missing or extra cases");
  const partitionAfter = readR2PartitionArtifact(input.partitionStorageRoot, input.expectedPartitionArtifactSha256);
  if (canonicalJson(partitionAfter) !== canonicalJson(partition)) throw new Error("R2 partition changed across truth-binding reads");

  const roots = cases.flatMap((item) => item.roots);
  const body: Omit<R2TruthBindingArtifact, "bindingSha256"> = {
    schemaVersion: 1,
    protocol: R2_TRUTH_BINDING_PROTOCOL,
    version,
    previousBindingSha256,
    partitionArtifactSha256: partition.artifactSha256,
    packetSha256: partition.packetSha256,
    responseSha256: partition.responseSha256,
    partitionAttestationSelfSha256: partition.partitionAttestationSelfSha256,
    humanReviewerIdentitySha256: partition.humanReviewerIdentitySha256,
    claims: { operatorOnly: true, reviewerVisible: false, truthDerived: true, independentVerificationClaimed: false },
    cases,
    counts: {
      cases: cases.length,
      bugBearing: cases.filter((item) => item.caseClass === "bug-bearing").length,
      reviewedComparison: cases.filter((item) => item.caseClass === "reviewed-comparison").length,
      registeredRoots: roots.length,
      highSeverityRoots: roots.filter((item) => item.expectedSeverity === "high").length,
    },
    recordedAt: input.recordedAt,
  };
  return { ...body, bindingSha256: canonicalJsonSha256(body) };
}

export function parseR2TruthBindingArtifact(value: unknown): R2TruthBindingArtifact {
  const root = exactObject(value, ["schemaVersion", "protocol", "version", "previousBindingSha256", "partitionArtifactSha256", "packetSha256", "responseSha256", "partitionAttestationSelfSha256", "humanReviewerIdentitySha256", "claims", "cases", "counts", "recordedAt", "bindingSha256"], "R2 truth binding");
  if (root.schemaVersion !== 1 || root.protocol !== R2_TRUTH_BINDING_PROTOCOL || !Number.isSafeInteger(root.version) || Number(root.version) < 1) throw new Error("R2 truth binding protocol/version is invalid");
  const previousBindingSha256 = root.previousBindingSha256 === null ? null : digest(root.previousBindingSha256, "previousBindingSha256");
  const claims = exactObject(root.claims, ["operatorOnly", "reviewerVisible", "truthDerived", "independentVerificationClaimed"], "R2 truth binding.claims");
  if (claims.operatorOnly !== true || claims.reviewerVisible !== false || claims.truthDerived !== true || claims.independentVerificationClaimed !== false) throw new Error("R2 truth binding claims are invalid");
  if (!Array.isArray(root.cases)) throw new Error("R2 truth binding.cases must be an array");
  const seen = new Set<string>();
  const cases = root.cases.map((value, index): R2TruthBindingCase => {
    const label = `R2 truth binding.cases[${index}]`;
    const item = exactObject(value, ["caseName", "partition", "caseClass", "repositoryIdentitySha256", "duplicateFamilySha256", "registrationSha256", "curationSha256", "caseBundleSha256", "truthScopeSha256", "canonicalTruthSha256", "truthVersion", "roots"], label);
    if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName) || seen.has(item.caseName)) throw new Error(`${label}.caseName must be unique and canonical`);
    if (item.partition !== "development" && item.partition !== "selection") throw new Error(`${label}.partition is invalid`);
    if (item.caseClass !== "bug-bearing" && item.caseClass !== "reviewed-comparison") throw new Error(`${label}.caseClass is invalid`);
    if (typeof item.truthVersion !== "string" || !TRUTH_VERSION.test(item.truthVersion)) throw new Error(`${label}.truthVersion is invalid`);
    if (!Array.isArray(item.roots)) throw new Error(`${label}.roots must be an array`);
    const rootIds = new Set<string>();
    const roots = item.roots.map((rootValue, rootIndex): R2TruthBindingRoot => {
      const rootLabel = `${label}.roots[${rootIndex}]`;
      const parsed = exactObject(rootValue, ["rootCause", "expectedSeverity"], rootLabel);
      const rootCause = validateRootCause(parsed.rootCause, `${rootLabel}.rootCause`);
      if (rootIds.has(rootCause)) throw new Error(`${rootLabel}.rootCause must be unique`);
      if (parsed.expectedSeverity !== "high" && parsed.expectedSeverity !== "medium" && parsed.expectedSeverity !== "low") throw new Error(`${rootLabel}.expectedSeverity is invalid`);
      rootIds.add(rootCause);
      return { rootCause, expectedSeverity: parsed.expectedSeverity };
    });
    if (canonicalJson(roots) !== canonicalJson([...roots].sort((a, b) => a.rootCause.localeCompare(b.rootCause)))) throw new Error(`${label}.roots are not canonical`);
    if ((item.caseClass === "bug-bearing") !== (roots.length > 0)) throw new Error(`${label}.roots do not match caseClass`);
    seen.add(item.caseName);
    return {
      caseName: item.caseName,
      partition: item.partition,
      caseClass: item.caseClass,
      repositoryIdentitySha256: digest(item.repositoryIdentitySha256, `${label}.repositoryIdentitySha256`),
      duplicateFamilySha256: digest(item.duplicateFamilySha256, `${label}.duplicateFamilySha256`),
      registrationSha256: digest(item.registrationSha256, `${label}.registrationSha256`),
      curationSha256: digest(item.curationSha256, `${label}.curationSha256`),
      caseBundleSha256: digest(item.caseBundleSha256, `${label}.caseBundleSha256`),
      truthScopeSha256: digest(item.truthScopeSha256, `${label}.truthScopeSha256`),
      canonicalTruthSha256: digest(item.canonicalTruthSha256, `${label}.canonicalTruthSha256`),
      truthVersion: item.truthVersion,
      roots,
    };
  });
  if (canonicalJson(cases) !== canonicalJson([...cases].sort((a, b) => a.caseName.localeCompare(b.caseName)))) throw new Error("R2 truth binding cases are not canonical");
  const counts = exactObject(root.counts, ["cases", "bugBearing", "reviewedComparison", "registeredRoots", "highSeverityRoots"], "R2 truth binding.counts");
  const integer = (value: unknown, label: string): number => {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
    return Number(value);
  };
  const parsed: R2TruthBindingArtifact = {
    schemaVersion: 1,
    protocol: R2_TRUTH_BINDING_PROTOCOL,
    version: Number(root.version),
    previousBindingSha256,
    partitionArtifactSha256: digest(root.partitionArtifactSha256, "partitionArtifactSha256"),
    packetSha256: digest(root.packetSha256, "packetSha256"),
    responseSha256: digest(root.responseSha256, "responseSha256"),
    partitionAttestationSelfSha256: digest(root.partitionAttestationSelfSha256, "partitionAttestationSelfSha256"),
    humanReviewerIdentitySha256: digest(root.humanReviewerIdentitySha256, "humanReviewerIdentitySha256"),
    claims: { operatorOnly: true, reviewerVisible: false, truthDerived: true, independentVerificationClaimed: false },
    cases,
    counts: {
      cases: integer(counts.cases, "counts.cases"),
      bugBearing: integer(counts.bugBearing, "counts.bugBearing"),
      reviewedComparison: integer(counts.reviewedComparison, "counts.reviewedComparison"),
      registeredRoots: integer(counts.registeredRoots, "counts.registeredRoots"),
      highSeverityRoots: integer(counts.highSeverityRoots, "counts.highSeverityRoots"),
    },
    recordedAt: timestamp(root.recordedAt, "recordedAt"),
    bindingSha256: digest(root.bindingSha256, "bindingSha256"),
  };
  const roots = parsed.cases.flatMap((item) => item.roots);
  const expectedCounts = { cases: parsed.cases.length, bugBearing: parsed.cases.filter((item) => item.caseClass === "bug-bearing").length, reviewedComparison: parsed.cases.filter((item) => item.caseClass === "reviewed-comparison").length, registeredRoots: roots.length, highSeverityRoots: roots.filter((item) => item.expectedSeverity === "high").length };
  if (canonicalJson(parsed.counts) !== canonicalJson(expectedCounts)) throw new Error("R2 truth binding counts are inconsistent");
  const development = parsed.cases.filter((item) => item.partition === "development");
  const selection = parsed.cases.filter((item) => item.partition === "selection");
  if (parsed.cases.length !== 36 || development.length !== 12 || selection.length !== 24 ||
      development.filter((item) => item.caseClass === "bug-bearing").length !== 8 ||
      selection.filter((item) => item.caseClass === "bug-bearing").length !== 16) throw new Error("R2 truth binding does not preserve the admitted 36-case partition contract");
  const familyPartitions = new Map<string, R2Partition>();
  const repositoryCounts = new Map<string, number>();
  for (const item of parsed.cases) {
    const prior = familyPartitions.get(item.duplicateFamilySha256);
    if (prior !== undefined && prior !== item.partition) throw new Error("R2 truth binding duplicate family spans partitions");
    familyPartitions.set(item.duplicateFamilySha256, item.partition);
    repositoryCounts.set(item.repositoryIdentitySha256, (repositoryCounts.get(item.repositoryIdentitySha256) ?? 0) + 1);
  }
  if ([...repositoryCounts.values()].some((count) => count > 9)) throw new Error("R2 truth binding exceeds repository-family concentration limit");
  if (parsed.bindingSha256 !== canonicalJsonSha256(bodyOf(parsed))) throw new Error("R2 truth binding digest is invalid");
  return parsed;
}

function readInventory(directory: string): R2TruthBindingArtifact[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !FILE_NAME.test(entry.name))) throw new Error("R2 truth binding storage contains symlink, extra, or mixed files");
  const names = entries.map((entry) => entry.name).sort();
  const bindings = names.map((name) => parseR2TruthBindingArtifact(readExperimentJson(join(directory, name))));
  for (const [index, binding] of bindings.entries()) {
    if (binding.version !== index + 1 || binding.previousBindingSha256 !== (index === 0 ? null : bindings[index - 1]!.bindingSha256)) throw new Error("R2 truth binding lineage is not contiguous");
    if (index > 0 && Date.parse(binding.recordedAt) <= Date.parse(bindings[index - 1]!.recordedAt)) throw new Error("R2 truth binding timestamps must increase");
    if (names[index] !== `binding.v${String(binding.version).padStart(6, "0")}.json`) throw new Error("R2 truth binding filename is noncanonical");
  }
  return bindings;
}

function acquireLock(root: string): () => void {
  const path = join(root, ".r2-truth-binding.lock");
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("R2 truth binding storage is already being written");
    throw error;
  }
  return () => { closeSync(descriptor); unlinkSync(path); };
}

export function writeR2TruthBindingArtifact(rootValue: string, input: R2TruthBindingInput): R2TruthBindingArtifact {
  if (input.expectedPreviousBindingSha256 === undefined) throw new Error("expectedPreviousBindingSha256 is mandatory");
  buildR2TruthBindingArtifact(input, 1, input.expectedPreviousBindingSha256);
  const root = resolve(rootValue);
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error("R2 truth binding storage root must be a real directory");
  const release = acquireLock(root);
  try {
    const directory = join(root, R2_TRUTH_BINDING_DIRECTORY);
    if (existsSync(directory)) {
      if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error("R2 truth binding directory must be real");
    } else mkdirSync(directory, { mode: 0o700 });
    const prior = readInventory(directory).at(-1) ?? null;
    if (input.expectedPreviousBindingSha256 !== (prior?.bindingSha256 ?? null)) throw new Error("R2 truth binding predecessor is not the append-only head");
    const binding = buildR2TruthBindingArtifact(input, (prior?.version ?? 0) + 1, prior?.bindingSha256 ?? null);
    writeExclusiveJson(root, join(directory, `binding.v${String(binding.version).padStart(6, "0")}.json`), binding);
    return binding;
  } finally { release(); }
}

export function readR2TruthBindingArtifact(rootValue: string, expectedBindingSha256: string): R2TruthBindingArtifact {
  const directory = join(resolve(rootValue), R2_TRUTH_BINDING_DIRECTORY);
  if (!existsSync(directory) || lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error("R2 truth binding directory must be real");
  const expected = digest(expectedBindingSha256, "expectedBindingSha256");
  const binding = readInventory(directory).find((candidate) => candidate.bindingSha256 === expected);
  if (!binding) throw new Error("R2 truth binding digest mismatch");
  return binding;
}
