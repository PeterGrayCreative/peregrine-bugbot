import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalJsonSha256, readExperimentFile, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import { readHistoricalCaseAdmission, historicalTruthScopeSha256, type HistoricalCaseAdmission, type HistoricalCurationV3 } from "./historical-curation.js";
import { readAuthenticatedHistoricalMethodologyCase, type AuthenticatedHistoricalMethodologyCase } from "./historical-methodology-case.js";
import { parseHistoricalCuratorPolicy, type HistoricalCuratorPolicy } from "./historical-curator-policy.js";
import { loadCaseSpec } from "./run-matrix.js";
import type { HistoricalCaseSpec } from "../src/types.js";
import { verifyHumanReviewPacket, verifyHumanReviewResponse, type VerifiedHumanReviewResponse } from "../scripts/evidence/verify-human-review-response.js";

export const R2_PARTITION_PROTOCOL = "r2-post-admission-partition-v1" as const;
export const R2_PARTITION_DIRECTORY = "r2-partitions";
export const R2_PARTITION_ATTESTATION_PROTOCOL = "r2-partition-attestation-v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const FILE_NAME = /^r2-partition-(\d{6})\.json$/;
const FAMILY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type R2Partition = "development" | "selection";
export type R2CaseClass = "bug-bearing" | "reviewed-comparison";

export interface R2PartitionAttestationDossier {
  dossierId: string;
  partition: R2Partition;
  caseClass: R2CaseClass;
  duplicateFamilyId: string;
}

export interface R2PartitionAttestation {
  schemaVersion: 1;
  protocol: typeof R2_PARTITION_ATTESTATION_PROTOCOL;
  packetSha256: string;
  responseSha256: string;
  humanReviewerIdentitySha256: string;
  approvedDossiers: R2PartitionAttestationDossier[];
  soleHumanPartitionAccepted: true;
  independentSelectionClaimed: false;
  reviewedAt: string;
  selfSha256: string;
}

export interface R2PartitionCase {
  caseName: string;
  corpus: "development" | "validation";
  reviewDossierId: string;
  registrationSha256: string;
  curationSha256: string;
  caseBundleSha256: string;
  truthScopeSha256: string;
  repositoryIdentitySha256: string;
  caseClass: R2CaseClass;
  partition: R2Partition;
  duplicateFamilyId: string;
  duplicateFamilySha256: string;
}

export interface R2PartitionCounts {
  packet: { proposals: number; retainedLosses: number };
  response: { approve: number; reject: number; unresolved: number };
  approved: number;
  development: {
    total: number;
    bugBearing: number;
    reviewedComparison: number;
  };
  selection: { total: number; bugBearing: number; reviewedComparison: number };
}

export interface R2PartitionArtifact {
  schemaVersion: 1;
  protocol: typeof R2_PARTITION_PROTOCOL;
  version: number;
  previousArtifactSha256: string | null;
  packetSha256: string;
  responseSha256: string;
  responseCompletedAt: string;
  humanReviewerIdentitySha256: string;
  partitionAttestationFileSha256: string;
  partitionAttestationSelfSha256: string;
  partitionAttestationReviewedAt: string;
  claims: {
    soleHumanPartitionAccepted: true;
    duplicateFamilyAssignments: "sole-human-partition-attestation";
    independentSelectionClaimed: false;
    protectedSelectionEstablished: false;
  };
  counts: R2PartitionCounts;
  cases: R2PartitionCase[];
  result: "admitted" | "insufficient-corpus";
  deficits: string[];
  recordedAt: string;
  artifactSha256: string;
}

export interface R2PartitionCaseInput {
  caseDirectory: string;
}

export interface R2PartitionInput {
  packetDirectory: string;
  responseDirectory: string;
  partitionAttestationFile: string;
  trustedPolicy: HistoricalCuratorPolicy;
  expectedHumanIdentitySha256: string;
  /** No partition, class, or family data is accepted from the caller. */
  cases: readonly R2PartitionCaseInput[] | readonly string[];
  recordedAt: string;
  /** Mandatory: null is the explicit predecessor for a new store. */
  expectedPreviousArtifactSha256: string | null;
}

export interface ReadR2PartitionAttestationResult {
  attestation: R2PartitionAttestation;
  fileSha256: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !ISO_UTC_MILLISECONDS.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp with milliseconds`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(object, key))) {
    throw new Error(`${label} has an invalid shape`);
  }
  return object;
}

function withoutAttestationDigest(value: R2PartitionAttestation): Omit<R2PartitionAttestation, "selfSha256"> {
  const { selfSha256: _selfSha256, ...body } = value;
  return body;
}

function withoutArtifactDigest(value: R2PartitionArtifact): Omit<R2PartitionArtifact, "artifactSha256"> {
  const { artifactSha256: _artifactSha256, ...body } = value;
  return body;
}

/** A family is never taken from prose: this is its canonical, domain-separated digest. */
export function duplicateFamilySha256(duplicateFamilyId: string): string {
  if (!FAMILY_ID.test(duplicateFamilyId)) throw new Error("duplicateFamilyId must be a safe portable identifier");
  return createHash("sha256").update("peregrine-r2-duplicate-family-v1\0").update(canonicalJson(duplicateFamilyId)).digest("hex");
}

export function parseR2PartitionAttestation(value: unknown): R2PartitionAttestation {
  const root = exactObject(value, ["schemaVersion", "protocol", "packetSha256", "responseSha256", "humanReviewerIdentitySha256", "approvedDossiers", "soleHumanPartitionAccepted", "independentSelectionClaimed", "reviewedAt", "selfSha256"], "R2 partition attestation");
  if (root.schemaVersion !== 1 || root.protocol !== R2_PARTITION_ATTESTATION_PROTOCOL || root.soleHumanPartitionAccepted !== true || root.independentSelectionClaimed !== false) {
    throw new Error("R2 partition attestation claims are invalid");
  }
  if (!Array.isArray(root.approvedDossiers)) throw new Error("R2 partition attestation approvedDossiers must be an array");
  const seen = new Set<string>();
  const approvedDossiers = root.approvedDossiers.map((value, index): R2PartitionAttestationDossier => {
    const label = `R2 partition attestation approvedDossiers[${index}]`;
    const item = exactObject(value, ["dossierId", "partition", "caseClass", "duplicateFamilyId"], label);
    if (typeof item.dossierId !== "string" || item.dossierId.length === 0 || seen.has(item.dossierId)) throw new Error(`${label}.dossierId must be unique`);
    if (item.partition !== "development" && item.partition !== "selection") throw new Error(`${label}.partition is invalid`);
    if (item.caseClass !== "bug-bearing" && item.caseClass !== "reviewed-comparison") throw new Error(`${label}.caseClass is invalid`);
    if (typeof item.duplicateFamilyId !== "string" || !FAMILY_ID.test(item.duplicateFamilyId)) throw new Error(`${label}.duplicateFamilyId is unsafe`);
    seen.add(item.dossierId);
    return {
      dossierId: item.dossierId,
      partition: item.partition,
      caseClass: item.caseClass,
      duplicateFamilyId: item.duplicateFamilyId,
    };
  });
  const sorted = [...approvedDossiers].sort((a, b) => a.dossierId.localeCompare(b.dossierId));
  if (canonicalJson(approvedDossiers) !== canonicalJson(sorted)) throw new Error("R2 partition attestation dossiers must be sorted by dossierId");
  const parsed: R2PartitionAttestation = {
    schemaVersion: 1,
    protocol: R2_PARTITION_ATTESTATION_PROTOCOL,
    packetSha256: hash(root.packetSha256, "R2 partition attestation.packetSha256"),
    responseSha256: hash(root.responseSha256, "R2 partition attestation.responseSha256"),
    humanReviewerIdentitySha256: hash(root.humanReviewerIdentitySha256, "R2 partition attestation.humanReviewerIdentitySha256"),
    approvedDossiers,
    soleHumanPartitionAccepted: true,
    independentSelectionClaimed: false,
    reviewedAt: timestamp(root.reviewedAt, "R2 partition attestation.reviewedAt"),
    selfSha256: hash(root.selfSha256, "R2 partition attestation.selfSha256"),
  };
  if (parsed.selfSha256 !== canonicalJsonSha256(withoutAttestationDigest(parsed))) throw new Error("R2 partition attestation self digest is invalid");
  return parsed;
}

/** Build canonical bytes for the sole human to persist as a new, immutable attestation file. */
export function buildR2PartitionAttestation(
  value: Omit<R2PartitionAttestation, "selfSha256">,
): R2PartitionAttestation {
  return parseR2PartitionAttestation({
    ...value,
    selfSha256: canonicalJsonSha256(value),
  });
}

function directJsonFile(pathValue: string, label: string): { path: string; bytes: Buffer } {
  const path = resolve(pathValue);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct regular non-symlink file`);
  return { path, bytes: readExperimentFile(path) };
}

export function readR2PartitionAttestation(path: string): ReadR2PartitionAttestationResult {
  const file = directJsonFile(path, "R2 partition attestation");
  let value: unknown;
  try {
    value = JSON.parse(file.bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("R2 partition attestation contains invalid JSON");
  }
  return {
    attestation: parseR2PartitionAttestation(value),
    fileSha256: sha256(file.bytes),
  };
}

function countsFrom(cases: readonly R2PartitionCase[], packet: { proposals: number; retainedLosses: number }, response: VerifiedHumanReviewResponse["counts"]): R2PartitionCounts {
  const bucket = (partition: R2Partition, caseClass: R2CaseClass): number => cases.filter((item) => item.partition === partition && item.caseClass === caseClass).length;
  return {
    packet,
    response,
    approved: cases.length,
    development: {
      total: cases.filter((item) => item.partition === "development").length,
      bugBearing: bucket("development", "bug-bearing"),
      reviewedComparison: bucket("development", "reviewed-comparison"),
    },
    selection: {
      total: cases.filter((item) => item.partition === "selection").length,
      bugBearing: bucket("selection", "bug-bearing"),
      reviewedComparison: bucket("selection", "reviewed-comparison"),
    },
  };
}

function deficitsFor(cases: readonly R2PartitionCase[]): string[] {
  const deficits: string[] = [];
  if (cases.length !== 36) deficits.push(`exactly 36 approved cases required (received ${cases.length})`);
  const expected: Record<R2Partition, { total: number; bugBearing: number; reviewedComparison: number }> = {
    development: { total: 12, bugBearing: 8, reviewedComparison: 4 },
    selection: { total: 24, bugBearing: 16, reviewedComparison: 8 },
  };
  for (const partition of ["development", "selection"] as const) {
    const actual = {
      total: cases.filter((item) => item.partition === partition).length,
      bugBearing: cases.filter((item) => item.partition === partition && item.caseClass === "bug-bearing").length,
      reviewedComparison: cases.filter((item) => item.partition === partition && item.caseClass === "reviewed-comparison").length,
    };
    const wanted = expected[partition];
    if (actual.total !== wanted.total) deficits.push(`${partition} requires ${wanted.total} cases (received ${actual.total})`);
    if (actual.bugBearing !== wanted.bugBearing) deficits.push(`${partition} requires ${wanted.bugBearing} bug-bearing cases (received ${actual.bugBearing})`);
    if (actual.reviewedComparison !== wanted.reviewedComparison) deficits.push(`${partition} requires ${wanted.reviewedComparison} reviewed-comparison cases (received ${actual.reviewedComparison})`);
  }
  const repositories = new Map<string, number>();
  for (const item of cases) {
    repositories.set(item.repositoryIdentitySha256, (repositories.get(item.repositoryIdentitySha256) ?? 0) + 1);
  }
  for (const [repositoryIdentitySha256, count] of [...repositories.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (count > 9) {
      deficits.push(`repository family ${repositoryIdentitySha256} exceeds 25% of the 36-case corpus (${count} cases; maximum 9)`);
    }
  }
  return deficits;
}

function assertCountBindings(counts: R2PartitionCounts): void {
  const responseTotal = counts.response.approve + counts.response.reject + counts.response.unresolved;
  if (responseTotal !== counts.packet.proposals) {
    throw new Error("partition artifact response counts do not cover every packet proposal");
  }
  if (counts.response.approve !== counts.approved) {
    throw new Error("partition artifact approved count does not match authenticated response approvals");
  }
}

function suppliedDirectories(input: R2PartitionInput): string[] {
  const values = input.cases.map((entry) => (typeof entry === "string" ? entry : entry.caseDirectory));
  if (values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error("R2 partition cases must contain valid case directories");
  if (new Set(values).size !== values.length) throw new Error("R2 partition cases contain duplicate directories");
  return values;
}

function authenticate(
  input: R2PartitionInput,
  attestationResult: ReadR2PartitionAttestationResult,
): {
  packet: ReturnType<typeof verifyHumanReviewPacket>;
  response: VerifiedHumanReviewResponse;
  cases: R2PartitionCase[];
} {
  const policy = parseHistoricalCuratorPolicy(input.trustedPolicy, "R2 trusted policy");
  if (policy.schemaVersion !== 2 || policy.registeredHumanIdentitySha256 !== input.expectedHumanIdentitySha256) throw new Error("R2 requires the registered sole-human policy identity");
  const packet = verifyHumanReviewPacket(input.packetDirectory);
  const response = verifyHumanReviewResponse(input.packetDirectory, input.responseDirectory, policy.registeredHumanIdentitySha256);
  const attestation = attestationResult.attestation;
  if (attestation.packetSha256 !== packet.packetSha256 || attestation.packetSha256 !== response.packetSha256 || attestation.responseSha256 !== response.responseSha256 || attestation.humanReviewerIdentitySha256 !== response.humanReviewerIdentitySha256 || attestation.humanReviewerIdentitySha256 !== policy.registeredHumanIdentitySha256)
    throw new Error("R2 partition attestation is stale or uses the wrong human identity");
  if (Date.parse(attestation.reviewedAt) < Date.parse(response.completedAt)) {
    throw new Error("R2 partition attestation predates the completed human response");
  }
  const approved = response.decisions.filter((item) => item.decision === "approve");
  if (attestation.approvedDossiers.length !== approved.length || attestation.approvedDossiers.some((item) => !approved.some((decision) => decision.dossierId === item.dossierId))) throw new Error("R2 partition attestation does not exactly cover approved response dossiers");
  const byDossier = new Map(attestation.approvedDossiers.map((item) => [item.dossierId, item]));
  const cases: R2PartitionCase[] = [];
  for (const directory of suppliedDirectories(input)) {
    const caseDirectory = resolve(directory);
    const spec = loadCaseSpec(caseDirectory);
    if (spec.kind !== "historical") throw new Error(`${spec.id} is not a historical methodology case`);
    const historicalSpec: HistoricalCaseSpec = spec;
    const admission: HistoricalCaseAdmission = readHistoricalCaseAdmission(caseDirectory, historicalSpec, policy, {
      requireAdmitted: true,
    });
    if (admission.curation.schemaVersion !== 3 || admission.curation.status !== "admitted" || admission.curation.humanDecision === null) throw new Error(`${spec.id} is not an admitted sole-human v3 case`);
    const curation = admission.curation as HistoricalCurationV3;
    const auth: AuthenticatedHistoricalMethodologyCase = readAuthenticatedHistoricalMethodologyCase(caseDirectory, policy);
    if (curation.humanDecision === null) throw new Error(`${spec.id} has no human approval decision`);
    const truthScopeSha256 = historicalTruthScopeSha256(admission.truth);
    if (auth.registration.caseBundleSha256 !== admission.caseBundleSha256 || auth.registration.truth.scopeSha256 !== truthScopeSha256 || auth.registration.source.repositoryIdentitySha256 !== curation.source.repositoryIdentitySha256) throw new Error(`${spec.id} changed during authenticated registration read`);
    const decision = curation.humanDecision;
    const dossier = byDossier.get(curation.reviewDossierId);
    const responseDecision = response.decisions.find((item) => item.dossierId === curation.reviewDossierId);
    if (
      !dossier ||
      !responseDecision ||
      responseDecision.decision !== "approve" ||
      decision.packetSha256 !== response.packetSha256 ||
      decision.responseSha256 !== response.responseSha256 ||
      decision.humanReviewerIdentitySha256 !== response.humanReviewerIdentitySha256 ||
      decision.dossierBundleSha256 !== responseDecision.dossierBundleSha256 ||
      decision.responseDecisionSha256 !== responseDecision.responseFileSha256 ||
      decision.caseBundleSha256 !== admission.caseBundleSha256 ||
      decision.truthScopeSha256 !== truthScopeSha256
    )
      throw new Error(`${spec.id} human decision is stale or does not bind its authenticated sources`);
    if (spec.corpus !== (dossier.partition === "development" ? "development" : "validation")) throw new Error(`${spec.id} corpus does not match its partition`);
    const expectedClass: R2CaseClass = auth.truth.scope.status === "known-roots" ? "bug-bearing" : "reviewed-comparison";
    if (expectedClass !== dossier.caseClass) throw new Error(`${spec.id} class does not match authenticated truth status`);
    cases.push({
      caseName: auth.registration.caseName,
      corpus: spec.corpus === "development" ? "development" : "validation",
      reviewDossierId: curation.reviewDossierId,
      registrationSha256: auth.registration.registrationSha256,
      curationSha256: auth.registration.curationSha256,
      caseBundleSha256: admission.caseBundleSha256,
      truthScopeSha256,
      repositoryIdentitySha256: auth.registration.source.repositoryIdentitySha256,
      caseClass: dossier.caseClass,
      partition: dossier.partition,
      duplicateFamilyId: dossier.duplicateFamilyId,
      duplicateFamilySha256: duplicateFamilySha256(dossier.duplicateFamilyId),
    });
  }
  if (cases.length !== approved.length || approved.some((item) => !cases.some((candidate) => candidate.reviewDossierId === item.dossierId))) throw new Error("supplied admitted cases do not exactly cover approved response dossiers");
  const families = new Map<string, R2Partition>();
  const dossierIds = new Set<string>();
  for (const item of cases) {
    const prior = families.get(item.duplicateFamilySha256);
    if (prior !== undefined && prior !== item.partition) throw new Error("duplicate family spans partitions");
    families.set(item.duplicateFamilySha256, item.partition);
  }
  for (const item of cases) {
    if (dossierIds.has(item.reviewDossierId)) throw new Error("supplied cases contain a duplicate review dossier");
    dossierIds.add(item.reviewDossierId);
  }
  const packetAfter = verifyHumanReviewPacket(input.packetDirectory);
  const responseAfter = verifyHumanReviewResponse(input.packetDirectory, input.responseDirectory, policy.registeredHumanIdentitySha256);
  if (canonicalJson(packetAfter) !== canonicalJson(packet) || canonicalJson(responseAfter) !== canonicalJson(response)) {
    throw new Error("R2 packet or response changed across authenticated reads");
  }
  cases.sort((a, b) => a.caseName.localeCompare(b.caseName));
  return { packet, response, cases };
}

export function buildR2PartitionArtifact(input: R2PartitionInput, version = 1, previousArtifactSha256: string | null = null): R2PartitionArtifact {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("partition version must be a positive integer");
  if (previousArtifactSha256 !== null) hash(previousArtifactSha256, "previousArtifactSha256");
  timestamp(input.recordedAt, "recordedAt");
  const attestationResult = readR2PartitionAttestation(input.partitionAttestationFile);
  if (Date.parse(input.recordedAt) <= Date.parse(attestationResult.attestation.reviewedAt)) {
    throw new Error("R2 partition artifact must be recorded after its human attestation");
  }
  const authenticated = authenticate(input, attestationResult);
  const deficits = deficitsFor(authenticated.cases);
  const body: Omit<R2PartitionArtifact, "artifactSha256"> = {
    schemaVersion: 1,
    protocol: R2_PARTITION_PROTOCOL,
    version,
    previousArtifactSha256,
    packetSha256: authenticated.packet.packetSha256,
    responseSha256: authenticated.response.responseSha256,
    responseCompletedAt: authenticated.response.completedAt,
    humanReviewerIdentitySha256: authenticated.response.humanReviewerIdentitySha256,
    partitionAttestationFileSha256: attestationResult.fileSha256,
    partitionAttestationSelfSha256: attestationResult.attestation.selfSha256,
    partitionAttestationReviewedAt: attestationResult.attestation.reviewedAt,
    claims: {
      soleHumanPartitionAccepted: true,
      duplicateFamilyAssignments: "sole-human-partition-attestation",
      independentSelectionClaimed: false,
      protectedSelectionEstablished: false,
    },
    counts: countsFrom(
      authenticated.cases,
      {
        proposals: authenticated.packet.proposals,
        retainedLosses: authenticated.packet.retainedLosses,
      },
      authenticated.response.counts,
    ),
    cases: authenticated.cases,
    result: deficits.length === 0 ? "admitted" : "insufficient-corpus",
    deficits,
    recordedAt: input.recordedAt,
  };
  return { ...body, artifactSha256: canonicalJsonSha256(body) };
}

function parseCounts(value: unknown): R2PartitionCounts {
  const root = exactObject(value, ["packet", "response", "approved", "development", "selection"], "partition artifact.counts");
  const packet = exactObject(root.packet, ["proposals", "retainedLosses"], "partition artifact.counts.packet");
  const response = exactObject(root.response, ["approve", "reject", "unresolved"], "partition artifact.counts.response");
  const bucket = (value: unknown, label: string): R2PartitionCounts["development"] => {
    const item = exactObject(value, ["total", "bugBearing", "reviewedComparison"], label);
    return {
      total: integer(item.total, `${label}.total`),
      bugBearing: integer(item.bugBearing, `${label}.bugBearing`),
      reviewedComparison: integer(item.reviewedComparison, `${label}.reviewedComparison`),
    };
  };
  return {
    packet: {
      proposals: integer(packet.proposals, "counts.packet.proposals"),
      retainedLosses: integer(packet.retainedLosses, "counts.packet.retainedLosses"),
    },
    response: {
      approve: integer(response.approve, "counts.response.approve"),
      reject: integer(response.reject, "counts.response.reject"),
      unresolved: integer(response.unresolved, "counts.response.unresolved"),
    },
    approved: integer(root.approved, "counts.approved"),
    development: bucket(root.development, "counts.development"),
    selection: bucket(root.selection, "counts.selection"),
  };
}

export function parseR2PartitionArtifact(value: unknown): R2PartitionArtifact {
  const root = exactObject(value, ["schemaVersion", "protocol", "version", "previousArtifactSha256", "packetSha256", "responseSha256", "responseCompletedAt", "humanReviewerIdentitySha256", "partitionAttestationFileSha256", "partitionAttestationSelfSha256", "partitionAttestationReviewedAt", "claims", "counts", "cases", "result", "deficits", "recordedAt", "artifactSha256"], "R2 partition artifact");
  if (root.schemaVersion !== 1 || root.protocol !== R2_PARTITION_PROTOCOL) throw new Error("R2 partition artifact protocol is invalid");
  const previous = root.previousArtifactSha256 === null ? null : hash(root.previousArtifactSha256, "previousArtifactSha256");
  if (!Number.isSafeInteger(root.version) || Number(root.version) < 1) throw new Error("partition artifact.version must be positive");
  const claims = exactObject(root.claims, ["soleHumanPartitionAccepted", "duplicateFamilyAssignments", "independentSelectionClaimed", "protectedSelectionEstablished"], "partition artifact.claims");
  if (claims.soleHumanPartitionAccepted !== true || claims.duplicateFamilyAssignments !== "sole-human-partition-attestation" || claims.independentSelectionClaimed !== false || claims.protectedSelectionEstablished !== false) throw new Error("partition artifact claims are invalid");
  if (!Array.isArray(root.cases)) throw new Error("partition artifact.cases must be an array");
  const names = new Set<string>();
  const dossierIds = new Set<string>();
  const familyPartitions = new Map<string, R2Partition>();
  const cases = root.cases.map((value, index): R2PartitionCase => {
    const label = `partition artifact.cases[${index}]`;
    const item = exactObject(value, ["caseName", "corpus", "reviewDossierId", "registrationSha256", "curationSha256", "caseBundleSha256", "truthScopeSha256", "repositoryIdentitySha256", "caseClass", "partition", "duplicateFamilyId", "duplicateFamilySha256"], label);
    if (typeof item.caseName !== "string" || item.caseName.length === 0 || names.has(item.caseName)) throw new Error(`${label}.caseName must be unique`);
    if (typeof item.reviewDossierId !== "string" || item.reviewDossierId.length === 0 || dossierIds.has(item.reviewDossierId)) throw new Error(`${label}.reviewDossierId must be unique`);
    if (item.corpus !== "development" && item.corpus !== "validation") throw new Error(`${label}.corpus is invalid`);
    if (item.partition !== "development" && item.partition !== "selection") throw new Error(`${label}.partition is invalid`);
    if (item.caseClass !== "bug-bearing" && item.caseClass !== "reviewed-comparison") throw new Error(`${label}.caseClass is invalid`);
    if (item.corpus !== (item.partition === "development" ? "development" : "validation")) throw new Error(`${label}.corpus does not match partition`);
    if (!item.caseName.startsWith(`${item.corpus}/`) || item.caseName.slice(item.corpus.length + 1).length === 0) throw new Error(`${label}.caseName does not match corpus`);
    if (typeof item.duplicateFamilyId !== "string" || !FAMILY_ID.test(item.duplicateFamilyId)) throw new Error(`${label}.duplicateFamilyId is unsafe`);
    const parsed: R2PartitionCase = {
      caseName: item.caseName,
      corpus: item.corpus,
      reviewDossierId: item.reviewDossierId,
      registrationSha256: hash(item.registrationSha256, `${label}.registrationSha256`),
      curationSha256: hash(item.curationSha256, `${label}.curationSha256`),
      caseBundleSha256: hash(item.caseBundleSha256, `${label}.caseBundleSha256`),
      truthScopeSha256: hash(item.truthScopeSha256, `${label}.truthScopeSha256`),
      repositoryIdentitySha256: hash(item.repositoryIdentitySha256, `${label}.repositoryIdentitySha256`),
      caseClass: item.caseClass,
      partition: item.partition,
      duplicateFamilyId: item.duplicateFamilyId,
      duplicateFamilySha256: hash(item.duplicateFamilySha256, `${label}.duplicateFamilySha256`),
    };
    if (parsed.duplicateFamilySha256 !== duplicateFamilySha256(parsed.duplicateFamilyId)) throw new Error(`${label}.duplicateFamilySha256 does not match duplicateFamilyId`);
    const priorFamilyPartition = familyPartitions.get(parsed.duplicateFamilySha256);
    if (priorFamilyPartition !== undefined && priorFamilyPartition !== parsed.partition) throw new Error("partition artifact duplicate family spans partitions");
    familyPartitions.set(parsed.duplicateFamilySha256, parsed.partition);
    names.add(parsed.caseName);
    dossierIds.add(parsed.reviewDossierId);
    return parsed;
  });
  if (canonicalJson(cases) !== canonicalJson([...cases].sort((a, b) => a.caseName.localeCompare(b.caseName)))) throw new Error("partition artifact cases must be sorted by caseName");
  if (!Array.isArray(root.deficits) || root.deficits.some((value) => typeof value !== "string") || new Set(root.deficits).size !== root.deficits.length) throw new Error("partition artifact.deficits is invalid");
  const result =
    root.result === "admitted" || root.result === "insufficient-corpus"
      ? root.result
      : (() => {
          throw new Error("partition artifact.result is invalid");
        })();
  const parsed: R2PartitionArtifact = {
    schemaVersion: 1,
    protocol: R2_PARTITION_PROTOCOL,
    version: Number(root.version),
    previousArtifactSha256: previous,
    packetSha256: hash(root.packetSha256, "packetSha256"),
    responseSha256: hash(root.responseSha256, "responseSha256"),
    responseCompletedAt: timestamp(root.responseCompletedAt, "responseCompletedAt"),
    humanReviewerIdentitySha256: hash(root.humanReviewerIdentitySha256, "humanReviewerIdentitySha256"),
    partitionAttestationFileSha256: hash(root.partitionAttestationFileSha256, "partitionAttestationFileSha256"),
    partitionAttestationSelfSha256: hash(root.partitionAttestationSelfSha256, "partitionAttestationSelfSha256"),
    partitionAttestationReviewedAt: timestamp(root.partitionAttestationReviewedAt, "partitionAttestationReviewedAt"),
    claims: {
      soleHumanPartitionAccepted: true,
      duplicateFamilyAssignments: "sole-human-partition-attestation",
      independentSelectionClaimed: false,
      protectedSelectionEstablished: false,
    },
    counts: parseCounts(root.counts),
    cases,
    result,
    deficits: [...root.deficits],
    recordedAt: timestamp(root.recordedAt, "recordedAt"),
    artifactSha256: hash(root.artifactSha256, "artifactSha256"),
  };
  const recomputedCounts = countsFrom(parsed.cases, parsed.counts.packet, parsed.counts.response);
  if (canonicalJson(parsed.counts) !== canonicalJson(recomputedCounts)) throw new Error("partition artifact counts are inconsistent with cases");
  assertCountBindings(parsed.counts);
  if (Date.parse(parsed.partitionAttestationReviewedAt) < Date.parse(parsed.responseCompletedAt) || Date.parse(parsed.recordedAt) <= Date.parse(parsed.partitionAttestationReviewedAt)) {
    throw new Error("partition artifact chronology is invalid");
  }
  const expectedDeficits = deficitsFor(parsed.cases);
  if (canonicalJson(parsed.deficits) !== canonicalJson(expectedDeficits) || parsed.result !== (expectedDeficits.length === 0 ? "admitted" : "insufficient-corpus")) throw new Error("partition artifact result or deficits are invalid");
  if (parsed.artifactSha256 !== canonicalJsonSha256(withoutArtifactDigest(parsed))) throw new Error("partition artifact digest is invalid");
  return parsed;
}

function readInventory(directory: string): R2PartitionArtifact[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !FILE_NAME.test(entry.name))) throw new Error("partition storage contains symlink, extra, or mixed files");
  const names = entries.map((entry) => entry.name).sort();
  const artifacts = names.map((name) => parseR2PartitionArtifact(readExperimentJson(join(directory, name))));
  for (const [index, artifact] of artifacts.entries()) {
    if (artifact.version !== index + 1 || artifact.previousArtifactSha256 !== (index === 0 ? null : artifacts[index - 1]!.artifactSha256)) throw new Error("partition artifact lineage is not contiguous");
    if (index > 0 && Date.parse(artifact.recordedAt) <= Date.parse(artifacts[index - 1]!.recordedAt)) throw new Error("partition artifact timestamps must increase");
    if (names[index] !== `r2-partition-${String(artifact.version).padStart(6, "0")}.json`) throw new Error("partition artifact filename is noncanonical");
  }
  return artifacts;
}

function acquireLock(root: string): () => void {
  const path = join(root, ".r2-partition.lock");
  let descriptor: number;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("R2 partition storage is already being written");
    throw error;
  }
  return () => {
    closeSync(descriptor);
    unlinkSync(path);
  };
}

export function writeR2PartitionArtifact(rootValue: string, input: R2PartitionInput): R2PartitionArtifact {
  if (input.expectedPreviousArtifactSha256 === undefined) throw new Error("expectedPreviousArtifactSha256 is mandatory");
  // This read authenticates packet, response, attestation, and every case before mkdir/write.
  buildR2PartitionArtifact(input, 1, input.expectedPreviousArtifactSha256);
  const root = resolve(rootValue);
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error("partition storage root must be a real directory");
  const release = acquireLock(root);
  try {
    const directory = join(root, R2_PARTITION_DIRECTORY);
    if (existsSync(directory)) {
      if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error("partition storage directory must be a real directory");
    } else mkdirSync(directory, { mode: 0o700 });
    const prior = readInventory(directory).at(-1) ?? null;
    if (input.expectedPreviousArtifactSha256 !== (prior?.artifactSha256 ?? null)) throw new Error("partition predecessor is not the current append-only head");
    const artifact = buildR2PartitionArtifact(input, (prior?.version ?? 0) + 1, prior?.artifactSha256 ?? null);
    writeExclusiveJson(root, join(directory, `r2-partition-${String(artifact.version).padStart(6, "0")}.json`), artifact);
    return artifact;
  } finally {
    release();
  }
}

export function readR2PartitionArtifact(rootValue: string, expectedArtifactSha256: string): R2PartitionArtifact {
  const directory = join(resolve(rootValue), R2_PARTITION_DIRECTORY);
  if (!existsSync(directory) || lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error("partition storage directory must be a real directory");
  const expected = hash(expectedArtifactSha256, "expectedArtifactSha256");
  const artifact = readInventory(directory).find((candidate) => candidate.artifactSha256 === expected);
  if (!artifact) throw new Error("partition artifact digest mismatch");
  return artifact;
}

export const parsePartitionAttestation = parseR2PartitionAttestation;
export const readPartitionAttestation = readR2PartitionAttestation;
