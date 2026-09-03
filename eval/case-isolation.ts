import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { packageRoot } from "../src/core/paths.js";
import type {
  CaseCorpus,
  CaseSpec,
  EvaluationIsolation,
  HistoricalCaseSpec,
  NetworkIsolationCapability,
  RunnerName,
} from "../src/types.js";
import { exec } from "../src/util/exec.js";

const OPAQUE_CASE_ID = /^case-[a-f0-9]{8,32}$/;
const COMMIT_OID = /^[a-f0-9]{40,64}$/;
const ANSWER_ARTIFACT = /^(?:ground[_-]?truth|later[_-]?fix|review[_-]?(?:thread|comment)s?|issue[_-]?(?:description|text)|curator[_-]?notes?)(?:\.|$)/i;
const ANSWER_MARKERS = [
  /(?:\/\/|#|\/\*|\*)\s*(?:BUG|FIXME)\b/i,
  /\bPEREGRINE_(?:SEAM_)?BUG\b/i,
  /\bground(?:_|-|\s)+truth\b/i,
  /\bexpected(?:_|-|\s)+(?:answer|bug|finding|outcome)\b/i,
  /\blater(?:_|-|\s)+fix\b/i,
  /\bcurator(?:_|-|\s)+notes?\b/i,
];

export interface LeakagePolicy {
  caseId: string;
  corpus: CaseCorpus;
  forbiddenTerms: string[];
}

export interface MaterializedCase {
  repoPath: string;
  baseRef: string;
  headRef: string;
  diffText: string;
  exactDiffSha256: string;
  evaluationIsolation: EvaluationIsolation;
  cleanup(): void;
}

export interface SanitizedCaseMetadata {
  title?: string;
  body?: string;
}

export function leakagePolicyForCase(caseDir: string, spec: CaseSpec): LeakagePolicy {
  const caseRoot = realpathSync(caseDir);
  const truthPath = confinedFile(caseRoot, "ground_truth.json", "ground truth");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(truthPath, "utf8"));
  } catch (error) {
    throw new Error(`ground truth must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || !Array.isArray((value as { bugs?: unknown }).bugs)) {
    throw new Error("ground truth must contain a bugs array");
  }
  const forbiddenTerms = (value as { bugs: unknown[] }).bugs.map((bug, index) => {
    if (!bug || typeof bug !== "object" || typeof (bug as { id?: unknown }).id !== "string") {
      throw new Error(`ground truth bug ${index} needs a string id`);
    }
    return (bug as { id: string }).id;
  });
  return { caseId: spec.id, corpus: spec.corpus, forbiddenTerms };
}

export function readSanitizedMetadata(
  caseDir: string,
  spec: CaseSpec,
  policy: LeakagePolicy,
): SanitizedCaseMetadata {
  if (!spec.metadataFile) return {};
  const caseRoot = realpathSync(caseDir);
  const path = confinedFile(caseRoot, spec.metadataFile, "metadataFile");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`metadataFile must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadataFile must contain an object");
  }
  const metadata = value as Record<string, unknown>;
  const unexpected = Object.keys(metadata).filter((key) => key !== "title" && key !== "body");
  if (unexpected.length > 0) throw new Error(`metadataFile contains unsupported fields: ${unexpected.join(", ")}`);
  for (const key of ["title", "body"] as const) {
    if (metadata[key] !== undefined && typeof metadata[key] !== "string") {
      throw new Error(`metadataFile ${key} must be a string`);
    }
    if (typeof metadata[key] === "string") {
      assertLeakageFreeText(`model-visible metadata ${key}`, metadata[key], policy);
    }
  }
  return metadata as SanitizedCaseMetadata;
}

export function assertOpaqueCaseId(value: string, source = "case id"): void {
  if (!OPAQUE_CASE_ID.test(value)) {
    throw new Error(`${source} must match ${OPAQUE_CASE_ID.source}; descriptive case IDs are forbidden`);
  }
}

export function networkIsolationCapability(runner: RunnerName): NetworkIsolationCapability {
  if (runner === "mock") {
    return {
      status: "not-applicable",
      mechanism: "No provider process is started for structural smoke runs.",
    };
  }
  if (runner === "claude") {
    return {
      status: "limited",
      mechanism:
        "The runner exposes only Read, Grep, and Glob tools, but cannot independently attest provider-host network namespace isolation.",
    };
  }
  return {
    status: "limited",
    mechanism:
      "The runner requests the Codex read-only sandbox, but cannot independently attest provider-host network namespace isolation.",
  };
}

export function assertRunnerMayUseCorpus(corpus: CaseCorpus, runner: RunnerName): void {
  if (corpus === "structural-smoke" && runner !== "mock") {
    throw new Error(
      `structural-smoke cases may run only with the mock engine; refusing live ${runner} inference`,
    );
  }
}

export function assertLeakageFreeText(
  label: string,
  value: string,
  policy: LeakagePolicy,
): void {
  for (const term of policy.forbiddenTerms) {
    if (term && value.toLocaleLowerCase().includes(term.toLocaleLowerCase())) {
      throw new Error(`${label} contains forbidden answer-bearing term ${JSON.stringify(term)}`);
    }
  }
  if (policy.corpus !== "structural-smoke") {
    for (const marker of ANSWER_MARKERS) {
      if (marker.test(value)) {
        throw new Error(`${label} contains undocumented answer-bearing marker ${marker.source}`);
      }
    }
  }
}

export function assertLeakageFreePath(path: string, policy: LeakagePolicy): void {
  assertLeakageFreeText("model-visible checkout path", path, policy);
}

export function createPromptValidator(
  policy: LeakagePolicy,
): (prompt: string, stage: "breadth" | "investigation") => void {
  return (prompt, stage) => {
    // The investigation prompt contains the untrusted breadth ledger. A model
    // may legitimately use words such as BUG or FIXME in that ledger, so only
    // runner-owned canaries remain meaningful at this second boundary.
    const phasePolicy = stage === "breadth"
      ? policy
      : { ...policy, corpus: "structural-smoke" as const };
    assertLeakageFreeText(`final ${stage} provider prompt`, prompt, phasePolicy);
  };
}

export async function materializeCase(
  caseDir: string,
  spec: CaseSpec,
  policy: LeakagePolicy,
  options: { tempRoot?: string; prepareProviderAssets?: boolean } = {},
): Promise<MaterializedCase> {
  assertOpaqueCaseId(spec.id);
  const caseRoot = realpathSync(caseDir);
  const diffPath = confinedFile(caseRoot, spec.diffFile, "diffFile");
  const expectedDiff = readFileSync(diffPath, "utf8");
  assertSafeDiffPaths(expectedDiff);
  assertLeakageFreeText("review diff", expectedDiff, policy);

  const attemptRoot = mkdtempSync(join(options.tempRoot ?? tmpdir(), "peregrine-eval-"));
  const repoPath = join(attemptRoot, "checkout");
  const providerHome = join(attemptRoot, "provider-home");
  const providerAssetsRoot = join(attemptRoot, "provider-assets");
  const templateDir = join(attemptRoot, "empty-git-template");
  mkdirSync(repoPath);
  mkdirSync(providerHome);
  mkdirSync(join(providerHome, "tmp"));
  mkdirSync(join(providerHome, "xdg-config"));
  mkdirSync(join(providerHome, "xdg-cache"));
  mkdirSync(join(providerHome, "xdg-data"));
  mkdirSync(templateDir);
  if (options.prepareProviderAssets === false) mkdirSync(providerAssetsRoot);
  else prepareProviderAssets(providerAssetsRoot, policy);

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    rmSync(attemptRoot, { recursive: true, force: true });
  };

  try {
    if (spec.kind === "historical") {
      await materializeHistorical(spec, repoPath, attemptRoot, providerHome, templateDir);
    } else {
      await materializeFixture(caseRoot, spec.fixtureDir, diffPath, repoPath, providerHome, templateDir);
    }

    await assertSanitizedRepository(repoPath, providerHome);
    assertTreeSafe(repoPath, policy, { allowRootGit: true });
    assertLeakageFreePath(realpathSync(repoPath), policy);

    const baseRef = await git(repoPath, ["rev-parse", "HEAD^"], providerHome);
    const headRef = await git(repoPath, ["rev-parse", "HEAD"], providerHome);
    await assertPatchReproducesRange(repoPath, diffPath, baseRef, headRef, providerHome);
    const actualDiff = await git(repoPath, ["diff", "--no-ext-diff", `${baseRef}...${headRef}`], providerHome);

    const evaluationIsolation: EvaluationIsolation = {
      providerHome,
      providerAssetsRoot,
      validatePrompt: createPromptValidator(policy),
    };
    return {
      repoPath,
      baseRef,
      headRef,
      diffText: actualDiff,
      exactDiffSha256: createHash("sha256").update(actualDiff).digest("hex"),
      evaluationIsolation,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function assertPatchReproducesRange(
  repoPath: string,
  diffPath: string,
  baseRef: string,
  headRef: string,
  providerHome: string,
): Promise<void> {
  try {
    await git(repoPath, ["apply", "--check", "--index", "--reverse", diffPath], providerHome);
    await git(repoPath, ["apply", "--index", "--reverse", diffPath], providerHome);
    const reversedTree = await git(repoPath, ["write-tree"], providerHome);
    const baseTree = await git(repoPath, ["rev-parse", `${baseRef}^{tree}`], providerHome);
    if (reversedTree !== baseTree) {
      throw new Error("checked-in diff does not reproduce the complete materialized base tree");
    }
  } finally {
    await git(repoPath, ["reset", "--quiet", "--hard", headRef], providerHome);
  }
}

function prepareProviderAssets(target: string, policy: LeakagePolicy): void {
  const source = packageRoot();
  mkdirSync(target);
  copyTree(join(source, "skills"), join(target, "skills"));
  copyTree(join(source, "schemas"), join(target, "schemas"));
  mkdirSync(join(target, ".claude-plugin"));
  cpSync(
    join(source, ".claude-plugin", "plugin.json"),
    join(target, ".claude-plugin", "plugin.json"),
    { force: false, errorOnExist: true },
  );
  // Trusted method assets may discuss generic bug markers. Case-specific
  // canaries must still be absent from the only package tree exposed to a
  // provider process.
  assertTreeSafe(
    target,
    { ...policy, corpus: "structural-smoke" },
    { allowRootGit: false },
  );
}

async function materializeFixture(
  caseRoot: string,
  fixtureDir: string,
  diffPath: string,
  repoPath: string,
  providerHome: string,
  templateDir: string,
): Promise<void> {
  const fixture = confinedDirectory(caseRoot, fixtureDir, "fixtureDir");
  assertTreeSafe(fixture, undefined, { allowRootGit: false });
  copyTree(fixture, repoPath);
  await initSanitizedRepository(repoPath, providerHome, templateDir);

  await git(repoPath, ["apply", "--check", "--reverse", diffPath], providerHome);
  await git(repoPath, ["apply", "--reverse", diffPath], providerHome);
  await commitTree(repoPath, providerHome, "base", "2000-01-01T00:00:00Z");
  await git(repoPath, ["apply", "--check", diffPath], providerHome);
  await git(repoPath, ["apply", diffPath], providerHome);
  await commitTree(repoPath, providerHome, "head", "2000-01-02T00:00:00Z");
}

async function materializeHistorical(
  spec: HistoricalCaseSpec,
  repoPath: string,
  attemptRoot: string,
  providerHome: string,
  templateDir: string,
): Promise<void> {
  if (!COMMIT_OID.test(spec.baseCommit) || !COMMIT_OID.test(spec.headCommit)) {
    throw new Error("historical baseCommit and headCommit must be full hexadecimal object IDs");
  }
  assertUncredentialedRepoSource(spec.repoSource);
  const sourcePath = isLocalRepoSource(spec.repoSource)
    ? realpathSync(resolve(spec.repoSource))
    : spec.repoSource;
  const staging = join(attemptRoot, "curator-source");
  const curatorHome = join(attemptRoot, "curator-home");
  mkdirSync(join(curatorHome, "tmp"), { recursive: true });
  const clone = await exec(
    "git",
    [
      "-c",
      "credential.helper=",
      "clone",
      "--quiet",
      "--no-checkout",
      "--no-local",
      sourcePath,
      staging,
    ],
    { timeoutMs: 300_000, env: isolatedGitEnvironment(curatorHome), inheritEnv: false },
  );
  if (clone.code !== 0) throw new Error(`historical source clone failed with exit ${clone.code}`);

  try {
    await git(staging, ["checkout", "--quiet", "--detach", spec.baseCommit], curatorHome);
    assertTreeSafe(staging, undefined, { allowRootGit: true });
    copyTree(staging, repoPath, new Set([".git"]));
    await initSanitizedRepository(repoPath, providerHome, templateDir);
    await commitTree(repoPath, providerHome, "base", "2000-01-01T00:00:00Z");

    clearWorkingTree(repoPath);
    await git(staging, ["checkout", "--quiet", "--detach", spec.headCommit], curatorHome);
    assertTreeSafe(staging, undefined, { allowRootGit: true });
    copyTree(staging, repoPath, new Set([".git"]));
    await commitTree(repoPath, providerHome, "head", "2000-01-02T00:00:00Z");
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(curatorHome, { recursive: true, force: true });
  }

  // Curator source history and remotes are destroyed before a provider can run.
  if (existsSync(staging) || existsSync(curatorHome)) {
    throw new Error("historical curator source was not removed");
  }
}

async function initSanitizedRepository(
  repoPath: string,
  providerHome: string,
  templateDir: string,
): Promise<void> {
  await git(repoPath, ["init", "--quiet", "--initial-branch=review", `--template=${templateDir}`], providerHome);
}

async function commitTree(
  repoPath: string,
  providerHome: string,
  message: string,
  date: string,
): Promise<void> {
  await git(repoPath, ["add", "--all"], providerHome);
  await git(repoPath, ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message], providerHome, date);
}

async function assertSanitizedRepository(repoPath: string, providerHome: string): Promise<void> {
  const remotes = await git(repoPath, ["remote"], providerHome);
  if (remotes.trim()) throw new Error("materialized repository retains a Git remote");
  const count = Number(await git(repoPath, ["rev-list", "--all", "--count"], providerHome));
  if (count !== 2) throw new Error(`materialized repository must contain exactly two commits, found ${count}`);
  const status = await git(repoPath, ["status", "--porcelain=v1", "--untracked-files=all"], providerHome);
  if (status.trim()) throw new Error("materialized repository is not clean");
  const hooks = join(repoPath, ".git", "hooks");
  if (existsSync(hooks) && readdirSync(hooks).length > 0) {
    throw new Error("materialized repository contains Git hooks");
  }
  const config = readFileSync(join(repoPath, ".git", "config"), "utf8");
  if (/\[(?:remote|credential|http|url)\b/i.test(config)) {
    throw new Error("materialized repository contains remote or credentialed Git configuration");
  }
}

function assertTreeSafe(
  root: string,
  policy: LeakagePolicy | undefined,
  options: { allowRootGit: boolean },
): void {
  const rootReal = realpathSync(root);
  const visit = (directory: string, atRoot: boolean): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (atRoot && options.allowRootGit && entry.name === ".git") continue;
      if (entry.name === ".git" || entry.name === ".gitmodules") {
        throw new Error(`model-visible repository contains forbidden ${entry.name}`);
      }
      if (ANSWER_ARTIFACT.test(entry.name)) {
        throw new Error(`model-visible repository contains answer artifact ${entry.name}`);
      }
      const full = join(directory, entry.name);
      const visiblePath = relative(rootReal, full);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`model-visible repository contains symlink ${visiblePath}`);
      if (stat.isDirectory()) {
        visit(full, false);
        continue;
      }
      if (!stat.isFile()) throw new Error(`model-visible repository contains special file ${visiblePath}`);
      const resolved = realpathSync(full);
      if (!isWithin(rootReal, resolved)) throw new Error(`model-visible file escapes repository: ${visiblePath}`);
      if (policy) {
        assertLeakageFreeText(`repository file ${visiblePath}`, readFileSync(full).toString("utf8"), policy);
      }
    }
  };
  visit(rootReal, true);
}

function confinedFile(caseRoot: string, value: string, field: string): string {
  const path = confinedPath(caseRoot, value, field);
  if (!lstatSync(path).isFile()) throw new Error(`${field} must identify a regular file`);
  return path;
}

function confinedDirectory(caseRoot: string, value: string, field: string): string {
  const path = confinedPath(caseRoot, value, field);
  if (!lstatSync(path).isDirectory()) throw new Error(`${field} must identify a directory`);
  return path;
}

function confinedPath(caseRoot: string, value: string, field: string): string {
  if (!value || isAbsolute(value)) throw new Error(`${field} must be a non-empty relative path`);
  const candidate = resolve(caseRoot, value);
  if (!existsSync(candidate)) throw new Error(`${field} does not exist`);
  const resolved = realpathSync(candidate);
  if (!isWithin(caseRoot, resolved)) throw new Error(`${field} escapes its case directory`);
  return resolved;
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function assertSafeDiffPaths(diff: string): void {
  for (const line of diff.split("\n")) {
    const match = line.match(/^(?:---|\+\+\+)\s+(?:[ab]\/)?([^\t]+)$/);
    if (!match || match[1] === "/dev/null") continue;
    const path = match[1]!;
    if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
      throw new Error(`diff contains unsafe path ${JSON.stringify(path)}`);
    }
  }
}

function copyTree(source: string, target: string, excluded = new Set<string>()): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    cpSync(join(source, entry.name), join(target, entry.name), {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
  }
}

function clearWorkingTree(repoPath: string): void {
  for (const entry of readdirSync(repoPath)) {
    if (entry !== ".git") rmSync(join(repoPath, entry), { recursive: true, force: true });
  }
}

async function git(
  cwd: string,
  args: string[],
  providerHome: string,
  date?: string,
): Promise<string> {
  const result = await exec("git", args, {
    cwd,
    timeoutMs: 60_000,
    env: isolatedGitEnvironment(providerHome, date),
    inheritEnv: false,
  });
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`git ${args[0] ?? "command"} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function isolatedGitEnvironment(home: string, date?: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: join(home, "tmp"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Peregrine Eval",
    GIT_AUTHOR_EMAIL: "eval@peregrine.invalid",
    GIT_COMMITTER_NAME: "Peregrine Eval",
    GIT_COMMITTER_EMAIL: "eval@peregrine.invalid",
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
  };
}

function assertUncredentialedRepoSource(value: string): void {
  if (!value) throw new Error("historical repoSource must be non-empty");
  try {
    const url = new URL(value);
    if (url.username || url.password) throw new Error("historical repoSource must not embed credentials");
  } catch (error) {
    if (error instanceof Error && /must not embed credentials/.test(error.message)) throw error;
    // SCP-like and local repository paths are not WHATWG URLs. Credentials in
    // an SCP-like source are rejected rather than copied into a provider repo.
    if (/^[^/@\s]+@[^:]+:/.test(value)) throw new Error("historical repoSource must not embed a username");
  }
}

function isLocalRepoSource(value: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[^/@\s]+@[^:]+:/.test(value);
}

export function caseIdFromDirectory(caseDir: string): string {
  return basename(caseDir);
}

export function corpusFromDirectory(caseDir: string): CaseCorpus | undefined {
  const value = basename(dirname(caseDir));
  return value === "structural-smoke" || value === "development" || value === "validation"
    ? value
    : undefined;
}
