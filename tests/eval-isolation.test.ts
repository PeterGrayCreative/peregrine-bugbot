import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  assertLiveProviderIsolationAvailable,
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
    assert.equal(first.materializedDiffSha256, second.materializedDiffSha256);
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
      "review.patch",
    ]);
    assert.equal(dirname(first.diffPath), firstRoot);
    assert.notEqual(first.diffPath, join(caseDir, "diff.patch"));

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
  const caseDir = join(root, "cases", "development", "case-cafebabe");
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
  writeFileSync(
    join(caseDir, "ground_truth.json"),
    JSON.stringify({ bugs: [{
      id: "truth-cafebabe",
      file: "src/value.ts",
      startLine: 1,
      endLine: 1,
      description: "The historical change introduces the curated wrong count.",
    }] }),
  );
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

test("reachable deleted UTF-16 binary blobs are scanned before provider invocation", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-deleted-blob-test-"));
  const hiddenDescription = "Deleted binary contains the unreleased answer sentinel.";
  try {
    const encoded = Buffer.from(`${hiddenDescription}\n// BUG: hidden answer`, "utf16le");
    for (const [id, bytes, expected] of [
      ["case-b16b00b5", encoded, /reachable Git blob .*forbidden answer-bearing term/],
      [
        "case-b16b00b6",
        Buffer.concat([Buffer.from([0xfe, 0xff]), encodeUtf16Be(encoded)]),
        /reachable Git blob .*forbidden answer-bearing term/,
      ],
      [
        "case-b16b00b7",
        encodeUtf16Be(Buffer.from("# FIXME: hidden encoded marker", "utf16le")),
        /reachable Git blob .*undocumented answer-bearing marker/,
      ],
    ] as const) {
      const source = join(root, `source-${id}`);
      const caseDir = join(root, "cases", "development", id);
      mkdirSync(join(source, "assets"), { recursive: true });
      git(source, "init", "-q", "-b", "main");
      git(source, "config", "user.name", "Curator");
      git(source, "config", "user.email", "curator@example.invalid");
      writeFileSync(join(source, "assets", "deleted.bin"), bytes);
      git(source, "add", ".");
      git(source, "commit", "-q", "-m", "source base");
      const base = git(source, "rev-parse", "HEAD");
      rmSync(join(source, "assets", "deleted.bin"));
      git(source, "add", "--all");
      git(source, "commit", "-q", "-m", "source head");
      const head = git(source, "rev-parse", "HEAD");

      mkdirSync(caseDir, { recursive: true });
      writeFileSync(join(caseDir, "diff.patch"), `${git(source, "diff", "--binary", `${base}...${head}`)}\n`);
      writeFileSync(
        join(caseDir, "ground_truth.json"),
        JSON.stringify({ bugs: [{
          id: "binary-deletion-answer",
          file: "assets/deleted.bin",
          startLine: 1,
          endLine: 1,
          description: hiddenDescription,
        }] }),
      );
      writeFileSync(
        join(caseDir, "case.json"),
        JSON.stringify({
          id,
          corpus: "development",
          kind: "historical",
          repoSource: source,
          baseCommit: base,
          headCommit: head,
          diffFile: "diff.patch",
        }),
      );

      const spec = loadCaseSpec(caseDir);
      await assert.rejects(
        () => materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec)),
        expected,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reachable base-only paths reject symlink modes and answer artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-base-only-paths-"));
  const casesDir = join(root, "cases");
  try {
    const symlinkCase = createBaseOnlyDeletionCase(
      root,
      casesDir,
      "case-120000aa",
      "src/legacy-link",
      "keep.ts",
      true,
    );
    let spec = loadCaseSpec(symlinkCase);
    await assert.rejects(
      () => materializeCase(symlinkCase, spec, leakagePolicyForCase(symlinkCase, spec)),
      /reachable Git history contains a forbidden symlink/,
    );

    const artifactCase = createBaseOnlyDeletionCase(
      root,
      casesDir,
      "case-a22fac7a",
      "review-comments.txt",
      "ordinary historical review text\n",
      false,
    );
    spec = loadCaseSpec(artifactCase);
    await assert.rejects(
      () => materializeCase(artifactCase, spec, leakagePolicyForCase(artifactCase, spec)),
      /reachable Git history contains a forbidden answer artifact/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("content-addressed curator exceptions allow only an explicitly documented marker blob", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-marker-exception-"));
  const caseDir = createFixtureCase(root, "case-e11e11e1", "development");
  const marker = "// FIXME: retained historical terminology, not an answer\n";
  writeFileSync(join(caseDir, "fixture", "src", "legacy.ts"), marker);
  const specPath = join(caseDir, "case.json");
  const specJson = JSON.parse(readFileSync(specPath, "utf8"));
  specJson.leakageExceptionsFile = "leakage_exceptions.json";
  writeFileSync(specPath, JSON.stringify(specJson));
  const exceptionsPath = join(caseDir, "leakage_exceptions.json");
  writeFileSync(
    exceptionsPath,
    JSON.stringify({
      version: 1,
      entries: [{ sha256: "0".repeat(64), reason: "Verified non-answer historical terminology." }],
    }),
  );
  try {
    let spec = loadCaseSpec(caseDir);
    await assert.rejects(
      () => materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec)),
      /undocumented answer-bearing marker/,
    );
    writeFileSync(
      exceptionsPath,
      JSON.stringify({
        version: 1,
        entries: [{
          sha256: createHash("sha256").update(marker).digest("hex"),
          reason: "Verified non-answer historical terminology.",
        }],
      }),
    );
    spec = loadCaseSpec(caseDir);
    const materialized = await materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec));
    materialized.cleanup();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("attempt cleanup is installed before asset setup and retries after removal failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-cleanup-guard-"));
  const attempts = join(root, "attempts");
  mkdirSync(attempts);
  const caseDir = createFixtureCase(root, "case-c1ea4e55", "development");
  const spec = loadCaseSpec(caseDir);
  const policy = leakagePolicyForCase(caseDir, spec);
  try {
    await assert.rejects(
      () => materializeCase(caseDir, spec, policy, {
        tempRoot: attempts,
        assetPreparer() { throw new Error("forced asset setup failure"); },
      }),
      /forced asset setup failure/,
    );
    assert.deepEqual(readdirSync(attempts), []);

    await assert.rejects(
      () => materializeCase(caseDir, spec, policy, {
        tempRoot: attempts,
        assetPreparer() { throw new Error("forced setup failure before provider"); },
        removeAttempt() { throw new Error("forced setup cleanup failure"); },
      }),
      (error: unknown) =>
        error instanceof AggregateError &&
        error.message.includes("case materialization failed and cleanup also failed") &&
        error.message.includes("cleanup failed after two attempts"),
    );
    const leakedAttempt = readdirSync(attempts);
    assert.equal(leakedAttempt.length, 1, "a failed removal remains visible for external cleanup");
    rmSync(join(attempts, leakedAttempt[0]!), { recursive: true, force: true });

    let removalCalls = 0;
    const materialized = await materializeCase(caseDir, spec, policy, {
      tempRoot: attempts,
      prepareProviderAssets: false,
      removeAttempt(path) {
        removalCalls++;
        if (removalCalls === 1) {
          throw new Error("forced removal failure");
        }
        rmSync(path, { recursive: true, force: true });
      },
    });
    const attemptRoot = dirname(materialized.repoPath);
    materialized.cleanup();
    assert.equal(removalCalls, 2);
    assert.equal(existsSync(attemptRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("leakage validation rejects descriptive IDs, paths, prompts, metadata, and live answer markers", async () => {
  assert.throws(() => assertOpaqueCaseId("seeded-null-deref"), /descriptive case IDs are forbidden/);
  const policy = {
    caseId: "case-feedface",
    corpus: "development" as const,
    forbiddenTerms: ["truth-needle", "seeded-null-deref"],
    documentedMarkerHashes: new Set<string>(),
  };
  assert.throws(() => assertLeakageFreePath("/tmp/seeded-null-deref", policy), /forbidden answer-bearing term/);
  assert.throws(
    () => createPromptValidator(policy)({ prompt: "The answer is truth-needle", stage: "breadth" }),
    /final breadth provider prompt/,
  );
  assert.doesNotThrow(() =>
    createPromptValidator(policy)({
      prompt: "Ledger: Candidate says // BUG: check this and mentions ground truth generically",
      stage: "investigation",
      untrustedModelText: "Candidate says // BUG: check this and mentions ground truth generically",
    }),
  );
  assert.doesNotThrow(() =>
    createPromptValidator(policy)({
      prompt: "Inspect the authorization lane at high severity and use fix-in-pr when warranted.",
      stage: "breadth",
    }),
  );
  assert.throws(
    () => createPromptValidator(policy)({
      prompt: "Trusted instructions contain // BUG: direct answer\nLedger: ordinary candidate",
      stage: "investigation",
      untrustedModelText: "ordinary candidate",
    }),
    /final investigation provider prompt/,
  );
  assert.throws(
    () => createPromptValidator(policy)({
      prompt: "Trusted instructions mention ground truth\nLedger: ordinary candidate",
      stage: "investigation",
      untrustedModelText: "ordinary candidate",
    }),
    /final investigation provider prompt/,
  );
  assert.throws(
    () => createPromptValidator(policy)({
      prompt: "Candidate exposes truth-needle",
      stage: "investigation",
      untrustedModelText: "Candidate exposes truth-needle",
    }),
    /breadth model output/,
  );
  assert.throws(() => assertLeakageFreeText("diff", "+ // BUG: answer", policy), /answer-bearing marker/);
  assert.throws(() => assertLeakageFreeText("profile", "# FIXME later", policy), /answer-bearing marker/);

  const root = mkdtempSync(join(tmpdir(), "peregrine-metadata-test-"));
  const caseDir = createFixtureCase(root, "case-feedface", "development", {
    metadata: { title: "A hidden truth description with enough detail." },
  });
  try {
    const spec = loadCaseSpec(caseDir);
    const casePolicy = leakagePolicyForCase(caseDir, spec);
    assert.throws(() => readSanitizedMetadata(caseDir, spec, casePolicy), /model-visible metadata/);
    assert.throws(
      () => createPromptValidator(casePolicy)({
        prompt: "A hidden truth   description with enough detail.",
        stage: "breadth",
      }),
      /forbidden answer-bearing term/,
    );
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
      expected: /forbidden symlink/,
    },
    {
      name: "nested-git",
      mutate(caseDir) {
        mkdirSync(join(caseDir, "fixture", "nested", ".git"), { recursive: true });
      },
      expected: /forbidden nested Git metadata/,
    },
    {
      name: "gitmodules",
      mutate(caseDir) {
        writeFileSync(join(caseDir, "fixture", ".gitmodules"), "[submodule]\n");
      },
      expected: /forbidden nested Git metadata/,
    },
    {
      name: "special-file",
      mutate(caseDir) {
        execFileSync("mkfifo", [join(caseDir, "fixture", "named-pipe")]);
      },
      expected: /forbidden special file/,
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
      name: "ground-truth-id-filename",
      mutate(caseDir) {
        writeFileSync(join(caseDir, "fixture", "src", "truth-needle.ts"), "export {};\n");
      },
      expected: /repository path .*forbidden answer-bearing term/,
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
  const diffPaths: string[] = [];
  let calls = 0;
  const engine: Engine = {
    name: "mock",
    async review(ctx): Promise<EngineResult> {
      calls++;
      paths.push(ctx.repoPath);
      diffPaths.push(ctx.diffPath);
      assert.equal(dirname(ctx.diffPath), dirname(ctx.repoPath));
      assert.doesNotMatch(ctx.diffPath, /case-aabbccdd|\/cases\//);
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
    assert.ok(diffPaths.every((path) => !existsSync(path)), "every materialized diff should be removed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty selected corpora produce a safe zero-attempt manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-empty-matrix-"));
  const casesDir = join(root, "cases");
  mkdirSync(join(casesDir, "development"), { recursive: true });
  mkdirSync(join(casesDir, "validation"));
  const matrixPath = join(root, "matrix.json");
  writeFileSync(
    matrixPath,
    JSON.stringify({
      repeats: 1,
      corpora: ["development", "validation"],
      configs: [{ name: "live", runner: "claude" }],
    }),
  );
  let calls = 0;
  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => ({ name: "claude", async review() { calls++; return completed("claude"); } }),
    });
    const manifest = JSON.parse(readFileSync(join(runsDir, "matrix-manifest.json"), "utf8"));
    assert.deepEqual(manifest.expectedAttempts, []);
    assert.equal(calls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("case discovery rejects missing specs and non-canonical directory layouts", async () => {
  for (const scenario of ["missing-spec", "descriptive-layer"] as const) {
    const root = mkdtempSync(join(tmpdir(), `peregrine-layout-${scenario}-`));
    const casesDir = join(root, "cases");
    if (scenario === "missing-spec") {
      mkdirSync(join(casesDir, "development", "case-acde1234"), { recursive: true });
    } else {
      mkdirSync(join(casesDir, "development", "authorization-examples"), { recursive: true });
    }
    const matrixPath = join(root, "matrix.json");
    writeFileSync(
      matrixPath,
      JSON.stringify({ repeats: 1, configs: [{ name: "mock", runner: "mock" }] }),
    );
    try {
      await assert.rejects(
        () => runMatrix(matrixPath, join(root, "runs"), { casesDir }),
        scenario === "missing-spec" ? /missing case\.json/ : /descriptive case IDs are forbidden/,
      );
      assert.equal(existsSync(join(root, "runs")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("leaking cases, structural smoke, and uncontained live runs never invoke an engine", async () => {
  for (const scenario of ["leak", "live-structural", "live-uncontained"] as const) {
    const root = mkdtempSync(join(tmpdir(), `peregrine-no-engine-${scenario}-`));
    const casesDir = join(root, "cases");
    const corpus: CaseCorpus = scenario === "live-structural" ? "structural-smoke" : "development";
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
      if (scenario === "live-uncontained") assert.match(record.outcome.message, /filesystem and network allowlist/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("leakage failures do not echo answer IDs or paths into records or stdout", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-redacted-leak-"));
  const casesDir = join(root, "cases");
  const caseDir = createFixtureCase(casesDir, "case-acde9876", "development");
  writeFileSync(join(caseDir, "fixture", "src", "truth-needle.ts"), "export {};\n");
  const matrixPath = join(root, "matrix.json");
  writeFileSync(
    matrixPath,
    JSON.stringify({ repeats: 1, configs: [{ name: "mock", runner: "mock" }] }),
  );
  let calls = 0;
  let captured = "";
  let runsDir = "";
  const originalWrite = process.stdout.write;
  const originalLog = console.log;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  console.log = (...values: unknown[]) => { captured += `${values.map(String).join(" ")}\n`; };
  try {
    runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => ({ name: "mock", async review() { calls++; return completed(); } }),
    });
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
  try {
    const record = readFileSync(join(runsDir, "attempt-000001.json"), "utf8");
    assert.equal(calls, 0);
    assert.doesNotMatch(record, /truth-needle/);
    assert.doesNotMatch(captured, /truth-needle/);
    assert.match(record, /forbidden answer-bearing term/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated provider environments omit ambient Git, SSH, CLI homes, and unrelated credentials", () => {
  const previous = { ...process.env };
  process.env.ANTHROPIC_API_KEY = "allowed-provider-key";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "disallowed-bare-oauth-token";
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
    assert.equal(environment.CLAUDE_CODE_OAUTH_TOKEN, undefined);
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

test("matrix manifest records live network isolation as unavailable", () => {
  assert.equal(networkIsolationCapability("mock").status, "not-applicable");
  assert.equal(networkIsolationCapability("claude").status, "unavailable");
  assert.equal(networkIsolationCapability("codex").status, "unavailable");
  assert.throws(() => assertLiveProviderIsolationAvailable("claude"), /filesystem and network allowlist/);
  assert.throws(() => assertLiveProviderIsolationAvailable("codex"), /filesystem and network allowlist/);
});

function createFixtureCase(
  casesDir: string,
  id: string,
  corpus: CaseCorpus,
  options: { metadata?: Record<string, unknown> } = {},
): string {
  const caseDir = join(casesDir, corpus, id);
  mkdirSync(join(caseDir, "fixture", "src"), { recursive: true });
  writeFileSync(join(caseDir, "fixture", "src", "value.ts"), HEAD);
  writeFileSync(join(caseDir, "diff.patch"), PATCH);
  writeFileSync(
    join(caseDir, "ground_truth.json"),
    JSON.stringify({
      bugs: [{
        id: "truth-needle",
        file: "src/value.ts",
        startLine: 1,
        endLine: 1,
        description: "A hidden truth description with enough detail.",
        lane: "authorization",
        severity: "high",
        expectedDisposition: "fix-in-pr",
      }],
    }),
  );
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

function createBaseOnlyDeletionCase(
  root: string,
  casesDir: string,
  id: string,
  deletedPath: string,
  deletedContent: string,
  symlink: boolean,
): string {
  const source = join(root, `source-${id}`);
  mkdirSync(join(source, "src"), { recursive: true });
  git(source, "init", "-q", "-b", "main");
  git(source, "config", "user.name", "Curator");
  git(source, "config", "user.email", "curator@example.invalid");
  writeFileSync(join(source, "src", "keep.ts"), "export const keep = true;\n");
  const deleted = join(source, deletedPath);
  mkdirSync(dirname(deleted), { recursive: true });
  if (symlink) symlinkSync(deletedContent, deleted);
  else writeFileSync(deleted, deletedContent);
  git(source, "add", "--all");
  git(source, "commit", "-q", "-m", "base");
  const base = git(source, "rev-parse", "HEAD");
  rmSync(deleted, { recursive: true, force: true });
  git(source, "add", "--all");
  git(source, "commit", "-q", "-m", "head");
  const head = git(source, "rev-parse", "HEAD");

  const caseDir = join(casesDir, "development", id);
  mkdirSync(join(caseDir, "fixture", "src"), { recursive: true });
  writeFileSync(join(caseDir, "fixture", "src", "keep.ts"), "export const keep = true;\n");
  writeFileSync(join(caseDir, "diff.patch"), `${git(source, "diff", "--binary", `${base}...${head}`)}\n`);
  writeFileSync(
    join(caseDir, "ground_truth.json"),
    JSON.stringify({ bugs: [{
      id: `hidden-${id}`,
      file: "src/keep.ts",
      startLine: 1,
      endLine: 1,
      description: "The deleted base-only object is curator-controlled answer material.",
    }] }),
  );
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({
      id,
      corpus: "development",
      kind: "seeded",
      fixtureDir: "fixture",
      diffFile: "diff.patch",
    }),
  );
  return caseDir;
}

function encodeUtf16Be(utf16Le: Buffer): Buffer {
  const output = Buffer.allocUnsafe(utf16Le.length);
  for (let index = 0; index < utf16Le.length; index += 2) {
    output[index] = utf16Le[index + 1]!;
    output[index + 1] = utf16Le[index]!;
  }
  return output;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
