import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertLeakageFreePath,
  assertLeakageFreeText,
  assertOpaqueCaseId,
  createPromptValidator,
  leakagePolicyForCase,
  materializeCase,
  networkIsolationCapability,
  readSanitizedMetadata,
} from "../eval/case-isolation.js";
import { loadCaseSpec, runMatrix } from "../eval/run-matrix.js";
import { isolatedProviderEnvironment } from "../src/security/provider-env.js";
import type { CaseCorpus, CaseSpec, EngineResult, MatrixModelConfig } from "../src/types.js";
import type { Engine } from "../src/engines/engine.js";

const HEAD = "export const enabled = false;\n";
const PATCH = [
  "--- a/src/value.ts",
  "+++ b/src/value.ts",
  "@@ -1 +1 @@",
  "-export const enabled = true;",
  "+export const enabled = false;",
  "",
].join("\n");

test("fixture attempts use unique sanitized repositories with deterministic refs", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-isolation-test-"));
  const caseDir = createFixtureCase(root, "case-deadbeef", "development");
  const spec = loadCaseSpec(caseDir);
  const policy = leakagePolicyForCase(caseDir, spec);
  const first = await materializeCase(caseDir, spec, policy);
  const second = await materializeCase(caseDir, spec, policy);
  const firstRoot = dirname(first.repoPath);
  const secondRoot = dirname(second.repoPath);
  try {
    assert.notEqual(first.repoPath, second.repoPath);
    assert.equal(first.baseRef, second.baseRef);
    assert.equal(first.headRef, second.headRef);
    assert.equal(first.exactDiffSha256, second.exactDiffSha256);
    assert.equal(git(first.repoPath, "rev-list", "--all", "--count"), "2");
    assert.equal(git(first.repoPath, "remote"), "");
    assert.equal(readFileSync(join(first.repoPath, "src/value.ts"), "utf8"), HEAD);
    assert.equal(existsSync(join(first.repoPath, ".git", "hooks")), false);
    assert.equal(existsSync(join(first.evaluationIsolation.providerAssetsRoot, "eval")), false);
    assert.ok(existsSync(join(first.evaluationIsolation.providerAssetsRoot, "skills")));
    assert.ok(existsSync(join(first.evaluationIsolation.providerAssetsRoot, "schemas")));
    assert.doesNotMatch(readFileSync(join(first.repoPath, ".git", "config"), "utf8"), /remote|credential|token/i);
    assert.deepEqual(readdirSync(firstRoot).sort(), [
      "checkout",
      "empty-git-template",
      "provider-assets",
      "provider-home",
    ]);

    writeFileSync(join(first.repoPath, "src/value.ts"), "mutated\n");
    assert.equal(readFileSync(join(second.repoPath, "src/value.ts"), "utf8"), HEAD);
  } finally {
    first.cleanup();
    second.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(existsSync(firstRoot), false);
  assert.equal(existsSync(secondRoot), false);
});

test("historical attempts export only sanitized base and head trees", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-history-test-"));
  const source = join(root, "source");
  const caseDir = join(root, "cases", "case-cafebabe");
  mkdirSync(source, { recursive: true });
  git(source, "init", "-q", "-b", "main");
  git(source, "config", "user.name", "Curator");
  git(source, "config", "user.email", "curator@example.invalid");
  mkdirSync(join(source, "src"));
  writeFileSync(join(source, "src/value.ts"), "export const count = 1;\n");
  git(source, "add", ".");
  git(source, "commit", "-q", "-m", "source base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src/value.ts"), "export const count = 2;\n");
  git(source, "add", ".");
  git(source, "commit", "-q", "-m", "source head");
  const head = git(source, "rev-parse", "HEAD");
  const diff = git(source, "diff", `${base}...${head}`) + "\n";
  writeFileSync(join(source, "src/value.ts"), "export const count = 3;\n");
  git(source, "add", ".");
  git(source, "commit", "-q", "-m", "future repair");
  const later = git(source, "rev-parse", "HEAD");
  git(source, "remote", "add", "origin", "https://example.invalid/answer-source.git");
  mkdirSync(join(source, ".git", "hooks"), { recursive: true });
  writeFileSync(join(source, ".git", "hooks", "pre-commit"), "#!/bin/sh\n");

  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, "diff.patch"), diff);
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ bugs: [{ id: "truth-cafebabe" }] }));
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({
      id: "case-cafebabe",
      corpus: "development",
      kind: "historical",
      repoSource: source,
      baseCommit: base,
      headCommit: head,
      diffFile: "diff.patch",
    }),
  );

  const spec = loadCaseSpec(caseDir);
  const materialized = await materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec));
  try {
    assert.equal(git(materialized.repoPath, "rev-list", "--all", "--count"), "2");
    assert.equal(git(materialized.repoPath, "remote"), "");
    assert.equal(readFileSync(join(materialized.repoPath, "src/value.ts"), "utf8"), "export const count = 2;\n");
    assert.notEqual(materialized.baseRef, base);
    assert.notEqual(materialized.headRef, head);
    const future = spawnSync("git", ["cat-file", "-e", later], { cwd: materialized.repoPath });
    assert.notEqual(future.status, 0);
    assert.equal(existsSync(join(dirname(materialized.repoPath), "curator-source")), false);
  } finally {
    materialized.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("leakage validation rejects descriptive IDs, paths, prompts, metadata, and live answer markers", async () => {
  assert.throws(() => assertOpaqueCaseId("seeded-null-deref"), /descriptive case IDs are forbidden/);
  const policy = {
    caseId: "case-feedface",
    corpus: "development" as const,
    forbiddenTerms: ["truth-needle", "seeded-null-deref"],
  };
  assert.throws(() => assertLeakageFreePath("/tmp/seeded-null-deref", policy), /forbidden answer-bearing term/);
  assert.throws(
    () => createPromptValidator(policy)("The answer is truth-needle", "breadth"),
    /final breadth provider prompt/,
  );
  assert.doesNotThrow(() =>
    createPromptValidator(policy)("Candidate says // BUG: check this", "investigation"),
  );
  assert.throws(
    () => createPromptValidator(policy)("Candidate exposes truth-needle", "investigation"),
    /final investigation provider prompt/,
  );
  assert.throws(() => assertLeakageFreeText("diff", "+ // BUG: answer", policy), /answer-bearing marker/);
  assert.throws(() => assertLeakageFreeText("profile", "# FIXME later", policy), /answer-bearing marker/);

  const root = mkdtempSync(join(tmpdir(), "peregrine-metadata-test-"));
  const caseDir = createFixtureCase(root, "case-feedface", "development", {
    metadata: { title: "truth-needle" },
  });
  try {
    const spec = loadCaseSpec(caseDir);
    const casePolicy = leakagePolicyForCase(caseDir, spec);
    assert.throws(() => readSanitizedMetadata(caseDir, spec, casePolicy), /model-visible metadata/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("case materialization rejects traversal, symlinks, nested Git data, answer artifacts, and profile markers", async () => {
  const mutations: Array<{ name: string; mutate(caseDir: string): void; expected: RegExp }> = [
    {
      name: "traversal",
      mutate(caseDir) {
        const spec = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8"));
        spec.diffFile = "../outside.patch";
        writeFileSync(join(dirname(caseDir), "outside.patch"), PATCH);
        writeFileSync(join(caseDir, "case.json"), JSON.stringify(spec));
      },
      expected: /diffFile escapes its case directory/,
    },
    {
      name: "symlink",
      mutate(caseDir) {
        symlinkSync("/tmp", join(caseDir, "fixture", "escape"));
      },
      expected: /contains symlink/,
    },
    {
      name: "nested-git",
      mutate(caseDir) {
        mkdirSync(join(caseDir, "fixture", "nested", ".git"), { recursive: true });
      },
      expected: /forbidden \.git/,
    },
    {
      name: "gitmodules",
      mutate(caseDir) {
        writeFileSync(join(caseDir, "fixture", ".gitmodules"), "[submodule]\n");
      },
      expected: /forbidden \.gitmodules/,
    },
    {
      name: "special-file",
      mutate(caseDir) {
        execFileSync("mkfifo", [join(caseDir, "fixture", "named-pipe")]);
      },
      expected: /contains special file/,
    },
    {
      name: "answer-artifact",
      mutate(caseDir) {
        writeFileSync(join(caseDir, "fixture", "ground_truth.json"), "{}\n");
      },
      expected: /answer artifact/,
    },
    {
      name: "ground-truth-id",
      mutate(caseDir) {
        writeFileSync(join(caseDir, "fixture", "src", "canary.ts"), "export const value = 'truth-needle';\n");
      },
      expected: /forbidden answer-bearing term/,
    },
    {
      name: "profile-marker",
      mutate(caseDir) {
        mkdirSync(join(caseDir, "fixture", ".peregrine"), { recursive: true });
        writeFileSync(join(caseDir, "fixture", ".peregrine", "profile.md"), "# FIXME expected answer\n");
      },
      expected: /answer-bearing marker/,
    },
  ];

  for (const item of mutations) {
    const root = mkdtempSync(join(tmpdir(), `peregrine-negative-${item.name}-`));
    const caseDir = createFixtureCase(root, "case-abcd1234", "development");
    try {
      item.mutate(caseDir);
      const spec = loadCaseSpec(caseDir);
      const attemptsRoot = join(root, "attempts");
      mkdirSync(attemptsRoot);
      await assert.rejects(
        () => materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec), { tempRoot: attemptsRoot }),
        item.expected,
      );
      assert.deepEqual(readdirSync(attemptsRoot), [], "failed materialization must clean its attempt root");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("matrix creates and cleans a fresh checkout for every attempt, including failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-matrix-isolation-"));
  const casesDir = join(root, "cases");
  createFixtureCase(casesDir, "case-aabbccdd", "development");
  const matrixPath = join(root, "matrix.json");
  const configs: MatrixModelConfig[] = [
    { name: "one", runner: "mock" },
    { name: "two", runner: "mock" },
  ];
  writeFileSync(matrixPath, JSON.stringify({ repeats: 2, configs }));

  const paths: string[] = [];
  let calls = 0;
  const engine: Engine = {
    name: "mock",
    async review(ctx): Promise<EngineResult> {
      calls++;
      paths.push(ctx.repoPath);
      assert.equal(readFileSync(join(ctx.repoPath, "src/value.ts"), "utf8"), HEAD);
      writeFileSync(join(ctx.repoPath, "src/value.ts"), `mutation-${calls}\n`);
      if (calls === 2) throw new Error("forced provider failure");
      return completed();
    },
  };

  try {
    await runMatrix(matrixPath, join(root, "runs"), { casesDir, engineFor: () => engine });
    assert.equal(calls, 4);
    assert.equal(new Set(paths).size, 4);
    assert.ok(paths.every((path) => !existsSync(path)), "every attempt checkout should be removed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("leaking cases and structural smoke/live mismatches never invoke an engine", async () => {
  for (const scenario of ["leak", "live-structural"] as const) {
    const root = mkdtempSync(join(tmpdir(), `peregrine-no-engine-${scenario}-`));
    const casesDir = join(root, "cases");
    const corpus: CaseCorpus = scenario === "leak" ? "development" : "structural-smoke";
    const caseDir = createFixtureCase(casesDir, "case-11223344", corpus);
    if (scenario === "leak") {
      writeFileSync(join(caseDir, "fixture", "src", "leak.ts"), "// BUG: exposed answer\n");
    }
    const matrixPath = join(root, "matrix.json");
    writeFileSync(
      matrixPath,
      JSON.stringify({ repeats: 1, configs: [{ name: "live", runner: "claude" }] }),
    );
    let calls = 0;
    const engine: Engine = { name: "claude", async review() { calls++; return completed("claude"); } };
    try {
      const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
        casesDir,
        engineFor: () => engine,
      });
      assert.equal(calls, 0);
      const record = JSON.parse(
        readFileSync(join(runsDir, "attempt-000001.json"), "utf8"),
      ) as { outcome: { status: string; failureKind: string; message: string } };
      assert.equal(record.outcome.status, "failed");
      assert.equal(record.outcome.failureKind, "configuration");
      assert.match(record.outcome.message, /isolation failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("isolated provider environments omit ambient Git, SSH, CLI homes, and unrelated credentials", () => {
  const previous = { ...process.env };
  process.env.ANTHROPIC_API_KEY = "allowed-provider-key";
  process.env.OPENAI_API_KEY = "other-provider-key";
  process.env.GITHUB_TOKEN = "unrelated-token";
  process.env.SSH_AUTH_SOCK = "/tmp/agent.sock";
  process.env.GIT_ASKPASS = "/tmp/credential-helper";
  process.env.CODEX_HOME = "/tmp/user-codex-home";
  process.env.HTTPS_PROXY = "https://user:password@proxy.invalid";
  try {
    const environment = isolatedProviderEnvironment("claude", "/tmp/isolated-home");
    assert.equal(environment.HOME, "/tmp/isolated-home");
    assert.equal(environment.ANTHROPIC_API_KEY, "allowed-provider-key");
    assert.equal(environment.OPENAI_API_KEY, undefined);
    assert.equal(environment.GITHUB_TOKEN, undefined);
    assert.equal(environment.SSH_AUTH_SOCK, undefined);
    assert.equal(environment.GIT_ASKPASS, undefined);
    assert.equal(environment.CODEX_HOME, undefined);
    assert.equal(environment.HTTPS_PROXY, undefined);
    assert.equal(environment.GIT_CONFIG_GLOBAL, "/dev/null");
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name];
    for (const [name, value] of Object.entries(previous)) process.env[name] = value;
  }
});

test("matrix manifest records network-isolation capability without claiming unsupported enforcement", () => {
  assert.equal(networkIsolationCapability("mock").status, "not-applicable");
  assert.equal(networkIsolationCapability("claude").status, "limited");
  assert.equal(networkIsolationCapability("codex").status, "limited");
});

function createFixtureCase(
  casesDir: string,
  id: string,
  corpus: CaseCorpus,
  options: { metadata?: Record<string, unknown> } = {},
): string {
  const caseDir = join(casesDir, id);
  mkdirSync(join(caseDir, "fixture", "src"), { recursive: true });
  writeFileSync(join(caseDir, "fixture", "src", "value.ts"), HEAD);
  writeFileSync(join(caseDir, "diff.patch"), PATCH);
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ bugs: [{ id: "truth-needle" }] }));
  const spec: CaseSpec = {
    id,
    corpus,
    kind: "seeded",
    fixtureDir: "fixture",
    diffFile: "diff.patch",
    ...(options.metadata ? { metadataFile: "metadata.json" } : {}),
  };
  writeFileSync(join(caseDir, "case.json"), JSON.stringify(spec));
  if (options.metadata) writeFileSync(join(caseDir, "metadata.json"), JSON.stringify(options.metadata));
  return caseDir;
}

function completed(engine: "mock" | "claude" = "mock"): EngineResult {
  return {
    engine,
    status: "clean",
    modelConfig: "test",
    findings: [],
    usage: {},
    durationMs: 1,
  };
}

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
