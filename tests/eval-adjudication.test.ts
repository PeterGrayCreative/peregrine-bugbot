import assert from "node:assert/strict";
import test from "node:test";
import {
  adjudicationKey,
  parseExperimentAdjudicationLedger,
  parseExperimentAdjudicationSource,
} from "../eval/adjudication-ledger.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";

const hash = (value: string) => value.repeat(64);

test("adjudication sources require final decisions bound to exact finding occurrences", () => {
  const source = {
    schemaVersion: 1 as const,
    kind: "unmatched-finding-adjudication-source" as const,
    experimentId: hash("a"),
    curatorIdentitySha256: hash("c"),
    reviewProtocol: "blind-to-engine-route-variant-v1" as const,
    records: [
      record(0, "unsupported"),
      record(1, "confirmed-new"),
    ],
  };
  assert.deepEqual(parseExperimentAdjudicationSource(source), source);
  assert.notEqual(
    adjudicationKey("attempt-000001", 0, hash("b")),
    adjudicationKey("attempt-000001", 1, hash("b")),
  );
  assert.throws(() => parseExperimentAdjudicationSource({
    ...source,
    records: [{ ...record(0, "unsupported"), classification: "unresolved" }],
  }), /must be final/);
  assert.throws(() => parseExperimentAdjudicationSource({
    ...source,
    records: [record(0, "unsupported"), record(0, "confirmed-new")],
  }), /duplicate finding decision/);
});

test("adjudication ledgers authenticate their contents and reject unsafe source paths", () => {
  const body = {
    schemaVersion: 1 as const,
    kind: "experiment-adjudication" as const,
    experimentId: hash("a"),
    experimentManifestSha256: hash("b"),
    terminalSealSha256: hash("c"),
    gradingSealSha256: hash("d"),
    source: {
      repositoryCommit: "e".repeat(40),
      path: "docs/validation/adjudication.json",
      sha256: hash("f"),
      curatorIdentitySha256: hash("1"),
      reviewProtocol: "blind-to-engine-route-variant-v1" as const,
    },
    records: [record(0, "unsupported")],
    recordedAt: "2026-09-05T00:00:00.000Z",
  };
  const ledger = { ...body, ledgerSha256: canonicalJsonSha256(body) };
  assert.deepEqual(parseExperimentAdjudicationLedger(ledger), ledger);
  assert.throws(() => parseExperimentAdjudicationLedger({
    ...ledger,
    records: [record(0, "confirmed-new")],
  }), /does not authenticate/);
  const unsafeBody = { ...body, source: { ...body.source, path: "../outside.json" } };
  assert.throws(() => parseExperimentAdjudicationLedger({
    ...unsafeBody,
    ledgerSha256: canonicalJsonSha256(unsafeBody),
  }), /unsafe/);
});

function record(findingIndex: number, classification: "confirmed-new" | "unsupported") {
  return {
    attemptId: "attempt-000001",
    findingIndex,
    findingEvidenceSha256: hash("b"),
    classification,
    rationale: "Reviewed against the committed fixture and its stated contract.",
    evidence: "The reported behavior is unsupported by the fixture contract.",
  };
}
