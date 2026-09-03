import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { prepareReviewManifest } from "../src/core/manifest.js";
import type { PeregrineConfig, ReviewContext } from "../src/types.js";

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
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
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
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
