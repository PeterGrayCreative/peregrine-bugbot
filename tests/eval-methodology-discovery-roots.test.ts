import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../eval/experiment.js";
import { readMethodologyAdjudicationArtifact } from "../eval/methodology-analysis-artifacts.js";
import {
  METHODOLOGY_DISCOVERY_ROOT_LEDGER_FILE,
  buildMethodologyDiscoveryCuratorPacket,
  createMethodologyDiscoveryBlindingKey,
  deriveMethodologyDiscoveryRootSummary,
  methodologyDiscoveryImplementationSha256,
  readMethodologyDiscoveryRootLedger,
  writeMethodologyDiscoveryRootLedger,
  type MethodologyDiscoveryArtifactInputs,
  type MethodologyDiscoveryRootInput,
} from "../eval/methodology-discovery-roots.js";
import type { MethodologyFinding } from "../eval/methodology-output.js";
import { writeMethodologySealedAnalysisBinding } from "../eval/methodology-sealed-analysis-binding.js";
import type { MethodologyArmId } from "../eval/methodology-schedule.js";
import {
  cleanupMethodologySealedAnalysisFixture,
  createMethodologySealedAnalysisFixture,
  sealedAnalysisReadInput,
  type MethodologySealedAnalysisFixture,
} from "./helpers/methodology-sealed-analysis-fixture.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const domainSha = (domain: string, value: unknown): string => createHash("sha256")
  .update(domain).update("\0").update(canonicalJson(value)).digest("hex");
const rootId = (value: string): string => `root-${digest(value)}`;
const recordedAt = "2026-09-08T18:00:00.000Z";

interface Fixture extends MethodologySealedAnalysisFixture {
  source: MethodologyDiscoveryArtifactInputs;
  bindingSha256: string;
}

async function createFixture(
  options: { zeroConfirmed?: boolean; seed?: number; runId?: string } = {},
): Promise<Fixture> {
  const value = await createMethodologySealedAnalysisFixture({
    runId: options.runId ?? "run-discovery-roots-001",
    seed: options.seed ?? 29,
    repeats: 2,
    judgeVerdict: false,
    findingsForArm,
    classifyUnmatched: ({ armId, findingIndex }) => {
      if (!options.zeroConfirmed && armId !== "D") return "confirmed-new";
      return findingIndex === 0 ? "unsupported" : "unresolved";
    },
  });
  const binding = writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput);
  const { expectedBindingSha256: _binding, ...bindingInputs } = sealedAnalysisReadInput(
    value,
    binding.bindingSha256,
  );
  return {
    ...value,
    bindingSha256: binding.bindingSha256,
    source: {
      ...bindingInputs,
      schedule: value.schedule,
      expectedSealedAnalysisBindingSha256: binding.bindingSha256,
      expectedLegacyGradeSetArtifactSha256: value.legacy.artifactSha256,
      expectedAdjudicationLedgerSha256: value.adjudication.ledgerSha256,
      blindingKey: createMethodologyDiscoveryBlindingKey(),
    },
  };
}

function cleanup(value: Fixture): void {
  cleanupMethodologySealedAnalysisFixture(value);
}

function findingsForArm(armId: MethodologyArmId): MethodologyFinding[] {
  if (armId === "A" || armId === "B") return [{
    file: "src/shared.ts", startLine: 10, endLine: 12,
    explanation: "Shared discovery: retry acknowledgement races persistence.",
    impact: "A retry can acknowledge data that is not durable.", severity: "high",
  }];
  if (armId === "C") return [{
    file: "src/arm-c.ts", startLine: 20, endLine: 21,
    explanation: "Arm-C discovery: a stale completion overwrites newer state.",
    impact: "The interface can show stale state.", severity: "medium",
  }];
  return [{
    file: "src/noise.ts", startLine: 30, endLine: 30,
    explanation: "Unsupported speculation about a configured timeout.",
    impact: "No demonstrated impact.", severity: "low",
  }, {
    file: "src/unresolved.ts", startLine: 40, endLine: 42,
    explanation: "Unresolved claim about a shutdown edge.",
    impact: "Shutdown might omit cleanup.", severity: "medium",
  }];
}

function curatorRoots(
  packet: ReturnType<typeof buildMethodologyDiscoveryCuratorPacket>,
): MethodologyDiscoveryRootInput[] {
  const shared = packet.items.filter((item) => item.file === "src/shared.ts")
    .map((item) => item.occurrenceId);
  const armOnly = packet.items.filter((item) => item.file === "src/arm-c.ts")
    .map((item) => item.occurrenceId);
  return [{
    rootId: rootId("shared"),
    occurrenceIds: shared,
    causalMechanism: "Retry acknowledgement can precede durable persistence.",
    evidence: "All occurrences identify the same ordering boundary and consequence.",
  }, {
    rootId: rootId("arm-c"),
    occurrenceIds: armOnly,
    causalMechanism: "An older completion can overwrite newer state.",
    evidence: "Both repeat occurrences identify the same stale-completion path.",
  }];
}

test("requires the composite binding and emits keyed, arm-blind occurrence identifiers", async () => {
  const data = await createFixture();
  try {
    const packet = buildMethodologyDiscoveryCuratorPacket(data.analysisRoot, data.source);
    assert.deepEqual(packet, buildMethodologyDiscoveryCuratorPacket(data.analysisRoot, data.source));
    assert.equal(packet.items.length, 6);
    assert.equal(new Set(packet.items.map((item) => item.occurrenceId)).size, 6);
    const serialized = JSON.stringify(packet);
    for (const forbidden of [
      "attemptId", "armId", "repeat", "route", "timing", "model", "configName",
      "config", "resourceUse",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into packet`);
    }
    assert.equal(serialized.includes("Unsupported speculation"), false);
    assert.equal(serialized.includes("Unresolved claim"), false);
    assert.equal(data.adjudication.counts.unsupported, 2);
    assert.equal(data.adjudication.counts.unresolved, 2);
    assert.equal(packet.discoveryImplementationSha256, methodologyDiscoveryImplementationSha256());

    const confirmed = data.adjudication.records.filter((record) =>
      record.classification === "confirmed-new");
    for (const record of confirmed) {
      const oldEnumerableId = `occurrence-${domainSha(
        "peregrine-methodology-discovery-occurrence-v1",
        {
          runId: data.sealed.runId,
          attemptId: record.attemptId,
          findingIndex: record.findingIndex,
          findingEvidenceSha256: record.findingEvidenceSha256,
        },
      )}`;
      assert.equal(packet.items.some((item) => item.occurrenceId === oldEnumerableId), false);
    }

    assert.throws(() => buildMethodologyDiscoveryCuratorPacket(data.analysisRoot, {
      ...data.source,
      expectedSealedAnalysisBindingSha256: digest("wrong-composite-binding"),
    }), /binding digest mismatch/i);
  } finally { cleanup(data); }
});

test("groups complete occurrences into shared and arm-only roots", async () => {
  const data = await createFixture();
  try {
    const packet = buildMethodologyDiscoveryCuratorPacket(data.analysisRoot, data.source);
    const ledger = writeMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "curator-packet-omits-arm-route-timing-v1",
      recordedAt,
      roots: curatorRoots(packet),
    });
    const reread = readMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    });
    assert.deepEqual(reread, ledger);
    assert.deepEqual(ledger.counts, { confirmedNewOccurrences: 6, discoveryRoots: 2 });
    assert.deepEqual(ledger.claims, {
      curatorPacket: "arm-route-timing-omitted",
      curatorBlindness: "operator-mediated-not-independently-attested",
    });

    const summary = deriveMethodologyDiscoveryRootSummary(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    });
    const shared = summary.roots.find((root) => root.rootId === rootId("shared"))!;
    assert.deepEqual({
      occurrences: shared.occurrenceCount,
      attempts: shared.attemptCount,
      cases: shared.caseCount,
      arms: shared.armIds,
      coverage: shared.armCoverage,
    }, { occurrences: 4, attempts: 4, cases: 1, arms: ["A", "B"], coverage: "shared" });
    assert.deepEqual(shared.repeatReliability, [
      { armId: "A", detectingAttempts: 2, scheduledAttempts: 2 },
      { armId: "B", detectingAttempts: 2, scheduledAttempts: 2 },
      { armId: "C", detectingAttempts: 0, scheduledAttempts: 2 },
      { armId: "D", detectingAttempts: 0, scheduledAttempts: 2 },
    ]);
    const armOnly = summary.roots.find((root) => root.rootId === rootId("arm-c"))!;
    assert.deepEqual(armOnly.armIds, ["C"]);
    assert.equal(armOnly.armCoverage, "arm-only");
    assert.equal(armOnly.occurrenceCount, 2);
    assert.deepEqual(summary.claims, {
      frozenKnownRootRecall: "unchanged",
      discoveryAnalysis: "post-hoc-separate",
      totalRecall: "not-established",
      independentCuration: "not-established",
    });

    const original = readMethodologyAdjudicationArtifact(data.analysisRoot, {
      expectedLedgerSha256: data.adjudication.ledgerSha256,
      gradeSet: data.legacy,
    });
    assert.deepEqual(original.counts, { "confirmed-new": 6, unsupported: 2, unresolved: 2 });
    assert.equal(original.records.length, 10);
  } finally { cleanup(data); }
});

test("requires complete roots, omission protocol, append-only storage, and authentic bytes", async () => {
  const data = await createFixture();
  try {
    const packet = buildMethodologyDiscoveryCuratorPacket(data.analysisRoot, data.source);
    const roots = curatorRoots(packet);
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "curator-packet-omits-arm-route-timing-v1",
      recordedAt,
      roots: roots.slice(0, 1),
    }), /every and only/);
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "not-blind" as never,
      recordedAt,
      roots,
    }), /arm\/route\/timing-omitting packet/);
    const ledger = writeMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "curator-packet-omits-arm-route-timing-v1",
      recordedAt,
      roots,
    });
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "curator-packet-omits-arm-route-timing-v1",
      recordedAt,
      roots,
    }), /exist|EEXIST/i);

    const path = join(data.analysisRoot, METHODOLOGY_DISCOVERY_ROOT_LEDGER_FILE);
    const tampered = JSON.parse(readFileSync(path, "utf8")) as { roots: Array<{ evidence: string }> };
    tampered.roots[0]!.evidence = "Tampered evidence.";
    writeFileSync(path, `${JSON.stringify(tampered)}\n`);
    assert.throws(() => readMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    }), /digest mismatch/);
  } finally { cleanup(data); }
});

test("rejects cross-run bindings and the wrong blinding nonce after sealing", async () => {
  const data = await createFixture();
  const other = await createFixture({ seed: 31, runId: "run-discovery-roots-002" });
  try {
    assert.throws(() => buildMethodologyDiscoveryCuratorPacket(data.analysisRoot, {
      ...other.source,
      expectedSealedAnalysisBindingSha256: data.bindingSha256,
    }), /binding digest|caller-held artifacts|stale|cross-run|run/i);

    const packet = buildMethodologyDiscoveryCuratorPacket(data.analysisRoot, data.source);
    const ledger = writeMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "curator-packet-omits-arm-route-timing-v1",
      recordedAt,
      roots: curatorRoots(packet),
    });
    assert.throws(() => readMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: { ...data.source, blindingKey: createMethodologyDiscoveryBlindingKey() },
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    }), /packet does not match its caller-held digest/i);
  } finally {
    cleanup(data);
    cleanup(other);
  }
});

test("retains an authenticated zero-root result", async () => {
  const data = await createFixture({ zeroConfirmed: true });
  try {
    const packet = buildMethodologyDiscoveryCuratorPacket(data.analysisRoot, data.source);
    assert.deepEqual(packet.items, []);
    const ledger = writeMethodologyDiscoveryRootLedger(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "curator-packet-omits-arm-route-timing-v1",
      recordedAt,
      roots: [],
    });
    const summary = deriveMethodologyDiscoveryRootSummary(data.analysisRoot, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    });
    assert.deepEqual(ledger.counts, { confirmedNewOccurrences: 0, discoveryRoots: 0 });
    assert.deepEqual(summary.roots, []);
    assert.deepEqual(summary.counts, { confirmedNewOccurrences: 0, discoveryRoots: 0 });
  } finally { cleanup(data); }
});
