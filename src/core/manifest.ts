import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { bundledSkillDir } from "./paths.js";
import type { ReviewContext } from "../types.js";
import { exec } from "../util/exec.js";
import { nonSensitiveEnvironment } from "../security/provider-env.js";

export const MAX_MANIFEST_CHARS = 64_000;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface ReviewManifest {
  available: boolean;
  output?: string;
  reason?: string;
  profilePath?: string;
}

/** Run deterministic lane routing before either model stage. */
export async function prepareReviewManifest(ctx: ReviewContext, skillName: string): Promise<ReviewManifest> {
  if (!ctx.baseRef || !ctx.headRef) {
    return { available: false, reason: "base/head refs were not supplied" };
  }
  const script = `${bundledSkillDir(skillName)}/scripts/review-manifest.sh`;
  const profilePath = await resolveProfilePath(ctx);
  const manifestArgs = [script, ctx.baseRef, ctx.headRef];
  if (profilePath) manifestArgs.push(profilePath);
  const result = await exec("bash", manifestArgs, {
    cwd: ctx.repoPath,
    timeoutMs: 30_000,
    env: nonSensitiveEnvironment(),
    inheritEnv: false,
  });
  if (result.timedOut) return { available: false, reason: "manifest timed out after 30000ms" };
  if (result.code !== 0) {
    if (ctx.profilePath) {
      throw new Error(`explicit review profile could not be loaded (manifest exit ${result.code})`);
    }
    return { available: false, reason: `manifest command failed with exit ${result.code}` };
  }
  if (result.stdout.length > MAX_MANIFEST_CHARS) {
    throw new Error(`review manifest exceeds ${MAX_MANIFEST_CHARS} characters; refusing silent truncation`);
  }
  return { available: true, output: result.stdout, profilePath };
}

async function resolveProfilePath(ctx: ReviewContext): Promise<string | undefined> {
  const lexicalRepoRoot = resolve(ctx.repoPath);
  const physicalRepoRoot = realpathSync(ctx.repoPath);
  if (ctx.profilePath) {
    const requested = resolve(ctx.repoPath, ctx.profilePath);
    const lexicalRelative = relative(lexicalRepoRoot, requested);
    const physicalRelative = relative(physicalRepoRoot, requested);
    const repoRelative = isRepoRelativePath(lexicalRelative)
      ? lexicalRelative
      : isRepoRelativePath(physicalRelative)
        ? physicalRelative
        : undefined;
    if (repoRelative !== undefined) {
      assertRepoProfilePathHasNoSymlinks(physicalRepoRoot, repoRelative);
      return join(physicalRepoRoot, repoRelative);
    }
    // Canonicalize the containing directory, but never follow the final
    // external profile symlink. Explicit external paths are trusted by caller
    // choice, but repository-local paths above never gain that classification.
    return existsSync(dirname(requested))
      ? join(realpathSync(dirname(requested)), basename(requested))
      : requested;
  }

  const environment = nonSensitiveEnvironment();
  // Use the physical checkout root even when TMPDIR or the caller used a
  // symlinked path. A deleted head profile has no file to realpath directly,
  // but the manifest script still needs this exact repo-local identity to load
  // the trusted merge-base snapshot.
  assertRepoProfilePathHasNoSymlinks(physicalRepoRoot, ".peregrine/profile.md");
  const repositoryProfile = join(physicalRepoRoot, ".peregrine", "profile.md");
  if (existsSync(repositoryProfile)) return repositoryProfile;

  const mergeBase = await exec("git", ["merge-base", ctx.baseRef!, ctx.headRef!], {
    cwd: ctx.repoPath,
    timeoutMs: 5_000,
    env: environment,
    inheritEnv: false,
  });
  if (GIT_OBJECT_ID.test(mergeBase.stdout.trim())) {
    const baseProfile = await exec(
      "git",
      ["cat-file", "-e", `${mergeBase.stdout.trim()}:.peregrine/profile.md`],
      { cwd: ctx.repoPath, timeoutMs: 5_000, env: environment, inheritEnv: false },
    );
    if (baseProfile.code === 0) return repositoryProfile;
  }

  const remote = await exec("git", ["config", "--get", "remote.origin.url"], {
    cwd: ctx.repoPath,
    timeoutMs: 5_000,
    env: environment,
    inheritEnv: false,
  });
  const repositoryKeySource = remote.code === 0 && remote.stdout.trim()
    ? remote.stdout.trim()
    : resolve(ctx.repoPath);
  const hash = await exec("git", ["hash-object", "--stdin"], {
    cwd: ctx.repoPath,
    timeoutMs: 5_000,
    stdin: repositoryKeySource,
    env: environment,
    inheritEnv: false,
  });
  if (hash.code !== 0 || !GIT_OBJECT_ID.test(hash.stdout.trim())) return undefined;
  const profilesRoot = process.env.PEREGRINE_HOME
    ? resolve(process.env.PEREGRINE_HOME, "profiles")
    : join(homedir(), ".peregrine", "profiles");
  const externalProfile = join(profilesRoot, hash.stdout.trim(), "profile.md");
  return existsSync(externalProfile) ? externalProfile : undefined;
}

function isRepoRelativePath(path: string): boolean {
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function assertRepoProfilePathHasNoSymlinks(repoRoot: string, repoRelative: string): void {
  let current = repoRoot;
  for (const component of repoRelative.split(/[\\/]/).filter(Boolean)) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error("repository-local review profile path must not contain symbolic links");
      }
    } catch (error) {
      if (error instanceof Error && /must not contain symbolic links/.test(error.message)) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }
  }
}
