import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { materializeDevelopmentEndpoints, type DevelopmentEndpointInput } from "../eval/development-benchmark-materializer.js";

function run(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" } }).trim();
}

function fixture(options: { escaping?: boolean; chainedEscape?: boolean; mixedCaseEscape?: boolean } = {}): { root: string; input: DevelopmentEndpointInput; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "peregrine-endpoints-test-"));
  const source = join(root, "source");
  mkdirSync(source);
  run(source, "init", "--quiet");
  run(source, "config", "user.name", "Fixture");
  run(source, "config", "user.email", "fixture@example.invalid");
  mkdirSync(join(source, "lib"));
  writeFileSync(join(source, "lib", "target.txt"), "base\n");
  writeFileSync(join(source, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(source, "ignored.txt"), "tracked despite ignore\n");
  writeFileSync(join(source, "run.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  symlinkSync(options.escaping ? "../../outside" : "lib/target.txt", join(source, "link"));
  symlinkSync("../run.sh", join(source, "lib", "up"));
  if (options.chainedEscape || options.mixedCaseEscape) {
    symlinkSync(".", join(source, "a"));
    symlinkSync(options.mixedCaseEscape ? "A/../secret" : "a/../secret", join(source, "b"));
  }
  run(source, "add", ".");
  run(source, "add", "--force", "ignored.txt");
  run(source, "commit", "--quiet", "-m", "base");
  const baseCommit = run(source, "rev-parse", "HEAD");
  const baseTree = run(source, "rev-parse", "HEAD^{tree}");
  writeFileSync(join(source, "lib", "target.txt"), "head\n");
  run(source, "add", ".");
  run(source, "commit", "--quiet", "-m", "head");
  const headCommit = run(source, "rev-parse", "HEAD");
  const headTree = run(source, "rev-parse", "HEAD^{tree}");
  const diff = execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--full-index", baseCommit, headCommit], { cwd: source });
  const retainedDiffPath = join(root, "retained.diff");
  writeFileSync(retainedDiffPath, diff);
  const sourceBareStore = join(root, "source.git");
  run(root, "clone", "--quiet", "--bare", source, sourceBareStore);
  return {
    root,
    input: { sourceBareStore, baseCommit, baseTree, headCommit, headTree, retainedDiffPath, retainedDiffSha256: createHash("sha256").update(diff).digest("hex"), outputDirectory: join(root, "output") },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("materializes exact trees and byte-bound diff into neutral clean review history", () => {
  const f = fixture();
  try {
    const result = materializeDevelopmentEndpoints(f.input);
    assert.equal(result.sourceAncestry, "unestablished");
    assert.equal(result.sourceBaseCommit, f.input.baseCommit);
    assert.equal(result.sourceHeadCommit, f.input.headCommit);
    assert.equal(run(result.repository, "rev-parse", `${result.baseCommit}^{tree}`), f.input.baseTree);
    assert.equal(run(result.repository, "rev-parse", `${result.headCommit}^{tree}`), f.input.headTree);
    assert.equal(run(result.repository, "status", "--porcelain"), "");
    assert.equal(run(result.repository, "remote"), "");
    assert.equal(run(result.repository, "for-each-ref", "--format=%(refname)"), "refs/heads/review");
    assert.equal(readFileSync(join(result.repository, "lib", "target.txt"), "utf8"), "head\n");
    assert.equal(readFileSync(join(result.repository, "ignored.txt"), "utf8"), "tracked despite ignore\n");
  } finally { f.cleanup(); }
});

test("rejects escaping symlink", () => {
  const f = fixture({ escaping: true });
  try { assert.throws(() => materializeDevelopmentEndpoints(f.input), /escaping symlink/); }
  finally { f.cleanup(); }
});

test("rejects escape through a symlink before a later parent component", () => {
  const f = fixture({ chainedEscape: true });
  try { assert.throws(() => materializeDevelopmentEndpoints(f.input), /unsafe symlink parent traversal/); }
  finally { f.cleanup(); }
});

test("rejects mixed-case link alias before a later parent component", () => {
  const f = fixture({ mixedCaseEscape: true });
  try { assert.throws(() => materializeDevelopmentEndpoints(f.input), /unsafe symlink parent traversal/); }
  finally { f.cleanup(); }
});

test("rejects missing or wrong retained diff", () => {
  const f = fixture();
  try {
    assert.throws(() => materializeDevelopmentEndpoints({ ...f.input, retainedDiffPath: join(f.root, "missing.diff") }));
    writeFileSync(f.input.retainedDiffPath, "wrong\n");
    assert.throws(() => materializeDevelopmentEndpoints(f.input), /SHA-256 mismatch/);
    const wrong = createHash("sha256").update("wrong\n").digest("hex");
    assert.throws(() => materializeDevelopmentEndpoints({ ...f.input, retainedDiffSha256: wrong }), /diff bytes differ/);
  } finally { f.cleanup(); }
});

test("rejects incorrect endpoint tree binding", () => {
  const f = fixture();
  try { assert.throws(() => materializeDevelopmentEndpoints({ ...f.input, headTree: f.input.baseTree }), /commit\/tree mismatch/); }
  finally { f.cleanup(); }
});
