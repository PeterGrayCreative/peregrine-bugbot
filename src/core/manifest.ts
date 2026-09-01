import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { bundledSkillDir } from "./paths.js";
import type { ReviewContext } from "../types.js";
import { exec } from "../util/exec.js";
import { nonSensitiveEnvironment } from "../security/provider-env.js";

const MAX_MANIFEST_CHARS = 64_000;

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
  if (ctx.profilePath) return resolve(ctx.repoPath, ctx.profilePath);

  const environment = nonSensitiveEnvironment();
  const repositoryProfile = join(ctx.repoPath, ".peregrine", "profile.md");
  if (existsSync(repositoryProfile)) return repositoryProfile;

  const mergeBase = await exec("git", ["merge-base", ctx.baseRef!, ctx.headRef!], {
    cwd: ctx.repoPath,
    timeoutMs: 5_000,
    env: environment,
    inheritEnv: false,
  });
  if (/^[a-f0-9]{40,64}$/.test(mergeBase.stdout.trim())) {
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
  if (hash.code !== 0 || !/^[a-f0-9]{40,64}$/.test(hash.stdout.trim())) return undefined;
  const profilesRoot = process.env.PEREGRINE_HOME
    ? resolve(process.env.PEREGRINE_HOME, "profiles")
    : join(homedir(), ".peregrine", "profiles");
  const externalProfile = join(profilesRoot, hash.stdout.trim(), "profile.md");
  return existsSync(externalProfile) ? externalProfile : undefined;
}
