import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  canonicalJson,
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

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const OCCURRENCE_ID = /^occurrence-[a-f0-9]{64}$/;
const ROOT_ID = /^root-[a-f0-9]{64}$/;
const PACKET_ITEM_KEYS = [
  "occurrenceId", "caseName", "file", "startLine", "endLine", "severity",
  "explanation", "impact",
] as const;
const ROOT_INPUT_KEYS = ["rootId", "occurrenceIds", "causalMechanism", "evidence"] as const;
const LEDGER_KEYS = [
  "schemaVersion", "protocol", "runId", "sealedGradeSetArtifactSha256",
  "legacyGradeSetArtifactSha256", "adjudicationLedgerSha256", "packetSha256",
  "curatorIdentitySha256", "reviewProtocol", "recordedAt", "roots", "counts",
  "ledgerSha256",
] as const;

export interface MethodologyDiscoveryArtifactInputs {
  schedule: unknown;
  expectedSealedGradeSetArtifactSha256: string;
  expectedLegacyGradeSetArtifactSha256: string;
  expectedAdjudicationLedgerSha256: string;
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
  sealedGradeSetArtifactSha256: string;
  legacyGradeSetArtifactSha256: string;
  adjudicationLedgerSha256: string;
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
  sealedGradeSetArtifactSha256: string;
  legacyGradeSetArtifactSha256: string;
  adjudicationLedgerSha256: string;
  packetSha256: string;
  curatorIdentitySha256: string;
  reviewProtocol: "blind-to-arm-route-timing-v1";
  recordedAt: string;
  roots: MethodologyDiscoveryRootInput[];
  counts: { confirmedNewOccurrences: number; discoveryRoots: number };
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
  reviewProtocol: "blind-to-arm-route-timing-v1";
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
  const expectedSealed = digest(input.expectedSealedGradeSetArtifactSha256,
    "expectedSealedGradeSetArtifactSha256");
  const expectedLegacy = digest(input.expectedLegacyGradeSetArtifactSha256,
    "expectedLegacyGradeSetArtifactSha256");
  const expectedAdjudication = digest(input.expectedAdjudicationLedgerSha256,
    "expectedAdjudicationLedgerSha256");
  const schedule = parseMethodologySchedule(input.schedule, "methodology discovery schedule");
  const sealed = readMethodologySealedJudgeGradeSet(analysisRoot, expectedSealed);
  const gradeSet = readMethodologyGradeSet(analysisRoot, expectedLegacy);
  assertLegacyMethodologyGradeSetMatchesSealed(gradeSet, sealed);
  if (sealed.runId !== gradeSet.runId || canonicalJson(schedule) !== canonicalJson(gradeSet.schedule)) {
    throw new Error("methodology discovery artifacts belong to a different schedule or run");
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
    const occurrenceId = `occurrence-${domainSha("peregrine-methodology-discovery-occurrence-v1", {
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
    sealedGradeSetArtifactSha256: expectedSealed,
    legacyGradeSetArtifactSha256: expectedLegacy,
    adjudicationLedgerSha256: expectedAdjudication,
  }).slice(0, 8), 16);
  materialized.sort((left, right) =>
    discoveryOrder(seed, left.item.occurrenceId).localeCompare(discoveryOrder(seed, right.item.occurrenceId)) ||
    left.item.occurrenceId.localeCompare(right.item.occurrenceId));
  const items = materialized.map(({ item }) => item);
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_DISCOVERY_CURATOR_PACKET_PROTOCOL,
    runId: sealed.runId,
    sealedGradeSetArtifactSha256: expectedSealed,
    legacyGradeSetArtifactSha256: expectedLegacy,
    adjudicationLedgerSha256: expectedAdjudication,
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
  if (input.reviewProtocol !== "blind-to-arm-route-timing-v1") {
    throw new Error("methodology discovery root curation must remain blind to arm, route, and timing");
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
    sealedGradeSetArtifactSha256: input.packet.sealedGradeSetArtifactSha256,
    legacyGradeSetArtifactSha256: input.packet.legacyGradeSetArtifactSha256,
    adjudicationLedgerSha256: input.packet.adjudicationLedgerSha256,
    packetSha256: input.packet.packetSha256,
    curatorIdentitySha256,
    reviewProtocol: "blind-to-arm-route-timing-v1" as const,
    recordedAt: canonicalTimestamp(input.recordedAt),
    roots,
    counts: { confirmedNewOccurrences: expected.length, discoveryRoots: roots.length },
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
