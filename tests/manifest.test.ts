import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.equal(manifest.profilePath, join(repo, ".peregrine", "profile.md"));
    assert.match(manifest.output ?? "", /profile: .*\.peregrine\/profile\.md \(merge-base snapshot\)/);
    assert.match(manifest.output ?? "", /app\.ts/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
