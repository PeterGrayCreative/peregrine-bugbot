import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ACCEPTED_EVAL_RUNTIME_IMAGE,
  buildContainedProviderArgs,
  createContainedOutputReader,
  createContainedProviderExec,
  observeContainedCliVersion,
  parseContainedProviderArgs,
} from "../eval/runtime-containment.js";
import { parseMatrixRunManifest } from "../eval/artifacts.js";
import type { exec } from "../src/util/exec.js";

const image = ACCEPTED_EVAL_RUNTIME_IMAGE;

function roots() {
  const root = mkdtempSync(join(tmpdir(), "peregrine-runtime-test-"));
  const checkoutDir = join(root, "checkout");
  const assetsDir = join(root, "assets");
  const outputDir = join(root, "output");
  for (const path of [checkoutDir, assetsDir]) mkdirSync(path);
  mkdirSync(outputDir, { mode: 0o700 });
  return { root, checkoutDir, assetsDir, outputDir };
}

const codexCommand = (paths: ReturnType<typeof roots>, extra: string[] = []) => [
  "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config",
  "--config", "project_doc_max_bytes=0", "--config", "project_doc_fallback_filenames=[]",
  "--config", 'projects."/workspace".trust_level="untrusted"',
  "--config", 'model_reasoning_effort="medium"',
  "--sandbox", "read-only", "--color", "never", "--cd", paths.checkoutDir,
  "--json", ...extra, "-",
];

test("API-key launch is immutable, no-pull, narrow, and passes only a credential name", () => {
  const paths = roots();
  process.env.OPENAI_API_KEY = "must-not-appear";
  const args = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths },
    "codex", codexCommand(paths, ["--output-last-message", join(paths.outputDir, "result.json")]),
    "peregrine-eval-00000000-0000-4000-8000-000000000000",
  );
  const parsed = parseContainedProviderArgs(args, "codex", "api-key");
  assert.equal(parsed.secretName, "OPENAI_API_KEY");
  assert.equal(parsed.network, "bridge");
  assert.ok(parsed.commandArgs.includes("/workspace"));
  assert.ok(parsed.commandArgs.includes("/output/result.json"));
  assert.equal(args.includes("must-not-appear"), false);
  assert.equal(args.includes("never"), true);
  assert.equal(args.filter((value) => value === "--interactive").length, 1);
  assert.equal(args.some((value) => value.includes("docker.sock") || value === "/"), false);
});

test("CLI-session launch mounts only the selected provider session and never falls back to a key", () => {
  const paths = roots();
  const session = join(paths.root, "codex-session"); mkdirSync(session, { mode: 0o700 });
  writeFileSync(join(session, "auth.json"), "{}", { mode: 0o600 });
  process.env.PEREGRINE_CODEX_SESSION_DIR = session;
  process.env.OPENAI_API_KEY = "must-not-be-selected";
  const args = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "cli-session", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000001",
  );
  const parsed = parseContainedProviderArgs(args, "codex", "cli-session");
  assert.equal(parsed.sessionDir, realpathSync(session));
  assert.equal(parsed.secretName, undefined);
  assert.equal(args.includes("OPENAI_API_KEY"), false);
  assert.throws(() => parseContainedProviderArgs(args, "claude", "cli-session"));
});

test("mutations that weaken mounts, pull policy, privileges, or image identity are rejected", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const original = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000002",
  );
  for (const mutate of [
    (args: string[]) => { args[args.indexOf("never")] = "always"; },
    (args: string[]) => { args.splice(args.indexOf("--interactive"), 1); },
    (args: string[]) => { args.splice(args.indexOf("--read-only"), 1); },
    (args: string[]) => { args[args.findIndex((value) => value.includes("target=/workspace"))] = `type=bind,source=${paths.checkoutDir},target=/workspace`; },
    (args: string[]) => { args[args.indexOf(image)] = "peregrine:latest"; },
    (args: string[]) => { args.splice(args.indexOf(image), 0, "--volume", "/:/host"); },
    (args: string[]) => { args[args.indexOf("read-only")] = "danger-full-access"; },
    (args: string[]) => { args.splice(args.indexOf("--ignore-rules"), 0, "--ignore-rules"); },
  ]) {
    const changed = [...original]; mutate(changed);
    assert.throws(() => parseContainedProviderArgs(changed, "codex", "api-key"));
  }
});

test("fake contained launch keeps Docker stdin open and delivers the prompt", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const prompt = "PEREGRINE_ROLE: breadth-worker\nInspect the changed invariant.";
  let delivered = "";
  const fake: typeof exec = async (_cmd, args, options) => {
    if (args[0] === "run") {
      assert.equal(args.includes("--interactive"), true);
      delivered = options?.stdin ?? "";
    }
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  };
  const run = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  const result = await run("codex", codexCommand(paths), { inheritEnv: false, stdin: prompt });
  assert.equal(result.code, 0);
  assert.equal(delivered, prompt);
});

test("a different well-formed runtime digest is rejected before launch", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const differentDigest = `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:${"a".repeat(64)}`;
  assert.notEqual(differentDigest, ACCEPTED_EVAL_RUNTIME_IMAGE);
  assert.throws(() => buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image: differentDigest, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000005",
  ), /must equal the accepted immutable GHCR digest/);

  const accepted = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000006",
  );
  accepted[accepted.indexOf(image)] = differentDigest;
  assert.throws(
    () => parseContainedProviderArgs(accepted, "codex", "api-key"),
    /must equal the accepted immutable GHCR digest/,
  );
});

test("strict launch parsing supports a deterministic non-1000 host identity", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const args = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000003",
  );
  const actual = `${process.getuid!()}:${process.getgid!()}`;
  args[args.indexOf(actual)] = "4242:4343";
  for (let index = 0; index < args.length; index++) {
    args[index] = args[index]!.replace(`uid=${process.getuid!()},gid=${process.getgid!()}`, "uid=4242,gid=4343");
  }
  const parsed = parseContainedProviderArgs(args, "codex", "api-key", { uid: 4242, gid: 4343 });
  assert.equal(parsed.uid, 4242);
  assert.equal(parsed.gid, 4343);
});

test("every Codex isolation flag is unique and value-bound", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const original = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000004",
  );
  const commandStart = original.indexOf("codex") + 1;
  for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--json"]) {
    const changed = [...original]; changed.splice(changed.indexOf(flag, commandStart), 1);
    assert.throws(() => parseContainedProviderArgs(changed, "codex", "api-key"));
  }
  for (const [flag, bad] of [["--sandbox", "danger-full-access"], ["--color", "always"], ["--cd", "/tmp"]] as const) {
    const changed = [...original]; changed[changed.indexOf(flag, commandStart) + 1] = bad;
    assert.throws(() => parseContainedProviderArgs(changed, "codex", "api-key"));
  }
  const duplicateConfig = [...original];
  duplicateConfig.splice(duplicateConfig.indexOf(image), 0, "--config", "project_doc_max_bytes=0");
  assert.throws(() => parseContainedProviderArgs(duplicateConfig, "codex", "api-key"));
});

test("timed-out provider containers are force-removed and checked for survivors", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const calls: string[][] = [];
  const fake = async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "ps") return { stdout: "", stderr: "", code: 0, timedOut: false };
    if (args[0] === "rm") return { stdout: "", stderr: "", code: 0, timedOut: false };
    return { stdout: "", stderr: "", code: null, timedOut: true };
  };
  const run = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  const result = await run("codex", codexCommand(paths), { inheritEnv: false, timeoutMs: 1 });
  assert.equal(result.timedOut, true);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [["run", "--name"], ["rm", "--force"], ["ps", "--all"]]);
});

test("provider and version probes preserve primary failures while proving cleanup", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const fake = async (_cmd: string, args: string[]) => {
    if (args[0] === "run") throw new Error("primary sentinel");
    if (args[0] === "rm") return { stdout: "", stderr: "rm failed", code: 1, timedOut: false };
    return { stdout: "container-id\n", stderr: "", code: 0, timedOut: false };
  };
  const provider = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  await assert.rejects(() => provider("codex", codexCommand(paths), { inheritEnv: false }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[0]), /primary sentinel/);
    assert.equal(error.errors.length, 3);
    return true;
  });
  await assert.rejects(() => observeContainedCliVersion("codex", fake, image), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[0]), /primary sentinel/);
    assert.equal(error.errors.length, 3);
    return true;
  });
});

test("returned provider timeouts retain their result when cleanup also fails", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const fake = async (_cmd: string, args: string[]) => {
    if (args[0] === "run") return { stdout: '{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":2}}\n', stderr: "", code: null, timedOut: true };
    if (args[0] === "rm") return { stdout: "", stderr: "rm failed", code: 1, timedOut: false };
    return { stdout: "container-id\n", stderr: "", code: 0, timedOut: false };
  };
  const provider = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  const result = await provider("codex", codexCommand(paths), { inheritEnv: false });
  assert.equal(result.timedOut, true);
  assert.equal(result.stdout.includes("input_tokens"), true);
  assert.deepEqual(result.cleanupErrors, [
    "force-removing evaluation container failed",
    "evaluation container survived force-removal",
  ]);
});

test("CLI-session inputs must remain private, owned, single-link files", () => {
  const paths = roots();
  const session = join(paths.root, "session"); mkdirSync(session, { mode: 0o755 });
  writeFileSync(join(session, "auth.json"), "{}", { mode: 0o600 });
  process.env.PEREGRINE_CODEX_SESSION_DIR = session;
  assert.throws(() => buildContainedProviderArgs(
    { runner: "codex", providerAccess: "cli-session", image, ...paths }, "codex", codexCommand(paths),
  ), /session directory must be private/);
  chmodSync(session, 0o700);
  chmodSync(join(session, "auth.json"), 0o644);
  assert.throws(() => buildContainedProviderArgs(
    { runner: "codex", providerAccess: "cli-session", image, ...paths }, "codex", codexCommand(paths),
  ), /session file must be a private/);
});

test("provider output reader rejects symlinks, hardlinks, writable files, oversize files, and extras", () => {
  const paths = roots();
  const uid = process.getuid!();
  const target = join(paths.outputDir, "result.json");
  writeFileSync(target, "{}", { mode: 0o600 });
  assert.equal(createContainedOutputReader(paths.outputDir, 16, uid)(target), "{}");

  const symlinkRoot = roots(); writeFileSync(join(symlinkRoot.root, "outside"), "secret");
  symlinkSync(join(symlinkRoot.root, "outside"), join(symlinkRoot.outputDir, "result.json"));
  assert.throws(() => createContainedOutputReader(symlinkRoot.outputDir, 16, uid)(join(symlinkRoot.outputDir, "result.json")));

  const hardRoot = roots(); writeFileSync(join(hardRoot.outputDir, "result.json"), "{}");
  linkSync(join(hardRoot.outputDir, "result.json"), join(hardRoot.root, "linked"));
  assert.throws(() => createContainedOutputReader(hardRoot.outputDir, 16, uid)(join(hardRoot.outputDir, "result.json")));

  const modeRoot = roots(); writeFileSync(join(modeRoot.outputDir, "result.json"), "{}"); chmodSync(join(modeRoot.outputDir, "result.json"), 0o622);
  assert.throws(() => createContainedOutputReader(modeRoot.outputDir, 16, uid)(join(modeRoot.outputDir, "result.json")));

  const sizeRoot = roots(); writeFileSync(join(sizeRoot.outputDir, "result.json"), "too large");
  assert.throws(() => createContainedOutputReader(sizeRoot.outputDir, 2, uid)(join(sizeRoot.outputDir, "result.json")));

  const extraRoot = roots(); writeFileSync(join(extraRoot.outputDir, "result.json"), "{}"); writeFileSync(join(extraRoot.outputDir, "extra"), "x");
  assert.throws(() => createContainedOutputReader(extraRoot.outputDir, 16, uid)(join(extraRoot.outputDir, "result.json")));
});

test("schema-v2 evidence records filesystem and network capability separately", () => {
  const manifest = {
    schemaVersion: 2,
    createdAt: "2026-09-03T00:00:00.000Z",
    expectedAttempts: [{
      id: "attempt-000001", caseName: "development/case-aabbccdd", corpus: "development",
      expectedBugCount: 1, configName: "luna-medium", repeat: 1,
      file: "attempt-000001.json", runner: "codex",
    }],
    providerNetworkIsolation: { codex: { status: "limited", mechanism: "bridge egress; no destination allowlist" } },
    providerFilesystemIsolation: { codex: { status: "enforced", mechanism: "digest-pinned OCI mounts" } },
    runtimeImage: { reference: image, pullPolicy: "never" },
  };
  assert.doesNotThrow(() => parseMatrixRunManifest(manifest));
  assert.throws(() => parseMatrixRunManifest({ ...manifest, runtimeImage: { reference: `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:${"a".repeat(64)}`, pullPolicy: "never" } }), /must equal the accepted/);
  assert.throws(() => parseMatrixRunManifest({ ...manifest, providerFilesystemIsolation: { codex: { status: "limited", mechanism: "weak" } } }), /must be enforced/);
  assert.throws(() => parseMatrixRunManifest({ ...manifest, providerNetworkIsolation: { codex: { status: "enforced", mechanism: "overclaim" } } }), /must be limited/);
});
