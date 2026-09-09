import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createMethodologyPromptValidator } from "../eval/methodology-prompt-isolation.js";
import { compileMethodologyReviewPrompt } from "../eval/methodology-prompts.js";
import { canonicalJson } from "../eval/experiment.js";
import type { LeakagePolicy } from "../eval/case-isolation.js";

const scope = { baseRef: "a".repeat(40), headRef: "b".repeat(40),
  diff: "+const x = work();", taskSpecification: "Preserve the caller contract.", rawChangedPaths: ["src/a.ts"] };
function policy(): LeakagePolicy {
  return { caseId: "case-aaaaaaaa", corpus: "development", forbiddenTerms: ["secretcuratorcanary"],
    documentedMarkerHashes: new Set() };
}

test("single-reviewer dispatch needs no invented breadth output and rejects drift", async () => {
  const compiled = await compileMethodologyReviewPrompt({ armId: "A", scope });
  const guard = createMethodologyPromptValidator(policy(), compiled, scope);
  guard({ prompt: compiled.prompt, stage: "investigation" });
  assert.throws(() => guard({ prompt: compiled.prompt + "x", stage: "investigation" }), /differs/);
  assert.throws(() => guard({ prompt: compiled.prompt, stage: "breadth" }), /differs/);
  assert.throws(() => guard({ prompt: compiled.prompt, stage: "investigation", untrustedModelText: "{}" }), /differs/);
  assert.throws(() => createMethodologyPromptValidator(policy(), { ...compiled, promptSha256: "0".repeat(64) }, scope), /digest/);
});

test("two-worker dispatch binds the exact canonical handoff and denies answer terms inside it", async () => {
  const handoff = { status: "unable-to-complete", limitations: ["Required caller unavailable."], candidates: [] };
  const compiled = await compileMethodologyReviewPrompt({ armId: "C", scope, handoff });
  const text = canonicalJson(handoff);
  createMethodologyPromptValidator(policy(), compiled, scope, text)({ prompt: compiled.prompt,
    stage: "investigation", untrustedModelText: text });
  assert.throws(() => createMethodologyPromptValidator(policy(), compiled, scope), /boundary/);
  assert.throws(() => createMethodologyPromptValidator(policy(), compiled, scope, text + " "), /boundary/);
  const leaked = await compileMethodologyReviewPrompt({ armId: "C", scope,
    handoff: { ...handoff, limitations: ["secretcuratorcanary"] } });
  assert.throws(() => createMethodologyPromptValidator(policy(), leaked, scope,
    canonicalJson({ ...handoff, limitations: ["secretcuratorcanary"] })), /forbidden answer-bearing term/);
});

test("trusted method vocabulary does not relax raw-context marker or answer checks", async () => {
  const compiled = await compileMethodologyReviewPrompt({ armId: "B", scope, activatedLanes: [] });
  createMethodologyPromptValidator(policy(), compiled, scope);
  const markedScope = { ...scope, diff: "+// BUG: visible marker" };
  const marked = await compileMethodologyReviewPrompt({ armId: "B", scope: markedScope, activatedLanes: [] });
  assert.throws(() => createMethodologyPromptValidator(policy(), marked, markedScope), /undocumented/);
  const documented = policy();
  documented.documentedMarkerHashes = new Set([createHash("sha256").update(markedScope.diff).digest("hex")]);
  createMethodologyPromptValidator(documented, marked, markedScope);
  const leakedScope = { ...scope, taskSpecification: "secretcuratorcanary" };
  const leaked = await compileMethodologyReviewPrompt({ armId: "A", scope: leakedScope });
  assert.throws(() => createMethodologyPromptValidator(policy(), leaked, leakedScope), /forbidden/);
});

test("operator-only R2 truth bindings are absent from every assembled reviewer prompt", async () => {
  const canaries = ["r2-operator-truth-binding-v1", "methodology-r2-truth-bindings", "f".repeat(64)];
  for (const armId of ["A", "B", "C", "D"] as const) {
    const handoff = armId === "C"
      ? { status: "completed", limitations: [], candidates: [] } as const
      : armId === "D"
        ? { model: "test", candidates: [], clear: [], escalations: [], coverage: { coveredFiles: ["src/a.ts"], unavailable: [] } } as const
        : undefined;
    const compiled = await compileMethodologyReviewPrompt({
      armId,
      scope,
      ...(armId === "B" || armId === "D" ? { activatedLanes: [] } : {}),
      ...(handoff === undefined ? {} : { handoff }),
    });
    for (const canary of canaries) assert.equal(compiled.prompt.includes(canary), false);
  }
});
