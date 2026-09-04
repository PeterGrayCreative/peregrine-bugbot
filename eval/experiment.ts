import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  realpathSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  CASE_CORPORA,
  RUNNER_NAMES,
  type CaseCorpus,
  type ExperimentProtocol,
  type ExperimentEvidenceClass,
  type MatrixModelConfig,
  type RunRecord,
  type RunnerName,
} from "../src/types.js";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const BLOCK_ID = /^(?:block|retry)-[0-9]{6}$/;
const OPAQUE_CASE_ID = /^case-[a-f0-9]{8,32}$/;
const EXPERIMENT_MODES = ["structural-smoke", "screening", "visible-checkpoint", "checkpoint"] as const;
const EXPERIMENT_EVIDENCE_CLASSES = ["diagnostic-visible-subset", "visible-seeded-checkpoint"] as const;
const CACHE_CONDITIONS = ["cold", "warm", "uncontrolled", "not-applicable"] as const;
const JUDGE_KINDS = ["exact", "claude", "codex"] as const;
const INVESTIGATION_PROMPT_MODES = ["legacy", "method-packet"] as const;
const BREADTH_LEDGER_MODES = [
  "full",
  "structural-compact",
  "adaptive-structural-compact",
] as const;
const PROVIDER_AVAILABILITY_STATUSES = [
  "configured",
  "denied",
  "blocked-isolation",
  "missing-cli",
  "missing-credential",
  "not-applicable",
] as const;
const CLI_VERSION_STATUSES = ["observed", "unavailable", "not-applicable"] as const;
const STOP_REASONS = [
  "provider-calls-denied",
  "provider-attempt-ceiling",
  "provider-cost-unavailable",
  "provider-cost-ceiling",
  "wall-time-ceiling",
  "failure-rate-ceiling",
  "consecutive-failure-ceiling",
] as const;

export type ExperimentVariant = "structural" | "control" | "treatment";
export type ExperimentStopReason = (typeof STOP_REASONS)[number];

export interface ExperimentCase {
  caseName: string;
  corpus: CaseCorpus;
  expectedBugCount: number | null;
}

export interface ExperimentAttemptReference {
  experimentId: string;
  manifestSha256: string;
  attemptId: string;
  evidenceSha256: string;
}

export interface ExperimentScheduledAttempt {
  id: string;
  blockId: string;
  sequence: number;
  caseName: string;
  corpus: CaseCorpus;
  expectedBugCount: number | null;
  configName: string;
  repeat: number;
  runner: RunnerName;
  variant: ExperimentVariant;
  position: 1 | 2;
  file: string;
  retryOf?: ExperimentAttemptReference;
}

export interface ExperimentHashes {
  repositorySha256: string;
  corpusSha256: string;
  promptSha256: string;
  methodSha256: string;
  schemaSha256: string;
  profileSha256: string;
  judgeSha256: string;
  matrixManifestSha256: string;
  matrixConfigSha256: string;
  peregrineConfigSha256: string;
  configurationSha256: string;
}

export interface ExperimentModelIdentity {
  configName: string;
  runner: RunnerName;
  effectiveConfigSha256: string;
  breadthModel?: string;
  breadthEffort?: string;
  investigationModel?: string;
  investigationEffort?: string;
  investigationPromptMode?: (typeof INVESTIGATION_PROMPT_MODES)[number];
  breadthLedgerMode?: (typeof BREADTH_LEDGER_MODES)[number];
}

export interface ExperimentCliVersion {
  runner: RunnerName;
  status: (typeof CLI_VERSION_STATUSES)[number];
  version?: string;
}

export interface ExperimentProviderAvailability {
  runner: RunnerName;
  status: (typeof PROVIDER_AVAILABILITY_STATUSES)[number];
}

export interface ExperimentRuntime {
  observedAt: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  cliVersions: ExperimentCliVersion[];
  providerAvailability: ExperimentProviderAvailability[];
}

export interface ExperimentLineage {
  kind: "retry";
  source: ExperimentAttemptReference;
}

export interface ExperimentManifest {
  schemaVersion: 1;
  experimentId: string;
  createdAt: string;
  repositoryCommit: string;
  protocol: ExperimentProtocol;
  /** Required only for visible-checkpoint; derived from full-corpus vs allowlisted selection. */
  evidenceClass?: ExperimentEvidenceClass;
  hashes: ExperimentHashes;
  models: ExperimentModelIdentity[];
  runtime: ExperimentRuntime;
  schedule: ExperimentScheduledAttempt[];
  lineage?: ExperimentLineage;
}

export interface ExperimentCeilingObserved {
  attempts: number;
  providerAttempts: number;
  failures: number;
  failureRate: number;
  consecutiveFailures: number;
  providerCostUsd: number;
  wallTimeMs: number;
  costUnavailableAttemptIds: string[];
}

export interface ExperimentCeilingDecision {
  stop: boolean;
  reason?: ExperimentStopReason;
  beforeAttemptId?: string;
  observed: ExperimentCeilingObserved;
}

export interface ExperimentStopRecord {
  schemaVersion: 1;
  experimentId: string;
  recordedAt: string;
  reason: ExperimentStopReason;
  beforeAttemptId: string;
  observed: ExperimentCeilingObserved;
  limits: ExperimentProtocol["limits"];
}

export interface ExperimentAttemptStartedRecord {
  schemaVersion: 1;
  experimentId: string;
  attemptId: string;
  startedAt: string;
}

export interface ExperimentProviderStartedRecord {
  schemaVersion: 1;
  experimentId: string;
  attemptId: string;
  providerStartedAt: string;
}

export interface HashTreeOptions {
  /** Exact relative paths or directory prefixes to omit from the digest. */
  excludeRelativePaths?: readonly string[];
}

/** Classifies visible-checkpoint evidence without permitting gold or holdout labels. */
export function visibleCheckpointEvidenceClass(
  caseIds?: readonly string[],
): ExperimentEvidenceClass {
  return caseIds === undefined ? "visible-seeded-checkpoint" : "diagnostic-visible-subset";
}

export interface BuildExperimentManifestInput {
  createdAt: string;
  repositoryCommit: string;
  protocol: ExperimentProtocol;
  evidenceClass?: ExperimentEvidenceClass;
  hashes: ExperimentHashes;
  models: ExperimentModelIdentity[];
  runtime: ExperimentRuntime;
  schedule: ExperimentScheduledAttempt[];
  lineage?: ExperimentLineage;
}

/** Holds the single-writer/read-consumer lease for an experiment directory. */
export function acquireExperimentLock(runDirectory: string): () => void {
  const root = resolve(runDirectory);
  const path = join(root, ".experiment.lock");
  let descriptor: number;
  try {
    assertSafeExperimentDestinationParent(root, path);
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("experiment is already locked; stale locks require explicit operator recovery");
    }
    throw error;
  }
  writeFileSync(descriptor, `${process.pid}\n`);
  fsyncSync(descriptor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(descriptor);
    assertSafeExperimentDestinationParent(root, path);
    unlinkSync(path);
  };
}

/**
 * Writes one immutable JSON artifact durably without an overwrite window.
 * Node exposes no openat(2)-style relative operations, so a malicious same-user
 * process racing between validation and a filesystem call is outside this guard.
 */
export function writeExclusiveJson(experimentRoot: string, path: string, value: unknown): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    assertSafeExperimentDestinationParent(experimentRoot, temporary);
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertSafeExperimentDestinationParent(experimentRoot, path);
    const temporaryStat = lstatSync(temporary);
    if (temporaryStat.isSymbolicLink() || !temporaryStat.isFile()) {
      throw new Error("experiment temporary artifact must remain a regular non-symlink file");
    }
    linkSync(temporary, path);
    fsyncDirectory(experimentRoot, dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      assertSafeExperimentDestinationParent(experimentRoot, temporary);
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // Refuse to follow a parent that changed while cleaning up.
    }
  }
}

function fsyncDirectory(experimentRoot: string, path: string): void {
  assertSafeExperimentDestinationParent(experimentRoot, join(path, ".fsync-target"));
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertSafeExperimentDestinationParent(experimentRoot: string, destination: string): void {
  const root = resolve(experimentRoot);
  const target = resolve(destination);
  const targetRelative = relative(root, target);
  if (
    targetRelative === "" ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`) ||
    isAbsolute(targetRelative)
  ) {
    throw new Error(`experiment destination must be a child of its root: ${destination}`);
  }

  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`experiment root must be a real directory: ${root}`);
  }
  const realRoot = realpathSync(root);
  const parent = dirname(target);
  const parentRelative = relative(root, parent);
  let current = root;
  for (const component of parentRelative.split(sep).filter(Boolean)) {
    current = join(current, component);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`experiment destination parent must be a real directory: ${current}`);
    }
  }

  const realParent = realpathSync(parent);
  const confined = relative(realRoot, realParent);
  if (confined === ".." || confined.startsWith(`..${sep}`) || isAbsolute(confined)) {
    throw new Error(`experiment destination parent escapes its root: ${parent}`);
  }
}

/**
 * Parses the user-visible experiment contract without applying repository or
 * model defaults. Missing limits are invalid: an experiment must decide its
 * budget before any provider process can start.
 */
export function parseExperimentProtocol(
  value: unknown,
  source = "experiment protocol",
): ExperimentProtocol {
  return parseExperimentProtocolValue(value, source);
}

function parseExperimentProtocolValue(
  value: unknown,
  source: string,
): ExperimentProtocol {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "mode",
    "seed",
    "cacheCondition",
    "providerCalls",
    "providerAccess",
    "costAccounting",
    "judge",
    "control",
    "treatment",
    "limits",
  ]), source);
  const mode = member(root.mode, EXPERIMENT_MODES, `${source}.mode`);
  const seed = integer(root.seed, `${source}.seed`, 0, 0xffff_ffff);
  const cacheCondition = member(root.cacheCondition, CACHE_CONDITIONS, `${source}.cacheCondition`);
  const providerCalls = member(root.providerCalls, ["allow", "deny"] as const, `${source}.providerCalls`);
  const providerAccess = member(
    root.providerAccess,
    ["api-key", "cli-session", "not-applicable"] as const,
    `${source}.providerAccess`,
  );
  const costAccounting = member(
    root.costAccounting,
    ["required", "best-effort", "not-applicable"] as const,
    `${source}.costAccounting`,
  );
  const judgeRoot = object(root.judge, `${source}.judge`);
  onlyKeys(judgeRoot, new Set(["kind", "model", "effort", "version", "limits"]), `${source}.judge`);
  const judgeKind = member(judgeRoot.kind, JUDGE_KINDS, `${source}.judge.kind`);
  const judgeVersion = boundedString(judgeRoot.version, `${source}.judge.version`);
  const judgeModel = optionalBoundedString(judgeRoot.model, `${source}.judge.model`);
  const judgeEffort = optionalBoundedString(judgeRoot.effort, `${source}.judge.effort`);
  const judgeLimits = judgeRoot.limits === undefined ? undefined : parseExperimentLimits(judgeRoot.limits, `${source}.judge.limits`);
  if (judgeKind === "exact" && (judgeModel !== undefined || judgeEffort !== undefined || judgeLimits !== undefined)) {
    throw new Error(`${source}.judge model, effort, and limits must be absent for the exact judge`);
  }
  if (judgeKind !== "exact" && (judgeModel === undefined || judgeEffort === undefined || judgeLimits === undefined)) {
    throw new Error(`${source}.judge model, effort, and limits are required for a provider judge`);
  }
  const supportedJudgeVersion = judgeKind === "exact" ? "exact-v1" : "semantic-v1";
  if (judgeVersion !== supportedJudgeVersion) {
    throw new Error(
      `${source}.judge ${judgeKind}/${judgeVersion} is not supported; expected ${judgeKind}/${supportedJudgeVersion}`,
    );
  }
  if (judgeKind !== "exact" && (
    judgeKind !== "codex" || judgeModel !== "gpt-5.6-luna" || judgeEffort !== "medium"
  )) {
    throw new Error(`${source}.judge must use the contained gpt-5.6-luna medium semantic judge`);
  }

  const limits = parseExperimentLimits(root.limits, `${source}.limits`);
  const control = optionalBoundedString(root.control, `${source}.control`);
  const treatment = optionalBoundedString(root.treatment, `${source}.treatment`);
  if (mode === "structural-smoke") {
    if (control !== undefined || treatment !== undefined) {
      throw new Error(`${source}: structural-smoke must not declare control or treatment`);
    }
    if (cacheCondition !== "not-applicable") {
      throw new Error(`${source}: structural-smoke cache condition must be not-applicable`);
    }
    if (providerCalls !== "deny") {
      throw new Error(`${source}: structural-smoke must deny provider calls`);
    }
    if (providerAccess !== "not-applicable" || costAccounting !== "not-applicable") {
      throw new Error(`${source}: structural-smoke provider access and cost accounting must be not-applicable`);
    }
    if (judgeKind !== "exact") {
      throw new Error(`${source}: structural-smoke must use the exact judge`);
    }
    if (limits.maxProviderCostUsd !== null || limits.maxProviderAttempts !== 0) {
      throw new Error(`${source}: structural-smoke must not declare provider cost or attempt capacity`);
    }
  } else {
    if (control === undefined || treatment === undefined) {
      throw new Error(`${source}: ${mode} requires control and treatment`);
    }
    if (control === treatment) throw new Error(`${source}: control and treatment must differ`);
    if (cacheCondition !== "uncontrolled") {
      throw new Error(
        `${source}: live cache state must remain uncontrolled until a cache protocol is enforced`,
      );
    }
    if (providerAccess === "not-applicable" || costAccounting === "not-applicable") {
      throw new Error(`${source}: live experiments must declare provider access and cost accounting`);
    }
    if (
      (providerAccess === "api-key" && costAccounting !== "required") ||
      (providerAccess === "cli-session" && costAccounting !== "best-effort")
    ) {
      throw new Error(
        `${source}: live experiments require api-key with required accounting or cli-session with best-effort accounting`,
      );
    }
    if (judgeKind === "exact") {
      throw new Error(`${source}: live paired experiments must preregister a semantic judge`);
    }
    if (costAccounting === "required" && limits.maxProviderCostUsd === null) {
      throw new Error(`${source}: required cost accounting needs maxProviderCostUsd`);
    }
    if (providerCalls === "allow" && limits.maxProviderAttempts < 1) {
      throw new Error(`${source}: provider calls require a positive maxProviderAttempts`);
    }
    if (judgeLimits!.maxProviderAttempts < 1 || judgeLimits!.maxWallTimeMs < 1) {
      throw new Error(`${source}: semantic judge requires positive, separately declared attempt and wall-time ceilings`);
    }
  }

  return {
    mode,
    seed,
    cacheCondition,
    providerCalls,
    providerAccess,
    costAccounting,
    judge: {
      kind: judgeKind,
      ...(judgeModel === undefined ? {} : { model: judgeModel }),
      ...(judgeEffort === undefined ? {} : { effort: judgeEffort }),
      version: judgeVersion,
      ...(judgeLimits === undefined ? {} : { limits: judgeLimits }),
    },
    ...(control === undefined ? {} : { control }),
    ...(treatment === undefined ? {} : { treatment }),
    limits,
  };
}

export function buildExperimentSchedule(input: {
  protocol: ExperimentProtocol;
  cases: readonly ExperimentCase[];
  repeats: number;
  configs: readonly MatrixModelConfig[];
}): ExperimentScheduledAttempt[] {
  const protocol = parseExperimentProtocol(input.protocol);
  const repeats = integer(input.repeats, "experiment repeats", 1, Number.MAX_SAFE_INTEGER);
  const cases = [...input.cases].map((item, index) => parseExperimentCase(item, `experiment cases[${index}]`));
  const caseNames = cases.map((item) => item.caseName);
  if (new Set(caseNames).size !== caseNames.length) throw new Error("experiment case names must be unique");
  cases.sort((left, right) => compareText(left.caseName, right.caseName));

  const configs = input.configs.map((item, index) => parseMatrixConfig(item, `experiment configs[${index}]`));
  const configNames = configs.map((item) => item.name);
  if (new Set(configNames).size !== configNames.length) throw new Error("experiment config names must be unique");
  validateModeInputs(protocol, cases, configs);

  const random = seededRandom(protocol.seed);
  const blocks = cases.flatMap((caseItem) =>
    Array.from({ length: repeats }, (_, index) => ({ caseItem, repeat: index + 1 })),
  );
  shuffle(blocks, random);

  const scheduled: ExperimentScheduledAttempt[] = [];
  const firstControlFirst = random() < 0.5;
  for (const [blockIndex, block] of blocks.entries()) {
    if (!block) throw new Error("internal error: missing experiment block");
    const blockId = `block-${String(blockIndex + 1).padStart(6, "0")}`;
    if (protocol.mode === "structural-smoke") {
      const config = configs[0];
      if (!config) throw new Error("internal error: structural config is absent");
      scheduled.push(scheduleAttempt({
        sequence: scheduled.length + 1,
        blockId,
        block,
        config,
        variant: "structural",
        position: 1,
      }));
      continue;
    }

    const control = configs.find((item) => item.name === protocol.control);
    const treatment = configs.find((item) => item.name === protocol.treatment);
    if (!control || !treatment) throw new Error("internal error: paired configs are absent");
    const controlFirst = blockIndex % 2 === 0 ? firstControlFirst : !firstControlFirst;
    const ordered = controlFirst
      ? [[control, "control"], [treatment, "treatment"]] as const
      : [[treatment, "treatment"], [control, "control"]] as const;
    for (const [positionIndex, [config, variant]] of ordered.entries()) {
      scheduled.push(scheduleAttempt({
        sequence: scheduled.length + 1,
        blockId,
        block,
        config,
        variant,
        position: (positionIndex + 1) as 1 | 2,
      }));
    }
  }
  validateSchedule(scheduled, protocol);
  return scheduled;
}

/** Creates the sole schedule entry for a new experiment that retries evidence from another run. */
export function buildRetrySchedule(
  sourceAttempt: ExperimentScheduledAttempt,
  source: ExperimentAttemptReference,
): ExperimentScheduledAttempt[] {
  const parsedAttempt = parseScheduledAttempt(sourceAttempt, "source attempt");
  const parsedSource = parseAttemptReference(source, "retry source");
  if (parsedAttempt.id !== parsedSource.attemptId) {
    throw new Error("retry source attemptId must identify the source schedule entry");
  }
  return [{
    ...parsedAttempt,
    id: "attempt-000001",
    blockId: "retry-000001",
    sequence: 1,
    position: 1,
    file: "attempt-000001.json",
    retryOf: parsedSource,
  }];
}

/** Canonical JSON rejects values that JSON.stringify would silently erase or coerce. */
export function canonicalJson(value: unknown): string {
  return canonicalValue(value, "$", new Set<object>());
}

export function canonicalJsonSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function absentInputSha256(label: string): string {
  return sha256(`peregrine-absent-input-v1\0${boundedString(label, "absent input label")}`);
}

/** Reads one regular file without following a final-component symbolic link. */
export function readExperimentFile(path: string): Buffer {
  let descriptor: number;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error(`${path} must be a regular non-symlink file`);
    }
    throw error;
  }
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(`${path} must be a regular non-symlink file`);
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Parses experiment metadata without echoing malformed file contents. */
export function readExperimentJson(path: string): unknown {
  const bytes = readExperimentFile(path);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${path} contains invalid JSON`);
  }
}

/**
 * Hashes paths, Git-like executable modes, and file bytes. Symlinks and
 * special files are rejected. The traversal never intentionally follows a
 * symbolic link, including one in the root path itself.
 */
export function hashPathTree(path: string, options: HashTreeOptions = {}): string {
  const root = resolve(path);
  assertPathComponentsAreNotSymlinks(root);
  const excluded = normalizeExclusions(options.excludeRelativePaths ?? []);
  const entries: Array<{ path: string; mode: "040000" | "100644" | "100755"; size?: number; sha256?: string }> = [];

  const visit = (absolute: string, relativePath: string): void => {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`hash input contains a symbolic link: ${displayPath(relativePath)}`);
    if (stat.isDirectory()) {
      entries.push({ path: relativePath || ".", mode: "040000" });
      const children = readdirSync(absolute).sort(compareText);
      for (const name of children) {
        const childRelative = relativePath ? `${relativePath}/${name}` : name;
        if (isExcluded(childRelative, excluded)) continue;
        visit(resolve(absolute, name), childRelative);
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`hash input contains a special file: ${displayPath(relativePath)}`);
    const descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      bytes = readFileSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    entries.push({
      path: relativePath || ".",
      mode: stat.mode & 0o111 ? "100755" : "100644",
      size: bytes.byteLength,
      sha256: sha256(bytes),
    });
  };

  visit(root, "");
  return canonicalJsonSha256({ schemaVersion: 1, entries });
}

/** Hashes exactly the selected case directories plus the shared curator alias file. */
export function hashExperimentCorpus(
  casesDir: string,
  caseNames: readonly string[],
): string {
  const root = resolve(casesDir);
  const names = [...caseNames].sort(compareText);
  unique(names, "experiment corpus case names");
  const cases = names.map((caseName) => {
    const [corpusValue, id, ...extra] = caseName.split("/");
    const corpus = member(corpusValue, CASE_CORPORA, `experiment case ${caseName} corpus`);
    if (extra.length > 0) {
      throw new Error(`experiment case ${caseName} must be nested directly under its corpus`);
    }
    assertExperimentCaseName(caseName, corpus, `experiment case ${caseName}`);
    return { caseName, sha256: hashPathTree(join(root, corpus, id!)) };
  });
  const aliases = join(root, "case-aliases.json");
  return canonicalJsonSha256({
    schemaVersion: 1,
    aliases: existsSync(aliases) ? hashPathTree(aliases) : absentInputSha256("case aliases"),
    cases,
  });
}

/** Builds and deeply freezes a self-authenticating immutable manifest value. */
export function buildExperimentManifest(input: BuildExperimentManifestInput): ExperimentManifest {
  const body = parseManifestBody({ schemaVersion: 1, ...input }, "experiment manifest input");
  const experimentId = canonicalJsonSha256(body);
  return deepFreeze({ ...body, experimentId });
}

export function parseExperimentManifest(
  value: unknown,
  source = "experiment manifest",
): ExperimentManifest {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "schemaVersion",
    "experimentId",
    "createdAt",
    "repositoryCommit",
    "protocol",
    "evidenceClass",
    "hashes",
    "models",
    "runtime",
    "schedule",
    "lineage",
  ]), source);
  const experimentId = hash(root.experimentId, `${source}.experimentId`);
  const body = parseManifestBody(root, source);
  const expected = canonicalJsonSha256(body);
  if (experimentId !== expected) throw new Error(`${source}.experimentId does not authenticate its contents`);
  const parsed = { ...body, experimentId };
  assertNoSecrets(parsed, `${source} artifact`);
  return deepFreeze(parsed);
}

/**
 * Evaluates persisted attempts in schedule order. A zero provider-spend limit
 * therefore prevents the first live call while still allowing mock smoke.
 */
export function evaluateExperimentCeilings(input: {
  protocol: ExperimentProtocol;
  schedule: readonly ExperimentScheduledAttempt[];
  records: readonly RunRecord[];
  /** Attempt IDs with a durable provider-started marker. */
  providerStartedAttemptIds: readonly string[];
}): ExperimentCeilingDecision {
  // Keep this evaluator pure so preregistered limits can be checked before each
  // contained provider attempt and tested without contacting a provider.
  const protocol = parseExperimentProtocolValue(input.protocol, "experiment protocol");
  const limits = protocol.limits;
  const schedule = input.schedule.map((item, index) => parseScheduledAttempt(item, `schedule[${index}]`));
  const scheduleById = new Map(schedule.map((attempt) => [attempt.id, attempt]));
  const providerStartedAttemptIds = input.providerStartedAttemptIds.map((id, index) =>
    attemptId(id, `providerStartedAttemptIds[${index}]`));
  unique(providerStartedAttemptIds, "providerStartedAttemptIds");
  const providerStarted = new Set(providerStartedAttemptIds);
  for (const id of providerStarted) {
    const attempt = scheduleById.get(id);
    if (!attempt) throw new Error(`provider-started attempt ${id} is not scheduled`);
    if (attempt.runner === "mock") throw new Error(`mock attempt ${id} cannot have a provider-started marker`);
  }
  const recordsById = new Map<string, RunRecord>();
  for (const record of input.records) {
    if (recordsById.has(record.attemptId)) throw new Error(`duplicate persisted attempt ${record.attemptId}`);
    const expected = scheduleById.get(record.attemptId);
    if (!expected) throw new Error(`persisted attempt ${record.attemptId} is not scheduled`);
    for (const [field, actual, wanted] of [
      ["caseName", record.caseName, expected.caseName],
      ["caseCorpus", record.caseCorpus, expected.corpus],
      ["configName", record.configName, expected.configName],
      ["repeat", record.repeat, expected.repeat],
      ["runner", record.runner, expected.runner],
    ] as const) {
      if (actual !== wanted) throw new Error(`persisted attempt ${record.attemptId} ${field} does not match its schedule`);
    }
    if (record.runner !== "mock" &&
      (record.outcome.status === "completed" || record.outcome.telemetry !== undefined) &&
      !providerStarted.has(record.attemptId)) {
      throw new Error(`persisted provider work ${record.attemptId} is missing its provider-started marker`);
    }
    integer(record.attemptDurationMs, `${record.attemptId}.attemptDurationMs`, 0, Number.MAX_SAFE_INTEGER);
    recordsById.set(record.attemptId, record);
  }
  const completedPrefix: RunRecord[] = [];
  let next: ExperimentScheduledAttempt | undefined;
  for (const attempt of schedule) {
    const record = recordsById.get(attempt.id);
    if (!record) {
      next = attempt;
      break;
    }
    completedPrefix.push(record);
  }
  if (recordsById.size !== completedPrefix.length) {
    throw new Error("persisted attempts must form a contiguous prefix of the immutable schedule");
  }
  for (const id of providerStarted) {
    if (!recordsById.has(id)) {
      throw new Error(`provider-started attempt ${id} has no terminal record and must not be resumed`);
    }
  }

  const costUnavailableAttemptIds: string[] = [];
  let providerCostUsd = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let wallTimeMs = 0;
  for (const record of completedPrefix) {
    wallTimeMs += record.attemptDurationMs;
    if (record.outcome.status === "failed") {
      failures++;
      consecutiveFailures++;
    } else {
      consecutiveFailures = 0;
    }
    if (record.runner === "mock" || !providerStarted.has(record.attemptId)) continue;
    const cost = record.outcome.status === "completed"
      ? record.outcome.result.usage.costUsd
      : record.outcome.telemetry?.usage.costUsd;
    if (cost === undefined) costUnavailableAttemptIds.push(record.attemptId);
    else providerCostUsd += finiteNumber(cost, `${record.attemptId} provider cost`, 0);
  }
  const attempts = completedPrefix.length;
  const observed: ExperimentCeilingObserved = {
    attempts,
    providerAttempts: [...providerStarted].filter((id) => recordsById.has(id)).length,
    failures,
    failureRate: attempts === 0 ? 0 : failures / attempts,
    consecutiveFailures,
    providerCostUsd,
    wallTimeMs,
    costUnavailableAttemptIds,
  };
  if (!next) return { stop: false, observed };

  const providerCallNext = next.runner !== "mock";
  const completedPrefixEndsAtBlockBoundary =
    attempts > 0 && schedule[attempts - 1]?.blockId !== next.blockId;
  const reason = providerCallNext && protocol.providerCalls === "deny"
    ? "provider-calls-denied"
    : providerCallNext && observed.providerAttempts >= limits.maxProviderAttempts
      ? "provider-attempt-ceiling"
      : providerCallNext &&
          (protocol.costAccounting === "required" || limits.maxProviderCostUsd !== null) &&
          costUnavailableAttemptIds.length > 0
        ? "provider-cost-unavailable"
        : providerCallNext && limits.maxProviderCostUsd !== null && providerCostUsd >= limits.maxProviderCostUsd
          ? "provider-cost-ceiling"
        : wallTimeMs >= limits.maxWallTimeMs
          ? "wall-time-ceiling"
          : consecutiveFailures >= limits.maxConsecutiveFailures
            ? "consecutive-failure-ceiling"
            : completedPrefixEndsAtBlockBoundary &&
                attempts >= limits.minAttemptsForFailureRate &&
                observed.failureRate > limits.maxFailureRate
              ? "failure-rate-ceiling"
              : undefined;
  return reason
    ? { stop: true, reason, beforeAttemptId: next.id, observed }
    : { stop: false, beforeAttemptId: next.id, observed };
}

export function attemptStartedFile(attemptIdValue: string): string {
  return `state/${attemptId(attemptIdValue, "attempt id")}.started.json`;
}

export function providerStartedFile(attemptIdValue: string): string {
  return `state/${attemptId(attemptIdValue, "attempt id")}.provider-started.json`;
}

export function parseExperimentAttemptStartedRecord(
  value: unknown,
  source = "experiment attempt-started record",
): ExperimentAttemptStartedRecord {
  const root = object(value, source);
  onlyKeys(root, new Set(["schemaVersion", "experimentId", "attemptId", "startedAt"]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const parsed = {
    schemaVersion: 1 as const,
    experimentId: hash(root.experimentId, `${source}.experimentId`),
    attemptId: attemptId(root.attemptId, `${source}.attemptId`),
    startedAt: isoDate(root.startedAt, `${source}.startedAt`),
  };
  assertNoSecrets(parsed, `${source} artifact`);
  return deepFreeze(parsed);
}

export function parseExperimentProviderStartedRecord(
  value: unknown,
  source = "experiment provider-started record",
): ExperimentProviderStartedRecord {
  const root = object(value, source);
  onlyKeys(root, new Set(["schemaVersion", "experimentId", "attemptId", "providerStartedAt"]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const parsed = {
    schemaVersion: 1 as const,
    experimentId: hash(root.experimentId, `${source}.experimentId`),
    attemptId: attemptId(root.attemptId, `${source}.attemptId`),
    providerStartedAt: isoDate(root.providerStartedAt, `${source}.providerStartedAt`),
  };
  assertNoSecrets(parsed, `${source} artifact`);
  return deepFreeze(parsed);
}

export function buildExperimentStopRecord(input: {
  experimentId: string;
  recordedAt: string;
  decision: ExperimentCeilingDecision;
  limits: ExperimentProtocol["limits"];
}): ExperimentStopRecord {
  if (!input.decision.stop || !input.decision.reason || !input.decision.beforeAttemptId) {
    throw new Error("an experiment stop record requires a terminal ceiling decision");
  }
  return parseExperimentStopRecord({
    schemaVersion: 1,
    experimentId: input.experimentId,
    recordedAt: input.recordedAt,
    reason: input.decision.reason,
    beforeAttemptId: input.decision.beforeAttemptId,
    observed: input.decision.observed,
    limits: input.limits,
  });
}

export function parseExperimentStopRecord(
  value: unknown,
  source = "experiment stop record",
): ExperimentStopRecord {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "schemaVersion",
    "experimentId",
    "recordedAt",
    "reason",
    "beforeAttemptId",
    "observed",
    "limits",
  ]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const experimentId = hash(root.experimentId, `${source}.experimentId`);
  const recordedAt = isoDate(root.recordedAt, `${source}.recordedAt`);
  const reason = member(root.reason, STOP_REASONS, `${source}.reason`);
  const beforeAttemptId = attemptId(root.beforeAttemptId, `${source}.beforeAttemptId`);
  const observed = parseCeilingObserved(root.observed, `${source}.observed`);
  const limits = parseExperimentLimits(root.limits, `${source}.limits`);
  if (reason === "provider-cost-unavailable" && observed.costUnavailableAttemptIds.length === 0) {
    throw new Error(`${source}: provider-cost-unavailable requires an affected attempt`);
  }
  if (reason === "provider-attempt-ceiling" && observed.providerAttempts < limits.maxProviderAttempts) {
    throw new Error(`${source}: provider-attempt-ceiling is not supported by observed attempts`);
  }
  if (reason === "provider-cost-ceiling" && (
    limits.maxProviderCostUsd === null || observed.providerCostUsd < limits.maxProviderCostUsd
  )) {
    throw new Error(`${source}: provider-cost-ceiling is not supported by observed spend`);
  }
  if (reason === "wall-time-ceiling" && observed.wallTimeMs < limits.maxWallTimeMs) {
    throw new Error(`${source}: wall-time-ceiling is not supported by observed duration`);
  }
  if (reason === "failure-rate-ceiling" && (
    observed.attempts < limits.minAttemptsForFailureRate ||
    observed.failureRate <= limits.maxFailureRate
  )) {
    throw new Error(`${source}: failure-rate-ceiling is not supported by observed failures`);
  }
  if (reason === "consecutive-failure-ceiling" &&
    observed.consecutiveFailures < limits.maxConsecutiveFailures) {
    throw new Error(`${source}: consecutive-failure-ceiling is not supported by observed failures`);
  }
  const parsed = {
    schemaVersion: 1 as const,
    experimentId,
    recordedAt,
    reason,
    beforeAttemptId,
    observed,
    limits,
  };
  assertNoSecrets(parsed, `${source} artifact`);
  return deepFreeze(parsed);
}

function parseManifestBody(value: unknown, source: string): Omit<ExperimentManifest, "experimentId"> {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "schemaVersion",
    "createdAt",
    "repositoryCommit",
    "protocol",
    "evidenceClass",
    "hashes",
    "models",
    "runtime",
    "schedule",
    "lineage",
    "experimentId",
  ]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const createdAt = isoDate(root.createdAt, `${source}.createdAt`);
  const repositoryCommit = boundedString(root.repositoryCommit, `${source}.repositoryCommit`);
  if (!GIT_OID.test(repositoryCommit)) throw new Error(`${source}.repositoryCommit must be a full Git object ID`);
  const protocol = parseExperimentProtocol(root.protocol, `${source}.protocol`);
  const evidenceClass = root.evidenceClass === undefined
    ? undefined
    : member(root.evidenceClass, EXPERIMENT_EVIDENCE_CLASSES, `${source}.evidenceClass`);
  if (protocol.mode === "visible-checkpoint" && evidenceClass === undefined) {
    throw new Error(`${source}: visible-checkpoint must bind its evidence class`);
  }
  if (protocol.mode !== "visible-checkpoint" && evidenceClass !== undefined) {
    throw new Error(`${source}: evidenceClass is supported only for visible-checkpoint`);
  }
  const hashes = parseHashes(root.hashes, `${source}.hashes`);
  const models = array(root.models, `${source}.models`).map((item, index) =>
    parseModelIdentity(item, `${source}.models[${index}]`));
  if (models.length === 0) throw new Error(`${source}.models must not be empty`);
  unique(models.map((model) => model.configName), `${source}.models configName`);
  models.sort((left, right) => compareText(left.configName, right.configName));
  const runtime = parseRuntime(root.runtime, `${source}.runtime`);
  const schedule = array(root.schedule, `${source}.schedule`).map((item, index) =>
    parseScheduledAttempt(item, `${source}.schedule[${index}]`));
  const lineage = root.lineage === undefined ? undefined : parseLineage(root.lineage, `${source}.lineage`);
  validateSchedule(schedule, protocol, lineage);
  const modelNames = new Set(models.map((model) => model.configName));
  const modelByName = new Map(models.map((model) => [model.configName, model]));
  for (const attempt of schedule) {
    if (!modelNames.has(attempt.configName)) throw new Error(`${source}: schedule references an unrecorded model config`);
    if (modelByName.get(attempt.configName)?.runner !== attempt.runner) {
      throw new Error(`${source}: schedule runner does not match its model identity`);
    }
  }
  const runners = new Set(models.map((model) => model.runner));
  if (protocol.judge.kind !== "exact") runners.add(protocol.judge.kind);
  validateRuntimeRunners(runtime, runners, source);
  validateRuntimeProtocol(runtime, protocol, source);
  const parsed = {
    schemaVersion: 1 as const,
    createdAt,
    repositoryCommit,
    protocol,
    ...(evidenceClass === undefined ? {} : { evidenceClass }),
    hashes,
    models,
    runtime,
    schedule,
    ...(lineage === undefined ? {} : { lineage }),
  };
  assertNoSecrets(parsed, `${source} artifact`);
  return parsed;
}

function validateModeInputs(
  protocol: ExperimentProtocol,
  cases: readonly ExperimentCase[],
  configs: readonly MatrixModelConfig[],
): void {
  if (protocol.mode === "structural-smoke") {
    if (configs.length !== 1 || configs[0]?.runner !== "mock") {
      throw new Error("structural-smoke requires exactly one mock config");
    }
    if (cases.some((item) => item.corpus !== "structural-smoke")) {
      throw new Error("structural-smoke may only schedule structural-smoke cases");
    }
    return;
  }
  if (configs.length !== 2) throw new Error(`${protocol.mode} requires exactly two configs`);
  const control = configs.find((item) => item.name === protocol.control);
  const treatment = configs.find((item) => item.name === protocol.treatment);
  if (!control || !treatment) throw new Error("control and treatment must name the two matrix configs");
  if (control.runner !== treatment.runner) {
    throw new Error("control and treatment must use the same provider runner");
  }
  if (protocol.mode === "screening" && cases.some((item) => item.corpus !== "development")) {
    throw new Error("screening may only schedule development cases");
  }
  if ((protocol.mode === "visible-checkpoint" || protocol.mode === "checkpoint") &&
    cases.some((item) => item.corpus === "structural-smoke")) {
    throw new Error(`${protocol.mode} may only schedule development and validation cases`);
  }
}

function scheduleAttempt(input: {
  sequence: number;
  blockId: string;
  block: { caseItem: ExperimentCase; repeat: number };
  config: MatrixModelConfig;
  variant: ExperimentVariant;
  position: 1 | 2;
}): ExperimentScheduledAttempt {
  const id = `attempt-${String(input.sequence).padStart(6, "0")}`;
  return {
    id,
    blockId: input.blockId,
    sequence: input.sequence,
    caseName: input.block.caseItem.caseName,
    corpus: input.block.caseItem.corpus,
    expectedBugCount: input.block.caseItem.expectedBugCount,
    configName: input.config.name,
    repeat: input.block.repeat,
    runner: input.config.runner,
    variant: input.variant,
    position: input.position,
    file: `${id}.json`,
  };
}

function validateSchedule(
  schedule: readonly ExperimentScheduledAttempt[],
  protocol: ExperimentProtocol,
  lineage?: ExperimentLineage,
): void {
  unique(schedule.map((attempt) => attempt.id), "experiment schedule attempt id");
  unique(schedule.map((attempt) => attempt.file), "experiment schedule file");
  for (const [index, attempt] of schedule.entries()) {
    if (attempt.sequence !== index + 1) throw new Error("experiment schedule sequence must be contiguous");
  }
  if (lineage) {
    if (schedule.length !== 1 || !schedule[0]?.retryOf) {
      throw new Error("a retry experiment must contain exactly one linked attempt");
    }
    if (canonicalJson(schedule[0].retryOf) !== canonicalJson(lineage.source)) {
      throw new Error("retry schedule linkage must match experiment lineage");
    }
    return;
  }
  if (schedule.some((attempt) => attempt.retryOf !== undefined)) {
    throw new Error("ordinary experiment schedules must not contain retry linkage");
  }
  const groups = new Map<string, ExperimentScheduledAttempt[]>();
  for (const attempt of schedule) {
    const group = groups.get(attempt.blockId) ?? [];
    group.push(attempt);
    groups.set(attempt.blockId, group);
  }
  if (protocol.mode === "structural-smoke") {
    for (const block of groups.values()) {
      if (block.length !== 1 || block[0]?.variant !== "structural" || block[0].position !== 1) {
        throw new Error("each structural-smoke block must contain one structural attempt");
      }
      if (block[0].runner !== "mock") throw new Error("structural-smoke attempts must use the mock runner");
    }
    return;
  }
  let controlFirst = 0;
  let treatmentFirst = 0;
  for (const block of groups.values()) {
    if (block.length !== 2) throw new Error("each paired block must contain exactly two attempts");
    const ordered = [...block].sort((left, right) => left.position - right.position);
    const [first, second] = ordered;
    if (!first || !second || first.position !== 1 || second.position !== 2) {
      throw new Error("paired block positions must be 1 and 2");
    }
    if (first.caseName !== second.caseName || first.corpus !== second.corpus || first.repeat !== second.repeat) {
      throw new Error("paired block variants must share one case and repeat");
    }
    if (first.runner !== second.runner) throw new Error("paired block variants must share one provider runner");
    const variants = new Set([first.variant, second.variant]);
    if (!variants.has("control") || !variants.has("treatment")) {
      throw new Error("paired block must contain one control and one treatment");
    }
    const control = first.variant === "control" ? first : second;
    const treatment = first.variant === "treatment" ? first : second;
    if (control.configName !== protocol.control || treatment.configName !== protocol.treatment) {
      throw new Error("paired block variants must use the declared control and treatment configs");
    }
    if (first.variant === "control") controlFirst++;
    else treatmentFirst++;
  }
  if (Math.abs(controlFirst - treatmentFirst) > 1) {
    throw new Error("control/treatment first position must be balanced");
  }
}

function parseScheduledAttempt(value: unknown, source: string): ExperimentScheduledAttempt {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "id", "blockId", "sequence", "caseName", "corpus", "expectedBugCount", "configName",
    "repeat", "runner", "variant", "position", "file", "retryOf",
  ]), source);
  const id = attemptId(root.id, `${source}.id`);
  const blockId = boundedString(root.blockId, `${source}.blockId`);
  if (!BLOCK_ID.test(blockId)) throw new Error(`${source}.blockId has an invalid format`);
  const sequence = integer(root.sequence, `${source}.sequence`, 1, Number.MAX_SAFE_INTEGER);
  const caseName = boundedString(root.caseName, `${source}.caseName`);
  const corpus = member(root.corpus, CASE_CORPORA, `${source}.corpus`);
  assertExperimentCaseName(caseName, corpus, `${source}.caseName`);
  const expectedBugCount = root.expectedBugCount === null
    ? null
    : integer(root.expectedBugCount, `${source}.expectedBugCount`, 0, Number.MAX_SAFE_INTEGER);
  const configName = boundedString(root.configName, `${source}.configName`);
  const repeat = integer(root.repeat, `${source}.repeat`, 1, Number.MAX_SAFE_INTEGER);
  const runner = member(root.runner, RUNNER_NAMES, `${source}.runner`);
  const variant = member(root.variant, ["structural", "control", "treatment"] as const, `${source}.variant`);
  const position = integer(root.position, `${source}.position`, 1, 2) as 1 | 2;
  const file = boundedString(root.file, `${source}.file`);
  if (file !== `${id}.json`) throw new Error(`${source}.file must be the canonical attempt filename`);
  const retryOf = root.retryOf === undefined ? undefined : parseAttemptReference(root.retryOf, `${source}.retryOf`);
  return {
    id,
    blockId,
    sequence,
    caseName,
    corpus,
    expectedBugCount,
    configName,
    repeat,
    runner,
    variant,
    position,
    file,
    ...(retryOf === undefined ? {} : { retryOf }),
  };
}

function parseExperimentCase(value: unknown, source: string): ExperimentCase {
  const root = object(value, source);
  onlyKeys(root, new Set(["caseName", "corpus", "expectedBugCount"]), source);
  const caseName = boundedString(root.caseName, `${source}.caseName`);
  const corpus = member(root.corpus, CASE_CORPORA, `${source}.corpus`);
  assertExperimentCaseName(caseName, corpus, `${source}.caseName`);
  return {
    caseName,
    corpus,
    expectedBugCount: root.expectedBugCount === null
      ? null
      : integer(root.expectedBugCount, `${source}.expectedBugCount`, 0, Number.MAX_SAFE_INTEGER),
  };
}

function assertExperimentCaseName(
  caseName: string,
  corpus: CaseCorpus,
  source: string,
): void {
  const prefix = `${corpus}/`;
  const id = caseName.startsWith(prefix) ? caseName.slice(prefix.length) : "";
  if (!OPAQUE_CASE_ID.test(id)) {
    throw new Error(`${source} must be an opaque case nested directly under ${corpus}`);
  }
}

function parseMatrixConfig(value: unknown, source: string): MatrixModelConfig {
  const root = object(value, source);
  onlyKeys(root, new Set(["name", "runner", "overrides"]), source);
  const name = boundedString(root.name, `${source}.name`);
  const runner = member(root.runner, RUNNER_NAMES, `${source}.runner`);
  if (root.overrides !== undefined) object(root.overrides, `${source}.overrides`);
  return { name, runner, ...(root.overrides === undefined ? {} : { overrides: root.overrides as Record<string, unknown> }) };
}

function parseHashes(value: unknown, source: string): ExperimentHashes {
  const root = object(value, source);
  const keys = [
    "repositorySha256",
    "corpusSha256",
    "promptSha256",
    "methodSha256",
    "schemaSha256",
    "profileSha256",
    "judgeSha256",
    "matrixManifestSha256",
    "matrixConfigSha256",
    "peregrineConfigSha256",
    "configurationSha256",
  ] as const;
  onlyKeys(root, new Set(keys), source);
  return Object.fromEntries(keys.map((key) => [key, hash(root[key], `${source}.${key}`)])) as unknown as ExperimentHashes;
}

function parseModelIdentity(value: unknown, source: string): ExperimentModelIdentity {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "configName", "runner", "effectiveConfigSha256", "breadthModel", "breadthEffort",
    "investigationModel", "investigationEffort", "investigationPromptMode", "breadthLedgerMode",
  ]), source);
  const runner = member(root.runner, RUNNER_NAMES, `${source}.runner`);
  const parsed: ExperimentModelIdentity = {
    configName: boundedString(root.configName, `${source}.configName`),
    runner,
    effectiveConfigSha256: hash(root.effectiveConfigSha256, `${source}.effectiveConfigSha256`),
  };
  for (const key of ["breadthModel", "breadthEffort", "investigationModel", "investigationEffort"] as const) {
    const item = optionalBoundedString(root[key], `${source}.${key}`);
    if (item !== undefined) parsed[key] = item;
  }
  if (root.investigationPromptMode !== undefined) {
    parsed.investigationPromptMode = member(
      root.investigationPromptMode,
      INVESTIGATION_PROMPT_MODES,
      `${source}.investigationPromptMode`,
    );
  }
  if (root.breadthLedgerMode !== undefined) {
    parsed.breadthLedgerMode = member(
      root.breadthLedgerMode,
      BREADTH_LEDGER_MODES,
      `${source}.breadthLedgerMode`,
    );
  }
  const stagesPresent = parsed.breadthModel !== undefined && parsed.breadthEffort !== undefined &&
    parsed.investigationModel !== undefined && parsed.investigationEffort !== undefined;
  if (runner === "mock" && Object.keys(parsed).length !== 3) {
    throw new Error(`${source}: mock model identity must not invent provider stages`);
  }
  if (runner !== "mock" && !stagesPresent) {
    throw new Error(`${source}: provider model identity requires exact models and efforts for both stages`);
  }
  return parsed;
}

function parseRuntime(value: unknown, source: string): ExperimentRuntime {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "observedAt", "nodeVersion", "platform", "arch", "cliVersions", "providerAvailability",
  ]), source);
  const cliVersions = array(root.cliVersions, `${source}.cliVersions`).map((item, index) => {
    const record = object(item, `${source}.cliVersions[${index}]`);
    onlyKeys(record, new Set(["runner", "status", "version"]), `${source}.cliVersions[${index}]`);
    const runner = member(record.runner, RUNNER_NAMES, `${source}.cliVersions[${index}].runner`);
    const status = member(record.status, CLI_VERSION_STATUSES, `${source}.cliVersions[${index}].status`);
    const version = optionalBoundedString(record.version, `${source}.cliVersions[${index}].version`);
    if (status === "observed" && version === undefined) throw new Error(`${source}: observed CLI needs a version`);
    if (status !== "observed" && version !== undefined) throw new Error(`${source}: unavailable CLI must not invent a version`);
    return { runner, status, ...(version === undefined ? {} : { version }) };
  });
  const providerAvailability = array(root.providerAvailability, `${source}.providerAvailability`).map((item, index) => {
    const record = object(item, `${source}.providerAvailability[${index}]`);
    onlyKeys(record, new Set(["runner", "status"]), `${source}.providerAvailability[${index}]`);
    return {
      runner: member(record.runner, RUNNER_NAMES, `${source}.providerAvailability[${index}].runner`),
      status: member(record.status, PROVIDER_AVAILABILITY_STATUSES, `${source}.providerAvailability[${index}].status`),
    };
  });
  unique(cliVersions.map((item) => item.runner), `${source}.cliVersions runner`);
  unique(providerAvailability.map((item) => item.runner), `${source}.providerAvailability runner`);
  cliVersions.sort((left, right) => compareText(left.runner, right.runner));
  providerAvailability.sort((left, right) => compareText(left.runner, right.runner));
  return {
    observedAt: isoDate(root.observedAt, `${source}.observedAt`),
    nodeVersion: boundedString(root.nodeVersion, `${source}.nodeVersion`),
    platform: boundedString(root.platform, `${source}.platform`),
    arch: boundedString(root.arch, `${source}.arch`),
    cliVersions,
    providerAvailability,
  };
}

function validateRuntimeRunners(runtime: ExperimentRuntime, runners: ReadonlySet<RunnerName>, source: string): void {
  const cliRunners = new Set(runtime.cliVersions.map((item) => item.runner));
  const providerRunners = new Set(runtime.providerAvailability.map((item) => item.runner));
  for (const runner of runners) {
    if (!cliRunners.has(runner) || !providerRunners.has(runner)) {
      throw new Error(`${source}.runtime must record CLI and provider availability for ${runner}`);
    }
  }
  for (const item of runtime.cliVersions) {
    if (!runners.has(item.runner)) throw new Error(`${source}.runtime records an unused runner`);
  }
  for (const item of runtime.providerAvailability) {
    if (!runners.has(item.runner)) throw new Error(`${source}.runtime records an unused runner`);
  }
}

function validateRuntimeProtocol(
  runtime: ExperimentRuntime,
  protocol: ExperimentProtocol,
  source: string,
): void {
  const cliByRunner = new Map(runtime.cliVersions.map((item) => [item.runner, item]));
  for (const availability of runtime.providerAvailability) {
    const cli = cliByRunner.get(availability.runner);
    if (!cli) throw new Error(`${source}.runtime is missing CLI status for ${availability.runner}`);
    if (availability.runner === "mock") {
      if (availability.status !== "not-applicable" || cli.status !== "not-applicable") {
        throw new Error(`${source}.runtime mock availability must be not-applicable`);
      }
      continue;
    }
    if (cli.status === "not-applicable" || availability.status === "not-applicable") {
      throw new Error(`${source}.runtime live provider availability cannot be not-applicable`);
    }
    if (protocol.providerCalls === "deny") {
      if (availability.status !== "denied") {
        throw new Error(`${source}.runtime denied protocol must record denied provider availability`);
      }
      continue;
    }
    if (availability.status === "denied") {
      throw new Error(`${source}.runtime allowed protocol cannot record denied provider availability`);
    }
    if (availability.status === "missing-cli" && cli.status !== "unavailable") {
      throw new Error(`${source}.runtime missing-cli availability conflicts with observed CLI version`);
    }
    if ((availability.status === "configured" || availability.status === "missing-credential") &&
      cli.status !== "observed") {
      throw new Error(`${source}.runtime ${availability.status} availability requires an observed CLI version`);
    }
  }
}

function parseLineage(value: unknown, source: string): ExperimentLineage {
  const root = object(value, source);
  onlyKeys(root, new Set(["kind", "source"]), source);
  if (root.kind !== "retry") throw new Error(`${source}.kind must be retry`);
  return { kind: "retry", source: parseAttemptReference(root.source, `${source}.source`) };
}

function parseAttemptReference(value: unknown, source: string): ExperimentAttemptReference {
  const root = object(value, source);
  onlyKeys(root, new Set(["experimentId", "manifestSha256", "attemptId", "evidenceSha256"]), source);
  return {
    experimentId: hash(root.experimentId, `${source}.experimentId`),
    manifestSha256: hash(root.manifestSha256, `${source}.manifestSha256`),
    attemptId: attemptId(root.attemptId, `${source}.attemptId`),
    evidenceSha256: hash(root.evidenceSha256, `${source}.evidenceSha256`),
  };
}

function parseExperimentLimits(value: unknown, source: string): ExperimentProtocol["limits"] {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "maxProviderCostUsd",
    "maxProviderAttempts",
    "maxWallTimeMs",
    "maxFailureRate",
    "minAttemptsForFailureRate",
    "maxConsecutiveFailures",
  ]), source);
  return {
    maxProviderCostUsd: root.maxProviderCostUsd === null
      ? null
      : finiteNumber(root.maxProviderCostUsd, `${source}.maxProviderCostUsd`, 0),
    maxProviderAttempts: integer(
      root.maxProviderAttempts,
      `${source}.maxProviderAttempts`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    maxWallTimeMs: integer(root.maxWallTimeMs, `${source}.maxWallTimeMs`, 0, Number.MAX_SAFE_INTEGER),
    maxFailureRate: finiteNumber(root.maxFailureRate, `${source}.maxFailureRate`, 0, 1),
    minAttemptsForFailureRate: integer(
      root.minAttemptsForFailureRate,
      `${source}.minAttemptsForFailureRate`,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    maxConsecutiveFailures: integer(
      root.maxConsecutiveFailures,
      `${source}.maxConsecutiveFailures`,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function parseCeilingObserved(value: unknown, source: string): ExperimentCeilingObserved {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "attempts",
    "providerAttempts",
    "failures",
    "failureRate",
    "consecutiveFailures",
    "providerCostUsd",
    "wallTimeMs",
    "costUnavailableAttemptIds",
  ]), source);
  const attempts = integer(root.attempts, `${source}.attempts`, 0, Number.MAX_SAFE_INTEGER);
  const providerAttempts = integer(
    root.providerAttempts,
    `${source}.providerAttempts`,
    0,
    attempts,
  );
  const failures = integer(root.failures, `${source}.failures`, 0, attempts);
  const failureRate = finiteNumber(root.failureRate, `${source}.failureRate`, 0, 1);
  const expectedRate = attempts === 0 ? 0 : failures / attempts;
  if (failureRate !== expectedRate) throw new Error(`${source}.failureRate does not match attempts and failures`);
  const consecutiveFailures = integer(
    root.consecutiveFailures,
    `${source}.consecutiveFailures`,
    0,
    failures,
  );
  const ids = array(root.costUnavailableAttemptIds, `${source}.costUnavailableAttemptIds`)
    .map((item, index) => attemptId(item, `${source}.costUnavailableAttemptIds[${index}]`));
  unique(ids, `${source}.costUnavailableAttemptIds`);
  return {
    attempts,
    providerAttempts,
    failures,
    failureRate,
    consecutiveFailures,
    providerCostUsd: finiteNumber(root.providerCostUsd, `${source}.providerCostUsd`, 0),
    wallTimeMs: integer(root.wallTimeMs, `${source}.wallTimeMs`, 0, Number.MAX_SAFE_INTEGER),
    costUnavailableAttemptIds: ids,
  };
}

function canonicalValue(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new Error(`${path} contains a non-JSON value`);
  if (seen.has(value)) throw new Error(`${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!(index in value)) throw new Error(`${path} contains a sparse array`);
      }
      return `[${value.map((item, index) => canonicalValue(item, `${path}[${index}]`, seen)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} contains a non-plain object`);
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareText).map((key) =>
      `${JSON.stringify(key)}:${canonicalValue(record[key], `${path}.${key}`, seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function seededRandom(seed: number): () => number {
  let state = seed === 0 ? 0x9e37_79b9 : seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffle<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index--) {
    const selected = Math.floor(random() * (index + 1));
    [values[index], values[selected]] = [values[selected]!, values[index]!];
  }
}

function assertPathComponentsAreNotSymlinks(path: string): void {
  const absolute = resolve(path);
  const parsedRoot = resolve(sep);
  const suffix = relative(parsedRoot, absolute);
  let current = parsedRoot;
  for (const component of suffix.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`hash input path contains a symbolic link: ${current}`);
  }
}

function normalizeExclusions(values: readonly string[]): string[] {
  const normalized = values.map((item, index) => {
    if (typeof item !== "string" || item.length === 0 || isAbsolute(item)) {
      throw new Error(`excludeRelativePaths[${index}] must be a non-empty relative path`);
    }
    const candidate = item.split(sep).join("/").replace(/^\.\//, "").replace(/\/$/, "");
    if (candidate === "." || candidate.split("/").some((part) => part === "" || part === "..")) {
      throw new Error(`excludeRelativePaths[${index}] must not traverse or identify the root`);
    }
    return candidate;
  });
  unique(normalized, "excludeRelativePaths");
  return normalized.sort(compareText);
}

function isExcluded(path: string, exclusions: readonly string[]): boolean {
  return exclusions.some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function object(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, source: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${source} must be an array`);
  return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, source: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${source} contains unsupported field ${unexpected[0]}`);
}

function boundedString(value: unknown, source: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new Error(`${source} must be a non-empty bounded single-line string`);
  }
  return value;
}

function optionalBoundedString(value: unknown, source: string): string | undefined {
  return value === undefined ? undefined : boundedString(value, source);
}

function integer(value: unknown, source: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${source} must be an integer from ${minimum} to ${maximum}`);
  }
  return Number(value);
}

function finiteNumber(value: unknown, source: string, minimum: number, maximum = Number.MAX_VALUE): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${source} must be a finite number from ${minimum} to ${maximum}`);
  }
  return value;
}

function member<const T extends readonly string[]>(value: unknown, choices: T, source: string): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new Error(`${source} must be one of: ${choices.join(", ")}`);
  }
  return value as T[number];
}

function hash(value: unknown, source: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${source} must be a lowercase SHA-256`);
  return value;
}

function attemptId(value: unknown, source: string): string {
  const parsed = boundedString(value, source);
  if (!ATTEMPT_ID.test(parsed)) throw new Error(`${source} has an invalid format`);
  return parsed;
}

function isoDate(value: unknown, source: string): string {
  const parsed = boundedString(value, source);
  if (new Date(parsed).toISOString() !== parsed) throw new Error(`${source} must be a canonical ISO timestamp`);
  return parsed;
}

function unique(values: readonly string[], source: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${source} values must be unique`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function displayPath(path: string): string {
  return path || ".";
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
