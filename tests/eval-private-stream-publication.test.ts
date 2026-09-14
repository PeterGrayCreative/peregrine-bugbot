import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { sha } from "../eval/prediction-contract.js";
import { predictionExecutionSourceManifest } from "../eval/prediction-execution-freeze.js";
import { buildEgressProbeContainerArgs, parseEgressProbeContainerArgs, parseEgressProbeFixtureAuditLine, PRIVATE_VERIFIER_FIXTURE_SHA256, VERIFIER_IMAGE } from "../scripts/run-eval-egress-probe.js";
import { privateProbeRuntime, runPrivateStreamRuntimeProbe } from "../scripts/run-private-stream-runtime-probe.js";
import { preparePrivateStreamRuntimePublication } from "../scripts/private-stream-runtime-contract.js";

test("private publication is separate, manual, source-frozen, dual-platform and readiness denied", () => {
  const workflow = readFileSync(resolve(".github/workflows/eval-private-stream-runtime-image.yml"), "utf8");
  const privateJob = workflow.split("\n  publish-private:\n")[1]!;
  assert.match(privateJob, /workflow_dispatch.*refs\/heads\/main/);
  assert.match(privateJob, /needs: verify-private/);
  assert.match(privateJob, /file: container\/eval-runtime\/Dockerfile.private-stream-v1/);
  assert.match(privateJob, /tags:.*:private-stream-v1-\$\{\{ github.sha \}\}/);
  assert.doesNotMatch(privateJob, /tags:.*:latest|tags:.*:\$\{\{ github.sha \}\}/);
  assert.match(privateJob, /for platform in linux\/amd64 linux\/arm64/);
  assert.match(privateJob, /--image "\$\{IMAGE_NAME\}@\$\{digest\}" --platform "\$platform"/);
  assert.ok(privateJob.indexOf("Attest the published digest") > privateJob.indexOf("Probe both platforms"));
  assert.match(privateJob, /subject-digest: \$\{\{ steps.publish-image.outputs.digest \}\}/);
  assert.match(privateJob, /if: always\(\)[\s\S]*private-stream-publication/);
  const verify = workflow.split("\n  verify-private:\n")[1]!.split("\n  publish-private:\n")[0]!;
  assert.doesNotMatch(verify, /secrets\.|packages: write|push: true|login-action/);
  assert.match(verify, /run-private-stream-runtime-probe.ts/);
  assert.equal(sha(readFileSync("scripts/eval-private-stream-probe-fixture-v1.mjs")), PRIVATE_VERIFIER_FIXTURE_SHA256);
  assert.equal(sha(readFileSync("container/eval-runtime/methodology-mcp-forwarder.mjs")), "558db6e7e5521ae4836577f7272e4f415bb4d8a9c6f6ff65899611ff575f2f0a");
  assert.equal(sha(readFileSync("container/eval-runtime/Dockerfile")), "426cad820ecf82a626719fe69f4fb37383962afd41fa37adec0fc1affa8d6479");
});

test("fixed-endpoint argv has no reviewer capability and rejects cross-profile/extraneous flags", () => {
  const base = { privateStream: true, role: "reviewer" as const, image: VERIFIER_IMAGE, name: "reviewer-test", network: "reviewer-test-net", alias: "reviewer", fixturePath: resolve("scripts/eval-private-stream-probe-fixture-v1.mjs"),
    challenges: { allowedProvider: "a".repeat(64), deniedProvider: "b".repeat(64), allowedMcp: "c".repeat(64), deniedMcp: "d".repeat(64) } };
  const args = buildEgressProbeContainerArgs(base);
  assert.equal(parseEgressProbeContainerArgs(args, true).role, "reviewer");
  assert.throws(() => parseEgressProbeContainerArgs(args));
  assert.throws(() => buildEgressProbeContainerArgs({ ...base, token: "e".repeat(64) }));
  for (const extra of [["--token", "e".repeat(64)], ["--env", "MCP_FORWARDER_TOKEN=x"], ["--privileged"], ["--mount", "type=bind,source=/,target=/host"], ["--network", "host"], ["--fixed-endpoint"]]) {
    const copy = [...args]; copy.splice(copy.indexOf("--read-only"), 0, ...extra);
    assert.throws(() => parseEgressProbeContainerArgs(copy, true));
  }
  const forwarder = buildEgressProbeContainerArgs({ privateStream: true, role: "forwarder", image: "candidate:pr", name: "forwarder-test", network: "external-test", alias: "mcp-forwarder", token: "a".repeat(64) });
  assert.equal(parseEgressProbeContainerArgs(forwarder, true).role, "forwarder");
  assert.throws(() => parseEgressProbeContainerArgs(forwarder));
  for (const value of ["0", "true", "1\n", ""]) assert.throws(() => parseEgressProbeContainerArgs(forwarder.map(v => v === "MCP_FORWARDER_FIXED_CLIENT_PATH=1" ? `MCP_FORWARDER_FIXED_CLIENT_PATH=${value}` : v), true));
});

test("private oracle rejects legacy, wrong-path failure, extra and resealed malformed fields", () => {
  const protocol = "eval-private-stream-fixture-v1", audit = { mcpViaSourceRead: true, wrongPathDenied: true, gatewayProviderReached: true, mismatchedSniDenied: true, directProviderFailed: true, directMcpFailed: true, directProviderIpFailed: true, directMcpIpFailed: true };
  const seal = (audit: unknown, p = protocol) => { const body = { status: "sealed", schemaVersion: 1, protocol: p, sealed: true, role: "reviewer", audit }; return JSON.stringify({ ...body, sha256: sha(p + "\0" + JSON.stringify(body)) }); };
  assert.equal(parseEgressProbeFixtureAuditLine(seal(audit), "reviewer", true).audit.wrongPathDenied, true);
  assert.throws(() => parseEgressProbeFixtureAuditLine(seal(audit), "reviewer"));
  assert.throws(() => parseEgressProbeFixtureAuditLine(seal(audit, "eval-egress-fixture-v1"), "reviewer", true));
  for (const changed of [{ ...audit, extra: true }, { ...audit, wrongPathDenied: "true" }, { ...audit, wrongPathDenied: undefined }]) assert.throws(() => parseEgressProbeFixtureAuditLine(seal(changed), "reviewer", true));
});

test("raw and reversibly encoded mechanical strings cannot persist on success or failure", t => {
  const root = mkdtempSync(join(tmpdir(), "private-probe-disk-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const token = "synthetic-sensitive-forwarding-capability";
  const encodings = [token, Buffer.from(token).toString("base64"), Buffer.from(token).toString("hex"), [...token].map(c => "%" + c.charCodeAt(0).toString(16)).join(""), [...token].map(c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join(""), [...token].reverse().join("")];
  for (const [index, value] of encodings.entries()) for (const mode of ["returned", "thrown", "oversized"] as const) {
    const receipts: unknown[] = [];
    const safe = privateProbeRuntime({ spawn(_command, _args, options) {
      assert.equal(options.stdio, "pipe"); assert.equal(options.maxBuffer, 4 * 1024 * 1024);
      assert.deepEqual(Object.keys(options.env as object).sort(), ["HOME", "PATH"]);
      if (mode === "thrown") throw new AggregateError([new Error(value)], value, { cause: value });
      return { status: 1, stdout: mode === "oversized" ? value.repeat(200000) : value, stderr: value, error: new Error(value, { cause: value }), unexpected: value } as never;
    } }, receipts);
    safe.spawn("docker", ["run", "--env", "MCP_FORWARDER_TOKEN=" + value], {});
    writeFileSync(join(root, `${index}-${mode}.json`), JSON.stringify(receipts), { flag: "wx" });
    for (const file of readdirSync(root)) for (const encoded of encodings) assert.equal(readFileSync(join(root, file), "utf8").includes(encoded), false);
  }
});

test("probe failure retains typed evidence and performs no provider-client launch", () => {
  let calls = 0;
  const result = runPrivateStreamRuntimeProbe({ image: "candidate:pr" }, { spawn(_command, args) { calls++; assert.ok(!args.includes("codex") && !args.includes("claude")); throw new Error("sensitive-error"); } });
  assert.equal(result.status, "FAIL"); assert.ok(calls >= 1); assert.ok(result.receipts.length >= 1);
  assert.equal(result.runtimeReady, false); assert.equal(result.providerCalls, 0);
  assert.equal(JSON.stringify(result).includes("sensitive-error"), false);
  const receipts: unknown[] = [], runtime = privateProbeRuntime({ spawn() { return { status: 1, stderr: "unproven-cleanup" }; } }, receipts);
  runtime.spawn("docker", ["rm", "--force", "fixture"], {});
  assert.equal(runtime.cleanupFailed(), true);
  assert.equal(JSON.stringify(receipts).includes("unproven-cleanup"), false);
});

test("publication input binds committed transitive sources and rejects drift and wrong revision", t => {
  const root = mkdtempSync(join(tmpdir(), "private-publication-git-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = [...predictionExecutionSourceManifest().files.map(f => f.path), ".github/workflows/eval-private-stream-runtime-image.yml", "scripts/run-eval-runtime-probe.ts", "scripts/run-eval-egress-probe.ts", "scripts/run-private-stream-runtime-probe.ts", "scripts/private-stream-runtime-contract.ts", "scripts/eval-egress-probe-fixture.mjs", "scripts/eval-private-stream-probe-fixture-v1.mjs"];
  for (const path of new Set(paths)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), readFileSync(resolve(path))); }
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@invalid" } }).trim();
  git(["init", "--quiet"]); git(["add", "."]); git(["commit", "--quiet", "-m", "fixture"]); const revision = git(["rev-parse", "HEAD"]);
  const contract = preparePrivateStreamRuntimePublication(root, revision);
  assert.match(contract.tag, new RegExp(`:private-stream-v1-${revision}$`));
  assert.deepEqual([contract.publishedDigest, contract.workflowRun, contract.independentReview], [null, null, null]);
  assert.deepEqual([contract.imageAccepted, contract.runtimeReady, contract.providerAuthorized, contract.batchAuthorized], [false, false, false, false]);
  assert.throws(() => preparePrivateStreamRuntimePublication(root, "a".repeat(40)));
  const path = join(root, "scripts/eval-private-stream-probe-fixture-v1.mjs"), original = readFileSync(path);
  writeFileSync(path, Buffer.concat([original, Buffer.from("\n// drift")]));
  assert.throws(() => preparePrivateStreamRuntimePublication(root, revision), /differs/);
});
