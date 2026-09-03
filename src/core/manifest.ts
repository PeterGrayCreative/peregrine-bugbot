import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { bundledSkillDir } from "./paths.js";
import type { ReviewContext, TypedReviewManifest } from "../types.js";
import { exec } from "../util/exec.js";
import { nonSensitiveEnvironment } from "../security/provider-env.js";
import { CORE_LANE_IDS } from "./lanes.js";

export const MAX_MANIFEST_CHARS = 64_000;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface ReviewManifest {
  available: boolean;
  output?: string;
  reason?: string;
  profilePath?: string;
  /** Stage-0 shadow metadata. Model prompts continue to use `output` only. */
  typed?: TypedReviewManifest;
}

/** Run deterministic lane routing before either model stage. */
export async function prepareReviewManifest(ctx: ReviewContext, skillName: string): Promise<ReviewManifest> {
  if (!ctx.baseRef || !ctx.headRef) {
    return { available: false, reason: "base/head refs were not supplied" };
  }
  const script = `${bundledSkillDir(skillName)}/scripts/review-manifest.sh`;
  const profilePath = await resolveProfilePath(ctx);
  const shadowDir = mkdtempSync(join(tmpdir(), "peregrine-manifest-shadow-"));
  const typedPath = join(shadowDir, "review-manifest.json");
  let result;
  try {
    const manifestArgs = [script, "--json-output", typedPath, ctx.baseRef, ctx.headRef];
    if (profilePath) manifestArgs.push(profilePath);
    result = await exec("bash", manifestArgs, {
      cwd: ctx.repoPath,
      timeoutMs: 30_000,
      env: nonSensitiveEnvironment(),
      inheritEnv: false,
    });
    if (result.timedOut) return { available: false, reason: "manifest timed out after 30000ms" };
    if (result.code !== 0) {
      if (ctx.profilePath) throw new Error(`explicit review profile could not be loaded (manifest exit ${result.code})`);
      return { available: false, reason: `manifest command failed with exit ${result.code}` };
    }
    if (result.stdout.length > MAX_MANIFEST_CHARS) {
      throw new Error(`review manifest exceeds ${MAX_MANIFEST_CHARS} characters; refusing silent truncation`);
    }
    const typed = parseTypedReviewManifest(readFileSync(typedPath, "utf8"));
    const parity = parseParityEvidence(readFileSync(`${typedPath}.parity`, "utf8"));
    assertManifestShadowParity(result.stdout, typed, parity);
    return { available: true, output: result.stdout, profilePath, typed };
  } finally {
    rmSync(shadowDir, { recursive: true, force: true });
  }
}

export function parseTypedReviewManifest(raw: string): TypedReviewManifest {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("typed review manifest is not valid JSON"); }
  const root = object(value, "typed review manifest", ["schemaVersion", "available", "base", "head", "mergeBase", "profile", "changedFiles", "activatedLanes", "customLanes", "largeFiles", "warnings"]);
  if (root.schemaVersion !== 1 || root.available !== true) throw new Error("typed review manifest has unsupported schema or availability");
  const base = object(root.base, "base", ["ref", "commit", "source"]);
  const head = object(root.head, "head", ["ref", "commit"]);
  const profile = object(root.profile, "profile", ["source", "requestedPath", "changedAtHead"]);
  stringValue(base.ref, "base.ref"); objectId(base.commit, "base.commit");
  if (!["argument", "trusted profile review-base", "origin/HEAD", "fallback"].includes(String(base.source))) throw new Error("invalid base.source");
  stringValue(head.ref, "head.ref"); objectId(head.commit, "head.commit"); objectId(root.mergeBase, "mergeBase");
  if (!["merge-base", "external", "none"].includes(String(profile.source))) throw new Error("invalid profile.source");
  if (profile.requestedPath !== null && typeof profile.requestedPath !== "string") throw new Error("invalid profile.requestedPath");
  if (typeof profile.changedAtHead !== "boolean") throw new Error("invalid profile.changedAtHead");
  const changedFiles = array(root.changedFiles, "changedFiles").map((entry, index) => {
    const file = object(entry, `changedFiles[${index}]`, ["path", "oldPath", "status", "additions", "deletions", "binary", "activatedLanes"], ["oldPath"]);
    safePath(file.path, `changedFiles[${index}].path`); if (file.oldPath !== undefined) safePath(file.oldPath, `changedFiles[${index}].oldPath`);
    if (typeof file.status !== "string" || !/^[ACDMRTUXB][0-9]*$/.test(file.status)) throw new Error(`invalid changedFiles[${index}].status`);
    for (const field of ["additions", "deletions"] as const) if (file[field] !== null && (!Number.isInteger(file[field]) || Number(file[field]) < 0)) throw new Error(`invalid changedFiles[${index}].${field}`);
    if (typeof file.binary !== "boolean" || file.binary !== (file.additions === null && file.deletions === null)) throw new Error(`invalid changedFiles[${index}] binary metadata`);
    const activatedLanes = array(file.activatedLanes, `changedFiles[${index}].activatedLanes`).map((item, laneIndex) => {
      const lane = object(item, `activation ${laneIndex}`, ["id", "reason"]); laneId(lane.id, "activation.id");
      if (!["path", "content", "profile-extension"].includes(String(lane.reason))) throw new Error("invalid activation.reason");
      return lane as { id: string; reason: "path" | "content" | "profile-extension" };
    });
    return { path: file.path as string, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath as string }), status: file.status as string, additions: file.additions as number | null, deletions: file.deletions as number | null, binary: file.binary, activatedLanes };
  });
  const activatedLanes = array(root.activatedLanes, "activatedLanes").map((id) => (laneId(id, "activatedLanes"), id as string));
  const customLanes = array(root.customLanes, "customLanes").map((entry, index) => { const lane = object(entry, `customLanes[${index}]`, ["id", "trustedSource"]); laneId(lane.id, "custom lane id"); stringValue(lane.trustedSource, "custom lane source"); return lane as { id: string; trustedSource: string }; });
  const largeFiles = array(root.largeFiles, "largeFiles").map((entry, index) => {
    const file = object(entry, `largeFiles[${index}]`, ["path", "baseLines", "headLines"]);
    safePath(file.path, `largeFiles[${index}].path`);
    nonNegativeInteger(file.baseLines, `largeFiles[${index}].baseLines`);
    nonNegativeInteger(file.headLines, `largeFiles[${index}].headLines`);
    if (file.headLines < 400) throw new Error(`largeFiles[${index}].headLines must be at least 400`);
    return file as { path: string; baseLines: number; headLines: number };
  });
  const warnings = array(root.warnings, "warnings").map((warning) => (stringValue(warning, "warning"), warning as string));
  const parsed = { schemaVersion: 1 as const, available: true as const, base: base as TypedReviewManifest["base"], head: head as TypedReviewManifest["head"], mergeBase: root.mergeBase as string, profile: profile as TypedReviewManifest["profile"], changedFiles, activatedLanes, customLanes, largeFiles, warnings };
  validateTypedReviewManifestSemantics(parsed);
  return parsed;
}

export function validateTypedReviewManifestSemantics(manifest: TypedReviewManifest): void {
  const derived = [...new Set(manifest.changedFiles.flatMap((file) => file.activatedLanes.map((lane) => lane.id)))].sort();
  requireUnique(manifest.changedFiles.map((file) => file.path), "changed file paths");
  for (const file of manifest.changedFiles) requireUnique(file.activatedLanes.map((lane) => `${lane.id}:${lane.reason}`), `activation entries for ${file.path}`);
  requireUnique(manifest.activatedLanes, "activated lanes");
  requireUnique(manifest.customLanes.map((lane) => lane.id), "custom lanes");
  requireUnique(manifest.largeFiles.map((file) => file.path), "large file paths");
  const customIds = new Set(manifest.customLanes.map((lane) => lane.id));
  const coreIds = new Set<string>(CORE_LANE_IDS);
  if (manifest.customLanes.some((lane) => coreIds.has(lane.id))) throw new Error("core lanes must not be declared as custom lanes");
  if (derived.some((id) => !coreIds.has(id) && !customIds.has(id))) throw new Error("activated custom lane is missing provenance");
  if (JSON.stringify(manifest.activatedLanes) !== JSON.stringify(derived)) throw new Error("typed review manifest activated-lane inventory is inconsistent");
  const changedPaths = new Set(manifest.changedFiles.map((file) => file.path));
  if (manifest.largeFiles.some((file) => !changedPaths.has(file.path))) throw new Error("large-file inventory contains an unchanged path");
  const requested = manifest.profile.requestedPath;
  if (requested !== null && requested.length === 0) throw new Error("typed review manifest profile path must not be empty");
  if (manifest.profile.source !== "none" && requested === null) throw new Error("selected typed review manifest profile requires requestedPath");
  if (manifest.profile.changedAtHead && requested === null) throw new Error("typed review manifest profile change requires requestedPath");
  if (manifest.customLanes.length > 0 && manifest.profile.source === "none") throw new Error("custom lanes require a trusted profile source");
  const expectedWarnings = manifest.profile.changedAtHead ? 1 : 0;
  if (manifest.warnings.length !== expectedWarnings) throw new Error("typed review manifest warnings do not match profile change state");
}

interface ManifestParityEvidence { statusText: string; statText: string; profileLine: string | null; laneText: Array<{ id: string; path: string; quotedPath: string }>; customLaneText: Array<{ id: string; quotedSource: string }>; largeFileText: Array<{ path: string; quotedPath: string; baseLines: number; headLines: number }> }

function parseParityEvidence(raw: string): ManifestParityEvidence {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("manifest parity evidence is not valid JSON"); }
  const root = object(value, "manifest parity evidence", ["statusText", "statText", "profileLine", "laneText", "customLaneText", "largeFileText"]);
  if (typeof root.statusText !== "string" || typeof root.statText !== "string") throw new Error("manifest parity text evidence is invalid");
  if (root.profileLine !== null && typeof root.profileLine !== "string") throw new Error("manifest parity profile evidence is invalid");
  const laneText = array(root.laneText, "manifest parity lanes").map((entry, index) => {
    const item = object(entry, `manifest parity lane ${index}`, ["id", "path", "quotedPath"]);
    laneId(item.id, "manifest parity lane id"); safePath(item.path, "manifest parity lane path"); stringValue(item.quotedPath, "manifest parity quoted path");
    return item as { id: string; path: string; quotedPath: string };
  });
  const customLaneText = array(root.customLaneText, "manifest parity custom lanes").map((entry, index) => {
    const item = object(entry, `manifest parity custom lane ${index}`, ["id", "quotedSource"]);
    laneId(item.id, "manifest parity custom lane id"); stringValue(item.quotedSource, "manifest parity quoted source");
    return item as { id: string; quotedSource: string };
  });
  const largeFileText = array(root.largeFileText, "manifest parity large files").map((entry, index) => {
    const item = object(entry, `manifest parity large file ${index}`, ["path", "quotedPath", "baseLines", "headLines"]);
    safePath(item.path, "manifest parity large-file path"); stringValue(item.quotedPath, "manifest parity large-file quoted path");
    nonNegativeInteger(item.baseLines, "manifest parity large-file baseLines"); nonNegativeInteger(item.headLines, "manifest parity large-file headLines");
    return item as { path: string; quotedPath: string; baseLines: number; headLines: number };
  });
  return { statusText: root.statusText, statText: root.statText, profileLine: root.profileLine as string | null, laneText, customLaneText, largeFileText };
}

function assertManifestShadowParity(text: string, manifest: TypedReviewManifest, evidence: ManifestParityEvidence): void {
  if (!text.startsWith("Invariant-first review manifest\n")) throw new Error("text manifest header drifted from typed shadow");
  for (const expected of [`base: ${manifest.base.ref} (${manifest.base.source})`, `head: ${manifest.head.ref}`, `merge-base: ${manifest.mergeBase}`]) {
    if (!text.split("\n").includes(expected)) throw new Error(`text/typed manifest parity mismatch: ${expected}`);
  }
  const textWarnings = text.split("\n").filter((line) => line.startsWith("warning: ")).map((line) => line.slice("warning: ".length));
  if (JSON.stringify(textWarnings) !== JSON.stringify(manifest.warnings)) throw new Error("text/typed manifest warning mismatch");
  const profileLines = text.split("\n").filter((line) => line.startsWith("profile: "));
  if (JSON.stringify(profileLines) !== JSON.stringify(evidence.profileLine === null ? [] : [evidence.profileLine])) throw new Error("text/typed manifest profile provenance mismatch");
  const changedSection = section(text, "Changed files", "Diff summary");
  const expectedChanged = manifest.changedFiles.length === 0 ? "(none)\n\n" : `${evidence.statusText}\n`;
  if (changedSection !== expectedChanged) throw new Error("text/typed manifest changed-file inventory mismatch");
  const textChangedFiles = parseGitNameStatusText(evidence.statusText).sort((a, b) => a.path.localeCompare(b.path));
  const typedChangedFiles = manifest.changedFiles.map(({ path, oldPath, status }) => ({ path, ...(oldPath === undefined ? {} : { oldPath }), status }));
  if (JSON.stringify(textChangedFiles) !== JSON.stringify(typedChangedFiles)) throw new Error("text changed-file semantics do not match typed inventory");
  if (!text.includes(`Diff summary\n${evidence.statText}\n`)) throw new Error("text/typed manifest diff-stat mismatch");
  const expectedLaneLines = new Map<string, string[]>();
  for (const item of evidence.laneText) expectedLaneLines.set(item.id, [...(expectedLaneLines.get(item.id) ?? []), `- ${item.quotedPath}`]);
  const actualLaneLines = new Map<string, string[]>();
  let currentLane: string | undefined;
  for (const line of text.split("\n")) {
    const heading = line.match(/\[lane: ([a-z0-9][a-z0-9-]*)\]$/); if (heading) { currentLane = heading[1]; continue; }
    if (currentLane && line.startsWith("- ")) actualLaneLines.set(currentLane, [...(actualLaneLines.get(currentLane) ?? []), line]);
    if (line === "Large changed files at head") currentLane = undefined;
  }
  for (const id of new Set([...expectedLaneLines.keys(), ...actualLaneLines.keys()])) {
    if (JSON.stringify(actualLaneLines.get(id) ?? []) !== JSON.stringify(expectedLaneLines.get(id) ?? [])) throw new Error(`text/typed manifest lane inventory mismatch: ${id}`);
  }
  const evidenceActivations = [...new Set(evidence.laneText.map((item) => `${item.id}\0${item.path}`))].sort();
  const typedActivations = [...new Set(manifest.changedFiles.flatMap((file) => file.activatedLanes.map((lane) => `${lane.id}\0${file.path}`)))].sort();
  if (JSON.stringify(evidenceActivations) !== JSON.stringify(typedActivations)) throw new Error("text lane semantics do not match typed activations");
  for (const custom of manifest.customLanes) {
    const quoted = evidence.customLaneText.find((item) => item.id === custom.id)?.quotedSource;
    if (!quoted || !text.includes(`trusted lane source: ${quoted}`)) throw new Error(`text/typed manifest custom-lane provenance mismatch: ${custom.id}`);
  }
  const largeSection = section(text, "Large changed files at head", "Next step");
  const expectedLargeLines = evidence.largeFileText.length === 0
    ? "(none at or above 400 lines)\n\n"
    : `${evidence.largeFileText.map((file) => `- ${file.quotedPath}: ${file.baseLines} -> ${file.headLines} lines`).join("\n")}\n\n`;
  if (largeSection !== expectedLargeLines) throw new Error("text/typed manifest large-file inventory mismatch");
  const evidenceLargeFiles = evidence.largeFileText.map(({ path, baseLines, headLines }) => ({ path, baseLines, headLines })).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(evidenceLargeFiles) !== JSON.stringify(manifest.largeFiles)) throw new Error("text large-file semantics do not match typed inventory");
}

function parseGitNameStatusText(text: string): Array<{ path: string; oldPath?: string; status: string }> {
  if (text === "") return [];
  return text.trimEnd().split("\n").map((line) => {
    const fields = line.split("\t");
    const status = fields.shift();
    if (!status || !/^[ACDMRTUXB][0-9]*$/.test(status)) throw new Error("text manifest contains malformed changed-file status");
    if (/^[RC]/.test(status)) {
      if (fields.length !== 2) throw new Error("text manifest contains malformed rename/copy status");
      return { path: decodeGitPath(fields[1]!), oldPath: decodeGitPath(fields[0]!), status };
    }
    if (fields.length !== 1) throw new Error("text manifest contains malformed changed-file path");
    return { path: decodeGitPath(fields[0]!), status };
  });
}

function decodeGitPath(token: string): string {
  if (!token.startsWith('"')) return token;
  if (!token.endsWith('"')) throw new Error("text manifest contains malformed quoted path");
  const bytes: number[] = [];
  const body = token.slice(1, -1);
  for (let index = 0; index < body.length;) {
    if (body[index] !== "\\") {
      const point = body.codePointAt(index)!;
      bytes.push(...Buffer.from(String.fromCodePoint(point)));
      index += point > 0xffff ? 2 : 1;
      continue;
    }
    index += 1;
    const escaped = body[index++];
    if (escaped === undefined) throw new Error("text manifest contains malformed path escape");
    const simple: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
    if (simple[escaped] !== undefined) { bytes.push(simple[escaped]); continue; }
    if (/[0-7]/.test(escaped)) {
      const rest = body.slice(index, index + 2);
      if (!/^[0-7]{2}$/.test(rest)) throw new Error("text manifest contains malformed octal path escape");
      bytes.push(Number.parseInt(`${escaped}${rest}`, 8)); index += 2; continue;
    }
    throw new Error("text manifest contains unsupported path escape");
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)); }
  catch { throw new Error("text manifest contains invalid UTF-8 path bytes"); }
}

function section(text: string, start: string, end?: string): string {
  const startToken = `${start}\n`; const startAt = text.indexOf(startToken);
  if (startAt < 0) throw new Error(`text manifest omitted ${start}`);
  const contentStart = startAt + startToken.length;
  const endAt = end ? text.indexOf(`\n${end}\n`, contentStart) : -1;
  return text.slice(contentStart, endAt < 0 ? text.length : endAt + 1);
}

function object(value: unknown, name: string, keys: string[], optional: string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const actual = Object.keys(value as object); const allowed = new Set(keys);
  if (actual.some((key) => !allowed.has(key)) || keys.some((key) => !optional.includes(key) && !actual.includes(key))) throw new Error(`${name} has invalid fields`);
  return value as Record<string, any>;
}
function array(value: unknown, name: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${name} must be an array`); return value; }
function stringValue(value: unknown, name: string): asserts value is string { if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`); }
function objectId(value: unknown, name: string): asserts value is string { if (typeof value !== "string" || !GIT_OBJECT_ID.test(value)) throw new Error(`${name} must be a git object id`); }
function safePath(value: unknown, name: string): asserts value is string { if (typeof value !== "string" || value === "" || isAbsolute(value) || value.split(/[\\/]/).includes("..") || value.includes("\0")) throw new Error(`${name} must be a safe repository-relative path`); }
function nonNegativeInteger(value: unknown, name: string): asserts value is number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${name} must be a non-negative safe integer`); }
function laneId(value: unknown, name: string): asserts value is string { if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`${name} is invalid`); }
function requireUnique(values: string[], name: string): void { if (new Set(values).size !== values.length) throw new Error(`${name} must be unique`); }

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
