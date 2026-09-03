import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { MatrixRunManifest } from "../src/types.js";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  canonicalJsonSha256,
  writeExclusiveJson,
  type ExperimentManifest,
} from "./experiment.js";
import {
  EXPERIMENT_MANIFEST_FILENAME,
  EXPERIMENT_STOP_FILENAME,
  MATRIX_MANIFEST_FILENAME,
  readExperimentRunEvidence,
  type ExperimentRunEvidence,
} from "./experiment-evidence.js";

export const EXPERIMENT_TERMINAL_SEAL_FILENAME = "experiment-terminal-seal.json";
export const EXPERIMENT_GRADING_SEAL_FILENAME = "experiment-grading-seal.json";

const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_ARTIFACT = /^(?:matrix-manifest\.json|experiment-manifest\.json|experiment-stop\.json|state\/attempt-[0-9]{6}\.(?:started|provider-started)\.json|attempt-[0-9]{6}(?:\.graded)?\.json)$/;

export interface SealedArtifact {
  path: string;
  sha256: string;
}

export interface ExperimentTerminalSeal {
  schemaVersion: 1;
  kind: "experiment-terminal";
  experimentId: string;
  experimentManifestSha256: string;
  terminal: "completed" | "stopped";
  sealedAt: string;
  artifacts: SealedArtifact[];
  sealSha256: string;
}

export interface ExperimentGradingSeal {
  schemaVersion: 1;
  kind: "experiment-grading";
  experimentId: string;
  experimentManifestSha256: string;
  terminalSealSha256: string;
  sealedAt: string;
  artifacts: SealedArtifact[];
  sealSha256: string;
}

export function writeExperimentTerminalSeal(
  runDirectory: string,
  matrix: MatrixRunManifest,
  sealedAt: string,
): ExperimentTerminalSeal {
  const root = resolve(runDirectory);
  const evidence = readExperimentRunEvidence(root, matrix);
  const terminal = terminalKind(evidence);
  const body = {
    schemaVersion: 1 as const,
    kind: "experiment-terminal" as const,
    experimentId: evidence.experiment.experimentId,
    experimentManifestSha256: hashFile(join(root, EXPERIMENT_MANIFEST_FILENAME)),
    terminal,
    sealedAt: parseTimestamp(sealedAt, "terminal seal sealedAt"),
    artifacts: terminalArtifactPaths(evidence).map((path) => ({ path, sha256: hashFile(join(root, path)) })),
  };
  const seal = { ...body, sealSha256: canonicalJsonSha256(body) };
  assertNoSecrets(seal, "experiment terminal seal artifact");
  writeExclusiveJson(root, join(root, EXPERIMENT_TERMINAL_SEAL_FILENAME), seal);
  return seal;
}

export function requireValidExperimentTerminalSeal(
  runDirectory: string,
  matrix: MatrixRunManifest,
): { seal: ExperimentTerminalSeal; evidence: ExperimentRunEvidence } {
  const root = resolve(runDirectory);
  const path = join(root, EXPERIMENT_TERMINAL_SEAL_FILENAME);
  if (!existsSync(path)) throw new Error("experiment has no terminal seal; resume or retry it before grading or reporting");
  const evidence = readExperimentRunEvidence(root, matrix);
  const seal = parseExperimentTerminalSeal(readJsonFile(path), path);
  const expectedTerminal = terminalKind(evidence);
  assertSealIdentity(seal, evidence.experiment, root, path);
  if (seal.terminal !== expectedTerminal) throw new Error(`${path}.terminal does not match experiment evidence`);
  const lastEvidenceTimestamp = evidence.stop?.recordedAt ?? evidence.records.at(-1)?.finishedAt ?? evidence.experiment.createdAt;
  if (Date.parse(seal.sealedAt) < Date.parse(lastEvidenceTimestamp)) {
    throw new Error(`${path}.sealedAt predates terminal experiment evidence`);
  }
  assertArtifactSet(seal.artifacts, terminalArtifactPaths(evidence), root, path);
  return { seal, evidence };
}

export function writeExperimentGradingSeal(
  runDirectory: string,
  matrix: MatrixRunManifest,
  sealedAt: string,
): ExperimentGradingSeal {
  const root = resolve(runDirectory);
  const { evidence } = requireValidExperimentTerminalSeal(root, matrix);
  const expected = expectedGradePaths(evidence);
  for (const path of expected) {
    if (!existsSync(join(root, path))) throw new Error(`cannot seal incomplete grading; missing ${path}`);
  }
  const body = {
    schemaVersion: 1 as const,
    kind: "experiment-grading" as const,
    experimentId: evidence.experiment.experimentId,
    experimentManifestSha256: hashFile(join(root, EXPERIMENT_MANIFEST_FILENAME)),
    terminalSealSha256: hashFile(join(root, EXPERIMENT_TERMINAL_SEAL_FILENAME)),
    sealedAt: parseTimestamp(sealedAt, "grading seal sealedAt"),
    artifacts: expected.map((path) => ({ path, sha256: hashFile(join(root, path)) })),
  };
  const seal = { ...body, sealSha256: canonicalJsonSha256(body) };
  assertNoSecrets(seal, "experiment grading seal artifact");
  writeExclusiveJson(root, join(root, EXPERIMENT_GRADING_SEAL_FILENAME), seal);
  // The raw terminal seal hash is intentionally part of the grading seal, so
  // validate after persistence against exactly the bytes the reporter reads.
  if (seal.terminalSealSha256 !== hashFile(join(root, EXPERIMENT_TERMINAL_SEAL_FILENAME))) {
    throw new Error("terminal seal changed while grading was sealed");
  }
  return seal;
}

export function requireValidExperimentGradingSeal(
  runDirectory: string,
  matrix: MatrixRunManifest,
): { seal: ExperimentGradingSeal; evidence: ExperimentRunEvidence } {
  const root = resolve(runDirectory);
  const { evidence } = requireValidExperimentTerminalSeal(root, matrix);
  const path = join(root, EXPERIMENT_GRADING_SEAL_FILENAME);
  if (!existsSync(path)) throw new Error("experiment grading is not sealed; run eval:grade first");
  const seal = parseExperimentGradingSeal(readJsonFile(path), path);
  assertSealIdentity(seal, evidence.experiment, root, path);
  if (seal.terminalSealSha256 !== hashFile(join(root, EXPERIMENT_TERMINAL_SEAL_FILENAME))) {
    throw new Error(`${path}.terminalSealSha256 does not match the terminal seal`);
  }
  assertArtifactSet(seal.artifacts, expectedGradePaths(evidence), root, path);
  return { seal, evidence };
}

export function parseExperimentTerminalSeal(value: unknown, source = "experiment terminal seal"): ExperimentTerminalSeal {
  const root = strictObject(value, source);
  onlyKeys(root, ["schemaVersion", "kind", "experimentId", "experimentManifestSha256", "terminal", "sealedAt", "artifacts", "sealSha256"], source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  if (root.kind !== "experiment-terminal") throw new Error(`${source}.kind must be experiment-terminal`);
  if (root.terminal !== "completed" && root.terminal !== "stopped") throw new Error(`${source}.terminal is invalid`);
  const body = {
    schemaVersion: 1 as const,
    kind: "experiment-terminal" as const,
    experimentId: hash(root.experimentId, `${source}.experimentId`),
    experimentManifestSha256: hash(root.experimentManifestSha256, `${source}.experimentManifestSha256`),
    terminal: root.terminal as "completed" | "stopped",
    sealedAt: parseTimestamp(root.sealedAt, `${source}.sealedAt`),
    artifacts: parseArtifacts(root.artifacts, `${source}.artifacts`),
  };
  const sealSha256 = hash(root.sealSha256, `${source}.sealSha256`);
  if (sealSha256 !== canonicalJsonSha256(body)) throw new Error(`${source}.sealSha256 does not authenticate its contents`);
  const parsed = { ...body, sealSha256 };
  assertNoSecrets(parsed, `${source} artifact`);
  return parsed;
}

export function parseExperimentGradingSeal(value: unknown, source = "experiment grading seal"): ExperimentGradingSeal {
  const root = strictObject(value, source);
  onlyKeys(root, ["schemaVersion", "kind", "experimentId", "experimentManifestSha256", "terminalSealSha256", "sealedAt", "artifacts", "sealSha256"], source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  if (root.kind !== "experiment-grading") throw new Error(`${source}.kind must be experiment-grading`);
  const body = {
    schemaVersion: 1 as const,
    kind: "experiment-grading" as const,
    experimentId: hash(root.experimentId, `${source}.experimentId`),
    experimentManifestSha256: hash(root.experimentManifestSha256, `${source}.experimentManifestSha256`),
    terminalSealSha256: hash(root.terminalSealSha256, `${source}.terminalSealSha256`),
    sealedAt: parseTimestamp(root.sealedAt, `${source}.sealedAt`),
    artifacts: parseArtifacts(root.artifacts, `${source}.artifacts`),
  };
  const sealSha256 = hash(root.sealSha256, `${source}.sealSha256`);
  if (sealSha256 !== canonicalJsonSha256(body)) throw new Error(`${source}.sealSha256 does not authenticate its contents`);
  const parsed = { ...body, sealSha256 };
  assertNoSecrets(parsed, `${source} artifact`);
  return parsed;
}

/** Digest for retry lineage: exact source manifest, markers, and terminal evidence for one attempt. */
export function retrySourceEvidenceSha256(
  runDirectory: string,
  experiment: ExperimentManifest,
  attemptId: string,
): string {
  const root = resolve(runDirectory);
  const attempt = experiment.schedule.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`retry source attempt ${attemptId} is not scheduled`);
  const candidates = [
    EXPERIMENT_MANIFEST_FILENAME,
    `state/${attempt.id}.started.json`,
    `state/${attempt.id}.provider-started.json`,
    attempt.file,
  ];
  const artifacts = candidates.filter((path) => existsSync(join(root, path))).map((path) => ({
    path,
    sha256: hashFile(join(root, path)),
  }));
  if (!artifacts.some((item) => item.path === `state/${attempt.id}.started.json`)) {
    throw new Error("retry source attempt was never started");
  }
  return canonicalJsonSha256({ schemaVersion: 1, experimentId: experiment.experimentId, attemptId, artifacts });
}

function terminalKind(evidence: ExperimentRunEvidence): ExperimentTerminalSeal["terminal"] {
  if (evidence.interruptedAttempt) throw new Error(`${evidence.interruptedAttempt.id} is interrupted and cannot be sealed`);
  if (evidence.stop) return "stopped";
  if (evidence.nextAttempt) throw new Error(`${evidence.nextAttempt.id} has no terminal evidence; experiment cannot be sealed`);
  return "completed";
}

function terminalArtifactPaths(evidence: ExperimentRunEvidence): string[] {
  const paths = [MATRIX_MANIFEST_FILENAME, EXPERIMENT_MANIFEST_FILENAME];
  for (const attempt of evidence.experiment.schedule) {
    const started = `state/${attempt.id}.started.json`;
    const provider = `state/${attempt.id}.provider-started.json`;
    if (evidence.startedAttemptIds.includes(attempt.id)) paths.push(started);
    if (evidence.providerStartedAttemptIds.includes(attempt.id)) paths.push(provider);
    if (evidence.records.some((record) => record.attemptId === attempt.id)) paths.push(attempt.file);
  }
  if (evidence.stop) paths.push(EXPERIMENT_STOP_FILENAME);
  return paths.sort(compareText);
}

function expectedGradePaths(evidence: ExperimentRunEvidence): string[] {
  return evidence.records
    .filter((record) => record.outcome.status === "completed")
    .map((record) => evidence.experiment.schedule.find((attempt) => attempt.id === record.attemptId)!.file.replace(/\.json$/, ".graded.json"))
    .sort(compareText);
}

function assertSealIdentity(
  seal: Pick<ExperimentTerminalSeal, "experimentId" | "experimentManifestSha256">,
  experiment: ExperimentManifest,
  root: string,
  source: string,
): void {
  if (seal.experimentId !== experiment.experimentId) throw new Error(`${source}.experimentId does not match the experiment`);
  if (seal.experimentManifestSha256 !== hashFile(join(root, EXPERIMENT_MANIFEST_FILENAME))) {
    throw new Error(`${source}.experimentManifestSha256 does not match the experiment manifest`);
  }
}

function assertArtifactSet(actual: SealedArtifact[], expected: string[], root: string, source: string): void {
  const paths = actual.map((item) => item.path);
  if (JSON.stringify(paths) !== JSON.stringify([...expected].sort(compareText))) {
    throw new Error(`${source}.artifacts does not match the required artifact set`);
  }
  for (const artifact of actual) {
    const observed = hashFile(join(root, artifact.path));
    if (observed !== artifact.sha256) throw new Error(`${artifact.path} does not match its sealed digest`);
  }
}

function parseArtifacts(value: unknown, source: string): SealedArtifact[] {
  if (!Array.isArray(value)) throw new Error(`${source} must be an array`);
  const parsed = value.map((item, index) => {
    const record = strictObject(item, `${source}[${index}]`);
    onlyKeys(record, ["path", "sha256"], `${source}[${index}]`);
    if (typeof record.path !== "string" || !CANONICAL_ARTIFACT.test(record.path)) {
      throw new Error(`${source}[${index}].path is not a canonical experiment artifact`);
    }
    return { path: record.path, sha256: hash(record.sha256, `${source}[${index}].sha256`) };
  });
  const sorted = [...parsed].sort((left, right) => compareText(left.path, right.path));
  if (JSON.stringify(parsed) !== JSON.stringify(sorted)) throw new Error(`${source} must be sorted by path`);
  if (new Set(parsed.map((item) => item.path)).size !== parsed.length) throw new Error(`${source} paths must be unique`);
  return parsed;
}

function hashFile(path: string): string {
  let descriptor: number;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${path} is missing from sealed evidence`);
    }
    throw error;
  }
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(`${path} must be a regular non-symlink file`);
    return createHash("sha256").update(readFileSync(descriptor)).digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function readJsonFile(path: string): unknown {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${path} must be a regular non-symlink file`);
  const descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(`${path} must be a regular non-symlink file`);
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

function strictObject(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  return value as Record<string, unknown>;
}

function onlyKeys(root: Record<string, unknown>, keys: readonly string[], source: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${source} has unknown fields: ${unknown.join(", ")}`);
}

function hash(value: unknown, source: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${source} must be a lowercase SHA-256 digest`);
  return value;
}

function parseTimestamp(value: unknown, source: string): string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error(`${source} must be a canonical timestamp`);
  return value;
}

function compareText(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}
