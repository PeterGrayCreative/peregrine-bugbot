import assert from "node:assert/strict";
import test from "node:test";
import {
  compileMethodologyDiscoveryPrompt,
  compileMethodologyReviewPrompt,
  parseMethodologyRawScope,
} from "../eval/methodology-prompts.js";

const base = "a".repeat(40);
const head = "b".repeat(40);
const scope = {
  baseRef: base,
  headRef: head,
  diff: "diff --git a/src/a.ts b/src/a.ts\n+const answer = risky();\n",
  taskSpecification: "Preserve existing behavior while adding the requested boundary.",
  rawChangedPaths: ["src/z.ts", "src/a.ts"],
};
const neutralHandoff = {
  status: "completed",
  limitations: [],
  candidates: [{ file: "src/a.ts", startLine: 1, endLine: 1,
    hypothesis: "The new call may bypass a guard.", evidenceNeeded: "Trace the caller and guard." }],
};
const breadthHandoff = {
  model: "gpt-5.6-sol",
  candidates: [{ id: "c1", lane: "contracts", file: "src/a.ts", line: 1,
    invariant: "Callers preserve the boundary.", counterexample: "One caller bypasses it.",
    evidenceNeeded: "Trace all immediate callers." }],
  clear: [{ lane: "logic-correctness", file: "src/z.ts", reason: "No behavior changed." }],
  escalations: [{ target: "c1", reason: "Published contract boundary." }],
  coverage: { coveredFiles: ["src/a.ts"], unavailable: ["src/z.ts unavailable in checkout"] },
};

test("all four reviewer arms append byte-identical canonical raw scope", async () => {
  const prompts = await Promise.all([
    compileMethodologyReviewPrompt({ armId: "A", scope }),
    compileMethodologyReviewPrompt({ armId: "B", scope, activatedLanes: ["contracts"] }),
    compileMethodologyReviewPrompt({ armId: "C", scope, handoff: neutralHandoff }),
    compileMethodologyReviewPrompt({ armId: "D", scope, activatedLanes: ["contracts"], handoff: breadthHandoff }),
  ]);
  assert.equal(new Set(prompts.map((prompt) => prompt.rawScopeSha256)).size, 1);
  const suffixes = prompts.map((prompt) => prompt.prompt.slice(prompt.prompt.indexOf("<raw-review-scope")));
  assert.equal(new Set(suffixes).size, 1);
  assert.deepEqual(parseMethodologyRawScope(scope).rawChangedPaths, ["src/a.ts", "src/z.ts"]);
});

test("generic prompts contain the competent baseline but no Peregrine method content", async () => {
  const a = await compileMethodologyReviewPrompt({ armId: "A", scope });
  const cDiscovery = await compileMethodologyDiscoveryPrompt({ armId: "C", scope });
  const cReview = await compileMethodologyReviewPrompt({ armId: "C", scope, handoff: neutralHandoff });
  assert.ok(a.prompt.startsWith("Review this change for consequential correctness bugs introduced or exposed by it."));
  assert.ok(cReview.prompt.startsWith("Review this change for consequential correctness bugs introduced or exposed by it."));
  for (const prompt of [a, cDiscovery, cReview]) {
    assert.doesNotMatch(prompt.prompt, /PEREGRINE|invariant-first|activated lane|breadth-result|SKILL\.md/i);
    assert.equal(prompt.methodSourceSha256, null);
  }
});

test("topology boundaries require only the corresponding parsed handoff", async () => {
  await assert.rejects(() => compileMethodologyDiscoveryPrompt({ armId: "A" as "C", scope }), /arm id is invalid/);
  await assert.rejects(() => compileMethodologyReviewPrompt({ armId: "E" as "A", scope }), /arm id is invalid/);
  await assert.rejects(() => compileMethodologyReviewPrompt({ armId: "A", scope, handoff: neutralHandoff }), /cannot receive/);
  await assert.rejects(() => compileMethodologyReviewPrompt({ armId: "B", scope, activatedLanes: [], handoff: neutralHandoff }), /cannot receive/);
  await assert.rejects(() => compileMethodologyReviewPrompt({ armId: "C", scope }), /requires its discovery handoff/);
  await assert.rejects(() => compileMethodologyReviewPrompt({ armId: "D", scope, activatedLanes: [] }), /requires its breadth handoff/);
  await assert.rejects(() => compileMethodologyReviewPrompt({ armId: "C", scope, handoff: breadthHandoff }), /unsupported field|missing/);
  await assert.rejects(() => compileMethodologyReviewPrompt({ armId: "D", scope, activatedLanes: [], handoff: neutralHandoff }), /unexpected field|must be/);
});

test("Peregrine arms use trusted current method sources and explicit experimental adaptations", async () => {
  const b = await compileMethodologyReviewPrompt({ armId: "B", scope, activatedLanes: ["contracts"] });
  const dDiscovery = await compileMethodologyDiscoveryPrompt({ armId: "D", scope, activatedLanes: ["contracts"] });
  const dReview = await compileMethodologyReviewPrompt({ armId: "D", scope, activatedLanes: ["contracts"], handoff: breadthHandoff });
  assert.match(b.prompt, /Build the change graph/);
  assert.match(b.prompt, /single-session portability arm/);
  assert.match(b.prompt, /legacy verdict, disposition, category/i);
  assert.ok(b.prompt.indexOf("The raw baseRef is the authoritative comparison base") < b.prompt.indexOf("# Automated investigation method"));
  assert.match(b.prompt, /rawChangedPaths plus authoritative diff substitute for a semantic changed-file manifest/);
  assert.match(b.prompt, /no merge-base is supplied or required/);
  assert.match(dDiscovery.prompt, /Breadth Worker Packet/);
  assert.match(dDiscovery.prompt, /registered homogeneous Sol-high model and effort/);
  assert.match(dDiscovery.prompt, /Model selection is outside the worker's task/);
  assert.doesNotMatch(dDiscovery.prompt, /fast|cheap|price|latency|token savings|fallback|fall back/i);
  assert.match(dReview.prompt, /independently verify or reject every candidate/i);
  assert.ok(b.methodSourceSha256);
  assert.ok(dDiscovery.methodSourceSha256);
  assert.equal(dReview.methodSourceSha256, b.methodSourceSha256);
  await assert.rejects(
    () => compileMethodologyReviewPrompt({ armId: "B", scope, activatedLanes: ["invented-lane"] }),
    /not available from the trusted core method/,
  );
});

test("prompt, source, scope, and handoff hashes are stable and full handoffs are preserved", async () => {
  const first = await compileMethodologyReviewPrompt({ armId: "D", scope, activatedLanes: ["contracts"], handoff: breadthHandoff });
  const second = await compileMethodologyReviewPrompt({ armId: "D", scope: structuredClone(scope), activatedLanes: ["contracts"], handoff: structuredClone(breadthHandoff) });
  assert.deepEqual(first, second);
  assert.ok(first.prompt.includes("src/z.ts unavailable in checkout"));
  assert.ok(first.prompt.includes("Published contract boundary."));
  assert.match(first.promptSha256, /^[a-f0-9]{64}$/);
  assert.match(first.handoffSha256!, /^[a-f0-9]{64}$/);
  assert.match(first.methodSourceSha256!, /^[a-f0-9]{64}$/);
});

test("raw scope rejects semantic extras, unsafe paths, duplicates, and malformed source selections", async () => {
  assert.throws(() => parseMethodologyRawScope({ ...scope, semanticManifest: {} }), /unsupported fields/);
  assert.throws(() => parseMethodologyRawScope({ ...scope, rawChangedPaths: ["src/a.ts", "src/a.ts"] }), /unique/);
  assert.throws(() => parseMethodologyRawScope({ ...scope, rawChangedPaths: ["../answer.ts"] }), /safe repository-relative/);
  await assert.rejects(() => compileMethodologyDiscoveryPrompt({ armId: "D", scope, activatedLanes: ["custom-freeform"] }), /trusted core method/);
  await assert.rejects(() => compileMethodologyReviewPrompt({ armId: "A", scope, activatedLanes: [] }), /cannot receive activated/);
});
