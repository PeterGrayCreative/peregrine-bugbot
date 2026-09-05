import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMethodologyDiscoveryOutput, parseMethodologyReviewOutput } from "../eval/methodology-output.js";

const finding = { file: "src/task.ts", startLine: 1, endLine: 2,
  explanation: "A rejected operation reaches the success callback.", impact: "The caller loses the failure.", severity: "high" };
const review = { status: "completed", limitations: [], findings: [finding] };

test("common review accepts minimal findings without requiring methodology-specific fields", () => {
  assert.deepEqual(parseMethodologyReviewOutput(review), review);
  for (const key of ["lane", "invariant", "disposition", "confidence", "fixPlan", "category"]) {
    assert.throws(() => parseMethodologyReviewOutput({ ...review, findings: [{ ...finding, [key]: "injected" }] }), /unsupported field/);
  }
});

test("empty output is a model completion report, never a global-clean status", () => {
  assert.deepEqual(parseMethodologyReviewOutput({ ...review, findings: [] }), { ...review, findings: [] });
  assert.throws(() => parseMethodologyReviewOutput({ ...review, status: "clean", findings: [] }), /status/);
});

test("incomplete outputs retain findings and require explicit limitations", () => {
  const incomplete = { ...review, status: "unable-to-complete", limitations: ["Required caller context unavailable."] };
  assert.deepEqual(parseMethodologyReviewOutput(incomplete), incomplete);
  assert.throws(() => parseMethodologyReviewOutput({ ...incomplete, status: "completed" }), /limitations/);
  assert.throws(() => parseMethodologyReviewOutput({ ...incomplete, limitations: [] }), /limitation/);
});

test("unsafe locations, invalid ranges, blank impact, and missing fields reject", () => {
  for (const file of ["/tmp/a", "../a", "x//a", "x/./a", "C:/a", "x\\a", ".git/config", "x/\u0001a", " src/task.ts", "src/task.ts "]) {
    assert.throws(() => parseMethodologyReviewOutput({ ...review, findings: [{ ...finding, file }] }), /path/);
  }
  for (const patch of [{ startLine: 0 }, { endLine: 0 }, { startLine: 3 }, { startLine: 1.5 },
    { endLine: Number.MAX_SAFE_INTEGER + 1 }, { impact: " " }, { severity: "critical" }]) {
    assert.throws(() => parseMethodologyReviewOutput({ ...review, findings: [{ ...finding, ...patch }] }));
  }
  assert.throws(() => parseMethodologyReviewOutput({ findings: [] }), /missing status/);
});

test("neutral discovery records hypotheses without severity or lane judgments", () => {
  const output = { status: "completed", limitations: [], candidates: [{ file: "src/task.ts", startLine: 1,
    endLine: 2, hypothesis: "This branch may hide a rejected operation.", evidenceNeeded: "Inspect the caller success contract." }] };
  assert.deepEqual(parseMethodologyDiscoveryOutput(output), output);
  assert.throws(() => parseMethodologyDiscoveryOutput({ ...output,
    candidates: [{ ...output.candidates[0], lane: "logic" }] }), /unsupported field/);
  for (const file of [" src/task.ts", "src/task.ts "]) {
    assert.throws(() => parseMethodologyDiscoveryOutput({ ...output,
      candidates: [{ ...output.candidates[0], file }] }), /path/);
  }
});

test("malformed output keys cannot leak secret-like text through diagnostics", () => {
  const secret = "sk-proj-ABCDEFGHIJKLMNOPQRST";
  for (const invoke of [
    () => parseMethodologyReviewOutput({ ...review, [secret]: true }),
    () => parseMethodologyReviewOutput({ ...review, findings: [{ ...finding, [secret]: true }] }),
    () => parseMethodologyDiscoveryOutput({ status: "completed", limitations: [], candidates: [], [secret]: true }),
  ]) {
    assert.throws(invoke, (error: unknown) => error instanceof Error &&
      error.message.includes("unsupported field") && !error.message.includes(secret));
  }
});

test("provider schemas require only common fields and document authoritative parser checks", () => {
  for (const [name, list, fields] of [
    ["review", "findings", Object.keys(finding)],
    ["discovery", "candidates", ["file", "startLine", "endLine", "hypothesis", "evidenceNeeded"]],
  ] as const) {
    const schema = JSON.parse(readFileSync(new URL(`../schemas/methodology-${name}.schema.json`, import.meta.url), "utf8"));
    assert.deepEqual(schema.required, ["status", "limitations", list]);
    assert.deepEqual(Object.keys(schema.properties), schema.required);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties[list].items.required, fields);
    assert.deepEqual(Object.keys(schema.properties[list].items.properties), fields);
    assert.equal(schema.properties[list].items.additionalProperties, false);
    assert.equal(schema.properties[list].items.properties.endLine.maximum, Number.MAX_SAFE_INTEGER);
    assert.match(schema.$comment, /path safety, line order, completion\/limitation consistency, and secret rejection/);
  }
});
