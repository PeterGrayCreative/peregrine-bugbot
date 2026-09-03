import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseTypedReviewManifest, prepareReviewManifest } from "../src/core/manifest.js";
import type { PeregrineConfig, ReviewContext } from "../src/types.js";

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function validateAgainstSchema(value: unknown, schema: any, root = schema, path = "$",): void {
  if (schema.$ref) {
    const target = schema.$ref.split("/").slice(1).reduce((current: any, key: string) => current[key.replaceAll("~1", "/").replaceAll("~0", "~")], root);
    return validateAgainstSchema(value, target, root, path);
  }
  if (schema.const !== undefined) assert.deepEqual(value, schema.const, `${path} const`);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path} enum`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    assert.ok(types.includes(actual), `${path} type ${actual}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, `${path} minLength`);
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), `${path} pattern`);
  }
  if (typeof value === "number" && schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${path} minimum`);
  if (Array.isArray(value)) {
    if (schema.uniqueItems) assert.equal(new Set(value.map((item) => JSON.stringify(item))).size, value.length, `${path} uniqueItems`);
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(item, schema.items, root, `${path}[${index}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) assert.ok(key in record, `${path}.${key} required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) assert.ok(key in (schema.properties ?? {}), `${path}.${key} allowed`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in record) validateAgainstSchema(record[key], child, root, `${path}.${key}`);
  }
}

test("runner-owned manifest discovery uses the merge-base repository profile", async () => {
  const repo = mkdtempSync(join(tmpdir(), "peregrine-manifest-runner-"));
  try {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Peregrine Tests");
    git(repo, "config", "user.email", "peregrine-tests@example.invalid");
    mkdirSync(join(repo, ".peregrine"), { recursive: true });
    writeFileSync(
      join(repo, ".peregrine", "profile.md"),
      [
        "<!-- peregrine-profile-version: 1 -->",
        "# Review profile: runner fixture",
        "<!-- review-base: main -->",
        "",
      ].join("\n"),
    );
    writeFileSync(join(repo, "app.ts"), "export const value = 1;\n");
    git(repo, "add", ".peregrine/profile.md", "app.ts");
    git(repo, "commit", "-q", "-m", "base");
    git(repo, "switch", "-q", "-c", "feature");
    writeFileSync(join(repo, "app.ts"), "export const value = 2;\n");
    git(repo, "add", "app.ts");
    git(repo, "commit", "-q", "-m", "feature");

    const ctx: ReviewContext = {
      repoPath: repo,
      diffPath: join(repo, "diff.patch"),
      baseRef: "main",
      headRef: "HEAD",
      config: config(),
    };
    const manifest = await prepareReviewManifest(ctx, "invariant-first-pr-review");
    assert.equal(manifest.available, true);
    assert.equal(manifest.profilePath, join(realpathSync(repo), ".peregrine", "profile.md"));
    assert.match(manifest.output ?? "", /profile: .*\.peregrine\/profile\.md \(merge-base snapshot\)/);
    assert.match(manifest.output ?? "", /app\.ts/);
    assert.equal(manifest.typed?.schemaVersion, 1);
    assert.equal(manifest.typed?.profile.source, "merge-base");
    assert.equal(manifest.typed?.profile.changedAtHead, false);
    assert.equal(manifest.typed?.changedFiles[0]?.path, "app.ts");
    assert.equal(manifest.typed?.changedFiles[0]?.status, "M");
    assert.equal(manifest.typed?.changedFiles[0]?.additions, 1);
    assert.equal(manifest.typed?.changedFiles[0]?.deletions, 1);
    assert.ok(manifest.typed?.changedFiles[0]?.activatedLanes.some((lane) => lane.id === "logic-correctness"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("JSON shadow output does not change canonical text bytes", () => {
  const repo = mkdtempSync(join(tmpdir(), "peregrine-manifest-bytes-"));
  const jsonPath = join(repo, "shadow.json");
  try {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Peregrine Tests");
    git(repo, "config", "user.email", "peregrine-tests@example.invalid");
    writeFileSync(join(repo, "app.ts"), "export const value = 1;\n");
    git(repo, "add", "."); git(repo, "commit", "-q", "-m", "base");
    git(repo, "switch", "-q", "-c", "feature");
    writeFileSync(join(repo, "app.ts"), Array.from({ length: 400 }, (_, index) => `export const value${index} = ${index};`).join("\n") + "\n");
    git(repo, "add", "."); git(repo, "commit", "-q", "-m", "head");
    const script = resolve("skills/invariant-first-pr-review/scripts/review-manifest.sh");
    const text = execFileSync("bash", [script, "main", "HEAD"], { cwd: repo });
    const shadowText = execFileSync("bash", [script, "--json-output", jsonPath, "main", "HEAD"], { cwd: repo });
    assert.deepEqual(shadowText, text);
    const typed = parseTypedReviewManifest(readFileSync(jsonPath, "utf8"));
    validateAgainstSchema(typed, JSON.parse(readFileSync(resolve("schemas/review-manifest.schema.json"), "utf8")));
    assert.equal(typed.changedFiles[0]?.path, "app.ts");
    assert.deepEqual(typed.activatedLanes, [...typed.activatedLanes].sort());
    assert.deepEqual(typed.largeFiles, [{ path: "app.ts", baseLines: 1, headLines: 400 }]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("typed large-file evidence is complete and uses a rename's base path", async () => {
  const repo = mkdtempSync(join(tmpdir(), "peregrine-manifest-large-files-"));
  try {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Peregrine Tests");
    git(repo, "config", "user.email", "peregrine-tests@example.invalid");
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `export const line${index} = ${index};`).join("\n") + "\n";
    writeFileSync(join(repo, "renamed-old.ts"), lines(420));
    writeFileSync(join(repo, "modified.ts"), lines(399));
    writeFileSync(join(repo, "deleted.ts"), lines(450));
    git(repo, "add", "."); git(repo, "commit", "-q", "-m", "base");
    git(repo, "switch", "-q", "-c", "feature");
    git(repo, "mv", "renamed-old.ts", "renamed-new.ts");
    writeFileSync(join(repo, "modified.ts"), lines(400));
    rmSync(join(repo, "deleted.ts"));
    git(repo, "add", "."); git(repo, "commit", "-q", "-m", "head");
    const manifest = await prepareReviewManifest({ repoPath: repo, diffPath: join(repo, "diff"), baseRef: "main", headRef: "HEAD", config: config() }, "invariant-first-pr-review");
    assert.equal(manifest.available, true, manifest.reason);
    assert.deepEqual(manifest.typed?.largeFiles, [
      { path: "modified.ts", baseLines: 399, headLines: 400 },
      { path: "renamed-new.ts", baseLines: 420, headLines: 420 },
    ]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("seeded mixed-surface corpus preserves text and typed parity", () => {
  const repo = mkdtempSync(join(tmpdir(), "peregrine-manifest-seeded-parity-"));
  const jsonPath = join(repo, "shadow.json");
  try {
    git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "Peregrine Tests"); git(repo, "config", "user.email", "peregrine-tests@example.invalid");
    writeFileSync(join(repo, "README.md"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-q", "-m", "base"); git(repo, "switch", "-q", "-c", "feature");
    let seed = 0x5eed1234;
    const bodies = ["export const PORT = 3000;\n", "try { run(); } catch { }\n", "const page = items.slice(offset, offset + limit);\n", "useEffect(() => save(), []);\n"];
    for (let index = 0; index < 16; index++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const path = `src/${index % 3 === 0 ? "space name" : index % 5 === 0 ? "unicodé" : "file"}-${seed.toString(16)}.${index % 4 === 0 ? "tsx" : "ts"}`;
      mkdirSync(join(repo, "src"), { recursive: true }); writeFileSync(join(repo, path), bodies[seed % bodies.length]!);
    }
    git(repo, "add", "."); git(repo, "commit", "-q", "-m", "head");
    const script = resolve("skills/invariant-first-pr-review/scripts/review-manifest.sh");
    const text = execFileSync("bash", [script, "main", "HEAD"], { cwd: repo });
    const shadowText = execFileSync("bash", [script, "--json-output", jsonPath, "main", "HEAD"], { cwd: repo });
    assert.deepEqual(shadowText, text);
    const typed = parseTypedReviewManifest(readFileSync(jsonPath, "utf8"));
    validateAgainstSchema(typed, JSON.parse(readFileSync(resolve("schemas/review-manifest.schema.json"), "utf8")));
    assert.equal(typed.changedFiles.length, 16);
    assert.ok(typed.activatedLanes.length >= 3);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("typed manifest preserves newline and tab paths without replacement decoding", async () => {
  const repo = mkdtempSync(join(tmpdir(), "peregrine-manifest-path-bytes-"));
  try {
    git(repo, "init", "-q", "-b", "main"); git(repo, "config", "user.name", "Peregrine Tests"); git(repo, "config", "user.email", "peregrine-tests@example.invalid");
    writeFileSync(join(repo, "base.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-q", "-m", "base"); git(repo, "switch", "-q", "-c", "feature");
    writeFileSync(join(repo, "line\nbreak.ts"), "export const line = 1;\n");
    writeFileSync(join(repo, "tab\tpath.ts"), "export const tab = 1;\n");
    git(repo, "add", "."); git(repo, "commit", "-q", "-m", "head");
    const manifest = await prepareReviewManifest({ repoPath: repo, diffPath: join(repo, "diff"), baseRef: "main", headRef: "HEAD", config: config() }, "invariant-first-pr-review");
    assert.equal(manifest.available, true, manifest.reason);
    assert.deepEqual(manifest.typed?.changedFiles.map((file) => file.path).sort(), ["line\nbreak.ts", "tab\tpath.ts"]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("JSON helper fails closed on invalid UTF-8 and replacement-sequence collisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "peregrine-manifest-invalid-utf8-"));
  try {
    const status = join(dir, "status.z"); const numstat = join(dir, "numstat.z");
    writeFileSync(status, Buffer.concat([Buffer.from("A\x00valid-�.ts\x00A\x00invalid-"), Buffer.from([0xff]), Buffer.from(".ts\x00")]));
    writeFileSync(numstat, Buffer.concat([Buffer.from("1\t0\tvalid-�.ts\x001\t0\tinvalid-"), Buffer.from([0xff]), Buffer.from(".ts\x00")]));
    for (const name of ["activations", "custom", "lanes", "large", "status.txt", "stat.txt"]) writeFileSync(join(dir, name), "");
    writeFileSync(join(dir, "core"), "logic-correctness\0");
    const oid = "a".repeat(40); const helper = resolve("skills/invariant-first-pr-review/scripts/review-manifest-json.mjs");
    const result = spawnSync(process.execPath, [helper, "--output", join(dir, "out.json"), "--repo", dir, "--base-ref", "main", "--base-source", "argument", "--base-commit", oid, "--head-ref", "HEAD", "--head-commit", oid, "--merge-base", oid, "--profile-requested", "", "--profile-source", "", "--profile-changed-at-head", "0", "--profile-lanes-rel", "", "--activations", join(dir, "activations"), "--core-lanes", join(dir, "core"), "--custom-lanes", join(dir, "custom"), "--status-records", status, "--status-text", join(dir, "status.txt"), "--stat-text", join(dir, "stat.txt"), "--numstat-records", numstat, "--lane-text", join(dir, "lanes"), "--large-files", join(dir, "large"), "--parity-output", join(dir, "parity.json")], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(dir, "out.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("typed manifest parser rejects unsafe paths and unknown fields", () => {
  const valid = {
    schemaVersion: 1, available: true,
    base: { ref: "main", commit: "a".repeat(40), source: "argument" },
    head: { ref: "HEAD", commit: "b".repeat(40) }, mergeBase: "a".repeat(40),
    profile: { source: "none", requestedPath: null, changedAtHead: false },
    changedFiles: [], activatedLanes: [], customLanes: [], largeFiles: [], warnings: [],
  };
  assert.doesNotThrow(() => parseTypedReviewManifest(JSON.stringify(valid)));
  assert.throws(() => parseTypedReviewManifest(JSON.stringify({ ...valid, surprise: true })), /invalid fields/);
  assert.throws(() => parseTypedReviewManifest(JSON.stringify({
    ...valid,
    changedFiles: [{ path: "../escape.ts", status: "M", additions: 1, deletions: 1, binary: false, activatedLanes: [] }],
  })), /safe repository-relative path/);
  for (const unsafePath of ["folder\\..\\escape.ts", "folder\\../escape.ts", "nul\0file.ts"]) {
    const unsafe = {
      ...valid,
      changedFiles: [{ path: unsafePath, status: "M", additions: 1, deletions: 1, binary: false, activatedLanes: [] }],
    };
    assert.throws(() => parseTypedReviewManifest(JSON.stringify(unsafe)), /safe repository-relative path/);
    assert.throws(
      () => validateAgainstSchema(unsafe, JSON.parse(readFileSync(resolve("schemas/review-manifest.schema.json"), "utf8"))),
      /pattern/,
    );
  }
  assert.throws(() => parseTypedReviewManifest(JSON.stringify({
    ...valid, profile: { source: "external", requestedPath: null, changedAtHead: false },
  })), /requires requestedPath/);
  assert.throws(() => parseTypedReviewManifest(JSON.stringify({
    ...valid, customLanes: [{ id: "project-policy", trustedSource: "git show a:path" }],
  })), /trusted profile source/);
  assert.throws(() => parseTypedReviewManifest(JSON.stringify({
    ...valid, warnings: ["contradictory warning"],
  })), /warnings do not match/);
});

test("explicit repository profiles stay merge-base-trusted through a symlinked checkout path", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-manifest-symlink-"));
  const repo = join(root, "physical-repo");
  const alias = join(root, "repo-alias");
  try {
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Peregrine Tests");
    git(repo, "config", "user.email", "peregrine-tests@example.invalid");
    mkdirSync(join(repo, ".peregrine"));
    writeFileSync(
      join(repo, ".peregrine", "profile.md"),
      [
        "<!-- peregrine-profile-version: 1 -->",
        "# Review profile: trusted base",
        "<!-- review-base: main -->",
        "",
      ].join("\n"),
    );
    writeFileSync(join(repo, "app.ts"), "export const value = 1;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "base");
    git(repo, "switch", "-q", "-c", "feature");
    const externalProfile = join(root, "untrusted-head-profile.md");
    const externalProfileDir = join(root, "untrusted-profile-dir");
    mkdirSync(externalProfileDir);
    writeFileSync(
      externalProfile,
      [
        "<!-- peregrine-profile-version: 1 -->",
        "# Review profile: untrusted head",
        "<!-- review-base: main -->",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(externalProfileDir, "profile.md"),
      [
        "<!-- peregrine-profile-version: 1 -->",
        "# Review profile: another untrusted head",
        "<!-- review-base: main -->",
        "",
      ].join("\n"),
    );
    rmSync(join(repo, ".peregrine", "profile.md"));
    symlinkSync(externalProfile, join(repo, ".peregrine", "profile.md"));
    writeFileSync(join(repo, "app.ts"), "export const value = 2;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "head");
    symlinkSync(repo, alias, "dir");
    symlinkSync(externalProfileDir, join(repo, "..profile"), "dir");

    const ctx: ReviewContext = {
      repoPath: alias,
      diffPath: join(root, "diff.patch"),
      baseRef: "main",
      headRef: "HEAD",
      profilePath: ".peregrine/profile.md",
      config: config(),
    };
    await assert.rejects(
      () => prepareReviewManifest(ctx, "invariant-first-pr-review"),
      /repository-local review profile path must not contain symbolic links/,
    );
    await assert.rejects(
      () => prepareReviewManifest({
        ...ctx,
        profilePath: join(realpathSync(repo), ".peregrine", "profile.md"),
      }, "invariant-first-pr-review"),
      /repository-local review profile path must not contain symbolic links/,
    );
    await assert.rejects(
      () => prepareReviewManifest({
        ...ctx,
        profilePath: "..profile/profile.md",
      }, "invariant-first-pr-review"),
      /repository-local review profile path must not contain symbolic links/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic profile discovery rejects a symlinked repository profile directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-manifest-profile-dir-link-"));
  const repo = join(root, "repo");
  const external = join(root, "external-profile");
  try {
    mkdirSync(repo);
    mkdirSync(external);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Peregrine Tests");
    git(repo, "config", "user.email", "peregrine-tests@example.invalid");
    writeFileSync(join(repo, "app.ts"), "export const value = 1;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "base");
    writeFileSync(
      join(external, "profile.md"),
      "<!-- peregrine-profile-version: 1 -->\n# External\n<!-- review-base: main -->\n",
    );
    symlinkSync(external, join(repo, ".peregrine"), "dir");
    writeFileSync(join(repo, "app.ts"), "export const value = 2;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "head");
    const ctx: ReviewContext = {
      repoPath: repo,
      diffPath: join(root, "diff.patch"),
      baseRef: "main",
      headRef: "HEAD",
      config: config(),
    };
    await assert.rejects(
      () => prepareReviewManifest(ctx, "invariant-first-pr-review"),
      /repository-local review profile path must not contain symbolic links/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
