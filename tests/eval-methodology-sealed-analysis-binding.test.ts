import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  METHODOLOGY_SEALED_ANALYSIS_BINDING_FILE,
  METHODOLOGY_SEALED_ANALYSIS_SOURCE_PATHS,
  readMethodologySealedAnalysisBinding,
  verifyMethodologySealedAnalysisSource,
  writeMethodologySealedAnalysisBinding,
  type MethodologySealedAnalysisBindingReadInputs,
} from "../eval/methodology-sealed-analysis-binding.js";
import {
  cleanupMethodologySealedAnalysisFixture,
  createMethodologySealedAnalysisFixture,
  sealedAnalysisReadInput,
} from "./helpers/methodology-sealed-analysis-fixture.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

test("round-trips the source-bound sealed analysis join and preserves v1 claims", async () => {
  const value = await createMethodologySealedAnalysisFixture();
  try {
    const binding = writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput);
    const read = readMethodologySealedAnalysisBinding(
      value.analysisRoot,
      sealedAnalysisReadInput(value, binding.bindingSha256),
    );
    assert.deepEqual(read, binding);
    assert.equal(binding.protocol, "historical-methodology-sealed-analysis-binding-v1");
    assert.deepEqual(binding.claims, {
      sourceClosure: "fixed-explicit-source-list",
      providerIdentity: "not-established",
      semanticCorrectness: "not-established",
      humanCalibration: "required",
      efficacy: "not-decided",
    });
    assert.deepEqual(
      binding.analysisSource.map((entry) => entry.path),
      METHODOLOGY_SEALED_ANALYSIS_SOURCE_PATHS,
    );
    verifyMethodologySealedAnalysisSource(binding, value.writeInput.repositoryRoot);
    assert.throws(
      () => writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput),
      /exist|exclusive|EEXIST/i,
    );
  } finally { cleanupMethodologySealedAnalysisFixture(value); }
});

test("rejects missing or wrong caller-held base, judge, sealed, and judge-ledger anchors", async () => {
  const value = await createMethodologySealedAnalysisFixture();
  try {
    const binding = writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput);
    const input = sealedAnalysisReadInput(value, binding.bindingSha256);
    const wrong = digest("wrong-anchor");
    const fields: Array<keyof MethodologySealedAnalysisBindingReadInputs> = [
      "expectedBaseAnalysisBindingSha256",
      "expectedJudgeBindingSha256",
      "expectedSealedGradeSetArtifactSha256",
      "expectedExecutionEvidenceSha256",
      "expectedOccurrenceArtifactSha256",
      "expectedJudgeManifestSha256",
      "expectedJudgeTerminalSealSha256",
      "expectedProjectionSetSha256",
      "judgeImplementationSha256",
    ];
    for (const field of fields) {
      assert.throws(
        () => readMethodologySealedAnalysisBinding(value.analysisRoot, { ...input, [field]: wrong }),
        /digest|implementation|artifact|evidence|binding|anchor|mismatch/i,
      );
    }
    for (const field of [
      "expectedBaseAnalysisBindingSha256",
      "expectedJudgeBindingSha256",
      "expectedSealedGradeSetArtifactSha256",
    ] as const) {
      assert.throws(
        () => readMethodologySealedAnalysisBinding(value.analysisRoot,
          { ...input, [field]: undefined } as unknown as MethodologySealedAnalysisBindingReadInputs),
        /digest/i,
      );
    }
  } finally { cleanupMethodologySealedAnalysisFixture(value); }
});

test("rejects downstream, stored-binding, and source-manifest tampering", async () => {
  const value = await createMethodologySealedAnalysisFixture();
  try {
    const reportPath = join(value.analysisRoot, "methodology-report.json");
    const reportBytes = readFileSync(reportPath);
    const tamperedReport = JSON.parse(reportBytes.toString("utf8")) as Record<string, any>;
    tamperedReport.claims.efficacy = "forged-positive-result";
    writeFileSync(reportPath, `${JSON.stringify(tamperedReport)}\n`);
    assert.throws(
      () => writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput),
      /report artifact digest mismatch|report.*invalid/i,
    );
    writeFileSync(reportPath, reportBytes);

    const binding = writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput);
    writeFileSync(reportPath, `${JSON.stringify(tamperedReport)}\n`);
    assert.throws(
      () => readMethodologySealedAnalysisBinding(
        value.analysisRoot,
        sealedAnalysisReadInput(value, binding.bindingSha256),
      ),
      /report artifact digest mismatch|report.*invalid/i,
    );
    writeFileSync(reportPath, reportBytes);

    const path = join(value.analysisRoot, METHODOLOGY_SEALED_ANALYSIS_BINDING_FILE);
    const original = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
    writeFileSync(path, `${JSON.stringify({ ...original, extra: true })}\n`);
    assert.throws(
      () => readMethodologySealedAnalysisBinding(
        value.analysisRoot,
        sealedAnalysisReadInput(value, binding.bindingSha256),
      ),
      /structure|shape|digest/i,
    );

    const sourceTamper = structuredClone(original);
    sourceTamper.analysisSource[0].bytes += 1;
    sourceTamper.analysisSourceTreeSha256 = canonicalJsonSha256(sourceTamper.analysisSource);
    const { bindingSha256: _digest, ...body } = sourceTamper;
    sourceTamper.bindingSha256 = canonicalJsonSha256(body);
    writeFileSync(path, `${JSON.stringify(sourceTamper)}\n`);
    assert.throws(
      () => readMethodologySealedAnalysisBinding(
        value.analysisRoot,
        sealedAnalysisReadInput(value, sourceTamper.bindingSha256),
      ),
      /source|caller-held artifacts/i,
    );
  } finally { cleanupMethodologySealedAnalysisFixture(value); }
});

test("rejects a legacy grade set that is not the exact sealed-judge projection", async () => {
  const value = await createMethodologySealedAnalysisFixture({ legacyMismatch: true });
  try {
    assert.throws(
      () => writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput),
      /legacy methodology grade set does not exactly match sealed judge grades/i,
    );
  } finally { cleanupMethodologySealedAnalysisFixture(value); }
});

test("rejects a cross-run projection set", async () => {
  const value = await createMethodologySealedAnalysisFixture();
  try {
    const crossRun = structuredClone(value.writeInput);
    crossRun.projections.runId = "different-run";
    assert.throws(
      () => writeMethodologySealedAnalysisBinding(value.analysisRoot, crossRun),
      /stale|cross-run|runId/i,
    );
  } finally { cleanupMethodologySealedAnalysisFixture(value); }
});
