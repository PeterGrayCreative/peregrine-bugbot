import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAuthorizedDevelopmentReviewAttempt, type DevelopmentReviewSlot, type DevelopmentReviewAuthorization } from "../eval/development-review-containment.js";
import { trustedLocalReviewArgs, type TrustedLocalReviewAttempt } from "../eval/trusted-local-review-runner.js";
import type { exec } from "../src/util/exec.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const findings = { status: "completed", limitations: [], findings: [] };
const stream = [
  { type: "thread.started" }, { type: "turn.started" },
  { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(findings) } },
  { type: "turn.completed" },
].map((event) => JSON.stringify(event)).join("\n") + "\n";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "review-adapter-"));
  const neutralCheckout = join(root, "checkout"), assets = join(root, "assets"), output = join(root, "output");
  mkdirSync(join(neutralCheckout, ".git"), { recursive: true });
  mkdirSync(assets); mkdirSync(output, { mode: 0o700 }); chmodSync(output, 0o700);
  writeFileSync(join(neutralCheckout, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(assets, "review-output.schema.json"), "{}\n");
  const credentialFile = join(root, "auth.json"); writeFileSync(credentialFile, "secret", { mode: 0o600 }); chmodSync(credentialFile, 0o600);
  const args = trustedLocalReviewArgs(neutralCheckout, join(assets, "review-output.schema.json"));
  const rawScopeSha256 = sha("scope");
  const attempt = (armId: "A" | "B"): TrustedLocalReviewAttempt => ({
    armId, attemptDirectory: join(root, `case-${armId}`), checkoutDirectory: neutralCheckout,
    prompt: `prompt ${armId}`, promptSha256: sha(`prompt ${armId}`), rawScopeSha256,
    methodSourceSha256: armId === "A" ? null : sha("method"), command: "codex", args: [...args],
  });
  const slot: DevelopmentReviewSlot = { caseId: "real-case", attemptId: "attempt-000001", armId: "B",
    packageSha256: sha("package"), sourceSha256: sha("source"), schemaSha256: sha("{}\n"),
    scheduleSha256: sha("schedule"), mounts: { neutralCheckout, assets, output }, credentialFile, attempt: attempt("B") };
  const authorization: DevelopmentReviewAuthorization = { decision: "authorized", packageSha256: slot.packageSha256,
    sourceSha256: slot.sourceSha256, schemaSha256: slot.schemaSha256, rawScopeSha256, scheduleSha256: slot.scheduleSha256,
    attemptId: slot.attemptId, caseId: slot.caseId, armId: slot.armId };
  return { root, slot, authorization, credentialFile, attempt, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("missing or mismatched binding touches neither credential nor executor", async () => {
  const f = fixture(); const calls: string[] = [];
  const run = (async (cmd: string) => { calls.push(cmd); throw new Error("unexpected"); }) as typeof exec;
  try {
    rmSync(f.credentialFile);
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, undefined, run), /authorization binding/);
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, { ...f.authorization, sourceSha256: sha("wrong") }, run), /authorization binding/);
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, { ...f.authorization, attemptId: "wrong" }, run), /authorization binding/);
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, { ...f.authorization, caseId: "wrong" }, run), /authorization binding/);
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, { ...f.authorization, scheduleSha256: sha("wrong") }, run), /authorization binding/);
    assert.deepEqual(calls, []);
  } finally { f.cleanup(); }
});

test("scope and schema provenance mismatches stop before credential metadata or Docker", async () => {
  const f = fixture(); const calls: string[] = [];
  const run = (async (cmd: string) => { calls.push(cmd); throw new Error("unexpected"); }) as typeof exec;
  try {
    rmSync(f.credentialFile);
    f.slot.attempt.armId = "A";
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, f.authorization, run), /slot provenance/);
    f.slot.attempt.armId = "B";
    f.slot.attempt.rawScopeSha256 = sha("different");
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, f.authorization, run), /authorization binding/);
    f.slot.attempt.rawScopeSha256 = f.authorization.rawScopeSha256;
    writeFileSync(join(f.slot.mounts.assets, "review-output.schema.json"), "changed\n");
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, f.authorization, run), /schema provenance/);
    assert.deepEqual(calls, []);
  } finally { f.cleanup(); }
});

test("receipt paths inside or containing reviewer mounts fail before writes and credentials", async () => {
  const f = fixture(); const calls: string[] = [];
  const run = (async (cmd: string) => { calls.push(cmd); throw new Error("unexpected"); }) as typeof exec;
  try {
    rmSync(f.credentialFile);
    for (const directory of [join(f.slot.mounts.neutralCheckout, "receipt"),
      join(f.slot.mounts.assets, "receipt"), join(f.slot.mounts.output, "receipt"), f.root]) {
      f.slot.attempt.attemptDirectory = directory;
      await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, f.authorization, run), /receipt directory/);
    }
    assert.deepEqual(calls, []);
  } finally { f.cleanup(); }
});

test("oversized schema fails before credential metadata or Docker", async () => {
  const f = fixture(); const calls: string[] = [];
  const run = (async (cmd: string) => { calls.push(cmd); throw new Error("unexpected"); }) as typeof exec;
  try {
    rmSync(f.credentialFile);
    writeFileSync(join(f.slot.mounts.assets, "review-output.schema.json"), "x".repeat(1024 * 1024 + 1));
    await assert.rejects(runAuthorizedDevelopmentReviewAttempt(f.slot, f.authorization, run), /schema exceeds size bound/);
    assert.deepEqual(calls, []);
  } finally { f.cleanup(); }
});

test("single slot preserves exact case and arm in terminal", async () => {
  const f = fixture(); const calls: Array<{ args: string[]; stdin?: string }> = [];
  const run = (async (_cmd: string, args: string[], opts?: { stdin?: string }) => {
    calls.push({ args: [...args], stdin: opts?.stdin });
    return { code: 0, stdout: args[0] === "run" ? stream : "", stderr: "", timedOut: false };
  }) as typeof exec;
  try {
    const terminal = await runAuthorizedDevelopmentReviewAttempt(f.slot, f.authorization, run);
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.caseId, "real-case"); assert.equal(terminal.armId, "B");
    assert.deepEqual(calls.map((call) => call.args[0]), ["run", "rm", "ps"]);
    assert.equal(calls[0]!.stdin, f.slot.attempt.prompt);
    assert.equal(readFileSync(join(f.slot.attempt.attemptDirectory, "raw.jsonl"), "utf8"), stream);
    assert.deepEqual(JSON.parse(readFileSync(join(f.slot.attempt.attemptDirectory, "final-findings.json"), "utf8")), findings);
  } finally { f.cleanup(); }
});

test("schedule can run B then A with distinct empty outputs and names", async () => {
  const b = fixture(), a = fixture();
  a.slot.armId = "A"; a.slot.attempt = a.attempt("A"); a.authorization.armId = "A";
  a.slot.attemptId = "attempt-000002"; a.authorization.attemptId = a.slot.attemptId;
  const launches: string[][] = [];
  const run = (async (_cmd: string, args: string[]) => {
    if (args[0] === "run") {
      launches.push([...args]);
      const mount = args.find((value) => value.includes("target=/output"))!;
      const output = mount.match(/source=([^,]+),target=\/output/)![1]!;
      assert.deepEqual((await import("node:fs")).readdirSync(output), []);
      writeFileSync(join(output, "review-marker"), "occupied\n");
    }
    return { code: 0, stdout: args[0] === "run" ? stream : "", stderr: "", timedOut: false };
  }) as typeof exec;
  try {
    assert.equal((await runAuthorizedDevelopmentReviewAttempt(b.slot, b.authorization, run)).armId, "B");
    assert.equal((await runAuthorizedDevelopmentReviewAttempt(a.slot, a.authorization, run)).armId, "A");
    assert.equal(launches.length, 2);
    assert.notEqual(launches[0]![launches[0]!.indexOf("--name") + 1], launches[1]![launches[1]!.indexOf("--name") + 1]);
    assert.notEqual(launches[0]!.find((value) => value.includes("target=/output")), launches[1]!.find((value) => value.includes("target=/output")));
  } finally { b.cleanup(); a.cleanup(); }
});

for (const scenario of ["timeout", "overflow", "launch-exception", "remove-failure", "survivor"] as const) {
  test(`cleanup proof and raw evidence after ${scenario}`, async () => {
    const f = fixture(); const calls: string[] = [];
    const run = (async (_cmd: string, args: string[]) => {
      calls.push(args[0]!);
      if (args[0] === "run" && scenario === "launch-exception") throw new Error("spawn exception");
      return { code: scenario === "remove-failure" && args[0] === "rm" ? 1 : 0,
        stdout: args[0] === "run" ? "partial\n" : scenario === "survivor" && args[0] === "ps" ? "container-id\n" : "",
        stderr: args[0] === "run" ? "diagnostic\n" : "", timedOut: scenario === "timeout" && args[0] === "run",
        outputLimitExceeded: scenario === "overflow" && args[0] === "run" };
    }) as typeof exec;
    try {
      const failedCleanup = scenario === "remove-failure" || scenario === "survivor";
      const a = await runAuthorizedDevelopmentReviewAttempt(f.slot, f.authorization, run);
      assert.deepEqual(calls.slice(0, 3), ["run", "rm", "ps"]);
      assert.equal(a.status, scenario === "timeout" ? "timed-out" : scenario === "overflow" ? "output-limit-exceeded" :
        scenario === "remove-failure" || scenario === "survivor" ? "cleanup-failed" : "process-failed");
      if (failedCleanup) assert.deepEqual(calls, ["run", "rm", "ps"]);
      assert.equal(readFileSync(join(f.slot.attempt.attemptDirectory, "raw.jsonl"), "utf8"), scenario === "launch-exception" ? "" : "partial\n");
      assert.ok(readFileSync(join(f.slot.attempt.attemptDirectory, "cleanup.json"), "utf8"));
    } finally { f.cleanup(); }
  });
}
