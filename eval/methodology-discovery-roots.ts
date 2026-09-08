import { createHash, createHmac, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import {
  readMethodologyAdjudicationArtifact,
  readMethodologyGradeSet,
  type MethodologyGradeSetArtifact,
} from "./methodology-analysis-artifacts.js";
import type { MethodologyAdjudicationLedger } from "./methodology-adjudication.js";
import type { MethodologyFinding } from "./methodology-output.js";
import {
  assertLegacyMethodologyGradeSetMatchesSealed,
  readMethodologySealedJudgeGradeSet,
} from "./methodology-sealed-grade-artifact.js";
import {
  readMethodologySealedAnalysisBinding,
  type MethodologySealedAnalysisBindingReadInputs,
} from "./methodology-sealed-analysis-binding.js";
import {
  METHODOLOGY_ARM_IDS,
  parseMethodologySchedule,
  type MethodologyArmId,
  type MethodologySchedule,
} from "./methodology-schedule.js";

export const METHODOLOGY_DISCOVERY_CURATOR_PACKET_PROTOCOL =
  "historical-methodology-discovery-curator-packet-v1" as const;
export const METHODOLOGY_DISCOVERY_ROOT_PROTOCOL =
  "historical-methodology-discovery-roots-v1" as const;
export const METHODOLOGY_DISCOVERY_ROOT_LEDGER_FILE =
  "methodology-discovery-root-ledger.json";
export const METHODOLOGY_DISCOVERY_BLINDING_KEY_FILE =
  "methodology-discovery-blinding-key.json";
export const METHODOLOGY_DISCOVERY_BLINDING_KEY_PROTOCOL =
  "historical-methodology-discovery-blinding-key-v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const OCCURRENCE_ID = /^occurrence-[a-f0-9]{64}$/;
const ROOT_ID = /^root-[a-f0-9]{64}$/;
const BLINDING_KEY_BRAND: unique symbol = Symbol("methodology-discovery-blinding-key");
const BLINDING_KEYS = new WeakMap<object, {
  keyMaterial: Buffer;
  receipt: MethodologyDiscoveryBlindingKeyReceipt;
}>();
const PACKET_ITEM_KEYS = [
  "occurrenceId", "caseName", "file", "startLine", "endLine", "severity",
  "explanation", "impact",
] as const;
const ROOT_INPUT_KEYS = ["rootId", "occurrenceIds", "causalMechanism", "evidence"] as const;
const LEDGER_KEYS = [
  "schemaVersion", "protocol", "runId", "sealedGradeSetArtifactSha256",
  "sealedAnalysisBindingSha256", "legacyGradeSetArtifactSha256",
  "adjudicationLedgerSha256", "discoveryImplementationSha256",
  "blindingKeyArtifactSha256", "packetSha256",
  "curatorIdentitySha256", "reviewProtocol", "recordedAt", "roots", "counts",
  "claims",
  "ledgerSha256",
] as const;

export type MethodologyDiscoveryBlindingKey = {
  readonly [BLINDING_KEY_BRAND]: true;
};

export interface MethodologyDiscoveryBlindingKeyReceipt {
  readonly schemaVersion: 1;
  readonly protocol: typeof METHODOLOGY_DISCOVERY_BLINDING_KEY_PROTOCOL;
  readonly runId: string;
  readonly recordedAt: string;
  readonly artifactSha256: string;
}

/**
 * Persist a protected operator-only key before producing the curator packet.
 * The key file is never a curator or reviewer resource.
 */
export function writeMethodologyDiscoveryBlindingKey(operatorRoot: string, input: {
  runId: string;
  recordedAt: string;
}): { key: MethodologyDiscoveryBlindingKey; receipt: MethodologyDiscoveryBlindingKeyReceipt } {
  const root = protectedOperatorRoot(operatorRoot);
  const keyMaterial = randomBytes(32);
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_DISCOVERY_BLINDING_KEY_PROTOCOL,
    runId: runId(input.runId),
    keyMaterialHex: keyMaterial.toString("hex"),
    recordedAt: canonicalTimestamp(input.recordedAt),
  };
  const artifact = {
    ...body,
    artifactSha256: domainSha("peregrine-methodology-discovery-blinding-key-artifact-v1", body),
  };
  writeExclusiveJson(root, join(root, METHODOLOGY_DISCOVERY_BLINDING_KEY_FILE), artifact);
  const receipt = blindingKeyReceipt(artifact);
  return { key: registerBlindingKey(keyMaterial, receipt), receipt };
}

/** Reopen the operator key after process restart using a caller-held digest. */
export function readMethodologyDiscoveryBlindingKey(operatorRoot: string, input: {
  runId: string;
  expectedArtifactSha256: string;
}): { key: MethodologyDiscoveryBlindingKey; receipt: MethodologyDiscoveryBlindingKeyReceipt } {
  const root = protectedOperatorRoot(operatorRoot);
  const raw = readExperimentJson(join(root, METHODOLOGY_DISCOVERY_BLINDING_KEY_FILE));
  const item = exactObject(raw, [
    "schemaVersion", "protocol", "runId", "keyMaterialHex", "recordedAt", "artifactSha256",
  ] as const, "methodology discovery blinding key artifact");
  if (item.schemaVersion !== 1 || item.protocol !== METHODOLOGY_DISCOVERY_BLINDING_KEY_PROTOCOL ||
      item.runId !== runId(input.runId) || typeof item.keyMaterialHex !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.keyMaterialHex)) {
    throw new Error("methodology discovery blinding key artifact is invalid");
  }
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_DISCOVERY_BLINDING_KEY_PROTOCOL,
    runId: item.runId,
    keyMaterialHex: item.keyMaterialHex,
    recordedAt: canonicalTimestamp(item.recordedAt),
  };
  const artifactSha256 = domainSha("peregrine-methodology-discovery-blinding-key-artifact-v1", body);
  if (item.artifactSha256 !== digest(input.expectedArtifactSha256, "expectedArtifactSha256") ||
      item.artifactSha256 !== artifactSha256) {
    throw new Error("methodology discovery blinding key artifact digest mismatch");
  }
  return {
    key: registerBlindingKey(
      Buffer.from(item.keyMaterialHex, "hex"),
      blindingKeyReceipt({ ...body, artifactSha256 }),
    ),
    receipt: blindingKeyReceipt({ ...body, artifactSha256 }),
  };
}

/** Bind discovery packet/grouping behavior to the exact implementation bytes. */
export function methodologyDiscoveryImplementationSha256(): string {
  return createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
}

export interface MethodologyDiscoveryArtifactInputs extends
  Omit<MethodologySealedAnalysisBindingReadInputs, "expectedBindingSha256"> {
  schedule: unknown;
  expectedSealedAnalysisBindingSha256: string;
  expectedLegacyGradeSetArtifactSha256: string;
  expectedAdjudicationLedgerSha256: string;
  expectedBlindingKeyArtifactSha256: string;
  /** Operator-held opaque key. Give the curator only the derived packet. */
  blindingKey: MethodologyDiscoveryBlindingKey;
}

export interface MethodologyDiscoveryCuratorPacketItem {
  occurrenceId: string;
  caseName: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: MethodologyFinding["severity"];
  explanation: string;
  impact: string;
}

export interface MethodologyDiscoveryCuratorPacket {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_DISCOVERY_CURATOR_PACKET_PROTOCOL;
  runId: string;
  sealedAnalysisBindingSha256: string;
  sealedGradeSetArtifactSha256: string;
  legacyGradeSetArtifactSha256: string;
  adjudicationLedgerSha256: string;
  discoveryImplementationSha256: string;
  blindingKeyArtifactSha256: string;
  blindingKeySha256: string;
  seed: number;
  items: MethodologyDiscoveryCuratorPacketItem[];
  counts: { confirmedNewOccurrences: number };
  packetSha256: string;
}

export interface MethodologyDiscoveryRootInput {
  rootId: string;
  occurrenceIds: string[];
  causalMechanism: string;
  evidence: string;
}

export interface MethodologyDiscoveryRootLedger {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_DISCOVERY_ROOT_PROTOCOL;
  runId: string;
  sealedAnalysisBindingSha256: string;
  sealedGradeSetArtifactSha256: string;
  legacyGradeSetArtifactSha256: string;
  adjudicationLedgerSha256: string;
  discoveryImplementationSha256: string;
  blindingKeyArtifactSha256: string;
  packetSha256: string;
  curatorIdentitySha256: string;
  reviewProtocol: "curator-packet-omits-arm-route-timing-v1";
  recordedAt: string;
  roots: MethodologyDiscoveryRootInput[];
  counts: { confirmedNewOccurrences: number; discoveryRoots: number };
  claims: {
    curatorPacket: "arm-route-timing-omitted";
    curatorBlindness: "operator-mediated-not-independently-attested";
  };
  ledgerSha256: string;
}

export interface MethodologyDiscoveryRootSummary {
  schemaVersion: 1;
  protocol: "historical-methodology-discovery-summary-v1";
  runId: string;
  discoveryRootLedgerSha256: string;
  roots: Array<{
    rootId: string;
    causalMechanism: string;
    evidence: string;
    occurrenceCount: number;
    attemptCount: number;
    caseCount: number;
    armIds: MethodologyArmId[];
    armCoverage: "arm-only" | "shared";
    repeatReliability: Array<{
      armId: MethodologyArmId;
      detectingAttempts: number;
      scheduledAttempts: number;
    }>;
  }>;
  counts: { confirmedNewOccurrences: number; discoveryRoots: number };
  claims: {
    frozenKnownRootRecall: "unchanged";
    discoveryAnalysis: "post-hoc-separate";
    totalRecall: "not-established";
    independentCuration: "not-established";
  };
  summarySha256: string;
}

interface DiscoverySource {
  schedule: MethodologySchedule;
  gradeSet: MethodologyGradeSetArtifact;
  adjudication: MethodologyAdjudicationLedger;
  packet: MethodologyDiscoveryCuratorPacket;
  occurrenceSources: ReadonlyMap<string, {
    attemptId: string;
    caseName: string;
    armId: MethodologyArmId;
  }>;
}

/** Build the curator-visible discovery packet; never mount this packet to review agents. */
export function buildMethodologyDiscoveryCuratorPacket(
  analysisRoot: string,
  input: MethodologyDiscoveryArtifactInputs,
): MethodologyDiscoveryCuratorPacket {
  return loadDiscoverySource(analysisRoot, input).packet;
}

/** Persist one append-only blind curator grouping over every confirmed-new occurrence. */
export function writeMethodologyDiscoveryRootLedger(analysisRoot: string, input: {
  source: MethodologyDiscoveryArtifactInputs;
  expectedPacketSha256: string;
  curatorIdentitySha256: string;
  reviewProtocol: "curator-packet-omits-arm-route-timing-v1";
  recordedAt: string;
  roots: readonly MethodologyDiscoveryRootInput[];
}): MethodologyDiscoveryRootLedger {
  const source = loadDiscoverySource(analysisRoot, input.source);
  if (source.packet.packetSha256 !== digest(input.expectedPacketSha256, "expectedPacketSha256")) {
    throw new Error("methodology discovery packet does not match its caller-held digest");
  }
  const ledger = buildRootLedger({
    packet: source.packet,
    curatorIdentitySha256: input.curatorIdentitySha256,
    reviewProtocol: input.reviewProtocol,
    recordedAt: input.recordedAt,
    roots: input.roots,
  });
  assertNoSecrets(ledger, "methodology discovery root ledger");
  writeExclusiveJson(analysisRoot, join(analysisRoot, METHODOLOGY_DISCOVERY_ROOT_LEDGER_FILE), ledger);
  return ledger;
}

/** Read only when the caller retains every source digest and the exact ledger digest. */
export function readMethodologyDiscoveryRootLedger(analysisRoot: string, input: {
  source: MethodologyDiscoveryArtifactInputs;
  expectedPacketSha256: string;
  expectedLedgerSha256: string;
}): MethodologyDiscoveryRootLedger {
  const source = loadDiscoverySource(analysisRoot, input.source);
  if (source.packet.packetSha256 !== digest(input.expectedPacketSha256, "expectedPacketSha256")) {
    throw new Error("methodology discovery packet does not match its caller-held digest");
  }
  const raw = readExperimentJson(join(analysisRoot, METHODOLOGY_DISCOVERY_ROOT_LEDGER_FILE));
  const item = exactObject(raw, LEDGER_KEYS, "methodology discovery root ledger");
  const ledger = buildRootLedger({
    packet: source.packet,
    curatorIdentitySha256: item.curatorIdentitySha256,
    reviewProtocol: item.reviewProtocol,
    recordedAt: item.recordedAt,
    roots: item.roots as readonly MethodologyDiscoveryRootInput[],
  });
  if (ledger.ledgerSha256 !== digest(input.expectedLedgerSha256, "expectedLedgerSha256") ||
      canonicalJson(ledger) !== canonicalJson(raw)) {
    throw new Error("methodology discovery root ledger digest mismatch");
  }
  assertNoSecrets(ledger, "methodology discovery root ledger");
  return ledger;
}

/** Join blind root groups back to schedule metadata only after the ledger is sealed. */
export function deriveMethodologyDiscoveryRootSummary(analysisRoot: string, input: {
  source: MethodologyDiscoveryArtifactInputs;
  expectedPacketSha256: string;
  expectedLedgerSha256: string;
}): MethodologyDiscoveryRootSummary {
  const source = loadDiscoverySource(analysisRoot, input.source);
  const ledger = readMethodologyDiscoveryRootLedger(analysisRoot, input);
  const roots = ledger.roots.map((root) => {
    const members = root.occurrenceIds.map((id) => {
      const member = source.occurrenceSources.get(id);
      if (!member) throw new Error("methodology discovery root references an unknown occurrence");
      return member;
    });
    const attemptIds = new Set(members.map((member) => member.attemptId));
    const caseNames = [...new Set(members.map((member) => member.caseName))].sort();
    const armIds = METHODOLOGY_ARM_IDS.filter((armId) => members.some((member) => member.armId === armId));
    const repeatReliability = METHODOLOGY_ARM_IDS.map((armId) => {
      const scheduledAttempts = source.schedule.attempts.filter((attempt) =>
        caseNames.includes(attempt.caseName) && attempt.armId === armId).length;
      const detectingAttempts = new Set(members.filter((member) => member.armId === armId)
        .map((member) => member.attemptId)).size;
      return { armId, detectingAttempts, scheduledAttempts };
    });
    return {
      rootId: root.rootId,
      causalMechanism: root.causalMechanism,
      evidence: root.evidence,
      occurrenceCount: root.occurrenceIds.length,
      attemptCount: attemptIds.size,
      caseCount: caseNames.length,
      armIds,
      armCoverage: armIds.length === 1 ? "arm-only" as const : "shared" as const,
      repeatReliability,
    };
  });
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-discovery-summary-v1" as const,
    runId: ledger.runId,
    discoveryRootLedgerSha256: ledger.ledgerSha256,
    roots,
    counts: ledger.counts,
    claims: {
      frozenKnownRootRecall: "unchanged" as const,
      discoveryAnalysis: "post-hoc-separate" as const,
      totalRecall: "not-established" as const,
      independentCuration: "not-established" as const,
    },
  };
  return { ...body, summarySha256: domainSha("peregrine-methodology-discovery-summary-v1", body) };
}

function loadDiscoverySource(analysisRoot: string, input: MethodologyDiscoveryArtifactInputs): DiscoverySource {
  const blinding = readBlindingKey(input.blindingKey);
  const blindingKey = blinding.keyMaterial;
  const blindingKeySha256 = domainSha("peregrine-methodology-discovery-blinding-key-v1",
    blindingKey.toString("hex"));
  const blindingKeyArtifactSha256 = digest(input.expectedBlindingKeyArtifactSha256,
    "expectedBlindingKeyArtifactSha256");
  const discoveryImplementationSha256 = methodologyDiscoveryImplementationSha256();
  const expectedBinding = digest(input.expectedSealedAnalysisBindingSha256,
    "expectedSealedAnalysisBindingSha256");
  const {
    schedule: scheduleValue,
    expectedSealedAnalysisBindingSha256: _expectedBinding,
    expectedLegacyGradeSetArtifactSha256: _expectedLegacy,
    expectedAdjudicationLedgerSha256: _expectedAdjudication,
    expectedBlindingKeyArtifactSha256: _expectedBlindingKeyArtifact,
    blindingKey: _blindingKey,
    ...bindingReadInputs
  } = input;
  const binding = readMethodologySealedAnalysisBinding(analysisRoot, {
    ...bindingReadInputs,
    expectedBindingSha256: expectedBinding,
  });
  const expectedSealed = digest(input.expectedSealedGradeSetArtifactSha256,
    "expectedSealedGradeSetArtifactSha256");
  const expectedLegacy = digest(input.expectedLegacyGradeSetArtifactSha256,
    "expectedLegacyGradeSetArtifactSha256");
  const expectedAdjudication = digest(input.expectedAdjudicationLedgerSha256,
    "expectedAdjudicationLedgerSha256");
  const schedule = parseMethodologySchedule(scheduleValue, "methodology discovery schedule");
  const sealed = readMethodologySealedJudgeGradeSet(analysisRoot, expectedSealed);
  const gradeSet = readMethodologyGradeSet(analysisRoot, expectedLegacy);
  assertLegacyMethodologyGradeSetMatchesSealed(gradeSet, sealed);
  if (binding.bindingSha256 !== expectedBinding ||
      binding.sealedGradeSetArtifactSha256 !== expectedSealed ||
      binding.legacyGradeSetArtifactSha256 !== expectedLegacy ||
      binding.runId !== sealed.runId || sealed.runId !== gradeSet.runId ||
      binding.scheduleSha256 !== canonicalJsonSha256(schedule) ||
      canonicalJson(schedule) !== canonicalJson(gradeSet.schedule)) {
    throw new Error("methodology discovery artifacts do not match the sealed analysis binding, schedule, or run");
  }
  if (blinding.receipt.runId !== sealed.runId ||
      blinding.receipt.artifactSha256 !== blindingKeyArtifactSha256) {
    throw new Error("methodology discovery blinding key belongs to a different run or artifact");
  }
  const adjudication = readMethodologyAdjudicationArtifact(analysisRoot, {
    expectedLedgerSha256: expectedAdjudication,
    gradeSet,
  });
  if (adjudication.runId !== sealed.runId ||
      adjudication.gradeSetSha256 !== sealed.gradeSetSha256) {
    throw new Error("methodology discovery adjudication belongs to a different run");
  }
  const attemptById = new Map(schedule.attempts.map((attempt) => [attempt.id, attempt]));
  const gradeById = new Map(gradeSet.grades.map((grade) => [grade.projection.attemptId, grade]));
  const confirmed = adjudication.records.filter((record) => record.classification === "confirmed-new");
  const materialized = confirmed.map((record) => {
    const grade = gradeById.get(record.attemptId);
    const attempt = attemptById.get(record.attemptId);
    const finding = grade?.findings.find((candidate) => candidate.findingIndex === record.findingIndex);
    if (!grade || !attempt || !finding || finding.evidenceSha256 !== record.findingEvidenceSha256 ||
        grade.projection.caseName !== attempt.caseName) {
      throw new Error("methodology discovery confirmed-new occurrence is not bound to its grade and schedule");
    }
    const occurrenceId = `occurrence-${keyedDomainSha(blindingKey,
      "peregrine-methodology-discovery-occurrence-v1", {
      runId: sealed.runId,
      attemptId: record.attemptId,
      findingIndex: record.findingIndex,
      findingEvidenceSha256: record.findingEvidenceSha256,
    })}`;
    return {
      item: neutralPacketItem(occurrenceId, attempt.caseName, finding),
      source: { attemptId: attempt.id, caseName: attempt.caseName, armId: attempt.armId },
    };
  });
  if (new Set(materialized.map(({ item }) => item.occurrenceId)).size !== materialized.length) {
    throw new Error("methodology discovery occurrence identifiers are not unique");
  }
  const seed = Number.parseInt(domainSha("peregrine-methodology-discovery-order-seed-v1", {
    scheduleSeed: schedule.design.seed,
    runId: sealed.runId,
    sealedAnalysisBindingSha256: expectedBinding,
    sealedGradeSetArtifactSha256: expectedSealed,
    legacyGradeSetArtifactSha256: expectedLegacy,
    adjudicationLedgerSha256: expectedAdjudication,
    discoveryImplementationSha256,
    blindingKeyArtifactSha256,
    blindingKeySha256,
  }).slice(0, 8), 16);
  materialized.sort((left, right) =>
    discoveryOrder(seed, left.item.occurrenceId).localeCompare(discoveryOrder(seed, right.item.occurrenceId)) ||
    left.item.occurrenceId.localeCompare(right.item.occurrenceId));
  const items = materialized.map(({ item }) => item);
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_DISCOVERY_CURATOR_PACKET_PROTOCOL,
    runId: sealed.runId,
    sealedAnalysisBindingSha256: expectedBinding,
    sealedGradeSetArtifactSha256: expectedSealed,
    legacyGradeSetArtifactSha256: expectedLegacy,
    adjudicationLedgerSha256: expectedAdjudication,
    discoveryImplementationSha256,
    blindingKeyArtifactSha256,
    blindingKeySha256,
    seed,
    items,
    counts: { confirmedNewOccurrences: items.length },
  };
  const packet = { ...body, packetSha256: domainSha("peregrine-methodology-discovery-packet-v1", body) };
  assertNoSecrets(packet, "methodology discovery curator packet");
  return {
    schedule,
    gradeSet,
    adjudication,
    packet,
    occurrenceSources: new Map(materialized.map(({ item, source }) => [item.occurrenceId, source])),
  };
}

function buildRootLedger(input: {
  packet: MethodologyDiscoveryCuratorPacket;
  curatorIdentitySha256: unknown;
  reviewProtocol: unknown;
  recordedAt: unknown;
  roots: readonly MethodologyDiscoveryRootInput[];
}): MethodologyDiscoveryRootLedger {
  const curatorIdentitySha256 = digest(input.curatorIdentitySha256, "curatorIdentitySha256");
  if (input.reviewProtocol !== "curator-packet-omits-arm-route-timing-v1") {
    throw new Error("methodology discovery root curation requires the arm/route/timing-omitting packet");
  }
  if (!Array.isArray(input.roots)) throw new Error("methodology discovery roots must be an array");
  const roots = input.roots.map((root, index) => parseRoot(root, index))
    .sort((left, right) => left.rootId.localeCompare(right.rootId));
  if (new Set(roots.map((root) => root.rootId)).size !== roots.length) {
    throw new Error("methodology discovery root identifiers must be unique");
  }
  const members = roots.flatMap((root) => root.occurrenceIds);
  if (new Set(members).size !== members.length) {
    throw new Error("methodology discovery occurrence appears in more than one root");
  }
  const expected = input.packet.items.map((item) => item.occurrenceId).sort();
  if (canonicalJson([...members].sort()) !== canonicalJson(expected)) {
    throw new Error("methodology discovery roots must cover every and only packet occurrence");
  }
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_DISCOVERY_ROOT_PROTOCOL,
    runId: input.packet.runId,
    sealedAnalysisBindingSha256: input.packet.sealedAnalysisBindingSha256,
    sealedGradeSetArtifactSha256: input.packet.sealedGradeSetArtifactSha256,
    legacyGradeSetArtifactSha256: input.packet.legacyGradeSetArtifactSha256,
    adjudicationLedgerSha256: input.packet.adjudicationLedgerSha256,
    discoveryImplementationSha256: input.packet.discoveryImplementationSha256,
    blindingKeyArtifactSha256: input.packet.blindingKeyArtifactSha256,
    packetSha256: input.packet.packetSha256,
    curatorIdentitySha256,
    reviewProtocol: "curator-packet-omits-arm-route-timing-v1" as const,
    recordedAt: canonicalTimestamp(input.recordedAt),
    roots,
    counts: { confirmedNewOccurrences: expected.length, discoveryRoots: roots.length },
    claims: {
      curatorPacket: "arm-route-timing-omitted" as const,
      curatorBlindness: "operator-mediated-not-independently-attested" as const,
    },
  };
  return { ...body, ledgerSha256: domainSha("peregrine-methodology-discovery-root-ledger-v1", body) };
}

function neutralPacketItem(
  occurrenceId: string,
  caseName: string,
  finding: MethodologyFinding,
): MethodologyDiscoveryCuratorPacketItem {
  if (!OCCURRENCE_ID.test(occurrenceId) || !CASE_NAME.test(caseName)) {
    throw new Error("methodology discovery packet identity is invalid");
  }
  const item = exactObject({
    occurrenceId,
    caseName,
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    severity: finding.severity,
    explanation: finding.explanation,
    impact: finding.impact,
  }, PACKET_ITEM_KEYS, "methodology discovery packet item");
  return item as unknown as MethodologyDiscoveryCuratorPacketItem;
}

function parseRoot(value: unknown, index: number): MethodologyDiscoveryRootInput {
  const label = `methodology discovery roots[${index}]`;
  const item = exactObject(value, ROOT_INPUT_KEYS, label);
  if (typeof item.rootId !== "string" || !ROOT_ID.test(item.rootId)) {
    throw new Error(`${label}.rootId must be an opaque root SHA-256 ID`);
  }
  if (!Array.isArray(item.occurrenceIds) || item.occurrenceIds.length === 0) {
    throw new Error(`${label}.occurrenceIds must be a non-empty array`);
  }
  const occurrenceIds = item.occurrenceIds.map((id, memberIndex) => {
    if (typeof id !== "string" || !OCCURRENCE_ID.test(id)) {
      throw new Error(`${label}.occurrenceIds[${memberIndex}] is invalid`);
    }
    return id;
  }).sort();
  if (new Set(occurrenceIds).size !== occurrenceIds.length) {
    throw new Error(`${label}.occurrenceIds contains a duplicate`);
  }
  return {
    rootId: item.rootId,
    occurrenceIds,
    causalMechanism: boundedText(item.causalMechanism, `${label}.causalMechanism`),
    evidence: boundedText(item.evidence, `${label}.evidence`),
  };
}

function exactObject<const Keys extends readonly string[]>(value: unknown, keys: Keys, label: string): Record<Keys[number], unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (canonicalJson(actual) !== canonicalJson([...keys].sort())) throw new Error(`${label} has an invalid shape`);
  return value as Record<Keys[number], unknown>;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000) {
    throw new Error(`${label} must contain 1-2000 characters`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
  return value;
}

function runId(value: unknown): string {
  if (typeof value !== "string" || !RUN_ID.test(value)) {
    throw new Error("methodology discovery runId is invalid");
  }
  return value;
}

function registerBlindingKey(
  keyMaterial: Buffer,
  receipt: MethodologyDiscoveryBlindingKeyReceipt,
): MethodologyDiscoveryBlindingKey {
  const token = Object.freeze({ [BLINDING_KEY_BRAND]: true as const });
  BLINDING_KEYS.set(token, {
    keyMaterial: Buffer.from(keyMaterial),
    receipt: Object.freeze({ ...receipt }),
  });
  return token;
}

function blindingKeyReceipt(input: {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_DISCOVERY_BLINDING_KEY_PROTOCOL;
  runId: string;
  recordedAt: string;
  artifactSha256: string;
}): MethodologyDiscoveryBlindingKeyReceipt {
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    protocol: input.protocol,
    runId: input.runId,
    recordedAt: input.recordedAt,
    artifactSha256: input.artifactSha256,
  });
}

function protectedOperatorRoot(operatorRoot: string): string {
  const root = resolve(operatorRoot);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("methodology discovery operator root must be a private 0700 directory");
  }
  return realpathSync(root);
}

function readBlindingKey(value: unknown): {
  keyMaterial: Buffer;
  receipt: MethodologyDiscoveryBlindingKeyReceipt;
} {
  if (!value || typeof value !== "object" || !(BLINDING_KEY_BRAND in value)) {
    throw new Error("blindingKey must be created by createMethodologyDiscoveryBlindingKey");
  }
  const key = BLINDING_KEYS.get(value);
  if (!key) throw new Error("blindingKey must be reopened from its protected operator artifact");
  return key;
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("methodology discovery recordedAt must be a canonical timestamp");
  }
  return value;
}

function discoveryOrder(seed: number, occurrenceId: string): string {
  return domainSha("peregrine-methodology-discovery-order-v1", { seed, occurrenceId });
}

function domainSha(domain: string, value: unknown): string {
  return createHash("sha256").update(domain).update("\0").update(canonicalJson(value)).digest("hex");
}

function keyedDomainSha(key: Buffer, domain: string, value: unknown): string {
  return createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(canonicalJson(value))
    .digest("hex");
}
