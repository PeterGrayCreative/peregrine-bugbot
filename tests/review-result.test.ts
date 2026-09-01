import assert from "node:assert/strict";
import test from "node:test";
import { filterDiff, globMatches } from "../src/core/diff.js";
import { parseEngineResult, parseReviewPayload } from "../src/core/review-result.js";

function validFinding() {
  return {
    file: "src/service.ts",
    startLine: 12,
    endLine: 14,
    severity: "high",
    disposition: "fix-in-pr",
    category: "authorization",
    title: "Missing tenant boundary",
    explanation: "The query is not scoped to the current tenant.",
    failurePath: "A caller supplies another tenant's identifier and reads its record.",
    confidence: 0.95,
  };
}

test("strict review parsing accepts the complete finding contract", () => {
  const parsed = parseReviewPayload({ findings: [validFinding()] });
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]?.category, "authorization");
});

test("strict review parsing rejects extra fields, unsafe paths, and invalid ranges", () => {
  assert.throws(
    () => parseReviewPayload({ findings: [{ ...validFinding(), recommendation: "fix it" }] }),
    /unexpected field/,
  );
  assert.throws(
    () => parseReviewPayload({ findings: [{ ...validFinding(), file: "../secret" }] }),
    /safe repository-relative Git path/,
  );
  assert.throws(
    () => parseReviewPayload({ findings: [{ ...validFinding(), startLine: 20, endLine: 19 }] }),
    /endLine must be >= startLine/,
  );
  const withoutFailure = { ...validFinding() } as Record<string, unknown>;
  delete withoutFailure.failurePath;
  assert.throws(
    () => parseReviewPayload({ findings: [withoutFailure] }),
    /failurePath must be a non-empty string/,
  );
  const withoutDisposition = { ...validFinding() } as Record<string, unknown>;
  delete withoutDisposition.disposition;
  assert.throws(
    () => parseReviewPayload({ findings: [withoutDisposition] }),
    /disposition must be fix-in-pr or follow-up/,
  );
});

test("serialized result validation enforces status semantics and usage shape", () => {
  const base = {
    engine: "codex",
    status: "completed",
    modelConfig: "fast->strong",
    reviewedBaseRef: "base",
    reviewedHeadRef: "head",
    findings: [validFinding()],
    usage: { inputTokens: 10 },
    durationMs: 100,
  };
  assert.equal(parseEngineResult(base).engine, "codex");
  assert.throws(() => parseEngineResult({ ...base, status: "clean" }), /clean results cannot/);
  assert.throws(
    () => parseEngineResult({ ...base, usage: { inputTokens: -1 } }),
    /non-negative number/,
  );
  assert.throws(() => parseEngineResult({ ...base, unexpected: true }), /unexpected field/);
});

test("diff filtering removes complete ignored file blocks and reports them", () => {
  const diff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
    "--- a/pnpm-lock.yaml",
    "+++ b/pnpm-lock.yaml",
    "@@ -1 +1 @@",
    "-one",
    "+two",
    "",
  ].join("\n");
  const filtered = filterDiff(diff, ["**/pnpm-lock.yaml"]);
  assert.match(filtered.text, /src\/app\.ts/);
  assert.doesNotMatch(filtered.text, /pnpm-lock/);
  assert.deepEqual(filtered.ignoredFiles, ["pnpm-lock.yaml"]);
});

test("portable glob matching handles recursive, single-component, and literal patterns", () => {
  assert.equal(globMatches("**/__snapshots__/**", "src/__snapshots__/app.snap"), true);
  assert.equal(globMatches("dist/**", "dist/client/app.js"), true);
  assert.equal(globMatches("**/*.map", "src/app.js.map"), true);
  assert.equal(globMatches("src/*.ts", "src/nested/app.ts"), false);
  assert.equal(globMatches("src/file[1].ts", "src/file[1].ts"), true);
});
