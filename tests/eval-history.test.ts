import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  EVALUATION_DIFF_NORMALIZATION,
  leakagePolicyForCase,
  materializeCase,
} from "../eval/case-isolation.js";
import { prepareEvaluationManifest } from "../eval/case-manifest.js";
import { parseMatrixRunManifest, parseRunRecord } from "../eval/artifacts.js";
import { loadCaseSpec, runMatrix } from "../eval/run-matrix.js";
import { MAX_MANIFEST_CHARS, prepareReviewManifest } from "../src/core/manifest.js";
import { mockUsage } from "../src/core/telemetry.js";
import type {
  CaseCorpus,
  EngineResult,
  EvaluationHistoryProvenance,
  PeregrineConfig,
  ReviewContext,
} from "../src/types.js";
import type { Engine } from "../src/engines/engine.js";

const BASE_PROFILE = [
  "<!-- peregrine-profile-version: 1 -->",
  "# Review profile: base policy",
  "<!-- review-base: main -->",
  "<!-- manifest-extend runtime-config content-pattern: BASE_ONLY_TRIGGER -->",
  "",
].join("\n");

const HEAD_PROFILE = [
  "<!-- peregrine-profile-version: 1 -->",
  "# Review profile: untrusted head policy",
  "<!-- review-base: main -->",
  "<!-- manifest-extend runtime-config content-pattern: HEAD_ONLY_TRIGGER -->",
  "",
].join("\n");

test("materialized history exactly reproduces additions, deletions, renames, binaries, and merge-base profile policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-history-surfaces-"));
  const source = join(root, "source");
  mkdirSync(join(source, ".peregrine"), { recursive: true });
  mkdirSync(join(source, ".peregrine", "lanes"));
  mkdirSync(join(source, "src"));
  mkdirSync(join(source, "assets"));
  mkdirSync(join(source, "config"));
  initRepo(source);
  writeFileSync(join(source, ".peregrine", "profile.md"), BASE_PROFILE);
  writeFileSync(
    join(source, ".peregrine", "lanes", "09-project-policy.md"),
    customLane("Base project policy", "base-policy\\.cfg$", "BASE_CUSTOM_TRIGGER"),
  );
  writeFileSync(join(source, "src", "deleted.ts"), "export const removed = true;\n");
  writeFileSync(join(source, "src", "old-name.ts"), "export const stable = true;\n");
  writeFileSync(join(source, "src", "tool.sh"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(source, "src", "tool.sh"), 0o755);
  writeFileSync(join(source, "src", "policy.txt"), "neutral\n");
  writeFileSync(join(source, "config", "base-policy.cfg"), "neutral\n");
  writeFileSync(join(source, "assets", "payload.bin"), Buffer.from([0, 1, 2, 3]));
  commitAll(source, "source base");
  const sourceBase = git(source, "rev-parse", "HEAD");

  writeFileSync(join(source, ".peregrine", "profile.md"), HEAD_PROFILE);
  writeFileSync(
    join(source, ".peregrine", "lanes", "09-project-policy.md"),
    customLane("Head project policy", "head-policy\\.cfg$", "HEAD_CUSTOM_TRIGGER"),
  );
  rmSync(join(source, "src", "deleted.ts"));
  git(source, "mv", "src/old-name.ts", "src/new-name.ts");
  chmodSync(join(source, "src", "tool.sh"), 0o644);
  writeFileSync(join(source, "src", "added.ts"), "export const added = true;\n");
  writeFileSync(join(source, "src", "policy.txt"), "BASE_ONLY_TRIGGER\n");
  writeFileSync(join(source, "src", "head-policy.txt"), "HEAD_ONLY_TRIGGER\n");
  writeFileSync(join(source, "config", "base-policy.cfg"), "BASE_CUSTOM_TRIGGER\n");
  writeFileSync(join(source, "config", "head-policy.cfg"), "HEAD_CUSTOM_TRIGGER\n");
  writeFileSync(join(source, "assets", "payload.bin"), Buffer.from([0, 1, 2, 4, 5]));
  commitAll(source, "source head");
  const sourceHead = git(source, "rev-parse", "HEAD");
  const expectedDiff = canonicalDiff(source, sourceBase, sourceHead);
  assert.match(expectedDiff, /old mode 100755\nnew mode 100644/);
  const caseDir = createHistoricalCase(
    root,
    source,
    "case-a1b2c3d4",
    "development",
    expectedDiff,
    sourceBase,
    sourceHead,
  );

  const spec = loadCaseSpec(caseDir);
  const materialized = await materializeCase(
    caseDir,
    spec,
    leakagePolicyForCase(caseDir, spec),
    { prepareProviderAssets: false },
  );
  try {
    assert.equal(materialized.diffText, expectedDiff);
    assert.equal(materialized.historyProvenance.materialization, "historical-sanitized-export");
    assert.equal(materialized.baseRef, materialized.historyProvenance.mergeBase);
    assert.equal(materialized.historyProvenance.diffNormalization, EVALUATION_DIFF_NORMALIZATION);
    assert.equal(
      materialized.historyProvenance.diffSha256,
      createHash("sha256").update(expectedDiff).digest("hex"),
    );
    assert.equal(git(materialized.repoPath, "rev-parse", "HEAD"), materialized.headRef);
    assert.equal(git(materialized.repoPath, "write-tree"), materialized.historyProvenance.headTree);
    assert.equal(git(materialized.repoPath, "status", "--porcelain=v1"), "");

    const prepared = await prepareEvaluationManifest(
      reviewContext(materialized.repoPath, materialized.diffPath, materialized.diffText,
        materialized.baseRef, materialized.headRef),
      "invariant-first-pr-review",
      materialized.historyProvenance,
    );
    assert.equal(prepared.provenance.profileSource, "merge-base snapshot");
    assert.equal(prepared.provenance.headProfileChanged, true);
    assert.equal(prepared.provenance.output, prepared.manifest.output);
    assert.equal(
      prepared.provenance.outputSha256,
      createHash("sha256").update(prepared.provenance.output).digest("hex"),
    );
    assert.match(prepared.manifest.output ?? "", /^A\tsrc\/added\.ts$/m);
    assert.match(prepared.manifest.output ?? "", /^D\tsrc\/deleted\.ts$/m);
    assert.match(prepared.manifest.output ?? "", /^R100\tsrc\/old-name\.ts\tsrc\/new-name\.ts$/m);
    assert.match(prepared.manifest.output ?? "", /^M\tassets\/payload\.bin$/m);
    assert.match(prepared.manifest.output ?? "", /^M\tsrc\/tool\.sh$/m);
    assert.match(prepared.manifest.output ?? "", /^M\t\.peregrine\/profile\.md$/m);
    assert.match(runtimeSection(prepared.manifest.output ?? ""), /src\/policy\.txt/);
    assert.doesNotMatch(runtimeSection(prepared.manifest.output ?? ""), /src\/head-policy\.txt/);
    assert.match(prepared.manifest.output ?? "", /Base project policy \[lane: project-policy\]/);
    const custom = laneSection(prepared.manifest.output ?? "", "project-policy");
    assert.match(custom, /trusted lane source: git\\ show\\ (?:[a-f0-9]{40}|[a-f0-9]{64}):\.peregrine\/lanes\/09-project-policy\.md/);
    assert.match(custom, /config\/base-policy\.cfg/);
    assert.doesNotMatch(custom, /config\/head-policy\.cfg/);
  } finally {
    materialized.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("addition-only fixtures preserve an empty base and reproducible deterministic commits", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-empty-base-"));
  const source = join(root, "source");
  mkdirSync(source);
  initRepo(source);
  commitAll(source, "empty source base");
  const base = git(source, "rev-parse", "HEAD");
  mkdirSync(join(source, "src"));
  writeFileSync(join(source, "src", "added.ts"), "export const added = true;\n");
  commitAll(source, "source head");
  const head = git(source, "rev-parse", "HEAD");
  const expectedDiff = canonicalDiff(source, base, head);
  const caseDir = createFixtureFromHead(root, source, "case-0add0001", "development", expectedDiff);
  const spec = loadCaseSpec(caseDir);
  const policy = leakagePolicyForCase(caseDir, spec);
  const first = await materializeCase(caseDir, spec, policy, { prepareProviderAssets: false });
  const second = await materializeCase(caseDir, spec, policy, { prepareProviderAssets: false });
  try {
    assert.equal(first.baseRef, second.baseRef);
    assert.equal(first.headRef, second.headRef);
    assert.equal(first.historyProvenance.baseTree, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    assert.equal(first.historyProvenance.commitCount, 2);
    assert.equal(first.diffText, expectedDiff);
    const prepared = await prepareEvaluationManifest(
      reviewContext(first.repoPath, first.diffPath, first.diffText, first.baseRef, first.headRef),
      "invariant-first-pr-review",
      first.historyProvenance,
    );
    assert.equal(prepared.provenance.profileSource, "none");
    assert.match(prepared.manifest.output ?? "", /^A\tsrc\/added\.ts$/m);
  } finally {
    first.cleanup();
    second.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("production manifest provenance handles head-only, deleted, and absent profiles", async () => {
  for (const scenario of ["head-only", "deleted", "absent"] as const) {
    const root = mkdtempSync(join(tmpdir(), `peregrine-profile-${scenario}-`));
    const source = join(root, "source");
    mkdirSync(join(source, "src"), { recursive: true });
    initRepo(source);
    if (scenario === "deleted") {
      mkdirSync(join(source, ".peregrine"));
      writeFileSync(join(source, ".peregrine", "profile.md"), BASE_PROFILE);
      writeFileSync(join(source, "src", "policy.txt"), "neutral\n");
    }
    writeFileSync(join(source, "src", "value.ts"), "export const value = 1;\n");
    commitAll(source, "source base");
    const base = git(source, "rev-parse", "HEAD");
    if (scenario === "head-only") {
      mkdirSync(join(source, ".peregrine"));
      writeFileSync(join(source, ".peregrine", "profile.md"), HEAD_PROFILE);
      writeFileSync(join(source, "src", "head-policy.txt"), "HEAD_ONLY_TRIGGER\n");
    } else if (scenario === "deleted") {
      rmSync(join(source, ".peregrine"), { recursive: true, force: true });
      writeFileSync(join(source, "src", "policy.txt"), "BASE_ONLY_TRIGGER\n");
    }
    writeFileSync(join(source, "src", "value.ts"), "export const value = 2;\n");
    commitAll(source, "source head");
    const head = git(source, "rev-parse", "HEAD");
    const caseDir = createFixtureFromHead(
      root,
      source,
      scenario === "head-only" ? "case-aaaabbbb" : scenario === "deleted" ? "case-ccccdddd" : "case-eeeeffff",
      "development",
      canonicalDiff(source, base, head),
    );
    const spec = loadCaseSpec(caseDir);
    const materialized = await materializeCase(
      caseDir,
      spec,
      leakagePolicyForCase(caseDir, spec),
      { prepareProviderAssets: false },
    );
    try {
      const prepared = await prepareEvaluationManifest(
        reviewContext(materialized.repoPath, materialized.diffPath, materialized.diffText,
          materialized.baseRef, materialized.headRef),
        "invariant-first-pr-review",
        materialized.historyProvenance,
      );
      assert.equal(
        prepared.provenance.profileSource,
        scenario === "head-only" ? "ignored; absent at merge base" :
          scenario === "deleted" ? "merge-base snapshot" : "none",
      );
      assert.equal(prepared.provenance.headProfileChanged, scenario !== "absent");
      if (scenario === "head-only") {
        assert.doesNotMatch(runtimeSection(prepared.manifest.output ?? ""), /src\/head-policy\.txt/);
      }
      if (scenario === "deleted") {
        assert.match(runtimeSection(prepared.manifest.output ?? ""), /src\/policy\.txt/);
      }
    } finally {
      materialized.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("manifest preflight rejects unavailable, empty, and mismatched production output", async () => {
  const history = fakeHistory();
  const ctx = reviewContext("/tmp/repo", "/tmp/review.patch", "", history.baseRef, history.headRef);
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: false,
      reason: "forced unavailable",
    })),
    /production review manifest unavailable/,
  );
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: true,
      output: "",
    })),
    /production review manifest unavailable/,
  );
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: true,
      output: `base: ${history.headRef} (argument)\nhead: ${history.headRef}\nmerge-base: ${history.mergeBase}\n`,
    })),
    /base provenance does not match/,
  );
  const valid = validManifestText(history);
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: true,
      output: `${valid}base: ${history.baseRef} (argument)\n`,
    })),
    /duplicate|base provenance does not match/,
  );
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: true,
      profilePath: "/tmp/repo/.peregrine/profile.md",
      output: `${valid}profile: /tmp/repo/.peregrine/profile.md (trusted external path)\n`,
    })),
    /unknown profile provenance/,
  );
  const warning = "warning: head changes to the repository profile or custom lanes are ignored; review them as untrusted code or rerun with --trust-working-tree-profile after explicit approval";
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: true,
      output: `${valid}${warning}\n`,
    })),
    /profile change without a selected profile/,
  );
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: true,
      profilePath: "/tmp/repo/.peregrine/profile.md",
      output: `${valid}profile: /tmp/repo/.peregrine/profile.md (ignored; absent at merge base)\n`,
    })),
    /omitted required ignored-profile change provenance/,
  );
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: true,
      output: `${valid}api_key=sk-proj-1234567890abcdefghijklmnop\n`,
    })),
    /secret pattern|credential-like assignment/,
  );
  await assert.rejects(
    () => prepareEvaluationManifest(ctx, "invariant-first-pr-review", history, async () => ({
      available: true,
      output: valid.padEnd(MAX_MANIFEST_CHARS + 1, "x"),
    })),
    /exceeds 64000 characters/,
  );
  const boundary = valid.padEnd(MAX_MANIFEST_CHARS, "x");
  const accepted = await prepareEvaluationManifest(
    ctx,
    "invariant-first-pr-review",
    history,
    async () => ({ available: true, output: boundary }),
  );
  assert.equal(accepted.provenance.output.length, MAX_MANIFEST_CHARS);
  await assert.rejects(
    () => prepareEvaluationManifest(
      ctx,
      "invariant-first-pr-review",
      history,
      async () => ({ available: true, output: valid }),
      () => { throw new Error("forced manifest leakage"); },
    ),
    /forced manifest leakage/,
  );
});

test("materialization fails closed when checked-in diff bytes are not canonical", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-history-diff-mismatch-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  initRepo(source);
  writeFileSync(join(source, "src", "value.ts"), "export const value = 1;\n");
  commitAll(source, "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src", "value.ts"), "export const value = 2;\n");
  commitAll(source, "head");
  const head = git(source, "rev-parse", "HEAD");
  const caseDir = createFixtureFromHead(
    root,
    source,
    "case-d1ff0001",
    "development",
    `${canonicalDiff(source, base, head)}\n`,
  );
  const spec = loadCaseSpec(caseDir);
  try {
    await assert.rejects(
      () => materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec), {
        prepareProviderAssets: false,
      }),
      /does not exactly match.*identity-v1/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("matrix records history and manifest provenance before engine success or failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-matrix-provenance-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  initRepo(source);
  writeFileSync(join(source, "src", "value.ts"), "export const value = 1;\n");
  commitAll(source, "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src", "value.ts"), "export const value = 2;\n");
  commitAll(source, "head");
  const head = git(source, "rev-parse", "HEAD");
  const casesDir = join(root, "cases");
  createFixtureFromHead(root, source, "case-1234abcd", "development", canonicalDiff(source, base, head), casesDir);
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 2,
    corpora: ["development"],
    configs: [{ name: "mock", runner: "mock" }],
  }));
  let calls = 0;
  const producedManifests: string[] = [];
  const engine: Engine = {
    name: "mock",
    async review(ctx): Promise<EngineResult> {
      calls++;
      if (calls === 2) throw new Error("forced post-preflight failure");
      return completed(ctx);
    },
  };
  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      allowLegacyTestConfig: true,
      casesDir,
      engineFor: () => engine,
      manifestPreparer: async (...args) => {
        const produced = await prepareReviewManifest(...args);
        if (produced.output) producedManifests.push(produced.output);
        return produced;
      },
    });
    const manifest = parseMatrixRunManifest(
      JSON.parse(readFileSync(join(runsDir, "matrix-manifest.json"), "utf8")),
    );
    const records = manifest.expectedAttempts.map((attempt) => parseRunRecord(
      JSON.parse(readFileSync(join(runsDir, attempt.file), "utf8")),
      attempt.file,
      attempt,
    ));
    assert.equal(records.length, 2);
    for (const [index, record] of records.entries()) {
      assert.ok(record.evaluationProvenance?.manifest);
      const provenance = record.evaluationProvenance;
      const persistedManifest = provenance.manifest!;
      assert.equal(provenance.history.checkedOutTreeMatchesHead, true);
      assert.equal(persistedManifest.entryPoint, "prepareReviewManifest");
      assert.equal(persistedManifest.baseRef, provenance.history.baseRef);
      assert.match(provenance.history.diffSha256, /^[a-f0-9]{64}$/);
      assert.equal(
        createHash("sha256").update(persistedManifest.output).digest("hex"),
        persistedManifest.outputSha256,
      );
      assert.equal(persistedManifest.output, producedManifests[index]);
    }
    assert.equal(records[0]!.outcome.status, "completed");
    assert.equal(records[1]!.outcome.status, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("matrix records a configuration failure and never invokes the engine when manifest is unavailable", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-matrix-manifest-fail-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  initRepo(source);
  writeFileSync(join(source, "src", "value.ts"), "export const value = 1;\n");
  commitAll(source, "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src", "value.ts"), "export const value = 2;\n");
  commitAll(source, "head");
  const head = git(source, "rev-parse", "HEAD");
  const casesDir = join(root, "cases");
  createFixtureFromHead(root, source, "case-dead1234", "development", canonicalDiff(source, base, head), casesDir);
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 1,
    corpora: ["development"],
    configs: [{ name: "mock", runner: "mock" }],
  }));
  let calls = 0;
  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      allowLegacyTestConfig: true,
      casesDir,
      engineFor: () => ({ name: "mock", async review() { calls++; return completed(); } }),
      manifestPreparer: async () => ({ available: false, reason: "forced unavailable" }),
    });
    const record = JSON.parse(readFileSync(join(runsDir, "attempt-000001.json"), "utf8"));
    assert.equal(calls, 0);
    assert.equal(record.outcome.status, "failed");
    assert.equal(record.outcome.failureKind, "configuration");
    assert.match(record.outcome.message, /manifest preflight failed/);
    assert.equal(record.evaluationProvenance.history.checkedOutTreeMatchesHead, true);
    assert.equal(record.evaluationProvenance.manifest, undefined);

    const secretValue = "sk-proj-1234567890abcdefghijklmnop";
    const secretRunsDir = await runMatrix(matrixPath, join(root, "secret-runs"), {
      allowLegacyTestConfig: true,
      casesDir,
      engineFor: () => ({ name: "mock", async review() { calls++; return completed(); } }),
      manifestPreparer: async (ctx) => ({
        available: true,
        output: [
          `base: ${ctx.baseRef} (argument)`,
          `head: ${ctx.headRef}`,
          `merge-base: ${ctx.baseRef}`,
          "Changed files",
          `secret-token=${secretValue}`,
          "",
        ].join("\n"),
      }),
    });
    const secretRecordText = readFileSync(join(secretRunsDir, "attempt-000001.json"), "utf8");
    const secretRecord = JSON.parse(secretRecordText);
    assert.equal(calls, 0);
    assert.equal(secretRecord.outcome.status, "failed");
    assert.equal(secretRecord.outcome.failureKind, "configuration");
    assert.doesNotMatch(secretRecordText, new RegExp(secretValue));
    assert.equal(secretRecord.evaluationProvenance.manifest, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("historical export rejects unchanged gitlinks omitted by a physical checkout", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-history-gitlink-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  initRepo(source);
  writeFileSync(join(source, "src", "value.ts"), "export const value = 1;\n");
  git(source, "add", "--all");
  const fakeCommit = git(
    source,
    "commit-tree",
    "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    "-m",
    "submodule",
  );
  git(source, "update-index", "--add", "--cacheinfo", "160000", fakeCommit, "vendor/dependency");
  git(source, "commit", "-q", "-m", "base with gitlink");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src", "value.ts"), "export const value = 2;\n");
  commitAll(source, "head");
  const head = git(source, "rev-parse", "HEAD");
  const caseDir = join(root, "cases", "development", "case-160000ff");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, "diff.patch"), canonicalDiff(source, base, head));
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ bugs: [] }));
  writeFileSync(join(caseDir, "case.json"), JSON.stringify({
    id: "case-160000ff",
    corpus: "development",
    kind: "historical",
    repoSource: source,
    baseCommit: base,
    headCommit: head,
    diffFile: "diff.patch",
  }));
  const spec = loadCaseSpec(caseDir);
  try {
    await assert.rejects(
      () => materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec), {
        prepareProviderAssets: false,
      }),
      /historical base tree could not be reproduced exactly/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("historical specs reject object IDs that are neither SHA-1 nor SHA-256 length", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-history-invalid-oid-"));
  const caseDir = join(root, "case-c0ffee41");
  mkdirSync(caseDir);
  writeFileSync(join(caseDir, "diff.patch"), "");
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ bugs: [] }));
  writeFileSync(join(caseDir, "case.json"), JSON.stringify({
    id: "case-c0ffee41",
    corpus: "development",
    kind: "historical",
    repoSource: root,
    baseCommit: "a".repeat(41),
    headCommit: "b".repeat(40),
    diffFile: "diff.patch",
  }));
  const spec = loadCaseSpec(caseDir);
  try {
    await assert.rejects(
      () => materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec), {
        prepareProviderAssets: false,
      }),
      /must be full hexadecimal object IDs/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("historical materialization preserves CRLF patch bytes and source trees exactly", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-history-crlf-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  initRepo(source);
  writeFileSync(join(source, "src", "value.txt"), "first\r\nshared\r\n");
  commitAll(source, "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src", "value.txt"), "second\r\nshared\r\n");
  commitAll(source, "head");
  const head = git(source, "rev-parse", "HEAD");
  const diff = canonicalDiff(source, base, head);
  assert.match(diff, /-first\r\n\+second\r\n/);
  const caseDir = createHistoricalCase(
    root,
    source,
    "case-c12fc12f",
    "development",
    diff,
    base,
    head,
  );
  const spec = loadCaseSpec(caseDir);
  const materialized = await materializeCase(
    caseDir,
    spec,
    leakagePolicyForCase(caseDir, spec),
    { prepareProviderAssets: false },
  );
  try {
    assert.equal(materialized.diffText, diff);
    assert.match(materialized.diffText, /-first\r\n\+second\r\n/);
    assert.equal(
      materialized.historyProvenance.historicalSource?.sourceBaseTree,
      materialized.historyProvenance.baseTree,
    );
    assert.equal(
      materialized.historyProvenance.historicalSource?.sourceHeadTree,
      materialized.historyProvenance.headTree,
    );
  } finally {
    materialized.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("historical materialization retains a supported SHA-256 object format", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-history-sha256-"));
  const source = join(root, "source");
  mkdirSync(source);
  const initialized = spawnSync(
    "git",
    ["init", "-q", "-b", "main", "--object-format=sha256"],
    { cwd: source, encoding: "utf8" },
  );
  if (initialized.status !== 0) {
    rmSync(root, { recursive: true, force: true });
    context.skip("installed Git does not support SHA-256 repositories");
    return;
  }
  git(source, "config", "user.name", "Curator");
  git(source, "config", "user.email", "curator@example.invalid");
  writeFileSync(join(source, "value.txt"), "one\n");
  commitAll(source, "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "value.txt"), "two\n");
  commitAll(source, "head");
  const head = git(source, "rev-parse", "HEAD");
  const caseDir = createHistoricalCase(
    root,
    source,
    "case-2560abcd",
    "development",
    canonicalDiff(source, base, head),
    base,
    head,
  );
  const spec = loadCaseSpec(caseDir);
  const materialized = await materializeCase(
    caseDir,
    spec,
    leakagePolicyForCase(caseDir, spec),
    { prepareProviderAssets: false },
  );
  try {
    assert.equal(base.length, 64);
    assert.equal(materialized.historyProvenance.objectFormat, "sha256");
    assert.equal(materialized.baseRef.length, 64);
    assert.equal(materialized.historyProvenance.historicalSource?.sourceBaseRef, base);
    assert.equal(materialized.historyProvenance.historicalSource?.sourceHeadRef, head);
  } finally {
    materialized.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("quoted Unicode paths remain exact and escaped traversal patches fail closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-history-paths-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  initRepo(source);
  const quotedPath = "src/café file.ts";
  writeFileSync(join(source, quotedPath), "export const value = 1;\n");
  commitAll(source, "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, quotedPath), "export const value = 2;\n");
  commitAll(source, "head");
  const head = git(source, "rev-parse", "HEAD");
  const diff = canonicalDiff(source, base, head);
  assert.match(diff, /"a\/src\/caf\\303\\251 file\.ts"/);
  const caseDir = createHistoricalCase(
    root,
    source,
    "case-51afe123",
    "development",
    diff,
    base,
    head,
  );
  const spec = loadCaseSpec(caseDir);
  const materialized = await materializeCase(
    caseDir,
    spec,
    leakagePolicyForCase(caseDir, spec),
    { prepareProviderAssets: false },
  );
  try {
    assert.equal(materialized.diffText, diff);
    const prepared = await prepareEvaluationManifest(
      reviewContext(materialized.repoPath, materialized.diffPath, materialized.diffText,
        materialized.baseRef, materialized.headRef),
      "invariant-first-pr-review",
      materialized.historyProvenance,
    );
    assert.match(prepared.manifest.output ?? "", /caf\\303\\251 file\.ts/);
  } finally {
    materialized.cleanup();
  }

  const fixtureCase = createFixtureFromHead(
    root,
    source,
    "case-bad0cafe",
    "development",
    [
      'diff --git "a/\\056\\056/outside.txt" "b/\\056\\056/outside.txt"',
      "new file mode 100644",
      "index 0000000000000000000000000000000000000000..257cc5642cb1a054f08cc83f2d943e56fd3ebe99",
      "--- /dev/null",
      '+++ "b/\\056\\056/outside.txt"',
      "@@ -0,0 +1 @@",
      "+outside",
      "",
    ].join("\n"),
  );
  const unsafeSpec = loadCaseSpec(fixtureCase);
  try {
    await assert.rejects(
      () => materializeCase(
        fixtureCase,
        unsafeSpec,
        leakagePolicyForCase(fixtureCase, unsafeSpec),
        { prepareProviderAssets: false },
      ),
      /unsafe path|git apply failed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createHistoricalCase(
  root: string,
  source: string,
  id: string,
  corpus: CaseCorpus,
  diff: string,
  baseCommit: string,
  headCommit: string,
): string {
  const caseDir = join(root, "cases", corpus, id);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, "diff.patch"), diff);
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ bugs: [] }));
  writeFileSync(join(caseDir, "case.json"), JSON.stringify({
    id,
    corpus,
    kind: "historical",
    repoSource: source,
    baseCommit,
    headCommit,
    diffFile: "diff.patch",
  }));
  return caseDir;
}

function createFixtureFromHead(
  root: string,
  source: string,
  id: string,
  corpus: CaseCorpus,
  diff: string,
  casesDir = join(root, "cases"),
): string {
  const caseDir = join(casesDir, corpus, id);
  const fixture = join(caseDir, "fixture");
  mkdirSync(fixture, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    cpSync(join(source, entry.name), join(fixture, entry.name), { recursive: true });
  }
  writeFileSync(join(caseDir, "diff.patch"), diff);
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ bugs: [] }));
  writeFileSync(join(caseDir, "case.json"), JSON.stringify({
    id,
    corpus,
    kind: "clean",
    fixtureDir: "fixture",
    diffFile: "diff.patch",
  }));
  return caseDir;
}

function initRepo(repo: string): void {
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Curator");
  git(repo, "config", "user.email", "curator@example.invalid");
}

function commitAll(repo: string, message: string): void {
  git(repo, "add", "--all");
  git(repo, "commit", "-q", "--allow-empty", "-m", message);
}

function canonicalDiff(repo: string, base: string, head: string): string {
  return execFileSync(
    "git",
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-color",
      "--find-renames",
      `${base}...${head}`,
    ],
    { cwd: repo, encoding: "utf8" },
  );
}

function reviewContext(
  repoPath: string,
  diffPath: string,
  diffText: string,
  baseRef: string,
  headRef: string,
): ReviewContext {
  return { repoPath, diffPath, diffText, baseRef, headRef, config: config() };
}

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

function fakeHistory(): EvaluationHistoryProvenance {
  const baseRef = "1".repeat(40);
  const headRef = "2".repeat(40);
  return {
    schemaVersion: 1,
    materialization: "fixture-patch",
    objectFormat: "sha1",
    baseRef,
    headRef,
    mergeBase: baseRef,
    baseTree: "3".repeat(40),
    headTree: "4".repeat(40),
    commitCount: 2,
    baseIsMergeBase: true,
    checkedOutTreeMatchesHead: true,
    treeReproductionVerified: true,
    diffNormalization: EVALUATION_DIFF_NORMALIZATION,
    diffSha256: "5".repeat(64),
  };
}

function validManifestText(history: EvaluationHistoryProvenance): string {
  return [
    `base: ${history.baseRef} (argument)`,
    `head: ${history.headRef}`,
    `merge-base: ${history.mergeBase}`,
    "Changed files",
    "(none)",
    "",
  ].join("\n");
}

function customLane(label: string, pathPattern: string, contentPattern: string): string {
  return [
    `# ${label}`,
    `<!-- manifest path-pattern: ${pathPattern} -->`,
    `<!-- manifest content-pattern: ${contentPattern} -->`,
    "**Lane summary:** Project policy changes preserve the configured invariant.",
    "",
  ].join("\n");
}

function laneSection(output: string, laneId: string): string {
  const start = output.indexOf(`[lane: ${laneId}]`);
  if (start === -1) return "";
  const next = output.indexOf("\n\n", start);
  return output.slice(start, next === -1 ? undefined : next);
}

function runtimeSection(output: string): string {
  return output.match(/Runtime configuration, containers, and harnesses[\s\S]*?Response, error, transport, and observability contracts/)?.[0] ?? "";
}

function completed(ctx?: ReviewContext): EngineResult {
  return {
    engine: "mock",
    status: "clean",
    modelConfig: "mock",
    findings: [],
    usage: mockUsage(),
    durationMs: 1,
    ...(ctx ? { reviewedBaseRef: ctx.baseRef, reviewedHeadRef: ctx.headRef } : {}),
  };
}

function git(
  repo: string,
  ...args: Array<string | { input: string }>
): string {
  const options = typeof args.at(-1) === "object" ? args.pop() as { input: string } : undefined;
  const result = execFileSync("git", args as string[], {
    cwd: repo,
    encoding: "utf8",
    ...(options ? { input: options.input } : {}),
  });
  return result.trim();
}
