import { createHash } from "node:crypto";
import { MAX_MANIFEST_CHARS, prepareReviewManifest } from "../src/core/manifest.js";
import type { ReviewManifest } from "../src/core/manifest.js";
import type {
  EvaluationHistoryProvenance,
  EvaluationManifestProvenance,
  ReviewContext,
} from "../src/types.js";
import { assertNoSecrets } from "../src/security/secrets.js";

export type EvaluationManifestPreparer = typeof prepareReviewManifest;

const PROFILE_SOURCES = [
  "merge-base snapshot",
  "ignored; absent at merge base",
] as const;

/**
 * Evaluation preflight deliberately calls the production manifest entry point,
 * then adds fail-closed provenance checks that production reviews do not need.
 * The manifest text format remains owned by the existing shell producer until
 * the later typed-manifest shadow-mode slice.
 */
export async function prepareEvaluationManifest(
  ctx: ReviewContext,
  skillName: string,
  history: EvaluationHistoryProvenance,
  prepare: EvaluationManifestPreparer = prepareReviewManifest,
  validateOutput?: (output: string) => void,
): Promise<{ manifest: ReviewManifest; provenance: EvaluationManifestProvenance }> {
  const manifest = await prepare(ctx, skillName);
  if (!manifest.available || !manifest.output) {
    throw new Error(`production review manifest unavailable: ${manifest.reason ?? "empty output"}`);
  }
  if (manifest.output.length > MAX_MANIFEST_CHARS) {
    throw new Error(`production review manifest exceeds ${MAX_MANIFEST_CHARS} characters`);
  }
  assertNoSecrets(manifest.output, "production review manifest");
  assertNoSecrets(manifest.typed, "typed production review manifest");
  validateOutput?.(manifest.output);

  requireSingleLine(manifest.output, `base: ${history.baseRef} (argument)`, "base");
  requireSingleLine(manifest.output, `head: ${history.headRef}`, "head");
  requireSingleLine(manifest.output, `merge-base: ${history.mergeBase}`, "merge base");

  const profileLines = manifest.output
    .split("\n")
    .filter((line) => line.startsWith("profile: "));
  if (profileLines.length > 1) {
    throw new Error("production review manifest contains duplicate profile provenance");
  }
  if (manifest.profilePath && profileLines.length !== 1) {
    throw new Error("production review manifest omitted selected profile provenance");
  }
  if (!manifest.profilePath && profileLines.length !== 0) {
    throw new Error("production review manifest reported an unselected profile");
  }

  let profileSource: EvaluationManifestProvenance["profileSource"] = "none";
  if (profileLines[0]) {
    const match = profileLines[0].match(/ \(([^()]*)\)$/);
    if (!match || !PROFILE_SOURCES.includes(match[1] as (typeof PROFILE_SOURCES)[number])) {
      throw new Error("production review manifest contains unknown profile provenance");
    }
    profileSource = match[1] as (typeof PROFILE_SOURCES)[number];
  }

  const warningLine =
    "warning: head changes to the repository profile or custom lanes are ignored; review them as untrusted code or rerun with --trust-working-tree-profile after explicit approval";
  const warningCount = manifest.output.split("\n").filter((line) => line === warningLine).length;
  if (warningCount > 1) {
    throw new Error("production review manifest contains duplicate profile-change provenance");
  }
  if (profileSource === "none" && warningCount !== 0) {
    throw new Error("production review manifest reports a profile change without a selected profile");
  }
  if (profileSource === "ignored; absent at merge base" && warningCount !== 1) {
    throw new Error("production review manifest omitted required ignored-profile change provenance");
  }
  if (!manifest.typed) throw new Error("production review manifest omitted its typed shadow");
  if (manifest.typed.base.ref !== history.baseRef || manifest.typed.base.commit !== history.baseRef ||
      manifest.typed.head.ref !== history.headRef || manifest.typed.head.commit !== history.headRef ||
      manifest.typed.mergeBase !== history.mergeBase) {
    throw new Error("typed production review manifest commits do not match materialized history");
  }
  const expectedTypedProfileSource = profileSource === "merge-base snapshot" ? "merge-base" : "none";
  if (manifest.typed.profile.source !== expectedTypedProfileSource || manifest.typed.profile.changedAtHead !== (warningCount === 1)) {
    throw new Error("typed production review manifest profile provenance does not match canonical text");
  }

  return {
    manifest,
    provenance: {
      entryPoint: "prepareReviewManifest",
      skillName,
      baseRef: history.baseRef,
      headRef: history.headRef,
      mergeBase: history.mergeBase,
      outputSha256: createHash("sha256").update(manifest.output).digest("hex"),
      output: manifest.output,
      typed: manifest.typed,
      typedSha256: createHash("sha256").update(JSON.stringify(manifest.typed)).digest("hex"),
      profileSource,
      headProfileChanged: warningCount === 1,
    },
  };
}

function requireSingleLine(output: string, expected: string, label: string): void {
  const count = output.split("\n").filter((line) => line === expected).length;
  if (count !== 1) {
    throw new Error(`production review manifest ${label} provenance does not match materialized history`);
  }
}
