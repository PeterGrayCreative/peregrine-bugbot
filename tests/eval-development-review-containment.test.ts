import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildDevelopmentReviewLaunchArgs,
  buildDevelopmentReviewProbeArgs,
  probeDevelopmentReviewReadIsolation,
} from "../eval/development-review-containment.js";
import { ACCEPTED_EVAL_RUNTIME_IMAGE } from "../eval/runtime-containment.js";

test("probe and review share the same restricted filesystem mounts", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-review-test-"));
  try {
    const neutralCheckout = join(root, "neutral");
    const assets = join(root, "assets");
    const output = join(root, "output");
    const secret = join(root, "auth.json");
    mkdirSync(join(neutralCheckout, ".git"), { recursive: true });
    mkdirSync(assets);
    mkdirSync(output, { mode: 0o700 });
    writeFileSync(join(neutralCheckout, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(assets, "review-output.schema.json"), "{}\n");
    writeFileSync(secret, "{}\n", { mode: 0o600 });
    const mounts = { neutralCheckout, assets, output };
    const name = "peregrine-review-00000000-0000-0000-0000-000000000001";
    const probe = buildDevelopmentReviewProbeArgs(mounts, { privateSentinel: join(root, "sentinel"), siblingEvidence: join(root, "sibling"), hostHome: "/Users/unmounted" }, name);
    const review = buildDevelopmentReviewLaunchArgs(mounts, secret, name);
    const mounted = (args: string[]) => args.flatMap((arg, i) => arg === "--mount" ? [args[i + 1]!] : []);
    assert.deepEqual(mounted(probe), mounted(review).slice(0, 3));
    assert.equal(probe.filter((arg) => arg === "--network").length, 1);
    assert.equal(review.filter((arg) => arg === "--network").length, 1);
    assert.ok(probe.includes("none"));
    assert.ok(review.includes("bridge"));
    assert.ok(probe.includes(ACCEPTED_EVAL_RUNTIME_IMAGE));
    assert.ok(review.includes(ACCEPTED_EVAL_RUNTIME_IMAGE));
    assert.ok(review.includes("/workspace"));
    assert.ok(review.includes("/opt/peregrine/review-output.schema.json"));
    assert.ok(!mounted(probe).some((mount) => mount.includes(secret)));
    assert.ok(!mounted(review).some((mount) => mount.includes(root + ",target=/workspace")));
    assert.throws(() => buildDevelopmentReviewLaunchArgs({ ...mounts, assets: root }, secret, name));
    writeFileSync(join(output, "already-used"), "x");
    assert.throws(() => buildDevelopmentReviewProbeArgs(mounts, { privateSentinel: "/x", siblingEvidence: "/y", hostHome: "/z" }, name), /fresh empty/);
    rmSync(join(output, "already-used"));
    chmodSync(output, 0o755);
    assert.throws(() => buildDevelopmentReviewProbeArgs(mounts, { privateSentinel: "/x", siblingEvidence: "/y", hostHome: "/z" }, name), /0700/);
    chmodSync(output, 0o700);
    writeFileSync(join(assets, "unexpected.txt"), "x");
    assert.throws(() => buildDevelopmentReviewProbeArgs(mounts, { privateSentinel: "/x", siblingEvidence: "/y", hostHome: "/z" }, name));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mount roots cannot be symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-review-test-"));
  try {
    const checkout = join(root, "checkout");
    const link = join(root, "linked");
    const assets = join(root, "assets");
    const output = join(root, "output");
    mkdirSync(join(checkout, ".git"), { recursive: true });
    mkdirSync(assets);
    mkdirSync(output, { mode: 0o700 });
    writeFileSync(join(assets, "review-output.schema.json"), "{}\n");
    symlinkSync(checkout, link);
    assert.throws(() => buildDevelopmentReviewProbeArgs({ neutralCheckout: link, assets, output }, { privateSentinel: "/x", siblingEvidence: "/y", hostHome: "/z" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unavailable accepted image leaves a durable failed receipt before any launch", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-review-test-"));
  const attempt = join(root, "attempt");
  const calls: string[][] = [];
  const fakeRun = (async (_command: string, args: string[]) => {
    calls.push(args);
    return { code: 1, stdout: "", stderr: "unavailable", timedOut: false };
  }) as typeof import("../src/util/exec.js").exec;
  try {
    await assert.rejects(probeDevelopmentReviewReadIsolation(attempt, fakeRun), /unavailable locally/);
    assert.deepEqual(calls, [["image", "inspect", "--format", "{{json .RepoDigests}}", ACCEPTED_EVAL_RUNTIME_IMAGE]]);
    assert.equal(JSON.parse(readFileSync(join(attempt, "terminal.json"), "utf8")).status, "failed");
    assert.equal(JSON.parse(readFileSync(join(attempt, "inspect.json"), "utf8")).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolved mount path with delimiter is rejected through symlink ancestor", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-review-test-"));
  try {
    const actual = join(root, "unsafe,ancestor");
    const alias = join(root, "alias");
    mkdirSync(join(actual, "neutral", ".git"), { recursive: true });
    mkdirSync(join(actual, "assets"));
    mkdirSync(join(actual, "output"), { mode: 0o700 });
    writeFileSync(join(actual, "assets", "review-output.schema.json"), "{}\n");
    symlinkSync(actual, alias);
    assert.throws(() => buildDevelopmentReviewProbeArgs({ neutralCheckout: join(alias, "neutral"), assets: join(alias, "assets"), output: join(alias, "output") }, { privateSentinel: "/x", siblingEvidence: "/y", hostHome: "/z" }), /resolved to an unsafe/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const scenario of ["success", "run-failed", "malformed", "timeout", "attestation-symlink", "attestation-oversize", "remove-failed", "remove-throws", "survivor"] as const) {
  test(`probe retains all receipts: ${scenario}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "peregrine-review-test-"));
    const attempt = join(root, "attempt");
    const calls: string[] = [];
    const fakeRun = (async (_command: string, args: string[]) => {
      const step = args[0] === "image" ? "inspect" : args[0] === "run" ? "run" : args[0] === "rm" ? "remove" : "survivor";
      calls.push(step);
      if (step === "remove" && scenario === "remove-throws") throw new Error("remove exception");
      if (step === "run" && scenario !== "run-failed" && scenario !== "timeout") {
        const mount = args.find((arg) => arg.includes("target=/output"))!;
        const output = mount.match(/source=([^,]+),target=\/output/)![1]!;
        const attestation = join(output, "read-isolation-probe.json");
        if (scenario === "attestation-symlink") symlinkSync(join(output, "target.json"), attestation);
        else writeFileSync(attestation, scenario === "malformed" ? "{bad" : scenario === "attestation-oversize" ? "x".repeat(4097) : '{"status":"passed","positive":2,"denied":6}\n');
      }
      return {
        code: scenario === "run-failed" && step === "run" ? 42 : scenario === "remove-failed" && step === "remove" ? 1 : 0,
        stdout: step === "inspect" ? ACCEPTED_EVAL_RUNTIME_IMAGE : scenario === "survivor" && step === "survivor" ? "still-running" : "",
        stderr: "",
        timedOut: scenario === "timeout" && step === "run",
      };
    }) as typeof import("../src/util/exec.js").exec;
    try {
      if (scenario === "success") await probeDevelopmentReviewReadIsolation(attempt, fakeRun);
      else await assert.rejects(probeDevelopmentReviewReadIsolation(attempt, fakeRun));
      assert.deepEqual(calls, ["inspect", "run", "remove", "survivor"]);
      for (const step of calls) assert.ok(readFileSync(join(attempt, `${step}.json`), "utf8"));
      assert.equal(JSON.parse(readFileSync(join(attempt, "terminal.json"), "utf8")).status, scenario === "success" ? "passed" : "failed");
      if (scenario === "success") assert.equal(JSON.parse(readFileSync(join(attempt, "attestation.json"), "utf8")).status, "passed");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
