import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMethodologyAssetPreparer, readMethodologyAssetManifest } from "../eval/methodology-assets.js";
import { buildMethodologySchedule, methodologyArmConfigIdentitySha256, type MethodologyDesign } from "../eval/methodology-schedule.js";
import { compileMethodologyDiscoveryPrompt, compileMethodologyReviewPrompt } from "../eval/methodology-prompts.js";
import { createMethodologyInvocationRecorder, readMethodologyInvocation, registerMethodologyInvocations,
  readMethodologyInvocationRegistration, type MethodologyInvocationInput } from "../eval/methodology-invocations.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { ACCEPTED_EVAL_RUNTIME_IMAGE } from "../eval/runtime-containment.js";

const scope = { baseRef: "a".repeat(40), headRef: "b".repeat(40), diff: "+const x = 1;",
  taskSpecification: "Preserve behavior.", rawChangedPaths: ["src/a.ts"] };
const handoff = { status: "completed", limitations: [], candidates: [] };

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "methodology-invocations-test-"));
  const rawDesign: Omit<MethodologyDesign, "arms"> = { schemaVersion: 1, protocol: "historical-methodology-v1",
    seed: 7, repeats: 1, callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: "a".repeat(64) },
    totalDeadlineMs: 60_000, twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 } };
  const arms = (["A", "B", "C", "D"] as const).map((armId) => ({ armId, configName: armId,
    configIdentitySha256: methodologyArmConfigIdentitySha256({ design: rawDesign, armId, configName: armId }) }));
  const schedule = buildMethodologySchedule({ design: { ...rawDesign, arms },
    cases: [{ caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 }] });
  const assetsByArm = arms.map(({ armId }) => {
    const target = join(root, armId);
    createMethodologyAssetPreparer(armId)(target, { caseId: "case-aaaaaaaa", corpus: "structural-smoke",
      forbiddenTerms: [], documentedMarkerHashes: new Set() });
    return readMethodologyAssetManifest(target, armId);
  });
  const a = await compileMethodologyReviewPrompt({ armId: "A", scope });
  const registrationSha256 = registerMethodologyInvocations(root, { runId: "structural-only-fixture", schedule,
    scopeSha256ByCase: { "development/case-aaaaaaaa": a.rawScopeSha256 }, assetsByArm });
  const record = createMethodologyInvocationRecorder(root, registrationSha256);
  async function input(armId: "A" | "B" | "C" | "D", stageIndex: 1 | 2 = 1): Promise<MethodologyInvocationInput> {
    const attempt = schedule.attempts.find((item) => item.armId === armId)!;
    const compiled = armId === "C" && stageIndex === 1
      ? await compileMethodologyDiscoveryPrompt({ armId, scope })
      : await compileMethodologyReviewPrompt({ armId, scope,
        ...(armId === "B" || armId === "D" ? { activatedLanes: [] } : {}),
        ...(stageIndex === 2 ? { handoff } : {}) });
    return { attemptId: attempt.id, stageIndex, compiled, assets: assetsByArm.find((item) => item.armId === armId)!,
      schemaText: readFileSync(join(root, armId, compiled.schemaPath), "utf8"), model: "gpt-5.6-sol", effort: "high",
      stageMaximumMs: attempt.stageDeadlineMs[stageIndex - 1]!, requestedAt: `2026-09-05T12:00:0${stageIndex}.000Z`,
      attemptDeadlineAt: "2026-09-05T12:01:00.000Z", previousOutput: stageIndex === 1 ? null : JSON.stringify(handoff, null, 2) };
  }
  return { root, registrationSha256, record, input, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("exclusive pre-dispatch input records retain exact bytes and immutable predecessor chain", async () => {
  const f = await fixture();
  try {
    const first = await f.input("C");
    const hash1 = f.record(first);
    assert.throws(() => f.record(first), /EEXIST/);
    const second = await f.input("C", 2);
    const hash2 = f.record(second);
    const r1 = readMethodologyInvocation(f.root, f.registrationSha256, first.attemptId, 1, hash1);
    const r2 = readMethodologyInvocation(f.root, f.registrationSha256, first.attemptId, 2, hash2);
    assert.deepEqual(r1.input, first);
    assert.deepEqual(r2.input, second);
    assert.equal(r2.previousInvocationSha256, r1.recordSha256);
    assert.equal(r1.schemaVersion, 1);
    assert.equal(r2.schemaVersion, 1);
    assert.equal(r2.kind, "methodology-invocation-intent");
  } finally { f.cleanup(); }
});

test("registrations bind zero retries while preserving legacy registration digests", async () => {
  const f = await fixture();
  try {
    const path = join(f.root, "methodology-invocation-registration.json");
    const current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(current.schemaVersion, 2);
    assert.deepEqual(current.retryPolicy, { mode: "none", maxDiagnosticChildren: 0 });
    assert.equal(f.registrationSha256, canonicalJsonSha256(current));

    const legacy: Record<string, unknown> = { ...current, schemaVersion: 1 };
    delete legacy.retryPolicy;
    writeFileSync(path, JSON.stringify(legacy));
    const legacySha256 = canonicalJsonSha256(legacy);
    const parsed = readMethodologyInvocationRegistration(f.root, legacySha256);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal("retryPolicy" in parsed, false);
    assert.equal(canonicalJsonSha256(parsed), legacySha256);
    const legacyInput = await f.input("A");
    assert.throws(
      () => createMethodologyInvocationRecorder(f.root, legacySha256)(legacyInput),
      /read-only/,
    );
    assert.equal(existsSync(join(f.root, `${legacyInput.attemptId}.stage-1.input.json`)), false);
  } finally { f.cleanup(); }
});

test("v2 registrations reject omitted, malformed, or expanded retry policies", async () => {
  const f = await fixture();
  try {
    const path = join(f.root, "methodology-invocation-registration.json");
    const original = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const policies: unknown[] = [
      undefined,
      null,
      { mode: "none", maxDiagnosticChildren: 0, extra: false },
      { mode: "diagnostic", maxDiagnosticChildren: 0 },
      { mode: "none", maxDiagnosticChildren: 1 },
    ];
    for (const retryPolicy of policies) {
      const candidate = { ...original };
      if (retryPolicy === undefined) delete candidate.retryPolicy;
      else candidate.retryPolicy = retryPolicy;
      writeFileSync(path, JSON.stringify(candidate));
      assert.throws(() => readMethodologyInvocationRegistration(f.root, canonicalJsonSha256(candidate)),
        /fields|retry policy/);
    }
  } finally { f.cleanup(); }
});

test("no off-schedule stage, over-budget route, changed scope/schema, or missing predecessor", async () => {
  const f = await fixture();
  try {
    const a = await f.input("A");
    for (const patch of [{ attemptId: "attempt-999999" }, { stageIndex: 2 }, { stageMaximumMs: 60_001 },
      { model: "gpt-5.6-luna" }, { effort: "medium" }, { schemaText: "{}" },
      { attemptDeadlineAt: "2026-09-05T12:02:00.000Z" }, { requestedAt: "invalid" },
      { compiled: { ...a.compiled, rawScopeSha256: "0".repeat(64) } },
      { compiled: { ...a.compiled, methodSourceSha256: "a".repeat(64) } }]) {
      assert.throws(() => f.record({ ...a, ...patch } as MethodologyInvocationInput));
    }
    assert.throws(() => f.record({ ...a, attemptId: "../escape" }), /not scheduled/);
    const second = await f.input("C", 2);
    assert.throws(() => f.record(second), /caller-held invocation digest/);
    f.record(await f.input("C"));
    assert.throws(() => f.record({ ...second, previousOutput: JSON.stringify({ ...handoff, limitations: ["changed"] }) }));
    assert.throws(() => f.record({ ...second, attemptDeadlineAt: "2026-09-05T12:00:59.000Z" }), /predecessor/);
  } finally { f.cleanup(); }
});

test("reader rejects byte tampering and cross-run registration identities", async () => {
  const f = await fixture();
  try {
    const first = await f.input("A");
    const receipt = f.record(first);
    assert.throws(() => readMethodologyInvocation(f.root, "0".repeat(64), first.attemptId, 1, receipt), /registration digest/);
    const path = join(f.root, `${first.attemptId}.stage-1.input.json`);
    const record = JSON.parse(readFileSync(path, "utf8"));
    record.input.requestedAt = "2026-09-05T12:00:02.000Z";
    writeFileSync(path, JSON.stringify(record));
    assert.throws(() => readMethodologyInvocation(f.root, f.registrationSha256, first.attemptId, 1, receipt), /digest/);
    const { recordSha256: _ignored, ...body } = record;
    record.recordSha256 = canonicalJsonSha256(body);
    writeFileSync(path, JSON.stringify(record));
    assert.throws(() => readMethodologyInvocation(f.root, f.registrationSha256, first.attemptId, 1, receipt), /digest/);
  } finally { f.cleanup(); }
});

test("trusted v2 tool policy binds the attachment reference to the scheduled attempt", async () => {
  const f = await fixture();
  try {
    const input = await f.input("A");
    const attachment = {
      schemaVersion: 1 as const,
      protocol: "methodology-provider-attachment-reference-v1" as const,
      attemptId: input.attemptId,
      armId: "A" as const,
      sourceHeadTree: "b".repeat(40),
      effectiveRootsSha256: "1".repeat(64),
      image: ACCEPTED_EVAL_RUNTIME_IMAGE,
      runner: "codex" as const,
      providerAccess: "cli-session" as const,
      profile: "methodology-review" as const,
      executionClass: "provider" as const,
      outputByteLimit: 4_194_304,
      readLimitsSha256: "2".repeat(64),
      mcpLimitsSha256: "3".repeat(64),
      attestationSha256: "4".repeat(64),
    };
    input.toolPolicy = {
      protocol: "neutral-read-mcp-v2",
      url: "http://host.docker.internal:43123/mcp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      serverName: "source_read",
      enabledTools: ["list_tree", "read_file", "search_text"],
      attachment,
    };
    const receipt = f.record(input);
    assert.deepEqual(readMethodologyInvocation(f.root, f.registrationSha256, input.attemptId, 1, receipt).input,
      input);
  } finally { f.cleanup(); }

  for (const mutate of [
    (value: Record<string, unknown>) => { value.attemptId = "attempt-999999"; },
    (value: Record<string, unknown>) => { value.armId = "D"; },
    (value: Record<string, unknown>) => { value.image = "ghcr.io/example.invalid/runtime@sha256:" + "a".repeat(64); },
    (value: Record<string, unknown>) => { value.effectiveRootsSha256 = "invalid"; },
    (value: Record<string, unknown>) => { value.executionClass = "unknown"; },
    (value: Record<string, unknown>) => { value.outputByteLimit = 0; },
  ]) {
    const invalid = await fixture();
    try {
      const input = await invalid.input("A");
      const attachment: Record<string, unknown> = {
        schemaVersion: 1,
        protocol: "methodology-provider-attachment-reference-v1",
        attemptId: input.attemptId,
        armId: "A",
        sourceHeadTree: "b".repeat(40),
        effectiveRootsSha256: "1".repeat(64),
        image: ACCEPTED_EVAL_RUNTIME_IMAGE,
        runner: "codex",
        providerAccess: "cli-session",
        profile: "methodology-review",
        executionClass: "provider",
        outputByteLimit: 4_194_304,
        readLimitsSha256: "2".repeat(64),
        mcpLimitsSha256: "3".repeat(64),
        attestationSha256: "4".repeat(64),
      };
      mutate(attachment);
      input.toolPolicy = {
        protocol: "neutral-read-mcp-v2",
        url: "http://host.docker.internal:43123/mcp/" + "a".repeat(64),
        serverName: "source_read",
        enabledTools: ["list_tree", "read_file", "search_text"],
        attachment: attachment as NonNullable<NonNullable<MethodologyInvocationInput["toolPolicy"]>["attachment"]>,
      };
      assert.throws(() => invalid.record(input), /attachment evidence/);
    } finally { invalid.cleanup(); }
  }
});
