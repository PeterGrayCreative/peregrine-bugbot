import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { validateConfig } from "../src/config.js";
import { RunFailureError, runFailureKind, runFailureTelemetry } from "../src/core/run-failure.js";
import { getEngine } from "../src/engines/engine.js";
import { assertNoSecrets, safeDiagnostic } from "../src/security/secrets.js";
import { nonSensitiveEnvironment } from "../src/security/provider-env.js";
import { formatUsageCost } from "../src/core/telemetry.js";
import { packageRoot } from "../src/core/paths.js";
import { exec } from "../src/util/exec.js";
import {
  assertLiveProviderIsolationAvailable,
  assertLeakageFreeText,
  assertOpaqueCaseId,
  assertRunnerMayUseCorpus,
  caseIdFromDirectory,
  corpusFromDirectory,
  leakagePolicyForCase,
  materializeCase,
  networkIsolationCapability,
  readSanitizedMetadata,
} from "./case-isolation.js";
import { prepareEvaluationManifest } from "./case-manifest.js";
import type { EvaluationManifestPreparer } from "./case-manifest.js";
import { CASE_CORPORA } from "../src/types.js";
import type {
  CaseCorpus,
  CaseSpec,
  EvaluationAttemptProvenance,
  EngineResult,
  MatrixConfig,
  MatrixRunManifest,
  PeregrineConfig,
  ReviewContext,
  RunAttempt,
  RunFailureTelemetry,
  RunOutcome,
  RunRecord,
  RunnerName,
  StageTelemetry,
} from "../src/types.js";
import type { Engine } from "../src/engines/engine.js";
import { parseGroundTruth } from "./case-truth.js";
import {
  absentInputSha256,
  acquireExperimentLock,
  attemptStartedFile,
  buildExperimentManifest,
  buildExperimentSchedule,
  buildExperimentStopRecord,
  buildRetrySchedule,
  canonicalJson,
  canonicalJsonSha256,
  evaluateExperimentCeilings,
  hashExperimentCorpus,
  hashPathTree,
  parseExperimentAttemptStartedRecord,
  parseExperimentManifest,
  parseExperimentProtocol,
  parseExperimentStopRecord,
  providerStartedFile,
  readExperimentFile,
  readExperimentJson,
  writeExclusiveJson,
  type ExperimentCase,
  type ExperimentManifest,
  type ExperimentModelIdentity,
  type ExperimentRuntime,
  type ExperimentScheduledAttempt,
} from "./experiment.js";
import { readExperimentRunEvidence } from "./experiment-evidence.js";
import {
  EXPERIMENT_TERMINAL_SEAL_FILENAME,
  requireValidExperimentTerminalSeal,
  retrySourceEvidenceSha256,
  writeExperimentTerminalSeal,
} from "./experiment-seals.js";
import { parseMatrixRunManifest, parseRunRecord } from "./artifacts.js";

interface RunMatrixOptions {
  casesDir?: string;
  engineFor?: (runner: RunnerName) => Engine;
  /** Explicit compatibility seam for pre-PR5B tests; never used by the CLI or smoke runner. */
  allowLegacyTestConfig?: boolean;
  /** Continue one unsealed experiment after validating every immutable input. */
  resumeDir?: string;
  /** Create a child experiment for one failed or interrupted source attempt. */
  retry?: { runsDir: string; attemptId: string };
  /** Deterministic test clock. */
  now?: () => number;
  /** Test-only runtime fact provider; the default probe never contacts a provider. */
  runtimeMetadataFor?: (
    runners: readonly RunnerName[],
    observedAt: string,
  ) => Promise<ExperimentRuntime>;
  /** Test seam for simulating interruption after durable terminal evidence. */
  afterAttemptPersisted?: (attempt: RunAttempt) => void;
  /** Test seam; production and normal eval calls use prepareReviewManifest. */
  manifestPreparer?: EvaluationManifestPreparer;
  /** Test seam for verifying that attempt cleanup cannot erase incurred work. */
  materializeCaseFor?: typeof materializeCase;
}

interface DiscoveredCase {
  caseName: string;
  caseDir: string;
  corpus: CaseCorpus | "unknown";
  expectedBugCount: number | null;
}

/**
 * Runs the model-comparison matrix: every model config x every case x N
 * repeats. Repeats matter — engine runs are stochastic and single-run
 * comparisons between models will mislead you. Results land in
 * eval/runs/<timestamp>/ as one JSON per run, cost captured from the engine.
 *
 * Runs are sequential on purpose: parallel agentic sessions chew through
 * rate limits and make cost attribution noisy.
 */
export async function runMatrix(
  configPath?: string,
  runsRoot?: string,
  options: RunMatrixOptions = {},
): Promise<string> {
  if (options.resumeDir && options.retry) {
    throw new Error("matrix resume and retry modes are mutually exclusive");
  }
  const resolvedConfigPath = resolve(configPath ?? "eval/matrix.config.json");
  const matrixSource = readFileSync(resolvedConfigPath, "utf8");
  const matrix = JSON.parse(matrixSource) as MatrixConfig;
  validateMatrixCaseSelection(matrix);
  const protocol = matrix.experiment === undefined
    ? undefined
    : parseExperimentProtocol(matrix.experiment, `${resolvedConfigPath}.experiment`);
  if (!protocol && !options.allowLegacyTestConfig) {
    throw new Error("matrix config requires an experiment protocol");
  }
  if (!protocol && (options.resumeDir || options.retry)) {
    throw new Error("resume and retry require an experiment protocol");
  }
  const baseConfig = loadConfig();

  const casesDir = resolve(options.casesDir ?? "eval/cases");
  const cases = discoverCases(casesDir, matrix.corpora);
  const effective = protocol ? effectiveMatrixConfigs(matrix, baseConfig) : new Map<string, EffectiveMatrixConfig>();
  const now = options.now ?? Date.now;
  const runsBase = resolve(runsRoot ?? process.env.PEREGRINE_EVAL_RUNS_DIR ?? "eval/runs");
  let outDir: string;
  let manifest: MatrixRunManifest;
  let experimentManifest: ExperimentManifest | undefined;
  let experimentSchedule: ExperimentScheduledAttempt[] | undefined;
  let experimentManifestSha256: string | undefined;
  let releaseLock: (() => void) | undefined;

  if (!protocol) {
    outDir = createUniqueRunDirectory(runsBase, now());
    manifest = buildLegacyMatrixManifest(matrix, cases, isoTimestamp(now()));
    assertNoSecrets(manifest, "matrix manifest");
    writeExclusiveJson(outDir, join(outDir, "matrix-manifest.json"), manifest);
  } else if (options.resumeDir) {
    outDir = resolve(options.resumeDir);
    releaseLock = acquireExperimentLock(outDir);
    try {
      const loaded = loadExperimentArtifacts(outDir);
      experimentManifest = loaded.experiment;
      manifest = loaded.matrix;
      experimentManifestSha256 = rawSha256(readExperimentFile(join(outDir, "experiment-manifest.json")));
      if (existsSync(join(outDir, EXPERIMENT_TERMINAL_SEAL_FILENAME))) {
        requireValidExperimentTerminalSeal(outDir, manifest);
        releaseLock?.();
        releaseLock = undefined;
        return outDir;
      }
      if (existsSync(join(outDir, "experiment-stop.json"))) {
        const stopPath = join(outDir, "experiment-stop.json");
        const stop = parseExperimentStopRecord(
          readExperimentJson(stopPath),
          stopPath,
        );
        if (stop.experimentId !== experimentManifest.experimentId) {
          throw new Error("experiment stop record does not match the experiment manifest");
        }
        throw new Error(`experiment stopped at ${stop.beforeAttemptId} (${stop.reason}); create an explicit retry`);
      }
      experimentSchedule = [...experimentManifest.schedule];
      const current = await prepareExperimentManifest({
        matrix,
        matrixSource,
        cases,
        casesDir,
        protocol,
        baseConfig,
        effective,
        createdAt: experimentManifest.createdAt,
        runtimeObservedAt: experimentManifest.runtime.observedAt,
        schedule: experimentSchedule,
        lineage: experimentManifest.lineage,
        runtimeMetadataFor: options.runtimeMetadataFor,
      });
      if (canonicalJson(current) !== canonicalJson(experimentManifest)) {
        throw new Error("resume environment does not match the immutable experiment manifest");
      }
      assertExperimentMatchesMatrix(experimentManifest, manifest);
    } catch (error) {
      releaseLock?.();
      releaseLock = undefined;
      throw error;
    }
  } else {
    let releaseRetrySourceLock: (() => void) | undefined;
    try {
      let schedule = buildExperimentSchedule({
        protocol,
        cases: cases.map(({ caseName, corpus, expectedBugCount }): ExperimentCase => {
          if (corpus === "unknown") throw new Error(`experiment case ${caseName} has no corpus`);
          return { caseName, corpus, expectedBugCount };
        }),
        repeats: matrix.repeats,
        configs: matrix.configs,
      });
      let lineage: ExperimentManifest["lineage"];
      if (options.retry) {
        const sourceDir = resolve(options.retry.runsDir);
        releaseRetrySourceLock = acquireExperimentLock(sourceDir);
        const source = loadExperimentArtifacts(sourceDir);
        assertExperimentMatchesMatrix(source.experiment, source.matrix);
        if (existsSync(join(sourceDir, EXPERIMENT_TERMINAL_SEAL_FILENAME))) {
          requireValidExperimentTerminalSeal(sourceDir, source.matrix);
        } else {
          readExperimentRunEvidence(sourceDir, source.matrix);
        }
        const sourceAttempt = source.experiment.schedule.find((attempt) => attempt.id === options.retry!.attemptId);
        if (!sourceAttempt) throw new Error(`retry source attempt ${options.retry.attemptId} is not scheduled`);
        assertRetryableAttempt(sourceDir, source.experiment, sourceAttempt);
        const reference = {
          experimentId: source.experiment.experimentId,
          manifestSha256: rawSha256(readExperimentFile(join(sourceDir, "experiment-manifest.json"))),
          attemptId: sourceAttempt.id,
          evidenceSha256: retrySourceEvidenceSha256(sourceDir, source.experiment, sourceAttempt.id),
        };
        const comparable = await prepareExperimentManifest({
          matrix,
          matrixSource,
          cases,
          casesDir,
          protocol,
          baseConfig,
          effective,
          createdAt: source.experiment.createdAt,
          runtimeObservedAt: source.experiment.runtime.observedAt,
          schedule: source.experiment.schedule,
          ...(source.experiment.lineage ? { lineage: source.experiment.lineage } : {}),
          runtimeMetadataFor: options.runtimeMetadataFor,
        });
        assertRetryEnvironmentMatches(source.experiment, comparable);
        schedule = buildRetrySchedule(sourceAttempt, reference);
        lineage = { kind: "retry", source: reference };
      }
      const createdAt = isoTimestamp(now());
      experimentSchedule = schedule;
      experimentManifest = await prepareExperimentManifest({
        matrix,
        matrixSource,
        cases,
        casesDir,
        protocol,
        baseConfig,
        effective,
        createdAt,
        runtimeObservedAt: createdAt,
        schedule,
        ...(lineage ? { lineage } : {}),
        runtimeMetadataFor: options.runtimeMetadataFor,
      });
      manifest = matrixManifestFromExperiment(experimentManifest);
      outDir = createUniqueRunDirectory(runsBase, now());
      releaseLock = acquireExperimentLock(outDir);
      mkdirSync(join(outDir, "state"));
      assertNoSecrets(manifest, "matrix manifest");
      writeExclusiveJson(outDir, join(outDir, "matrix-manifest.json"), manifest);
      writeExclusiveJson(outDir, join(outDir, "experiment-manifest.json"), experimentManifest);
      experimentManifestSha256 = rawSha256(readExperimentFile(join(outDir, "experiment-manifest.json")));
      // Freeze the source until the child has durably authenticated its lineage.
      releaseRetrySourceLock?.();
      releaseRetrySourceLock = undefined;
    } catch (error) {
      releaseRetrySourceLock?.();
      releaseLock?.();
      releaseLock = undefined;
      throw error;
    }
  }

  const expectedAttempts = manifest.expectedAttempts;

  const total = expectedAttempts.length;
  if (total === 0) {
    console.log(
      `No eval cases matched ${matrix.corpora?.join(", ") ?? "the configured corpus"}; no provider processes were started.`,
    );
    console.log(`Empty run manifest written to ${outDir}`);
    if (experimentManifest) writeExperimentTerminalSeal(outDir, manifest, isoTimestamp(now()));
    releaseLock?.();
    return outDir;
  }
  const caseByName = new Map(cases.map((item) => [item.caseName, item]));
  const configByName = new Map(matrix.configs.map((item) => [item.name, item]));
  let existingState: ReturnType<typeof readExperimentAttemptState>;
  try {
    existingState = experimentManifest
      ? readExperimentAttemptState(outDir, experimentManifest, manifest)
      : { records: [], providerStartedIds: [] };
  } catch (error) {
    releaseLock?.();
    releaseLock = undefined;
    throw error;
  }
  const records = existingState.records;
  const providerStartedIds = existingState.providerStartedIds;

  try {
    for (const [index, attempt] of expectedAttempts.entries()) {
      const done = index + 1;
      const modelConfig = configByName.get(attempt.configName);
      const discovered = caseByName.get(attempt.caseName);
      if (!modelConfig || !discovered) {
        throw new Error(`immutable attempt ${attempt.id} references unavailable config or case`);
      }
      const { caseName, caseDir, corpus } = discovered;
      if (experimentManifest && existsSync(join(outDir, attempt.file))) continue;

      if (experimentManifest && experimentSchedule) {
        const decision = evaluateExperimentCeilings({
          protocol: experimentManifest.protocol,
          schedule: experimentSchedule,
          records,
          providerStartedAttemptIds: providerStartedIds,
        });
        if (decision.stop) {
          const stop = buildExperimentStopRecord({
            experimentId: experimentManifest.experimentId,
            recordedAt: isoTimestamp(now()),
            decision,
            limits: experimentManifest.protocol.limits,
          });
          writeExclusiveJson(outDir, join(outDir, "experiment-stop.json"), stop);
          console.log(`STOPPED before ${stop.beforeAttemptId}: ${stop.reason}`);
          break;
        }
        writeExclusiveJson(outDir, join(outDir, attemptStartedFile(attempt.id)), {
          schemaVersion: 1,
          experimentId: experimentManifest.experimentId,
          attemptId: attempt.id,
          startedAt: isoTimestamp(now()),
        });
      }

      let spec: CaseSpec | undefined;
      let policy: ReturnType<typeof leakagePolicyForCase> | undefined;
      let metadata: ReturnType<typeof readSanitizedMetadata> | undefined;
      let preparationError: unknown;
      try {
        spec = loadCaseSpec(caseDir);
        policy = leakagePolicyForCase(caseDir, spec);
        metadata = readSanitizedMetadata(caseDir, spec, policy);
      } catch (error) {
        preparationError = error;
      }

      {
        const repeat = attempt.repeat;
        const attemptId = attempt.id;
        const file = join(outDir, attempt.file);
        const started = now();
        const startedAt = new Date(started).toISOString();
        process.stdout.write(
          `[${done}/${total}] ${modelConfig.name} × ${caseName} (run ${repeat}) ... `,
        );

        let materialized: Awaited<ReturnType<typeof materializeCase>> | undefined;
        let evaluationProvenance: EvaluationAttemptProvenance | undefined;
        let record: RunRecord | undefined;
        try {
          if (!spec || !policy || !metadata) {
            throw new RunFailureError(
              "configuration",
              preparationError instanceof Error ? preparationError.message : "case preparation failed",
              { cause: preparationError },
            );
          }
          try {
            assertRunnerMayUseCorpus(spec.corpus, modelConfig.runner);
            materialized = await (options.materializeCaseFor ?? materializeCase)(caseDir, spec, policy, {
              prepareProviderAssets: modelConfig.runner !== "mock",
            });
            evaluationProvenance = { history: materialized.historyProvenance };
          } catch (error) {
            throw new RunFailureError(
              "configuration",
              `case ${spec.id} isolation failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          // Model overrides flow through the same config object the real bot
          // uses, so eval runs exercise the exact production path. Inside the
          // try: a typo'd engine name should fail THIS run, not kill the
          // remaining matrix.
          const preparedConfig = effective.get(modelConfig.name) ??
            effectiveMatrixConfig(modelConfig, baseConfig);
          const config = structuredClone(preparedConfig.config);

          const ctx: ReviewContext = {
            repoPath: materialized.repoPath,
            diffPath: materialized.diffPath,
            diffText: materialized.diffText,
            baseRef: materialized.baseRef,
            headRef: materialized.headRef,
            prTitle: metadata.title,
            prBody: metadata.body,
            evaluationIsolation: materialized.evaluationIsolation,
            config,
          };

          try {
            const prepared = await prepareEvaluationManifest(
              ctx,
              productionManifestSkillName(config, modelConfig.runner),
              materialized.historyProvenance,
              options.manifestPreparer,
              (output) => assertLeakageFreeText(
                "production review manifest",
                output,
                policy,
                { allowDocumentedMarkers: true },
              ),
            );
            evaluationProvenance.manifest = prepared.provenance;
          } catch (error) {
            throw new RunFailureError(
              "configuration",
              `case ${spec.id} manifest preflight failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          try {
            assertLiveProviderIsolationAvailable(modelConfig.runner);
          } catch (error) {
            throw new RunFailureError(
              "configuration",
              `case ${spec.id} isolation failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }

          if (experimentManifest && modelConfig.runner !== "mock") {
            await assertExperimentSnapshotUnchanged({
              expected: experimentManifest,
              matrix,
              matrixSource,
              cases,
              casesDir,
              protocol: experimentManifest.protocol,
              baseConfig,
              effective,
              runtimeMetadataFor: options.runtimeMetadataFor,
            });
            writeExclusiveJson(outDir, join(outDir, providerStartedFile(attemptId)), {
              schemaVersion: 1,
              experimentId: experimentManifest.experimentId,
              attemptId,
              providerStartedAt: isoTimestamp(now()),
            });
            providerStartedIds.push(attemptId);
          }

          const result = await (options.engineFor ?? getEngine)(modelConfig.runner).review(ctx);
          record = {
            schemaVersion: 1,
            ...(experimentManifest ? {
              experimentId: experimentManifest.experimentId,
              experimentManifestSha256: experimentManifestSha256!,
            } : {}),
            attemptId,
            caseName,
            caseCorpus: spec.corpus,
            caseKind: spec.kind,
            configName: modelConfig.name,
            repeat,
            runner: attempt.runner,
            startedAt,
            finishedAt: startedAt,
            attemptDurationMs: 0,
            evaluationProvenance,
            outcome: { status: "completed", result },
          };
          console.log(
            `${result.findings.length} finding(s), ${formatUsageCost(result.usage)}`,
          );
        } catch (err) {
          const outcome = failureOutcomeForArtifact(attempt.runner, err, 0);
          record = {
            schemaVersion: 1,
            ...(experimentManifest ? {
              experimentId: experimentManifest.experimentId,
              experimentManifestSha256: experimentManifestSha256!,
            } : {}),
            attemptId,
            caseName,
            caseCorpus: spec?.corpus ?? corpus,
            caseKind: spec?.kind ?? "unknown",
            configName: modelConfig.name,
            repeat,
            runner: attempt.runner,
            startedAt,
            finishedAt: startedAt,
            attemptDurationMs: 0,
            ...(evaluationProvenance ? { evaluationProvenance } : {}),
            outcome,
          };
          console.log(`FAILED [${outcome.failureKind}]: ${outcome.message}`);
        } finally {
          let cleanupError: unknown;
          if (materialized) {
            try {
              materialized.cleanup();
            } catch (error) {
              cleanupError = error;
            }
          }
          if (!record) throw new Error(`internal error: attempt ${attemptId} produced no record`);
          const attemptDurationMs = Math.max(0, now() - started);
          record = {
            ...record,
            finishedAt: new Date(started + attemptDurationMs).toISOString(),
            attemptDurationMs,
            outcome: record.outcome.status === "failed"
              ? { ...record.outcome, durationMs: attemptDurationMs }
              : record.outcome,
          };
          if (cleanupError !== undefined) {
            const detail = safeDiagnostic(
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            );
            const message = safeDiagnostic(record.outcome.status === "failed"
              ? `${record.outcome.message}; cleanup also failed: ${detail}`
              : `isolated attempt cleanup failed after provider completion: ${detail}`);
            record = {
              ...record,
              outcome: record.outcome.status === "failed"
                ? { ...record.outcome, message, durationMs: attemptDurationMs }
                : {
                    status: "failed",
                    failureKind: "configuration",
                    message,
                    durationMs: attemptDurationMs,
                    telemetry: completedResultFailureTelemetry(record.outcome.result),
                  },
            };
            console.log(`CLEANUP FAILED: ${detail}`);
          }
          if (experimentManifest) writeExclusiveJson(outDir, file, record);
          else writeFileSync(file, JSON.stringify(record, null, 2));
          records.push(record);
          options.afterAttemptPersisted?.(attempt);
        }
      }
    }
    if (experimentManifest) writeExperimentTerminalSeal(outDir, manifest, isoTimestamp(now()));
  } finally {
    releaseLock?.();
  }
  console.log(`\nRuns written to ${outDir}`);
  console.log(`Next: npm run eval:grade -- --runs ${outDir}`);
  return outDir;
}

interface EffectiveMatrixConfig {
  config: PeregrineConfig;
  identity: ExperimentModelIdentity;
}

interface PrepareExperimentManifestInput {
  matrix: MatrixConfig;
  matrixSource: string;
  cases: DiscoveredCase[];
  casesDir: string;
  protocol: MatrixConfig["experiment"];
  baseConfig: PeregrineConfig;
  effective: Map<string, EffectiveMatrixConfig>;
  createdAt: string;
  runtimeObservedAt: string;
  schedule: ExperimentScheduledAttempt[];
  lineage?: ExperimentManifest["lineage"];
  runtimeMetadataFor?: RunMatrixOptions["runtimeMetadataFor"];
  /** Safe only after repository and corpus hashes are revalidated unchanged. */
  reuseProfileSha256?: string;
}

function effectiveMatrixConfigs(
  matrix: MatrixConfig,
  baseConfig: PeregrineConfig,
): Map<string, EffectiveMatrixConfig> {
  const result = new Map<string, EffectiveMatrixConfig>();
  for (const modelConfig of matrix.configs) {
    result.set(modelConfig.name, effectiveMatrixConfig(modelConfig, baseConfig));
  }
  return result;
}

function effectiveMatrixConfig(
  modelConfig: MatrixConfig["configs"][number],
  baseConfig: PeregrineConfig,
): EffectiveMatrixConfig {
  const config = structuredClone(baseConfig);
  config.runner = modelConfig.runner;
  const runnerConfig = config.runners[modelConfig.runner];
  if (!runnerConfig || typeof runnerConfig !== "object") {
    throw new RunFailureError(
      "configuration",
      `matrix config "${modelConfig.name}": unknown runner "${modelConfig.runner}"`,
    );
  }
  Object.assign(runnerConfig as object, modelConfig.overrides ?? {});
  try {
    validateConfig(config, `matrix config "${modelConfig.name}"`);
  } catch (error) {
    throw new RunFailureError(
      "configuration",
      error instanceof Error ? error.message : "invalid effective matrix configuration",
      { cause: error },
    );
  }
  const identity: ExperimentModelIdentity = {
    configName: modelConfig.name,
    runner: modelConfig.runner,
    effectiveConfigSha256: canonicalJsonSha256(config),
  };
  if (modelConfig.runner !== "mock") {
    const stageConfig = config.runners[modelConfig.runner];
    identity.breadthModel = stageConfig.breadthModel;
    identity.breadthEffort = stageConfig.breadthEffort;
    identity.investigationModel = stageConfig.investigationModel;
    identity.investigationEffort = stageConfig.investigationEffort;
  }
  return { config, identity };
}

function buildLegacyMatrixManifest(
  matrix: MatrixConfig,
  cases: DiscoveredCase[],
  createdAt: string,
): MatrixRunManifest {
  let sequence = 0;
  const expectedAttempts = matrix.configs.flatMap((modelConfig) =>
    cases.flatMap(({ caseName, corpus, expectedBugCount }) =>
      Array.from({ length: matrix.repeats }, (_, index) => {
        const id = `attempt-${String(++sequence).padStart(6, "0")}`;
        return {
          id,
          caseName,
          corpus,
          expectedBugCount,
          configName: modelConfig.name,
          repeat: index + 1,
          file: `${id}.json`,
          runner: modelConfig.runner,
        };
      }),
    ),
  );
  return {
    schemaVersion: 1,
    createdAt,
    expectedAttempts,
    providerNetworkIsolation: Object.fromEntries(
      [...new Set(matrix.configs.map((config) => config.runner))].map((runner) => [
        runner,
        networkIsolationCapability(runner),
      ]),
    ),
  };
}

function matrixManifestFromExperiment(experiment: ExperimentManifest): MatrixRunManifest {
  return matrixManifestFromSchedule(experiment.createdAt, experiment.schedule);
}

function matrixManifestFromSchedule(
  createdAt: string,
  schedule: readonly ExperimentScheduledAttempt[],
): MatrixRunManifest {
  return {
    schemaVersion: 1,
    createdAt,
    expectedAttempts: schedule.map((attempt) => ({
      id: attempt.id,
      caseName: attempt.caseName,
      corpus: attempt.corpus,
      expectedBugCount: attempt.expectedBugCount,
      configName: attempt.configName,
      repeat: attempt.repeat,
      file: attempt.file,
      runner: attempt.runner,
    })),
    providerNetworkIsolation: Object.fromEntries(
      [...new Set(schedule.map((attempt) => attempt.runner))].map((runner) => [
        runner,
        networkIsolationCapability(runner),
      ]),
    ),
  };
}

async function prepareExperimentManifest(
  input: PrepareExperimentManifestInput,
): Promise<ExperimentManifest> {
  const root = packageRoot();
  const repositoryCommit = await gitObjectId(root, ["rev-parse", "HEAD"]);
  if (
    input.protocol.providerCalls === "allow" &&
    input.schedule.some((attempt) => attempt.runner !== "mock")
  ) {
    const status = await exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
      timeoutMs: 10_000,
      env: nonSensitiveEnvironment(),
      inheritEnv: false,
    });
    if (status.code !== 0 || status.timedOut) throw new Error("could not verify experiment worktree state");
    if (status.stdout.trim()) throw new Error("provider experiments require a clean Peregrine worktree");
  }

  const models = [...input.effective.values()].map((item) => item.identity);
  const runtimeRunners = new Set(models.map((model) => model.runner));
  if (input.protocol.judge.kind !== "exact") runtimeRunners.add(input.protocol.judge.kind);
  const runtime = input.runtimeMetadataFor
    ? await input.runtimeMetadataFor(
        [...runtimeRunners],
        input.runtimeObservedAt,
      )
    : await observeExperimentRuntime(
        [...runtimeRunners],
        input.runtimeObservedAt,
        input.protocol,
      );
  const matrixConfigSha256 = rawSha256(input.matrixSource);
  const matrixManifestSha256 = canonicalJsonSha256(
    matrixManifestFromSchedule(input.createdAt, input.schedule),
  );
  const peregrineConfigSha256 = canonicalJsonSha256(input.baseConfig);
  const repositorySha256 = hashPathTree(root, {
    excludeRelativePaths: [".git", "node_modules", "eval/cases", "eval/runs"],
  });
  const corpusSha256 = hashExperimentCorpus(
    input.casesDir,
    input.cases.map((item) => item.caseName),
  );
  const promptSha256 = canonicalJsonSha256({
    prompt: hashPathTree(join(root, "src", "core", "prompt.ts")),
    engines: [...new Set(models.map((model) => model.runner))].sort().map((runner) => ({
      runner,
      sha256: hashPathTree(join(root, "src", "engines", `${runner}.ts`)),
    })),
  });
  const methodSha256 = canonicalJsonSha256(
    [...new Set(input.matrix.configs.map((item) =>
      productionManifestSkillName(input.effective.get(item.name)!.config, item.runner),
    ))].sort().map((skillName) => ({
      skillName,
      sha256: hashPathTree(join(root, "skills", skillName)),
    })),
  );
  const schemaSha256 = hashPathTree(join(root, "schemas"));
  const profileSha256 = input.reuseProfileSha256 ??
    await effectiveProfileSnapshotSha256(input.cases);
  const judgeSha256 = canonicalJsonSha256({
    implementation: hashPathTree(join(root, "eval", "grade.ts")),
    gradingContract: hashPathTree(join(root, "eval", "grading-contract.ts")),
    resultSchema: hashPathTree(join(root, "schemas", "judge-result.schema.json")),
    evidenceSchema: hashPathTree(join(root, "schemas", "grading-evidence.schema.json")),
    judge: input.protocol.judge,
  });
  const configurationSha256 = canonicalJsonSha256({
    matrixManifestSha256,
    matrixConfigSha256,
    peregrineConfigSha256,
    effectiveConfigs: models.map((model) => ({
      configName: model.configName,
      sha256: model.effectiveConfigSha256,
    })),
  });
  return buildExperimentManifest({
    createdAt: input.createdAt,
    repositoryCommit,
    protocol: input.protocol,
    hashes: {
      repositorySha256,
      corpusSha256,
      promptSha256,
      methodSha256,
      schemaSha256,
      profileSha256,
      judgeSha256,
      matrixManifestSha256,
      matrixConfigSha256,
      peregrineConfigSha256,
      configurationSha256,
    },
    models,
    runtime,
    schedule: input.schedule,
    ...(input.lineage ? { lineage: input.lineage } : {}),
  });
}

async function assertExperimentSnapshotUnchanged(input: {
  expected: ExperimentManifest;
  matrix: MatrixConfig;
  matrixSource: string;
  cases: DiscoveredCase[];
  casesDir: string;
  protocol: MatrixConfig["experiment"];
  baseConfig: PeregrineConfig;
  effective: Map<string, EffectiveMatrixConfig>;
  runtimeMetadataFor?: RunMatrixOptions["runtimeMetadataFor"];
}): Promise<void> {
  const current = await prepareExperimentManifest({
    matrix: input.matrix,
    matrixSource: input.matrixSource,
    cases: input.cases,
    casesDir: input.casesDir,
    protocol: input.protocol,
    baseConfig: input.baseConfig,
    effective: input.effective,
    createdAt: input.expected.createdAt,
    runtimeObservedAt: input.expected.runtime.observedAt,
    schedule: [...input.expected.schedule],
    ...(input.expected.lineage ? { lineage: input.expected.lineage } : {}),
    runtimeMetadataFor: input.runtimeMetadataFor,
    reuseProfileSha256: input.expected.hashes.profileSha256,
  });
  if (canonicalJson(current) !== canonicalJson(input.expected)) {
    throw new Error("experiment inputs changed after the immutable manifest was written");
  }
}

async function effectiveProfileSnapshotSha256(cases: DiscoveredCase[]): Promise<string> {
  if (cases.length === 0) return absentInputSha256("effective profile bundle");
  const profiles: Array<{ caseName: string; files: Array<{ path: string; sha256: string }> }> = [];
  for (const item of [...cases].sort((left, right) => compareBytes(left.caseName, right.caseName))) {
    const spec = loadCaseSpec(item.caseDir);
    const policy = leakagePolicyForCase(item.caseDir, spec);
    readSanitizedMetadata(item.caseDir, spec, policy);
    const materialized = await materializeCase(item.caseDir, spec, policy, { prepareProviderAssets: false });
    try {
      const listed = await exec(
        "git",
        ["ls-tree", "-r", "--name-only", materialized.baseRef, "--", ".peregrine/profile.md", ".peregrine/lanes"],
        {
          cwd: materialized.repoPath,
          timeoutMs: 10_000,
          env: nonSensitiveEnvironment(),
          inheritEnv: false,
        },
      );
      if (listed.code !== 0 || listed.timedOut) {
        throw new Error(`could not inspect trusted profile snapshot for ${item.caseName}`);
      }
      const paths = listed.stdout.split("\n").filter(Boolean).sort(compareBytes);
      const files: Array<{ path: string; sha256: string }> = [];
      for (const path of paths) {
        if (path !== ".peregrine/profile.md" && !/^\.peregrine\/lanes\/[^/]+\.md$/.test(path)) {
          throw new Error(`trusted profile snapshot contains an unsafe path for ${item.caseName}`);
        }
        const shown = await exec("git", ["show", `${materialized.baseRef}:${path}`], {
          cwd: materialized.repoPath,
          timeoutMs: 10_000,
          env: nonSensitiveEnvironment(),
          inheritEnv: false,
        });
        if (shown.code !== 0 || shown.timedOut) {
          throw new Error(`could not read trusted profile snapshot for ${item.caseName}`);
        }
        files.push({ path, sha256: rawSha256(shown.stdout) });
      }
      profiles.push({ caseName: item.caseName, files });
    } finally {
      materialized.cleanup();
    }
  }
  return canonicalJsonSha256({ schemaVersion: 1, profiles });
}

async function observeExperimentRuntime(
  runners: readonly RunnerName[],
  observedAt: string,
  protocol: MatrixConfig["experiment"],
): Promise<ExperimentRuntime> {
  const cliVersions: ExperimentRuntime["cliVersions"] = [];
  const providerAvailability: ExperimentRuntime["providerAvailability"] = [];
  const home = mkdtempSync(join(tmpdir(), "peregrine-version-probe-"));
  try {
    mkdirSync(join(home, "tmp"));
    for (const runner of [...runners].sort()) {
      if (runner === "mock") {
        cliVersions.push({ runner, status: "not-applicable" });
        providerAvailability.push({ runner, status: "not-applicable" });
        continue;
      }
      const result = await exec(runner, ["--version"], {
        timeoutMs: 10_000,
        env: metadataProbeEnvironment(home),
        inheritEnv: false,
      });
      const version = result.code === 0 && !result.timedOut
        ? `${result.stdout}\n${result.stderr}`.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0]
        : undefined;
      cliVersions.push(version
        ? { runner, status: "observed", version }
        : { runner, status: "unavailable" });
      const isolation = networkIsolationCapability(runner);
      const credentialPresent = runner === "claude"
        ? Boolean(process.env.ANTHROPIC_API_KEY)
        : Boolean(process.env.OPENAI_API_KEY);
      providerAvailability.push({
        runner,
        status: protocol.providerCalls === "deny"
          ? "denied"
          : isolation.status !== "enforced"
            ? "blocked-isolation"
            : !version
              ? "missing-cli"
              : !credentialPresent
                ? "missing-credential"
                : "configured",
      });
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  return {
    observedAt,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cliVersions,
    providerAvailability,
  };
}

function metadataProbeEnvironment(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: join(home, "tmp"),
    XDG_CONFIG_HOME: join(home, "xdg-config"),
    XDG_CACHE_HOME: join(home, "xdg-cache"),
    XDG_DATA_HOME: join(home, "xdg-data"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CODEX_DISABLE_UPDATE_CHECK: "1",
  };
}

function loadExperimentArtifacts(outDir: string): {
  experiment: ExperimentManifest;
  matrix: MatrixRunManifest;
} {
  const experimentPath = join(outDir, "experiment-manifest.json");
  const matrixPath = join(outDir, "matrix-manifest.json");
  return {
    experiment: parseExperimentManifest(readJsonNoSymlink(experimentPath), experimentPath),
    matrix: parseMatrixRunManifest(readJsonNoSymlink(matrixPath), matrixPath),
  };
}

function assertExperimentMatchesMatrix(
  experiment: ExperimentManifest,
  matrix: MatrixRunManifest,
): void {
  const expected = matrixManifestFromExperiment(experiment);
  if (canonicalJson(expected) !== canonicalJson(matrix)) {
    throw new Error("matrix manifest does not match the immutable experiment schedule");
  }
  if (canonicalJsonSha256(matrix) !== experiment.hashes.matrixManifestSha256) {
    throw new Error("matrix manifest does not match its authenticated experiment hash");
  }
}

function readExperimentAttemptState(
  outDir: string,
  experiment: ExperimentManifest,
  matrix: MatrixRunManifest,
): { records: RunRecord[]; providerStartedIds: string[] } {
  const evidence = readExperimentRunEvidence(outDir, matrix);
  if (evidence.experiment.experimentId !== experiment.experimentId) {
    throw new Error("experiment evidence does not match the loaded immutable manifest");
  }
  if (evidence.interruptedAttempt) {
    throw new Error(
      `${evidence.interruptedAttempt.id} was interrupted; use an explicit retry instead of resume`,
    );
  }
  return {
    records: [...evidence.records],
    providerStartedIds: [...evidence.providerStartedAttemptIds],
  };
}

function assertRetryableAttempt(
  sourceDir: string,
  experiment: ExperimentManifest,
  attempt: ExperimentScheduledAttempt,
): void {
  const startedPath = join(sourceDir, attemptStartedFile(attempt.id));
  const terminalPath = join(sourceDir, attempt.file);
  if (existsSync(terminalPath)) {
    const matrix = matrixManifestFromExperiment(experiment);
    const expected = matrix.expectedAttempts[attempt.sequence - 1];
    if (!expected) throw new Error("retry source matrix attempt is missing");
    const record = parseRunRecord(readJsonNoSymlink(terminalPath), terminalPath, expected);
    if (record.outcome.status !== "failed") throw new Error("only failed or interrupted attempts may be retried");
    return;
  }
  if (!existsSync(startedPath)) throw new Error("retry source attempt was never started");
  const started = parseExperimentAttemptStartedRecord(readJsonNoSymlink(startedPath), startedPath);
  if (started.experimentId !== experiment.experimentId || started.attemptId !== attempt.id) {
    throw new Error("retry source start marker does not match its experiment");
  }
}

function assertRetryEnvironmentMatches(
  source: ExperimentManifest,
  current: ExperimentManifest,
): void {
  for (const [label, left, right] of [
    ["repository commit", source.repositoryCommit, current.repositoryCommit],
    ["protocol", source.protocol, current.protocol],
    ["hashes", source.hashes, current.hashes],
    ["models", source.models, current.models],
    ["runtime", source.runtime, current.runtime],
  ] as const) {
    if (canonicalJson(left) !== canonicalJson(right)) {
      throw new Error(`retry ${label} does not match the source experiment`);
    }
  }
}

function createUniqueRunDirectory(runsRoot: string, epochMs: number): string {
  mkdirSync(runsRoot, { recursive: true });
  const stem = isoTimestamp(epochMs).replace(/[:.]/g, "-");
  for (let suffix = 0; suffix < 1_000; suffix++) {
    const path = join(runsRoot, suffix === 0 ? stem : `${stem}-${String(suffix).padStart(3, "0")}`);
    try {
      mkdirSync(path);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("could not allocate a unique experiment directory");
}

function readJsonNoSymlink(path: string): unknown {
  return readExperimentJson(path);
}

function rawSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function gitObjectId(cwd: string, args: string[]): Promise<string> {
  const result = await exec("git", args, {
    cwd,
    timeoutMs: 10_000,
    env: nonSensitiveEnvironment(),
    inheritEnv: false,
  });
  const value = result.stdout.trim();
  if (result.code !== 0 || result.timedOut || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw new Error(`could not record repository Git identity for ${args.join(" ")}`);
  }
  return value;
}

function isoTimestamp(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new Error("experiment clock returned a non-finite value");
  return new Date(epochMs).toISOString();
}

function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export function failureOutcomeForArtifact(
  runner: RunnerName,
  error: unknown,
  durationMs: number,
): Extract<RunOutcome, { status: "failed" }> {
  const failureKind = runFailureKind(error);
  const message = safeDiagnostic(error instanceof Error ? error.message : String(error));
  const candidateTelemetry = runner === "mock" ? undefined : runFailureTelemetry(error);
  let telemetry = candidateTelemetry;
  let telemetryUnavailableReason: "not-observed" | "secret-redacted" | undefined;
  if (telemetry !== undefined) {
    try {
      assertNoSecrets(telemetry, "failure telemetry");
    } catch {
      telemetry = undefined;
      telemetryUnavailableReason = "secret-redacted";
    }
  } else if (runner !== "mock" &&
    (failureKind === "provider" || failureKind === "timeout" || failureKind === "parse")) {
    telemetryUnavailableReason = "not-observed";
  }
  return {
    status: "failed",
    failureKind,
    message,
    durationMs,
    ...(telemetry ? { telemetry } : {}),
    ...(telemetryUnavailableReason ? { telemetryUnavailableReason } : {}),
  };
}

function productionManifestSkillName(config: ReviewContext["config"], runner: RunnerName): string {
  if (runner === "claude") return config.runners.claude.skillName;
  if (runner === "codex") return config.runners.codex.skillName;
  if (config.runners.claude.skillName !== config.runners.codex.skillName) {
    throw new Error(
      "mock evaluation requires Claude and Codex to share one production manifest skill",
    );
  }
  return config.runners.claude.skillName;
}

/**
 * Cleanup is part of attempt validity, but it happens after provider work has
 * already been incurred. Convert the completed result to failure telemetry so
 * accounting retains known spend without persisting model output.
 */
function completedResultFailureTelemetry(result: EngineResult): RunFailureTelemetry | undefined {
  if (result.engine === "mock") return undefined;
  const stages = completedStages(result.raw);
  // An aggregate without its contributing requests cannot be reconciled during
  // strict artifact ingestion. Omit telemetry instead of inventing provenance.
  if (stages.length === 0) return undefined;
  return {
    engine: result.engine,
    modelConfig: result.modelConfig,
    usage: result.usage,
    durationMs: result.durationMs,
    stages,
  };
}

function completedStages(raw: unknown): StageTelemetry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  const breadth = completedStage("breadth", record.breadth);
  const investigation = completedStage("investigation", record.investigation);
  // Partial raw stage metadata cannot be reconciled with aggregate usage.
  return breadth && investigation ? [breadth, investigation] : [];
}

function completedStage(
  stage: StageTelemetry["stage"],
  value: unknown,
): StageTelemetry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.model !== "string" ||
    typeof record.promptSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.promptSha256) ||
    !record.usage || typeof record.usage !== "object" || Array.isArray(record.usage) ||
    !Number.isSafeInteger(record.durationMs) || Number(record.durationMs) < 0
  ) {
    return undefined;
  }
  return {
    stage,
    model: record.model,
    promptSha256: record.promptSha256,
    usage: record.usage as StageTelemetry["usage"],
    durationMs: Number(record.durationMs),
    completed: true,
  };
}

export function loadCaseSpec(caseDir: string): CaseSpec {
  const caseId = caseIdFromDirectory(caseDir);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8"));
  } catch (error) {
    throw new RunFailureError(
      "configuration",
      `case ${caseId}: could not load case.json: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunFailureError("configuration", `case ${caseId}: case.json must be an object`);
  }
  const spec = value as Partial<CaseSpec>;
  if (typeof spec.id !== "string") {
    throw new RunFailureError("configuration", `case ${caseId}: needs id`);
  }
  assertOpaqueCaseId(spec.id, `case ${caseId} id`);
  if (spec.id !== caseId) {
    throw new RunFailureError("configuration", `case ${caseId}: id must match its directory basename`);
  }
  if (!CASE_CORPORA.includes(spec.corpus as CaseCorpus)) {
    throw new RunFailureError("configuration", `case ${caseId}: invalid corpus`);
  }
  const directoryCorpus = corpusFromDirectory(caseDir);
  if (directoryCorpus && spec.corpus !== directoryCorpus) {
    throw new RunFailureError(
      "configuration",
      `case ${caseId}: corpus must match its parent directory ${directoryCorpus}`,
    );
  }
  if (spec.kind !== "seeded" && spec.kind !== "historical" && spec.kind !== "clean") {
    throw new RunFailureError("configuration", `case ${caseId}: invalid kind`);
  }
  if (typeof spec.diffFile !== "string" || spec.diffFile.length === 0) {
    throw new RunFailureError("configuration", `case ${caseId}: needs diffFile`);
  }
  if (spec.metadataFile !== undefined && typeof spec.metadataFile !== "string") {
    throw new RunFailureError("configuration", `case ${caseId}: metadataFile must be a string`);
  }
  if (
    spec.leakageExceptionsFile !== undefined &&
    typeof spec.leakageExceptionsFile !== "string"
  ) {
    throw new RunFailureError(
      "configuration",
      `case ${caseId}: leakageExceptionsFile must be a string`,
    );
  }
  if (spec.kind === "historical") {
    const historical = spec as Partial<Extract<CaseSpec, { kind: "historical" }>>;
    if (
      typeof historical.repoSource !== "string" ||
      typeof historical.baseCommit !== "string" ||
      typeof historical.headCommit !== "string"
    ) {
      throw new RunFailureError(
        "configuration",
        `case ${caseId}: historical cases need repoSource, baseCommit, and headCommit`,
      );
    }
    rejectUnexpectedKeys(value as Record<string, unknown>, [
      "id", "corpus", "kind", "repoSource", "baseCommit", "headCommit", "diffFile", "metadataFile", "leakageExceptionsFile",
    ], caseId);
  } else {
    const fixture = spec as Partial<Extract<CaseSpec, { kind: "seeded" | "clean" }>>;
    if (typeof fixture.fixtureDir !== "string" || fixture.fixtureDir.length === 0) {
      throw new RunFailureError("configuration", `case ${caseId}: fixture cases need fixtureDir`);
    }
    rejectUnexpectedKeys(value as Record<string, unknown>, [
      "id", "corpus", "kind", "fixtureDir", "diffFile", "metadataFile", "leakageExceptionsFile",
    ], caseId);
  }
  return spec as CaseSpec;
}

function discoverCases(
  casesDir: string,
  corpora?: CaseCorpus[],
): DiscoveredCase[] {
  const discovered: DiscoveredCase[] = [];
  for (const corpusEntry of readdirSync(casesDir, { withFileTypes: true })) {
    if (!corpusEntry.isDirectory()) {
      if (corpusEntry.name === "README.md" || corpusEntry.name === "case-aliases.json") continue;
      throw new Error(
        "unexpected case-root entry; expected only corpus directories and curator metadata",
      );
    }
    if (!CASE_CORPORA.includes(corpusEntry.name as CaseCorpus)) {
      throw new Error(
        "unexpected case directory; expected <cases-root>/<corpus>/<opaque-id>",
      );
    }
    const corpus = corpusEntry.name as CaseCorpus;
    const corpusDir = join(casesDir, corpus);
    for (const entry of readdirSync(corpusDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (entry.name === "README.md") continue;
        throw new Error(`unexpected ${corpus} corpus entry; expected an opaque case directory`);
      }
      try {
        assertOpaqueCaseId(entry.name, "case directory id");
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; expected <cases-root>/<corpus>/<opaque-id>`,
        );
      }
      const path = join(corpusDir, entry.name);
      const hasCaseSpec = readdirSync(path, { withFileTypes: true })
        .some((candidate) => candidate.isFile() && candidate.name === "case.json");
      if (!hasCaseSpec) {
        throw new Error(
          `case directory ${relative(casesDir, path)} is missing case.json; refusing to construct a partial manifest`,
        );
      }
      if (!corpora || corpora.includes(corpus)) {
        discovered.push({
          caseName: relative(casesDir, path),
          caseDir: path,
          corpus,
          expectedBugCount: readExpectedBugCount(path),
        });
      }
    }
  }
  discovered.sort((left, right) => left.caseName.localeCompare(right.caseName));
  const ids = new Set<string>();
  for (const item of discovered) {
    const id = basename(item.caseDir);
    if (ids.has(id)) throw new Error(`duplicate opaque case id ${id}`);
    ids.add(id);
  }
  return discovered;
}

function readExpectedBugCount(caseDir: string): number | null {
  try {
    const value = JSON.parse(readFileSync(join(caseDir, "ground_truth.json"), "utf8"));
    return parseGroundTruth(value).bugs.length;
  } catch {
    return null;
  }
}

function validateMatrixCaseSelection(matrix: MatrixConfig): void {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    throw new Error("matrix config must be an object");
  }
  if (!Number.isSafeInteger(matrix.repeats) || matrix.repeats < 1) {
    throw new Error("matrix repeats must be a positive integer");
  }
  if (!Array.isArray(matrix.configs)) throw new Error("matrix configs must be an array");
  if (matrix.experiment !== undefined) {
    const unexpected = Object.keys(matrix).filter(
      (key) => !["repeats", "configs", "corpora", "experiment"].includes(key),
    );
    if (unexpected.length > 0) {
      throw new Error(`matrix config contains unsupported field ${unexpected[0]}`);
    }
  }
  for (const [index, config] of matrix.configs.entries()) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`matrix configs[${index}] must be an object`);
    }
    if (typeof config.name !== "string" || !config.name.trim()) {
      throw new Error(`matrix configs[${index}].name must be a non-empty string`);
    }
    if (!(["claude", "codex", "mock"] as const).includes(config.runner)) {
      throw new Error(`matrix configs[${index}].runner is invalid`);
    }
    if (config.overrides !== undefined &&
      (!config.overrides || typeof config.overrides !== "object" || Array.isArray(config.overrides))) {
      throw new Error(`matrix configs[${index}].overrides must be an object`);
    }
  }
  const configNames = matrix.configs.map((config) => config.name);
  if (new Set(configNames).size !== configNames.length) {
    throw new Error("matrix config names must not contain duplicates");
  }
  if (matrix.corpora === undefined) return;
  if (
    !Array.isArray(matrix.corpora) ||
    matrix.corpora.length === 0 ||
    matrix.corpora.some((corpus) => !CASE_CORPORA.includes(corpus))
  ) {
    throw new Error(`matrix corpora must be a non-empty subset of: ${CASE_CORPORA.join(", ")}`);
  }
  if (new Set(matrix.corpora).size !== matrix.corpora.length) {
    throw new Error("matrix corpora must not contain duplicates");
  }
}

function rejectUnexpectedKeys(
  value: Record<string, unknown>,
  allowed: string[],
  caseId: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new RunFailureError(
      "configuration",
      `case ${caseId}: contains unsupported fields; answer-bearing notes belong outside model inputs`,
    );
  }
}
