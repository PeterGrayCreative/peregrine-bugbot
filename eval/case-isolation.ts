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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { packageRoot } from "../src/core/paths.js";
import type {
  CaseCorpus,
  CaseSpec,
  EvaluationDiffNormalization,
  EvaluationHistoryProvenance,
  EvaluationIsolation,
  HistoricalCaseSpec,
  NetworkIsolationCapability,
  RunnerName,
} from "../src/types.js";
import { exec } from "../src/util/exec.js";
import { parseGroundTruth } from "./case-truth.js";
import { HISTORICAL_EFFICACY_PROTOCOL, parseHistoricalGroundTruth } from "./historical-truth.js";

const OPAQUE_CASE_ID = /^case-[a-f0-9]{8,32}$/;
const COMMIT_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const EVALUATION_DIFF_NORMALIZATION: EvaluationDiffNormalization =
  "identity-v1";
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
  "expectedseverity", "disposition", "expecteddisposition", "riskclass", "expectedriskclass",
  "status", "corpus", "language", "repository",
]);
const ANSWER_GROUND_TRUTH_KEY =
  /(?:^id$|bugid|rootcause|description|precondition|impact|explanation|canary|expected|answer|needle|reason)/;
const SAFE_LEAKAGE_LABELS = [
  "review diff",
  "model-visible metadata",
  "model-visible checkout path",
  "breadth model output",
  "final breadth provider prompt",
  "final investigation provider prompt",
  "production review manifest",
  "reachable Git commit",
  "reachable Git path",
  "reachable Git blob",
  "repository path",
  "repository file",
] as const;

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
  historyProvenance: EvaluationHistoryProvenance;
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
  const forbiddenTerms: string[] = [];
  // Opt-in truth is parsed without projecting away partial scope. Scheduling
  // remains separately disabled until all historical consumers are integrated.
  if (spec.kind === "historical" && spec.evaluationProtocol === HISTORICAL_EFFICACY_PROTOCOL) {
    const truth = parseHistoricalGroundTruth(value);
    // These curator-authored annotations are answer-bearing even when too
    // short for the legacy generic prose heuristic.
    forbiddenTerms.push(truth.scope.reviewedScope, ...truth.bugs.map((bug) => bug.mechanismFamily));
  } else {
    parseGroundTruth(value);
  }
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
  if (unexpected.length > 0) throw new Error("metadataFile contains unsupported fields");
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
  return {
    status: "unavailable",
    mechanism:
      runner === "claude"
        ? "CLI customization surfaces are disabled, but external filesystem and network containment are not attested; live matrix attempts fail closed."
        : "The runner requests an untrusted read-only project with local guidance disabled, but external read/network containment is not attested; live matrix attempts fail closed.",
  };
}

export function assertRunnerMayUseCorpus(corpus: CaseCorpus, runner: RunnerName): void {
  if (corpus === "structural-smoke" && runner !== "mock") {
    throw new Error(
      `structural-smoke cases may run only with the mock engine; refusing live ${runner} inference`,
    );
  }
}

export function assertLiveProviderIsolationAvailable(runner: RunnerName, isolation?: EvaluationIsolation): void {
  if (runner === "mock") return;
  if (!isolation?.runProvider || !isolation.readProviderOutput || !isolation.providerOutputRoot) {
    throw new Error(`live ${runner} evaluation requires the attested OCI filesystem containment adapter`);
  }
}

export function assertLeakageFreeText(
  label: string,
  value: string | Buffer,
  policy: LeakagePolicy,
  options: { allowDocumentedMarkers?: boolean } = {},
): void {
  const raw = typeof value === "string" ? Buffer.from(value) : value;
  const views = leakageTextViews(raw);
  const normalizedViews = views.map(normalizeLeakageText);
  const safeLabel = safeLeakageLabel(label);
  for (const term of policy.forbiddenTerms) {
    if (term && normalizedViews.some((view) => view.includes(term))) {
      // Never echo the curator-only answer term into run artifacts or logs.
      throw new Error(`${safeLabel} contains forbidden answer-bearing term`);
    }
  }
  if (policy.corpus !== "structural-smoke") {
    for (const marker of ANSWER_MARKERS) {
      if (views.some((view) => marker.test(view))) {
        const hash = createHash("sha256").update(raw).digest("hex");
        if (options.allowDocumentedMarkers && policy.documentedMarkerHashes.has(hash)) continue;
        throw new Error(`${safeLabel} contains undocumented answer-bearing marker`);
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
  const expectedDiff = normalizeEvaluationDiff(readFileSync(diffPath, "utf8"));
  assertSafeDiffPaths(expectedDiff);
  assertLeakageFreeText("review diff", expectedDiff, policy, { allowDocumentedMarkers: true });

  const attemptRoot = mkdtempSync(join(options.tempRoot ?? tmpdir(), "peregrine-eval-"));
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    const remove = options.removeAttempt ?? ((path) => rmSync(path, { recursive: true, force: true }));
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        remove(attemptRoot);
        if (!existsSync(attemptRoot)) {
          cleaned = true;
          return;
        }
        lastError = new Error("attempt root still exists after removal");
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error("isolated attempt cleanup failed after two attempts", { cause: lastError });
  };

  const repoPath = join(attemptRoot, "checkout");
  const materializedDiffPath = join(attemptRoot, "review.patch");
  const providerHome = join(attemptRoot, "provider-home");
  const providerAssetsRoot = join(attemptRoot, "provider-assets");
  const providerOutputRoot = join(attemptRoot, "provider-output");
  const templateDir = join(attemptRoot, "empty-git-template");
  try {
    mkdirSync(repoPath);
    mkdirSync(providerHome);
    mkdirSync(providerOutputRoot, { mode: 0o700 });
    mkdirSync(join(providerHome, "tmp"));
    mkdirSync(join(providerHome, "xdg-config"));
    mkdirSync(join(providerHome, "xdg-cache"));
    mkdirSync(join(providerHome, "xdg-data"));
    mkdirSync(templateDir);
    writeFileSync(materializedDiffPath, expectedDiff, { flag: "wx" });
    if (options.prepareProviderAssets === false) mkdirSync(providerAssetsRoot);
    else (options.assetPreparer ?? prepareProviderAssets)(providerAssetsRoot, policy);

    let historicalSource: Awaited<ReturnType<typeof materializeHistorical>> | undefined;
    if (spec.kind === "historical") {
      historicalSource = await materializeHistorical(
        spec,
        repoPath,
        attemptRoot,
        providerHome,
        templateDir,
      );
    } else {
      await materializeFixture(caseRoot, spec.fixtureDir, materializedDiffPath, repoPath, providerHome, templateDir);
    }

    await assertSanitizedRepository(repoPath, providerHome);
    assertTreeSafe(repoPath, policy, { allowRootGit: true });
    await assertReachableHistorySafe(repoPath, providerHome, policy);
    assertLeakageFreePath(realpathSync(repoPath), policy);

    const baseRef = await git(repoPath, ["rev-parse", "HEAD^"], providerHome);
    const headRef = await git(repoPath, ["rev-parse", "HEAD"], providerHome);
    const mergeBase = await git(repoPath, ["merge-base", baseRef, headRef], providerHome);
    if (mergeBase !== baseRef) {
      throw new Error("materialized base is not the merge base of the review range");
    }
    await assertPatchReproducesRange(repoPath, materializedDiffPath, baseRef, headRef, providerHome);
    const actualDiff = await canonicalRangeDiff(repoPath, baseRef, headRef, providerHome);
    if (actualDiff !== expectedDiff) {
      throw new Error(
        `checked-in diff does not exactly match the materialized merge-base...head diff after ${EVALUATION_DIFF_NORMALIZATION}`,
      );
    }
    const { baseTree, headTree, objectFormat } = await assertCheckedOutHead(
      repoPath,
      baseRef,
      headRef,
      providerHome,
    );
    const diffSha256 = createHash("sha256").update(actualDiff).digest("hex");

    const evaluationIsolation: EvaluationIsolation = {
      providerHome,
      providerAssetsRoot,
      providerOutputRoot,
      validatePrompt: createPromptValidator(policy),
    };
    return {
      repoPath,
      diffPath: materializedDiffPath,
      baseRef,
      headRef,
      diffText: actualDiff,
      materializedDiffSha256: diffSha256,
      historyProvenance: {
        schemaVersion: 1,
        materialization: spec.kind === "historical"
          ? "historical-sanitized-export"
          : "fixture-patch",
        objectFormat,
        baseRef,
        headRef,
        mergeBase,
        baseTree,
        headTree,
        commitCount: 2,
        baseIsMergeBase: true,
        checkedOutTreeMatchesHead: true,
        treeReproductionVerified: true,
        ...(historicalSource ? { historicalSource } : {}),
        diffNormalization: EVALUATION_DIFF_NORMALIZATION,
        diffSha256,
      },
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
    await git(
      repoPath,
      ["apply", "--unidiff-zero", "--check", "--index", "--reverse", diffPath],
      providerHome,
    );
    await git(
      repoPath,
      ["apply", "--unidiff-zero", "--index", "--reverse", diffPath],
      providerHome,
    );
    const reversedTree = await git(repoPath, ["write-tree"], providerHome);
    const baseTree = await git(repoPath, ["rev-parse", `${baseRef}^{tree}`], providerHome);
    if (reversedTree !== baseTree) {
      throw new Error("checked-in diff does not reproduce the complete materialized base tree");
    }
  } finally {
    await git(repoPath, ["reset", "--quiet", "--hard", headRef], providerHome);
  }
}

export function normalizeEvaluationDiff(value: string): string {
  // Identity is intentional: CR bytes in a patch can belong to tracked CRLF
  // content, so even line-ending normalization could change repository state.
  return value;
}

async function canonicalRangeDiff(
  repoPath: string,
  baseRef: string,
  headRef: string,
  providerHome: string,
): Promise<string> {
  const raw = await gitRaw(
    repoPath,
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-color",
      "--find-renames",
      `${baseRef}...${headRef}`,
    ],
    providerHome,
  );
  return normalizeEvaluationDiff(raw);
}

async function assertCheckedOutHead(
  repoPath: string,
  baseRef: string,
  headRef: string,
  providerHome: string,
): Promise<{ baseTree: string; headTree: string; objectFormat: "sha1" | "sha256" }> {
  const currentHead = await git(repoPath, ["rev-parse", "HEAD"], providerHome);
  if (currentHead !== headRef) throw new Error("materialized checkout is not at the review head");
  const baseTree = await git(repoPath, ["rev-parse", `${baseRef}^{tree}`], providerHome);
  const headTree = await git(repoPath, ["rev-parse", `${headRef}^{tree}`], providerHome);
  const indexTree = await git(repoPath, ["write-tree"], providerHome);
  if (indexTree !== headTree) throw new Error("materialized index does not match the head tree");
  const worktreeDiff = await gitRaw(
    repoPath,
    ["diff", "--no-ext-diff", "--no-color", "--exit-code", headRef, "--"],
    providerHome,
  );
  if (worktreeDiff.length > 0) throw new Error("materialized working tree does not match the head tree");
  const objectFormat = await git(repoPath, ["rev-parse", "--show-object-format"], providerHome);
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new Error("materialized repository uses an unsupported Git object format");
  }
  return { baseTree, headTree, objectFormat };
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

function safeLeakageLabel(label: string): string {
  return SAFE_LEAKAGE_LABELS.find((candidate) => label.startsWith(candidate)) ?? "model-visible input";
}

function leakageTextViews(raw: Buffer): string[] {
  const views = new Set<string>([raw.toString("utf8")]);
  if (raw.includes(0)) {
    // ASCII embedded in UTF-16/32 is still visible when alternating NUL bytes
    // are removed. This also catches encoded markers inside otherwise-binary
    // blobs without assuming the whole blob is valid text.
    views.add(raw.toString("latin1").replaceAll("\0", ""));
  }
  if (hasBom(raw, [0xff, 0xfe]) || looksLikeUtf16(raw, "le")) {
    views.add(raw.subarray(hasBom(raw, [0xff, 0xfe]) ? 2 : 0).toString("utf16le"));
  }
  if (hasBom(raw, [0xfe, 0xff]) || looksLikeUtf16(raw, "be")) {
    const offset = hasBom(raw, [0xfe, 0xff]) ? 2 : 0;
    views.add(decodeUtf16Be(raw.subarray(offset)));
  }
  if (hasBom(raw, [0xff, 0xfe, 0x00, 0x00])) {
    views.add(decodeUtf32(raw.subarray(4), "le"));
  }
  if (hasBom(raw, [0x00, 0x00, 0xfe, 0xff])) {
    views.add(decodeUtf32(raw.subarray(4), "be"));
  }
  return [...views];
}

function hasBom(raw: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => raw[index] === byte);
}

function looksLikeUtf16(raw: Buffer, endian: "le" | "be"): boolean {
  let likelyPairs = 0;
  let pairs = 0;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const nul = endian === "le" ? raw[index + 1] : raw[index];
    const value = endian === "le" ? raw[index] : raw[index + 1];
    if (nul === 0 && value !== 0) likelyPairs++;
    pairs++;
  }
  return likelyPairs >= 4 && likelyPairs / pairs >= 0.3;
}

function decodeUtf16Be(raw: Buffer): string {
  const evenLength = raw.length - (raw.length % 2);
  const swapped = Buffer.allocUnsafe(evenLength);
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = raw[index + 1]!;
    swapped[index + 1] = raw[index]!;
  }
  return swapped.toString("utf16le");
}

function decodeUtf32(raw: Buffer, endian: "le" | "be"): string {
  const codePoints: number[] = [];
  for (let index = 0; index + 3 < raw.length; index += 4) {
    const value = endian === "le" ? raw.readUInt32LE(index) : raw.readUInt32BE(index);
    codePoints.push(value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? value : 0xfffd);
  }
  let decoded = "";
  for (let index = 0; index < codePoints.length; index += 4096) {
    decoded += String.fromCodePoint(...codePoints.slice(index, index + 4096));
  }
  return decoded;
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
  await initSanitizedRepository(repoPath, providerHome, templateDir, "sha1");

  await git(repoPath, ["apply", "--unidiff-zero", "--check", "--reverse", diffPath], providerHome);
  await git(repoPath, ["apply", "--unidiff-zero", "--reverse", diffPath], providerHome);
  await commitTree(repoPath, providerHome, "base", "2000-01-01T00:00:00Z");
  await git(repoPath, ["apply", "--unidiff-zero", "--check", diffPath], providerHome);
  await git(repoPath, ["apply", "--unidiff-zero", diffPath], providerHome);
  await commitTree(repoPath, providerHome, "head", "2000-01-02T00:00:00Z");
}

async function materializeHistorical(
  spec: HistoricalCaseSpec,
  repoPath: string,
  attemptRoot: string,
  providerHome: string,
  templateDir: string,
): Promise<NonNullable<EvaluationHistoryProvenance["historicalSource"]>> {
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

  let sourceBaseTree = "";
  let sourceHeadTree = "";
  let sourceIdentitySha256 = "";
  try {
    const sourceMergeBase = await git(
      staging,
      ["merge-base", spec.baseCommit, spec.headCommit],
      curatorHome,
    );
    if (sourceMergeBase !== spec.baseCommit) {
      throw new Error("historical baseCommit must be the merge base and an ancestor of headCommit");
    }
    sourceBaseTree = await git(
      staging,
      ["rev-parse", `${spec.baseCommit}^{tree}`],
      curatorHome,
    );
    sourceHeadTree = await git(
      staging,
      ["rev-parse", `${spec.headCommit}^{tree}`],
      curatorHome,
    );
    const sourceObjectFormat = await git(
      staging,
      ["rev-parse", "--show-object-format"],
      curatorHome,
    );
    if (sourceObjectFormat !== "sha1" && sourceObjectFormat !== "sha256") {
      throw new Error("historical source uses an unsupported Git object format");
    }
    if (await git(staging, ["rev-parse", "--is-shallow-repository"], curatorHome) !== "false") {
      throw new Error("historical source must expose complete, non-shallow ancestry");
    }
    if ((await git(staging, ["for-each-ref", "--format=%(refname)", "refs/replace"], curatorHome)).trim() ||
      existsSync(join(staging, ".git", "info", "grafts"))) {
      throw new Error("historical source cannot use replacement or grafted ancestry");
    }
    const sourceRoots = (await git(
      staging,
      ["rev-list", "--max-parents=0", spec.headCommit],
      curatorHome,
    )).split("\n").filter(Boolean).sort();
    sourceIdentitySha256 = repositoryFamilyIdentitySha256(sourceObjectFormat, sourceRoots);
    await git(staging, ["checkout", "--quiet", "--detach", spec.baseCommit], curatorHome);
    assertTreeSafe(staging, undefined, { allowRootGit: true });
    copyTree(staging, repoPath, new Set([".git"]));
    await initSanitizedRepository(repoPath, providerHome, templateDir, sourceObjectFormat);
    await commitTree(repoPath, providerHome, "base", "2000-01-01T00:00:00Z");
    await assertExportedSourceTree(repoPath, sourceBaseTree, "base", providerHome);

    clearWorkingTree(repoPath);
    await git(staging, ["checkout", "--quiet", "--detach", spec.headCommit], curatorHome);
    assertTreeSafe(staging, undefined, { allowRootGit: true });
    copyTree(staging, repoPath, new Set([".git"]));
    await commitTree(repoPath, providerHome, "head", "2000-01-02T00:00:00Z");
    await assertExportedSourceTree(repoPath, sourceHeadTree, "head", providerHome);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(curatorHome, { recursive: true, force: true });
  }

  // Curator source history and remotes are destroyed before a provider can run.
  if (existsSync(staging) || existsSync(curatorHome)) {
    throw new Error("historical curator source was not removed");
  }
  return {
    sourceIdentitySha256,
    sourceBaseRef: spec.baseCommit,
    sourceHeadRef: spec.headCommit,
    sourceMergeBase: spec.baseCommit,
    sourceBaseTree,
    sourceHeadTree,
    baseCommitIsMergeBase: true,
    baseTreeMatches: true,
    headTreeMatches: true,
  };
}

export function repositoryFamilyIdentitySha256(
  objectFormat: "sha1" | "sha256",
  rootCommitOids: readonly string[],
): string {
  const oidPattern = objectFormat === "sha1" ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/;
  const roots = [...new Set(rootCommitOids)].sort();
  if (roots.length === 0 || roots.some((oid) => !oidPattern.test(oid))) {
    throw new Error("historical repository family requires complete root commit object IDs");
  }
  return createHash("sha256").update(JSON.stringify({
    version: "git-root-family-v1",
    objectFormat,
    rootCommitOids: roots,
  })).digest("hex");
}

async function assertExportedSourceTree(
  repoPath: string,
  expectedTree: string,
  label: "base" | "head",
  providerHome: string,
): Promise<void> {
  const actualTree = await git(repoPath, ["rev-parse", "HEAD^{tree}"], providerHome);
  if (actualTree !== expectedTree) {
    throw new Error(
      `historical ${label} tree could not be reproduced exactly; unsupported or omitted Git entries are forbidden`,
    );
  }
}

async function initSanitizedRepository(
  repoPath: string,
  providerHome: string,
  templateDir: string,
  objectFormat: "sha1" | "sha256",
): Promise<void> {
  await git(
    repoPath,
    [
      "init",
      "--quiet",
      "--initial-branch=review",
      `--object-format=${objectFormat}`,
      `--template=${templateDir}`,
    ],
    providerHome,
  );
}

async function commitTree(
  repoPath: string,
  providerHome: string,
  message: string,
  date: string,
): Promise<void> {
  // Historical sources may intentionally track paths covered by their own
  // .gitignore. Force-add the exported tree so Git cannot silently omit them.
  await git(repoPath, ["add", "--force", "--all"], providerHome);
  await git(
    repoPath,
    ["-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", message],
    providerHome,
    date,
  );
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
  for (const forbidden of [
    join(repoPath, ".git", "objects", "info", "alternates"),
    join(repoPath, ".git", "objects", "info", "http-alternates"),
    join(repoPath, ".git", "shallow"),
    join(repoPath, ".git", "info", "grafts"),
  ]) {
    if (existsSync(forbidden)) {
      throw new Error("materialized repository retains an alternate or rewritten history source");
    }
  }
  const refs = (await git(
    repoPath,
    ["for-each-ref", "--format=%(refname)"],
    providerHome,
  )).split("\n").filter(Boolean);
  if (refs.length !== 1 || refs[0] !== "refs/heads/review") {
    throw new Error("materialized repository contains an unexpected Git ref");
  }
  const allowedReflogOids = new Set([
    await git(repoPath, ["rev-parse", "HEAD"], providerHome),
    await git(repoPath, ["rev-parse", "HEAD^"], providerHome),
  ]);
  const reflogOids = (await git(
    repoPath,
    ["reflog", "--all", "--format=%H"],
    providerHome,
  )).split("\n").filter(Boolean);
  if (reflogOids.some((oid) => !allowedReflogOids.has(oid))) {
    throw new Error("materialized repository reflog exposes an unexpected commit");
  }
  const unreachable = await gitRaw(
    repoPath,
    ["fsck", "--unreachable", "--no-reflogs", "--no-progress"],
    providerHome,
  );
  if (unreachable.trim()) {
    throw new Error("materialized repository contains unreachable Git objects");
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
    assertLeakageFreeText("reachable Git commit", commitObject, policy);
    const entries = gitBuffer(
      repoPath,
      ["ls-tree", "-r", "-z", "--full-tree", commit],
      providerHome,
    ).toString("utf8").split("\0").filter(Boolean);
    for (const entry of entries) {
      const separator = entry.indexOf("\t");
      if (separator === -1) throw new Error("reachable Git tree contains an unparseable entry");
      const header = entry.slice(0, separator).split(" ");
      if (header.length !== 3) throw new Error("reachable Git tree contains an unparseable entry");
      const mode = header[0];
      const objectType = header[1];
      const oid = header[2];
      const path = entry.slice(separator + 1);
      assertHistoricalPathSafe(path);
      assertLeakageFreeText("reachable Git path", path, policy);
      if (mode === "120000") throw new Error("reachable Git history contains a forbidden symlink");
      if (mode === "160000" || objectType === "commit") {
        throw new Error("reachable Git history contains a forbidden gitlink");
      }
      if ((mode !== "100644" && mode !== "100755") || objectType !== "blob" || !oid) {
        throw new Error("reachable Git history contains an unsupported tree entry");
      }
      if (seenBlobs.has(oid)) continue;
      seenBlobs.add(oid);
      const blob = gitBuffer(repoPath, ["cat-file", "blob", oid], providerHome);
      assertLeakageFreeText("reachable Git blob", blob, policy, {
        allowDocumentedMarkers: true,
      });
    }
  }
}

function assertHistoricalPathSafe(path: string): void {
  const components = path.split(/[\\/]/);
  if (
    !path ||
    path.startsWith("/") ||
    components.some((component) => component === "" || component === "." || component === "..")
  ) {
    throw new Error("reachable Git history contains an unsafe path");
  }
  if (components.some((component) => [".git", ".gitmodules"].includes(component.toLowerCase()))) {
    throw new Error("reachable Git history contains forbidden nested Git metadata");
  }
  if (components.some((component) => ANSWER_ARTIFACT.test(component))) {
    throw new Error("reachable Git history contains a forbidden answer artifact");
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
      if ([".git", ".gitmodules"].includes(entry.name.toLowerCase())) {
        throw new Error("model-visible repository contains forbidden nested Git metadata");
      }
      if (ANSWER_ARTIFACT.test(entry.name)) {
        throw new Error("model-visible repository contains a forbidden answer artifact");
      }
      const full = join(directory, entry.name);
      const visiblePath = relative(rootReal, full);
      if (policy) assertLeakageFreeText("repository path", visiblePath, policy);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error("model-visible repository contains a forbidden symlink");
      if (stat.isDirectory()) {
        visit(full, false);
        continue;
      }
      if (!stat.isFile()) throw new Error("model-visible repository contains a forbidden special file");
      const resolved = realpathSync(full);
      if (!isWithin(rootReal, resolved)) throw new Error("model-visible file escapes repository");
      if (policy) {
        assertLeakageFreeText("repository file", readFileSync(full), policy, {
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
      throw new Error("diff contains an unsafe path");
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
