import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { sha } from "../eval/prediction-contract.js";
import { predictionExecutionSourceManifest } from "../eval/prediction-execution-freeze.js";
import { buildEgressProbeContainerArgs, parseEgressProbeContainerArgs, parseEgressProbeFixtureAuditLine, PRIVATE_VERIFIER_FIXTURE_SHA256, VERIFIER_IMAGE } from "../scripts/run-eval-egress-probe.js";
import { privateProbeRuntime, runPrivateStreamRuntimeProbe } from "../scripts/run-private-stream-runtime-probe.js";
import { preparePrivateStreamRuntimePublication } from "../scripts/private-stream-runtime-contract.js";
import { PRIVATE_CONTAINMENT_MAX_BYTES, runPrivateContainmentProbe, validatePrivateContainmentResult } from "../scripts/private-stream-containment.js";

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

test("private containment cannot give candidate reports writable host storage or Docker logs", () => {
  let containment: readonly string[] | undefined;
  let rawReportCreated = false;
  const result = runPrivateStreamRuntimeProbe({ image: "candidate:pr" }, { spawn(_command, args) {
    if (args[0] === "run" && args.includes("none")) {
      containment = args;
      for (let index = 0; index < args.length; index++) {
        if (args[index] !== "--mount") continue;
        const mount = args[index + 1]!;
        if (mount.includes("target=/output") && !mount.endsWith(",readonly")) {
          const source = mount.split(",").find(field => field.startsWith("source="))!.slice(7);
          const report = JSON.stringify({ schemaVersion: 1, status: "passed", checks: ["raw-candidate-report"] });
          writeFileSync(join(source, "containment-probe.json"), report);
          rawReportCreated = readFileSync(join(source, "containment-probe.json"), "utf8") === report;
        }
      }
      return { status: 0, stdout: '{"schemaVersion":1,"protocol":"private-stream-containment-v1","status":"passed"}\n' };
    }
    return { status: 1, stderr: "fixture stops before egress" };
  } });
  assert.ok(containment);
  assert.equal(rawReportCreated, false, "candidate must not be able to persist a raw report on the host");
  assert.ok(!containment.some(arg => arg.includes("target=/output")));
  assert.equal(containment[containment.indexOf("--log-driver") + 1], "none");
  assert.equal(JSON.stringify(result).includes("raw-candidate-report"), false);
});

test("publication input binds committed transitive sources and rejects drift and wrong revision", t => {
  const root = mkdtempSync(join(tmpdir(), "private-publication-git-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = [...predictionExecutionSourceManifest().files.map(f => f.path), ".github/workflows/eval-private-stream-runtime-image.yml", "scripts/run-eval-runtime-probe.ts", "scripts/run-eval-egress-probe.ts", "scripts/run-private-stream-runtime-probe.ts", "scripts/private-stream-containment.ts", "scripts/private-stream-runtime-contract.ts", "scripts/eval-egress-probe-fixture.mjs", "scripts/eval-private-stream-probe-fixture-v1.mjs"];
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

const containmentPass = '{"schemaVersion":1,"protocol":"private-stream-containment-v1","status":"passed"}\n';

test("containment metadata is byte-bounded before decoding and has no extensible candidate fields", () => {
  for (const stdout of [containmentPass, Buffer.from(containmentPass), containmentPass.trim()]) validatePrivateContainmentResult({ status: 0, stdout });
  for (const stdout of ["", "{}", "null", "not json", containmentPass + containmentPass, containmentPass.replace('"passed"', '"failed"'), containmentPass.replace('"passed"', '"passed","checks":["raw-report"]'), containmentPass.replace('"passed"', '"failed","status":"passed"'), " ".repeat(PRIVATE_CONTAINMENT_MAX_BYTES) + containmentPass]) {
    assert.throws(() => validatePrivateContainmentResult({ status: 0, stdout }));
  }
  const oversized = Buffer.alloc(PRIVATE_CONTAINMENT_MAX_BYTES + 1);
  let decoded = false;
  oversized.toString = () => { decoded = true; throw new Error("oversized bytes reached decoder"); };
  assert.throws(() => validatePrivateContainmentResult({ status: 0, stdout: oversized }), /byte limit/);
  assert.equal(decoded, false);
  for (const result of [
    { status: 0, stdout: containmentPass, stderr: "candidate diagnostic" },
    { status: 1, stdout: containmentPass }, { status: null, stdout: containmentPass },
    { status: 0, stdout: containmentPass, error: new Error("subprocess failure") },
    { status: 0, stdout: "é".repeat(PRIVATE_CONTAINMENT_MAX_BYTES / 2 + 1) },
    { status: 0, stdout: containmentPass, stderr: "x".repeat(PRIVATE_CONTAINMENT_MAX_BYTES) },
  ]) assert.throws(() => validatePrivateContainmentResult(result));
});

test("private runtime enforces the containment pipe cap before returning bytes to any validator", () => {
  for (const stdout of ["x".repeat(PRIVATE_CONTAINMENT_MAX_BYTES + 1), Buffer.alloc(PRIVATE_CONTAINMENT_MAX_BYTES + 1)]) {
    const receipts: unknown[] = [];
    const runtime = privateProbeRuntime({ spawn(_command, _args, options) {
      assert.equal(options.maxBuffer, PRIVATE_CONTAINMENT_MAX_BYTES);
      return { status: 0, stdout };
    } }, receipts);
    const result = runtime.spawn("docker", ["run"], { maxBuffer: PRIVATE_CONTAINMENT_MAX_BYTES });
    assert.equal(result.status, null); assert.equal(result.stdout, undefined); assert.ok(result.error);
    assert.equal(JSON.stringify(receipts).includes("x".repeat(40)), false);
  }
});

test("private containment retains restrictions and removes temporary inputs for native and exact platform probes", () => {
  for (const platform of [undefined, "linux/amd64", "linux/arm64"] as const) {
    const image = platform ? "candidate@sha256:" + "a".repeat(64) : "candidate:pr";
    const calls: string[][] = [], roots: string[] = [], receipts: unknown[] = [];
    const runtime = privateProbeRuntime({ spawn(command, args, options) {
      assert.equal(command, "docker"); assert.equal(options.maxBuffer, args[0] === "run" ? PRIVATE_CONTAINMENT_MAX_BYTES : 4 * 1024 * 1024);
      calls.push([...args]);
      if (args[0] === "run") {
        for (const [flag, value] of [["--network", "none"], ["--log-driver", "none"], ["--cap-drop", "ALL"], ["--security-opt", "no-new-privileges"], ["--pids-limit", "256"], ["--user", "1000:1000"], ["--entrypoint", "node"]]) assert.equal(args[args.indexOf(flag!) + 1], value);
        assert.ok(args.includes("--read-only") && args.includes("--rm") && args.includes("--quiet"));
        assert.deepEqual(args.slice(-3), [image, "/opt/peregrine/private-containment-probe-v1.mjs", "--check"]);
        if (platform) { assert.equal(args[args.indexOf("--platform") + 1], platform); assert.equal(args[args.indexOf("--pull") + 1], "always"); }
        else assert.ok(!args.includes("--platform") && !args.includes("--pull"));
        const mounts = args.filter((_, index) => args[index - 1] === "--mount");
        assert.equal(mounts.length, 2);
        for (const mount of mounts) {
          assert.ok(mount.endsWith(",readonly"));
          const source = mount.split(",")[1]!.slice(7);
          assert.equal(statSync(source).mode & 0o777, 0o555);
          roots.push(dirname(source));
          assert.equal(existsSync(join(dirname(source), "output")), false);
        }
        return { status: 0, stdout: containmentPass };
      }
      if (args[0] === "rm") return { status: 0 };
      if (args[0] === "container") return { status: 1, stderr: `Error: No such object: ${args[2]}` };
      if (args[0] === "image" && args[1] === "rm") return { status: 0 };
      if (args[0] === "image" && args[1] === "inspect") return { status: 1, stderr: `Error: No such image: ${image}` };
      throw new Error("unexpected invocation");
    } }, receipts);
    runPrivateContainmentProbe(image, platform, runtime);
    assert.equal(runtime.cleanupFailed(), false);
    assert.ok(roots.length > 0 && roots.every(root => !existsSync(root)));
    assert.equal(calls.filter(args => args[0] === "container" && args[1] === "inspect").length, 1);
    assert.equal(calls.filter(args => args[0] === "image").length, platform ? 2 : 0);
    assert.equal(JSON.stringify(receipts).includes(containmentPass.trim()), false);
  }
});

test("malformed containment stops egress while retaining cleanup and metadata-only failure evidence", () => {
  for (const raw of ["synthetic-candidate-report", containmentPass + "x".repeat(PRIVATE_CONTAINMENT_MAX_BYTES)]) {
    const calls: string[][] = [];
    const result = runPrivateStreamRuntimeProbe({ image: "candidate:pr" }, { spawn(_command, args) {
      calls.push([...args]);
      if (args[0] === "run") return { status: 0, stdout: raw };
      if (args[0] === "rm") return { status: 0 };
      return { status: 1, stderr: `Error: No such object: ${args[2]}` };
    } });
    assert.equal(result.status, "FAIL"); assert.equal(result.credentialFreeVersionChecks, null);
    assert.deepEqual(calls.map(args => args[0]), ["run", "rm", "container"]);
    assert.equal(JSON.stringify(result).includes(raw), false);
    assert.equal(result.rawMechanicalStreamsPersisted, false);
  }
});

test("private containment fails closed on cleanup uncertainty and still attempts every cleanup after a thrown run", () => {
  const image = "candidate@sha256:" + "b".repeat(64);
  for (const mode of ["auto-removed", "survivor", "wrong-name", "unknown-removal", "image-survivor", "image-removal", "thrown-run"] as const) {
    const calls: string[][] = [];
    const receipts: unknown[] = [];
    const runtime = privateProbeRuntime({ spawn(_command, args) {
      calls.push([...args]);
      if (args[0] === "run") { if (mode === "thrown-run") throw new Error("synthetic thrown run"); return { status: 0, stdout: containmentPass }; }
      if (args[0] === "rm") {
        if (mode === "unknown-removal") return { status: 1, stderr: "daemon unavailable" };
        return { status: 1, stderr: `Error response from daemon: No such container: ${args[2]}` };
      }
      if (args[0] === "container") {
        if (mode === "survivor") return { status: 0, stdout: "[]" };
        return { status: 1, stderr: `Error: No such object: ${mode === "wrong-name" ? "other-container" : args[2]}` };
      }
      if (args[1] === "rm") return { status: mode === "image-removal" ? 1 : 0 };
      return mode === "image-survivor" ? { status: 0, stdout: "[]" } : { status: 1, stderr: `Error: No such image: ${image}` };
    } }, receipts);
    if (mode === "auto-removed") { runPrivateContainmentProbe(image, "linux/arm64", runtime); assert.equal(runtime.cleanupFailed(), false); }
    else assert.throws(() => runPrivateContainmentProbe(image, "linux/arm64", runtime));
    assert.ok(calls.some(args => args[0] === "rm"));
    assert.ok(calls.some(args => args[0] === "container"));
    assert.deepEqual(calls.slice(-2), [["image", "rm", "--force", image], ["image", "inspect", image]]);
    assert.equal(JSON.stringify(receipts).includes("synthetic thrown run"), false);
  }
});

test("versioned containment helper keeps predecessor network checks and exposes no report writer", () => {
  const helper = resolve("container/eval-runtime/private-containment-probe-v1.mjs");
  const source = readFileSync(helper, "utf8");
  assert.doesNotMatch(source, /containment-probe\.json|JSON\.stringify\(report/);
  const contract = JSON.parse(execFileSync(process.execPath, [helper, "--describe"], { encoding: "utf8" }));
  assert.equal(contract.mounts.output.access, "read-only");
  assert.deepEqual(contract.providerVersions, { claude: "2.1.252", codex: "0.152.0" });
  const valid = { interfaces: ["lo"], addresses: { lo: [] }, ipv4Routes: [], ipv6Routes: [], counters: {} };
  for (const fixture of [valid, { ...valid, interfaces: ["lo", "eth0"] }, { ...valid, ipv4Routes: [["lo", "00000000"]] }, { ...valid, addresses: { eth0: [{ address: "8.8.8.2" }] } }]) {
    const args = ["--assess-network-fixture"], options = { encoding: "utf8" as const, input: JSON.stringify(fixture) };
    const actual = execFileSync(process.execPath, [helper, ...args], options);
    const predecessor = execFileSync(process.execPath, [resolve("container/eval-runtime/containment-probe.mjs"), ...args], options);
    assert.equal(actual, predecessor);
    assert.equal(JSON.parse(actual).length === 0, fixture === valid);
  }
});

test("auto-removed containment container needs explicit absence proof, not a false cleanup failure", () => {
  const name = "peregrine-image-smoke-00000000-0000-4000-8000-000000000000";
  for (const absent of [true, false]) {
    const calls: string[][] = [], receipts: unknown[] = [];
    const runtime = privateProbeRuntime({ spawn(_command, args) {
      calls.push([...args]);
      if (args[0] === "rm") return { status: 1, stderr: `Error response from daemon: No such container: ${name}` };
      assert.deepEqual(args, ["container", "inspect", name]);
      return absent ? { status: 1, stderr: `Error: No such object: ${name}` } : { status: 0, stdout: "[]" };
    } }, receipts);
    runtime.spawn("docker", ["rm", "--force", name], {});
    assert.equal(runtime.cleanupFailed(), !absent);
    assert.equal(calls.length, 2);
    assert.equal(receipts.length, 2);
  }
});
