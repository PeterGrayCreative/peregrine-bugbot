import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildMethodologyAdjudicationResolution,
  deriveMethodologyEffectiveAdjudication,
  METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY,
  parseMethodologyAdjudicationResolution,
  readMethodologyAdjudicationResolutionChain,
  writeMethodologyAdjudicationResolution,
  type MethodologyAdjudicationOccurrenceIdentity,
} from "../eval/methodology-adjudication-resolution.js";
import {
  createMethodologySealedAnalysisFixture,
  cleanupMethodologySealedAnalysisFixture,
  type MethodologySealedAnalysisFixture,
} from "./helpers/methodology-sealed-analysis-fixture.js";

const sha = (character: string): string => character.repeat(64);

interface ResolutionFixture {
  root: string;
  base: MethodologySealedAnalysisFixture["adjudication"];
  gradeSet: MethodologySealedAnalysisFixture["legacy"];
  occurrenceA: MethodologyAdjudicationOccurrenceIdentity;
  occurrenceB: MethodologyAdjudicationOccurrenceIdentity;
  cleanup: () => void;
}

const sharedArtifactFixture = await createMethodologySealedAnalysisFixture();
const unresolved = sharedArtifactFixture.adjudication.records.filter((record) => record.classification === "unresolved");
assert.ok(unresolved.length >= 2, "fixture must expose at least two unresolved occurrences");
const sharedResolutionFixture = {
  base: sharedArtifactFixture.adjudication,
  gradeSet: sharedArtifactFixture.legacy,
  occurrenceA: {
    attemptId: unresolved[0]!.attemptId,
    findingIndex: unresolved[0]!.findingIndex,
    findingEvidenceSha256: unresolved[0]!.findingEvidenceSha256,
  },
  occurrenceB: {
    attemptId: unresolved[1]!.attemptId,
    findingIndex: unresolved[1]!.findingIndex,
    findingEvidenceSha256: unresolved[1]!.findingEvidenceSha256,
  },
};
function fixture(): ResolutionFixture {
  const root = mkdtempSync(join(tmpdir(), "peregrine-methodology-resolution-"));
  return { root, ...sharedResolutionFixture, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
test.after(() => cleanupMethodologySealedAnalysisFixture(sharedArtifactFixture));

function input(data: ResolutionFixture, occurrence: MethodologyAdjudicationOccurrenceIdentity,
  classification: "confirmed-new" | "unsupported") {
  return {
    baseLedger: data.base, gradeSet: data.gradeSet, occurrence, classification,
    curatorIdentitySha256: sha("1"), reviewerIdentitySha256s: [sha("1")], reviewerIndependence: "not-attested" as const,
    recordedAt: "2026-09-08T01:00:00.000Z", rationale: "Curator rationale.", evidence: "Independent evidence.",
    expectedHeadResolutionSha256: null,
  };
}

test("resolves occurrences incrementally and derives a complete effective view", () => {
  const data = fixture();
  try {
    const first = writeMethodologyAdjudicationResolution(data.root, input(data, data.occurrenceA, "confirmed-new"));
    const partial = readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: first.resolutionSha256 });
    assert.equal(partial.effective.unresolvedCount, data.base.counts.unresolved - 1);
    assert.equal(partial.effective.records.find((record) => sameOccurrence(record, data.occurrenceA))?.classification, "confirmed-new");
    const second = writeMethodologyAdjudicationResolution(data.root, { ...input(data, data.occurrenceB, "unsupported"), recordedAt: "2026-09-08T01:00:01.000Z", expectedHeadResolutionSha256: first.resolutionSha256 });
    const complete = readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: second.resolutionSha256 });
    assert.equal(complete.effective.unresolvedCount, data.base.counts.unresolved - 2);
    assert.deepEqual(complete.resolutions.map((resolution) => resolution.sequence), [1, 2]);
    assert.equal(complete.effective.records.find((record) => sameOccurrence(record, data.occurrenceB))?.classification, "unsupported");
    assert.equal(data.base.records.every((record) => record.classification === "unresolved"), true);
  } finally { data.cleanup(); }
});

function sameOccurrence(left: MethodologyAdjudicationOccurrenceIdentity, right: MethodologyAdjudicationOccurrenceIdentity): boolean {
  return left.attemptId === right.attemptId && left.findingIndex === right.findingIndex && left.findingEvidenceSha256 === right.findingEvidenceSha256;
}

test("empty chain and restart reads are deterministic and append-only", () => {
  const data = fixture();
  try {
    const empty = readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: null });
    assert.equal(empty.effective.unresolvedCount, data.base.counts.unresolved);
    const first = writeMethodologyAdjudicationResolution(data.root, input(data, data.occurrenceA, "unsupported"));
    const once = readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: first.resolutionSha256 });
    const twice = readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: structuredClone(data.base), gradeSet: structuredClone(data.gradeSet), expectedHeadResolutionSha256: first.resolutionSha256 });
    assert.deepEqual(twice.effective, once.effective);
    assert.throws(() => writeMethodologyAdjudicationResolution(data.root, { ...input(data, data.occurrenceA, "unsupported"), expectedHeadResolutionSha256: first.resolutionSha256 }), /currently unresolved|duplicate/i);
    assert.equal(existsSync(join(data.root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY, "resolution-000001.json")), true);
  } finally { data.cleanup(); }
});

test("rejects caller-asserted truth maps and stale or invented grade-set truth", () => {
  const data = fixture();
  try {
    assert.throws(() => writeMethodologyAdjudicationResolution(data.root, {
      ...input(data, data.occurrenceA, "confirmed-new"), gradeSet: undefined,
      gradeTruthVersions: new Map([[data.occurrenceA.attemptId, "truth-v1"]]),
    } as never), /grade-set artifact/i);
    const invented = structuredClone(data.gradeSet);
    const grade = invented.grades.find((candidate) => candidate.projection.attemptId === data.occurrenceA.attemptId)!;
    grade.metricEligibility.truthVersion = "truth-invented";
    assert.throws(() => writeMethodologyAdjudicationResolution(data.root, { ...input(data, data.occurrenceA, "confirmed-new"), gradeSet: invented }), /digest|canonical|invalid/i);
    assert.equal(existsSync(join(data.root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY, "resolution-000001.json")), false);
  } finally { data.cleanup(); }
});

test("rejects stale, cross-run, tampered, extra, symlinked, skipped, and wrong-head chains", () => {
  const data = fixture();
  try {
    const first = writeMethodologyAdjudicationResolution(data.root, input(data, data.occurrenceA, "confirmed-new"));
    assert.throws(() => readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: sha("9") }), /head digest/);
    assert.throws(() => writeMethodologyAdjudicationResolution(data.root, { ...input(data, data.occurrenceB, "unsupported"), expectedHeadResolutionSha256: sha("9") }), /head digest/);
    const stale = { ...data.base, runId: "other-run", ledgerSha256: sha("9") };
    assert.throws(() => readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: stale, gradeSet: data.gradeSet, expectedHeadResolutionSha256: first.resolutionSha256 }), /digest|invalid|stale|run/i);
    const path = join(data.root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY, "resolution-000001.json");
    const changed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    changed.evidence = "tampered";
    writeFileSync(path, JSON.stringify(changed));
    assert.throws(() => readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: first.resolutionSha256 }), /authenticate|digest|canonical/i);
    writeFileSync(path, JSON.stringify(first, null, 2));
    writeFileSync(join(data.root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY, "notes.txt"), "no");
    assert.throws(() => readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: first.resolutionSha256 }), /unsupported file/);
    rmSync(join(data.root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY, "notes.txt"));
    writeFileSync(join(data.root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY, "resolution-000003.json"), JSON.stringify(first));
    assert.throws(() => readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: first.resolutionSha256 }), /contiguous/);
    rmSync(join(data.root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY, "resolution-000003.json"));
    symlinkSync(path, join(data.root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY, "resolution-000002.json"));
    assert.throws(() => readMethodologyAdjudicationResolutionChain(data.root, { baseLedger: data.base, gradeSet: data.gradeSet, expectedHeadResolutionSha256: first.resolutionSha256 }), /non-regular/);
  } finally { data.cleanup(); }
});

test("resolution parser and pure derivation enforce exact immutable contracts", () => {
  const data = fixture();
  try {
    const resolution = buildMethodologyAdjudicationResolution({
      baseLedger: data.base, gradeSet: data.gradeSet, sequence: 1, previousResolutionSha256: null, occurrence: data.occurrenceA,
      classification: "confirmed-new", curatorIdentitySha256: sha("1"), recordedAt: "2026-09-08T01:00:00.000Z",
      reviewerIdentitySha256s: [sha("1")], reviewerIndependence: "not-attested", rationale: "Rationale.", evidence: "Evidence.",
    });
    assert.deepEqual(parseMethodologyAdjudicationResolution(resolution), resolution);
    assert.equal(deriveMethodologyEffectiveAdjudication(data.base, [], data.gradeSet).effectiveSha256 !== undefined, true);
    assert.throws(() => deriveMethodologyEffectiveAdjudication(data.base, [resolution, resolution], data.gradeSet), /duplicate|currently unresolved|sequence/);
    assert.throws(() => parseMethodologyAdjudicationResolution({ ...resolution, extra: true }), /shape/);
    assert.throws(() => buildMethodologyAdjudicationResolution({
      baseLedger: data.base, gradeSet: data.gradeSet, sequence: 1, previousResolutionSha256: null, occurrence: data.occurrenceA,
      classification: "unsupported", curatorIdentitySha256: sha("1"), reviewerIdentitySha256s: [sha("1")], reviewerIndependence: "operator-attested-independent",
      recordedAt: "2026-09-08T01:00:00.000Z", rationale: "Rationale.", evidence: "Evidence.",
    }), /at least two reviewer/i);
  } finally { data.cleanup(); }
});
