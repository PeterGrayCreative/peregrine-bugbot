import {
  lstatSync,
  readdirSync,
  type Stats,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { MatrixRunManifest, RunAttempt, RunRecord } from "../src/types.js";
import { parseRunRecord } from "./artifacts.js";
import {
  attemptStartedFile,
  canonicalJson,
  canonicalJsonSha256,
  evaluateExperimentCeilings,
  parseExperimentAttemptStartedRecord,
  parseExperimentManifest,
  parseExperimentProviderStartedRecord,
  readExperimentFile,
  readExperimentJson,
  parseExperimentStopRecord,
  providerStartedFile,
  type ExperimentManifest,
  type ExperimentScheduledAttempt,
  type ExperimentStopRecord,
} from "./experiment.js";

export const MATRIX_MANIFEST_FILENAME = "matrix-manifest.json";
export const EXPERIMENT_MANIFEST_FILENAME = "experiment-manifest.json";
export const EXPERIMENT_STOP_FILENAME = "experiment-stop.json";
export const EXPERIMENT_STATE_DIRECTORY = "state";
export const EXPERIMENT_TERMINAL_SEAL_FILENAME = "experiment-terminal-seal.json";
export const EXPERIMENT_GRADING_SEAL_FILENAME = "experiment-grading-seal.json";

export const EXPERIMENT_METADATA_FILENAMES = Object.freeze({
  matrixManifest: MATRIX_MANIFEST_FILENAME,
  experimentManifest: EXPERIMENT_MANIFEST_FILENAME,
  experimentStop: EXPERIMENT_STOP_FILENAME,
  stateDirectory: EXPERIMENT_STATE_DIRECTORY,
});

export interface ExperimentRunEvidence {
  experiment: ExperimentManifest;
  records: readonly RunRecord[];
  startedAttemptIds: readonly string[];
  providerStartedAttemptIds: readonly string[];
  /** A durably started attempt whose terminal record was never persisted. */
  interruptedAttempt?: ExperimentScheduledAttempt;
  /** The first attempt without terminal evidence, whether started or not. */
  nextAttempt?: ExperimentScheduledAttempt;
  stop?: ExperimentStopRecord;
}

/**
 * Reads an experiment directory without changing it and rejects evidence that
 * cannot have been emitted by the sequential schema-v1 experiment writer.
 * The caller supplies an already strictly parsed matrix manifest.
 */
export function readExperimentRunEvidence(
  runDirectory: string,
  matrix: MatrixRunManifest,
): ExperimentRunEvidence {
  const root = resolve(runDirectory);
  assertDirectory(root, "experiment run directory");
  rejectTopLevelSymlinksAndSpecialFiles(root);

  const experimentPath = join(root, EXPERIMENT_MANIFEST_FILENAME);
  const experimentManifestSha256 = createHash("sha256")
    .update(readExperimentFile(experimentPath))
    .digest("hex");
  const experiment = parseExperimentManifest(
    readRequiredJson(experimentPath),
    experimentPath,
  );
  assertScheduleMatchesMatrix(experiment, matrix);
  if (canonicalJsonSha256(matrix) !== experiment.hashes.matrixManifestSha256) {
    throw new Error("matrix manifest does not match its authenticated experiment hash");
  }
  rejectUndeclaredTopLevelEntries(root, experiment);

  const stateDirectory = join(root, EXPERIMENT_STATE_DIRECTORY);
  assertDirectory(stateDirectory, "experiment state directory");
  const allowedStateEntries = new Set(experiment.schedule.flatMap((attempt) => [
    basename(attemptStartedFile(attempt.id)),
    basename(providerStartedFile(attempt.id)),
  ]));
  for (const entry of readdirSync(stateDirectory).sort(compareText)) {
    if (!allowedStateEntries.has(entry)) {
      throw new Error(`experiment state contains undeclared entry: ${entry}`);
    }
    assertRegularFile(join(stateDirectory, entry), `experiment state entry ${entry}`);
  }

  const records: RunRecord[] = [];
  const startedAttemptIds: string[] = [];
  const providerStartedAttemptIds: string[] = [];
  let nextAttempt: ExperimentScheduledAttempt | undefined;
  let interruptedAttempt: ExperimentScheduledAttempt | undefined;

  for (const [index, attempt] of experiment.schedule.entries()) {
    const matrixAttempt = matrix.expectedAttempts[index];
    if (!matrixAttempt) throw new Error("matrix manifest is missing an experiment attempt");

    const startedPath = join(root, attemptStartedFile(attempt.id));
    const providerStartedPath = join(root, providerStartedFile(attempt.id));
    const terminalPath = join(root, attempt.file);
    const hasStarted = pathStat(startedPath) !== undefined;
    const hasProviderStarted = pathStat(providerStartedPath) !== undefined;
    const hasTerminal = pathStat(terminalPath) !== undefined;

    const started = hasStarted
      ? parseExperimentAttemptStartedRecord(readRequiredJson(startedPath), startedPath)
      : undefined;
    if (started) {
      assertMarkerIdentity(started.experimentId, started.attemptId, experiment, attempt, "start");
      if (Date.parse(started.startedAt) < Date.parse(experiment.createdAt)) {
        throw new Error(`${attempt.id} start marker precedes the experiment`);
      }
      startedAttemptIds.push(attempt.id);
    }

    const providerStarted = hasProviderStarted
      ? parseExperimentProviderStartedRecord(
          readRequiredJson(providerStartedPath),
          providerStartedPath,
        )
      : undefined;
    if (providerStarted) {
      assertMarkerIdentity(
        providerStarted.experimentId,
        providerStarted.attemptId,
        experiment,
        attempt,
        "provider",
      );
      if (attempt.runner === "mock") {
        throw new Error(`${attempt.id} mock attempt cannot have a provider marker`);
      }
      if (!started) throw new Error(`${attempt.id} provider marker has no start marker`);
      if (Date.parse(providerStarted.providerStartedAt) < Date.parse(started.startedAt)) {
        throw new Error(`${attempt.id} provider marker precedes its start marker`);
      }
      providerStartedAttemptIds.push(attempt.id);
    }

    if (hasTerminal) {
      if (nextAttempt) {
        throw new Error(
          `${attempt.id} has terminal evidence after schedule hole ${nextAttempt.id}`,
        );
      }
      if (!started) throw new Error(`${attempt.id} terminal record has no start marker`);
      const record = parseRunRecord(readRequiredJson(terminalPath), terminalPath, matrixAttempt);
      if (record.experimentId !== experiment.experimentId ||
        record.experimentManifestSha256 !== experimentManifestSha256) {
        throw new Error(`${attempt.id} terminal record does not match its experiment manifest`);
      }
      if (Date.parse(record.startedAt) < Date.parse(started.startedAt)) {
        throw new Error(`${attempt.id} terminal record precedes its start marker`);
      }
      if (providerStarted &&
        Date.parse(record.finishedAt) < Date.parse(providerStarted.providerStartedAt)) {
        throw new Error(`${attempt.id} terminal record precedes its provider marker`);
      }
      if (recordRequiresProviderMarker(record) && !providerStarted) {
        throw new Error(`${attempt.id} provider work is missing its provider marker`);
      }
      assertExperimentRecordModelIdentity(experiment, record);
      records.push(record);
      continue;
    }

    if (!nextAttempt) {
      nextAttempt = attempt;
      if (started) interruptedAttempt = attempt;
      continue;
    }
    if (started || providerStarted) {
      throw new Error(`${attempt.id} has state evidence after schedule hole ${nextAttempt.id}`);
    }
  }

  const stopPath = join(root, EXPERIMENT_STOP_FILENAME);
  const stopValue = readOptionalJson(stopPath);
  const stop = stopValue === undefined
    ? undefined
    : parseExperimentStopRecord(stopValue, stopPath);
  if (stop) {
    if (stop.experimentId !== experiment.experimentId) {
      throw new Error("experiment stop record does not match the experiment manifest");
    }
    if (canonicalJson(stop.limits) !== canonicalJson(experiment.protocol.limits)) {
      throw new Error("experiment stop record limits do not match the experiment manifest");
    }
    if (!nextAttempt || stop.beforeAttemptId !== nextAttempt.id) {
      throw new Error("experiment stop record does not identify the first missing attempt");
    }
    if (interruptedAttempt) {
      throw new Error("experiment stop record cannot precede an attempt that was already started");
    }
    const lastRecord = records.at(-1);
    if (Date.parse(stop.recordedAt) < Date.parse(experiment.createdAt) ||
      (lastRecord && Date.parse(stop.recordedAt) < Date.parse(lastRecord.finishedAt))) {
      throw new Error("experiment stop record predates the evidence it summarizes");
    }
    const decision = evaluateExperimentCeilings({
      protocol: experiment.protocol,
      schedule: experiment.schedule,
      records,
      providerStartedAttemptIds,
    });
    if (!decision.stop || decision.reason !== stop.reason ||
      decision.beforeAttemptId !== stop.beforeAttemptId ||
      canonicalJson(decision.observed) !== canonicalJson(stop.observed)) {
      throw new Error("experiment stop record is inconsistent with persisted evidence");
    }
  }

  return {
    experiment,
    records: Object.freeze(records),
    startedAttemptIds: Object.freeze(startedAttemptIds),
    providerStartedAttemptIds: Object.freeze(providerStartedAttemptIds),
    ...(interruptedAttempt ? { interruptedAttempt } : {}),
    ...(nextAttempt ? { nextAttempt } : {}),
    ...(stop ? { stop } : {}),
  };
}

/** Alias retained for callers that want the validation verb at the call site. */
export const validateExperimentRunEvidence = readExperimentRunEvidence;

/**
 * Binds provider output and failure telemetry to the exact model identity that
 * was authenticated in the immutable experiment manifest. Run-record parsing
 * already binds stage telemetry to modelConfig; this closes the remaining gap
 * between that internally consistent record and the experiment's selected
 * breadth/investigation models and efforts.
 */
export function assertExperimentRecordModelIdentity(
  experiment: Pick<ExperimentManifest, "models">,
  record: RunRecord,
): void {
  const identity = experiment.models.find((model) =>
    model.configName === record.configName && model.runner === record.runner);
  if (!identity) {
    throw new Error(
      `${record.attemptId} terminal record has no matching immutable experiment model identity`,
    );
  }
  const observedModelConfig = record.outcome.status === "completed"
    ? record.outcome.result.modelConfig
    : record.outcome.telemetry?.modelConfig;
  if (observedModelConfig === undefined) return;
  const expectedModelConfig = identity.runner === "mock"
    ? "mock"
    : `${identity.breadthModel}/${identity.breadthEffort}->` +
      `${identity.investigationModel}/${identity.investigationEffort}`;
  if (observedModelConfig !== expectedModelConfig) {
    throw new Error(
      `${record.attemptId} modelConfig does not match its immutable experiment model identity`,
    );
  }
}

function assertScheduleMatchesMatrix(
  experiment: ExperimentManifest,
  matrix: MatrixRunManifest,
): void {
  if (experiment.createdAt !== matrix.createdAt) {
    throw new Error("experiment and matrix manifests have different createdAt values");
  }
  if (experiment.schedule.length !== matrix.expectedAttempts.length) {
    throw new Error("experiment schedule and matrix manifest have different attempt counts");
  }
  for (const [index, scheduled] of experiment.schedule.entries()) {
    const expected = matrix.expectedAttempts[index];
    if (!expected) throw new Error("matrix manifest is missing an experiment attempt");
    assertAttemptMatches(scheduled, expected, index);
  }
}

function assertAttemptMatches(
  scheduled: ExperimentScheduledAttempt,
  expected: RunAttempt,
  index: number,
): void {
  for (const [field, actual, wanted] of [
    ["id", scheduled.id, expected.id],
    ["caseName", scheduled.caseName, expected.caseName],
    ["corpus", scheduled.corpus, expected.corpus],
    ["expectedBugCount", scheduled.expectedBugCount, expected.expectedBugCount],
    ["configName", scheduled.configName, expected.configName],
    ["repeat", scheduled.repeat, expected.repeat],
    ["runner", scheduled.runner, expected.runner],
    ["file", scheduled.file, expected.file],
  ] as const) {
    if (actual !== wanted) {
      throw new Error(`experiment schedule[${index}].${field} does not match the matrix manifest`);
    }
  }
}

function assertMarkerIdentity(
  experimentId: string,
  attemptId: string,
  experiment: ExperimentManifest,
  attempt: ExperimentScheduledAttempt,
  kind: "start" | "provider",
): void {
  if (experimentId !== experiment.experimentId || attemptId !== attempt.id) {
    throw new Error(`${attempt.id} ${kind} marker does not match its experiment`);
  }
}

function recordRequiresProviderMarker(record: RunRecord): boolean {
  if (record.runner === "mock") return false;
  if (record.outcome.status === "completed") return true;
  return record.outcome.telemetry !== undefined ||
    record.outcome.telemetryUnavailableReason !== undefined;
}

function rejectTopLevelSymlinksAndSpecialFiles(root: string): void {
  for (const entry of readdirSync(root).sort(compareText)) {
    const path = join(root, entry);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`experiment run entry ${entry} must be a regular non-symlink file or directory`);
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      throw new Error(`experiment run contains a special file: ${entry}`);
    }
  }
}

function rejectUndeclaredTopLevelEntries(
  root: string,
  experiment: ExperimentManifest,
): void {
  const allowed = new Set([
    MATRIX_MANIFEST_FILENAME,
    EXPERIMENT_MANIFEST_FILENAME,
    EXPERIMENT_STOP_FILENAME,
    EXPERIMENT_STATE_DIRECTORY,
    ".experiment.lock",
    "benchmark.json",
    "benchmark.html",
    "funnel-decision.json",
    "funnel-decision-adjudicated.json",
    "experiment-adjudication.json",
    EXPERIMENT_TERMINAL_SEAL_FILENAME,
    EXPERIMENT_GRADING_SEAL_FILENAME,
    ...(experiment.protocol.judge.kind === "exact" ? [] : ["judge"]),
    ...experiment.schedule.flatMap((attempt) => [
      attempt.file,
      attempt.file.replace(/\.json$/, ".graded.json"),
    ]),
  ]);
  const undeclared = readdirSync(root).sort(compareText).filter((entry) => !allowed.has(entry));
  if (undeclared.length > 0) {
    throw new Error(`experiment run contains undeclared top-level entries: ${undeclared.join(", ")}`);
  }
}

function assertDirectory(path: string, label: string): void {
  const stat = pathStat(path);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
}

function assertRegularFile(path: string, label: string): void {
  const stat = pathStat(path);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
}

function readRequiredJson(path: string): unknown {
  assertRegularFile(path, path);
  return readExperimentJson(path);
}

function readOptionalJson(path: string): unknown | undefined {
  return pathStat(path) === undefined ? undefined : readRequiredJson(path);
}

function pathStat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function compareText(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}
import { createHash } from "node:crypto";
