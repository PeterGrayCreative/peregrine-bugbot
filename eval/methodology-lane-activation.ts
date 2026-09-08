import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCoreLaneId, type CoreLaneId } from "../src/core/lanes.js";
import { parseTypedReviewManifest } from "../src/core/manifest.js";
import { bundledSkillDir } from "../src/core/paths.js";
import { assertNoSecrets } from "../src/security/secrets.js";
import type { ReviewContext } from "../src/types.js";
import { exec } from "../src/util/exec.js";
import { canonicalJson, canonicalJsonSha256, hashPathTree } from "./experiment.js";
import { parseMethodologyRawScope, type MethodologyRawScope } from "./methodology-prompts.js";
import { assertMethodologyMaterializedScope } from "./methodology-runner.js";

export interface MethodologyLaneActivation {
  schemaVersion: 1;
  protocol: "methodology-code-only-lanes-v1";
  rawScopeSha256: string;
  routingSourceSha256: string;
  manifestSha256: string;
  activatedLanes: CoreLaneId[];
  profilePolicy: "no-profile-or-custom-lanes";
  activationSha256: string;
}

/**
 * Experimental B/D routing only. No curator case/truth/label input is accepted.
 * The trusted existing manifest script inspects the sanitized comparison, with
 * no profile argument or production profile auto-discovery. Generic arms must
 * never receive this result. Consumers must freeze its digest in registration.
 */
export async function prepareMethodologyLaneActivation(input: {
  armId: "B" | "D";
  context: ReviewContext;
  rawScope: MethodologyRawScope;
}): Promise<MethodologyLaneActivation> {
  if (input.armId !== "B" && input.armId !== "D") throw new Error("generic methodology arms cannot receive lane activation");
  if (Object.keys(input).some((key) => !["armId", "context", "rawScope"].includes(key))) {
    throw new Error("methodology lane activation contains unsupported inputs");
  }
  const scope = parseMethodologyRawScope(input.rawScope);
  if (input.context.profilePath) throw new Error("experimental lane activation does not accept a repository profile");
  await assertMethodologyMaterializedScope(input.context, scope);
  const skill = bundledSkillDir("invariant-first-pr-review");
  const routingSourceSha256 = routingHash(skill);
  const scratch = mkdtempSync(join(tmpdir(), "peregrine-methodology-lanes-"));
  try {
    const output = join(scratch, "manifest.json");
    // Allowlist rather than forwarding BASH_ENV, NODE_OPTIONS, ambient GIT_*,
    // credentials, loader hooks, or the user's global Git configuration.
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: scratch,
      TMPDIR: scratch,
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "protocol.allow",
      GIT_CONFIG_VALUE_0: "never",
    };
    const result = await exec("bash", [join(skill, "scripts/review-manifest.sh"), "--json-output", output,
      scope.baseRef, scope.headRef], { cwd: input.context.repoPath, env, inheritEnv: false, timeoutMs: 30_000 });
    if (result.code !== 0 || result.timedOut) throw new Error("code-only methodology lane manifest failed");
    if (routingSourceSha256 !== routingHash(skill)) throw new Error("trusted routing sources changed during activation");
    const manifest = parseTypedReviewManifest(readFileSync(output, "utf8"));
    if (manifest.base.commit !== scope.baseRef || manifest.head.commit !== scope.headRef ||
        manifest.mergeBase !== scope.baseRef || manifest.profile.source !== "none" ||
        manifest.profile.requestedPath !== null || manifest.profile.changedAtHead || manifest.customLanes.length ||
        manifest.changedFiles.some((file) => file.activatedLanes.some((lane) => lane.reason === "profile-extension")) ||
        canonicalJson(manifest.changedFiles.map((file) => file.path).sort()) !== canonicalJson(scope.rawChangedPaths)) {
      throw new Error("code-only methodology manifest differs from its registered scope/profile boundary");
    }
    if (!manifest.activatedLanes.every(isCoreLaneId)) throw new Error("code-only methodology manifest contains unknown lanes");
    const body = { schemaVersion: 1 as const, protocol: "methodology-code-only-lanes-v1" as const,
      rawScopeSha256: canonicalJsonSha256(scope), routingSourceSha256,
      manifestSha256: canonicalJsonSha256(manifest), activatedLanes: [...manifest.activatedLanes] as CoreLaneId[],
      profilePolicy: "no-profile-or-custom-lanes" as const };
    assertNoSecrets(body, "methodology lane activation");
    // Confirm the source checkout did not drift while the script read it.
    await assertMethodologyMaterializedScope(input.context, scope);
    return { ...body, activationSha256: canonicalJsonSha256(body) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function routingHash(skill: string): string {
  return canonicalJsonSha256({ scripts: hashPathTree(join(skill, "scripts")),
    coreLaneSources: hashPathTree(join(skill, "references/lanes")) });
}
