import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import { parseGroundTruth } from "./case-truth.js";

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
const NON_ANSWER_GROUND_TRUTH_KEYS = new Set([
  "file", "lane", "invariantlane", "severity", "curatedseverity",
  "disposition", "expecteddisposition", "riskclass", "expectedriskclass",
  "status", "corpus", "language", "repository",
]);
const ANSWER_GROUND_TRUTH_KEY =
  /(?:^id$|bugid|rootcause|description|precondition|impact|explanation|canary|expected|answer|needle|reason)/;

export interface LeakagePolicy {
  caseId: string;
  corpus: CaseCorpus;
  forbiddenTerms: string[];
  documentedMarkerHashes: ReadonlySet<string>;
}

export interface MaterializedCase {
  repoPath: string;
  diffPath: string;
  baseRef: string;
  headRef: string;
  diffText: string;
  materializedDiffSha256: string;
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
  parseGroundTruth(value);
  const forbiddenTerms: string[] = [];
  collectAnswerTerms(value, forbiddenTerms);
  return {
    caseId: spec.id,
    corpus: spec.corpus,
    forbiddenTerms: [...new Set(forbiddenTerms.map(normalizeLeakageText).filter(Boolean))],
    documentedMarkerHashes: readDocumentedMarkerHashes(caseRoot, spec),
  };
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
      status: "unavailable",
      mechanism:
        "CLI customization surfaces are disabled, but external filesystem and network containment are not attested; live matrix attempts fail closed.",
    };
  }
  return {
    status: "unavailable",
    mechanism:
      "The runner requests an untrusted read-only project with local guidance disabled, but external read/network containment is not attested; live matrix attempts fail closed.",
  };
}

export function assertRunnerMayUseCorpus(corpus: CaseCorpus, runner: RunnerName): void {
  if (corpus === "structural-smoke" && runner !== "mock") {
    throw new Error(
      `structural-smoke cases may run only with the mock engine; refusing live ${runner} inference`,
    );
  }
}

export function assertLiveProviderIsolationAvailable(runner: RunnerName): void {
  if (runner === "mock") return;
  throw new Error(
    `live ${runner} evaluation is disabled until an externally enforced filesystem and network allowlist contains the checkout, sanitized assets, and output only`,
  );
}

export function assertLeakageFreeText(
  label: string,
  value: string | Buffer,
  policy: LeakagePolicy,
  options: { allowDocumentedMarkers?: boolean } = {},
): void {
  const raw = typeof value === "string" ? Buffer.from(value) : value;
  const normalized = normalizeLeakageText(raw.toString("utf8"));
  for (const term of policy.forbiddenTerms) {
    if (term && normalized.includes(term)) {
      // Never echo the curator-only answer term into run artifacts or logs.
      throw new Error(`${label} contains forbidden answer-bearing term`);
    }
  }
  if (policy.corpus !== "structural-smoke") {
    for (const marker of ANSWER_MARKERS) {
      if (marker.test(raw.toString("utf8"))) {
        const hash = createHash("sha256").update(raw).digest("hex");
        if (options.allowDocumentedMarkers && policy.documentedMarkerHashes.has(hash)) continue;
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
): EvaluationIsolation["validatePrompt"] {
  return ({ prompt, stage, untrustedModelText }) => {
    let trustedPrompt = prompt;
    if (stage === "investigation") {
      if (!untrustedModelText || !prompt.includes(untrustedModelText)) {
        throw new Error("investigation prompt does not contain its declared model-output boundary");
      }
      // Generic marker language may legitimately be produced by breadth. Scan
      // that boundary only for case-specific answer terms, then remove the
      // exact bytes before validating runner-owned instructions and context.
      const modelOnlyPolicy = { ...policy, corpus: "structural-smoke" as const };
      assertLeakageFreeText("breadth model output", untrustedModelText, modelOnlyPolicy);
      trustedPrompt = prompt.replace(untrustedModelText, "<validated-breadth-output>");
    } else if (untrustedModelText !== undefined) {
      throw new Error("breadth prompt cannot declare an embedded model-output boundary");
    }
    assertLeakageFreeText(`final ${stage} provider prompt`, trustedPrompt, policy);
  };
}

interface MaterializeOptions {
  tempRoot?: string;
  prepareProviderAssets?: boolean;
  /** Test seam for setup and cleanup failure guarantees. */
  assetPreparer?: typeof prepareProviderAssets;
  removeAttempt?: (attemptRoot: string) => void;
}

export async function materializeCase(
  caseDir: string,
  spec: CaseSpec,
  policy: LeakagePolicy,
  options: MaterializeOptions = {},
): Promise<MaterializedCase> {
  assertOpaqueCaseId(spec.id);
  const caseRoot = realpathSync(caseDir);
  const diffPath = confinedFile(caseRoot, spec.diffFile, "diffFile");
  const expectedDiff = readFileSync(diffPath, "utf8");
  assertSafeDiffPaths(expectedDiff);
  assertLeakageFreeText("review diff", expectedDiff, policy, { allowDocumentedMarkers: true });

  const attemptRoot = mkdtempSync(join(options.tempRoot ?? tmpdir(), "peregrine-eval-"));
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    try {
      (options.removeAttempt ?? ((path) => rmSync(path, { recursive: true, force: true })))(attemptRoot);
    } catch (error) {
      throw new Error(
        `isolated attempt cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (existsSync(attemptRoot)) throw new Error("isolated attempt cleanup did not remove its root");
    cleaned = true;
  };

  const repoPath = join(attemptRoot, "checkout");
  const materializedDiffPath = join(attemptRoot, "review.patch");
  const providerHome = join(attemptRoot, "provider-home");
  const providerAssetsRoot = join(attemptRoot, "provider-assets");
  const templateDir = join(attemptRoot, "empty-git-template");
  try {
    mkdirSync(repoPath);
    mkdirSync(providerHome);
    mkdirSync(join(providerHome, "tmp"));
    mkdirSync(join(providerHome, "xdg-config"));
    mkdirSync(join(providerHome, "xdg-cache"));
    mkdirSync(join(providerHome, "xdg-data"));
    mkdirSync(templateDir);
    cpSync(diffPath, materializedDiffPath, { force: false, errorOnExist: true });
    if (options.prepareProviderAssets === false) mkdirSync(providerAssetsRoot);
    else (options.assetPreparer ?? prepareProviderAssets)(providerAssetsRoot, policy);

    if (spec.kind === "historical") {
      await materializeHistorical(spec, repoPath, attemptRoot, providerHome, templateDir);
    } else {
      await materializeFixture(caseRoot, spec.fixtureDir, materializedDiffPath, repoPath, providerHome, templateDir);
    }

    await assertSanitizedRepository(repoPath, providerHome);
    assertTreeSafe(repoPath, policy, { allowRootGit: true });
    await assertReachableHistorySafe(repoPath, providerHome, policy);
    assertLeakageFreePath(realpathSync(repoPath), policy);

    const baseRef = await git(repoPath, ["rev-parse", "HEAD^"], providerHome);
    const headRef = await git(repoPath, ["rev-parse", "HEAD"], providerHome);
    await assertPatchReproducesRange(repoPath, materializedDiffPath, baseRef, headRef, providerHome);
    const actualDiff = await git(repoPath, ["diff", "--no-ext-diff", `${baseRef}...${headRef}`], providerHome);

    const evaluationIsolation: EvaluationIsolation = {
      providerHome,
      providerAssetsRoot,
      validatePrompt: createPromptValidator(policy),
    };
    return {
      repoPath,
      diffPath: materializedDiffPath,
      baseRef,
      headRef,
      diffText: actualDiff,
      materializedDiffSha256: createHash("sha256").update(actualDiff).digest("hex"),
      evaluationIsolation,
      cleanup,
    };
  } catch (error) {
    try {
      cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `case materialization failed and cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    }
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

function readDocumentedMarkerHashes(caseRoot: string, spec: CaseSpec): ReadonlySet<string> {
  if (!spec.leakageExceptionsFile) return new Set();
  const path = confinedFile(caseRoot, spec.leakageExceptionsFile, "leakageExceptionsFile");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `leakageExceptionsFile must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("leakageExceptionsFile must contain an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.entries)) {
    throw new Error("leakageExceptionsFile must contain version 1 and an entries array");
  }
  if (Object.keys(record).some((key) => key !== "version" && key !== "entries")) {
    throw new Error("leakageExceptionsFile contains unsupported fields");
  }
  const hashes = new Set<string>();
  record.entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`leakage exception ${index} must be an object`);
    }
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).some((key) => key !== "sha256" && key !== "reason") ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      typeof item.reason !== "string" ||
      item.reason.trim().length < 12
    ) {
      throw new Error(
        `leakage exception ${index} needs only a lowercase sha256 and a substantive reason`,
      );
    }
    if (hashes.has(item.sha256)) throw new Error(`duplicate leakage exception hash ${item.sha256}`);
    hashes.add(item.sha256);
  });
  return hashes;
}

function collectAnswerTerms(value: unknown, output: string[], key?: string): void {
  if (typeof value === "string") {
    const normalizedKey = key?.replace(/[_-]/g, "").toLowerCase() ?? "";
    // Do not turn generic schema vocabulary such as "high", "authorization",
    // or "fix-in-pr" into global bans. IDs and answer prose are always denied;
    // unknown future prose is denied once specific enough to be identifying.
    if (
      !NON_ANSWER_GROUND_TRUTH_KEYS.has(normalizedKey) &&
      (ANSWER_GROUND_TRUTH_KEY.test(normalizedKey) || normalizeLeakageText(value).length >= 24)
    ) {
      output.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAnswerTerms(entry, output, key));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    collectAnswerTerms(child, output, childKey);
  }
}

function normalizeLeakageText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
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

async function assertReachableHistorySafe(
  repoPath: string,
  providerHome: string,
  policy: LeakagePolicy,
): Promise<void> {
  const commits = (await git(repoPath, ["rev-list", "--all"], providerHome)).split("\n").filter(Boolean);
  const seenBlobs = new Set<string>();
  for (const commit of commits) {
    const commitObject = gitBuffer(repoPath, ["cat-file", "commit", commit], providerHome);
    assertLeakageFreeText(`reachable commit ${commit}`, commitObject, policy);
    const entries = gitBuffer(
      repoPath,
      ["ls-tree", "-r", "-z", "--full-tree", commit],
      providerHome,
    ).toString("utf8").split("\0").filter(Boolean);
    for (const entry of entries) {
      const separator = entry.indexOf("\t");
      if (separator === -1) throw new Error("reachable Git tree contains an unparseable entry");
      const header = entry.slice(0, separator).split(" ");
      const objectType = header[1];
      const oid = header[2];
      const path = entry.slice(separator + 1);
      assertLeakageFreeText(`reachable Git path ${path}`, path, policy);
      if (objectType !== "blob" || !oid || seenBlobs.has(oid)) continue;
      seenBlobs.add(oid);
      const blob = gitBuffer(repoPath, ["cat-file", "blob", oid], providerHome);
      assertLeakageFreeText(`reachable Git blob ${path}`, blob, policy, {
        allowDocumentedMarkers: true,
      });
    }
  }
}

function gitBuffer(cwd: string, args: string[], providerHome: string): Buffer {
  try {
    return execFileSync("git", args, {
      cwd,
      env: isolatedGitEnvironment(providerHome),
      encoding: "buffer",
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    throw new Error(`git ${args[0] ?? "command"} failed while scanning reachable history`);
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
      if (policy) assertLeakageFreeText(`repository path ${visiblePath}`, visiblePath, policy);
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
        assertLeakageFreeText(`repository file ${visiblePath}`, readFileSync(full), policy, {
          allowDocumentedMarkers: true,
        });
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
  return (await gitRaw(cwd, args, providerHome, date)).trim();
}

async function gitRaw(
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
  return result.stdout;
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
