import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { claudeSchemaJson, packageRoot, schemaPath } from "../src/core/paths.js";
import { exec, lastJsonBlock } from "../src/util/exec.js";
import type { EngineResult, Finding, GradedRun, GroundTruth, RunRecord } from "../src/types.js";
import type { GradingEvidence, SemanticJudgeDecision, UnmatchedFindingClassification } from "../src/types.js";
import {
  GRADING_VERSION,
  assertGradingEvidenceConsistent,
  classifyMissStage,
  classifyUnmatchedFindings,
  assertMatchReuseMatchesRootCause,
  resolveMatches,
  rootCauseKey,
  rootCauseMatches,
  semanticDecision,
} from "./grading-contract.js";
import { readAdjudications } from "./semantic-artifacts.js";
import { readCaseGroundTruth } from "./case-truth.js";
import {
  assertGradedMatchesRun,
  isLegacyMatrixRunManifest,
  isPreTelemetryMatrixRunManifest,
  parseLegacyCompletedRun,
  parseLegacyMatrixRunManifest,
  parseLegacySchemaV1RunRecord,
  parseMatrixRunManifest,
  parseGradedRun,
  parsePreTelemetryMatrixRunManifest,
  parsePreTelemetryRunRecord,
  parseRunRecord,
  type LegacySchemaV1GradedRun,
  type PreTelemetryGradedRun,
  type PreTelemetryRunRecord,
  type LegacySchemaV1RunRecord,
} from "./artifacts.js";
import {
  EXPERIMENT_METADATA_FILENAMES,
  type ExperimentRunEvidence,
} from "./experiment-evidence.js";
import {
  acquireExperimentLock,
  canonicalJson,
  canonicalJsonSha256,
  hashExperimentCorpus,
  hashPathTree,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import { preflightTrackedRunSet } from "./report.js";
import {
  EXPERIMENT_GRADING_SEAL_FILENAME,
  EXPERIMENT_TERMINAL_SEAL_FILENAME,
  requireValidExperimentGradingSeal,
  requireValidExperimentTerminalSeal,
  writeExperimentGradingSeal,
} from "./experiment-seals.js";

type LegacyRunRecord = Omit<RunRecord, "schemaVersion" | "attemptId" | "finishedAt" | "attemptDurationMs" | "outcome" | "caseCorpus" | "runner"> & {
  result: EngineResult;
};

/**
 * Grades each run against its case's ground_truth.json.
 *
 * Matching strategy:
 *  - JUDGE=claude or JUDGE=codex: a fixed judge model decides whether a finding
 *    describes the same root cause as a known bug. The judge is blind — it
 *    never sees which engine/models produced the finding, so it can't play
 *    favorites. Calibrate it early by human-spot-checking ~20% of judgments.
 *  - JUDGE=exact (default): file match + line-range overlap. Free and deterministic,
 *    useful for CI smoke tests and the mock engine, but too brittle to
 *    compare real models with.
 *
 * Unmatched fix-in-pr findings count as false positives. Follow-up findings are
 * retained for analysis but are not scored as incorrect PR demands.
 */
type Judge = "exact" | "claude" | "codex";
export type JudgeSelection =
  | { kind: "exact" }
  | { kind: Exclude<Judge, "exact">; model: string };

interface GradeRunsOptions {
  /** Test/embedding hook invoked after grades are durable but before the final corpus check and seal. */
  beforeExperimentSeal?: () => void;
}

export async function gradeRuns(
  runsDir?: string,
  casesDir = "eval/cases",
  options: GradeRunsOptions = {},
): Promise<void> {
  const dir = resolve(runsDir ?? latestRunsDir());
  const releaseLock = experimentMetadataPresent(dir) ? acquireExperimentLock(dir) : undefined;
  try {
    await gradeRunsLocked(dir, casesDir, options);
  } finally {
    releaseLock?.();
  }
}

async function gradeRunsLocked(dir: string, casesDir: string, options: GradeRunsOptions): Promise<void> {
  const manifestPath = join(dir, "matrix-manifest.json");
  const manifestValue: unknown = existsSync(manifestPath)
    ? readExperimentJson(manifestPath)
    : undefined;
  let manifest: ReturnType<typeof parseMatrixRunManifest> | undefined;
  let preTelemetryManifest: ReturnType<typeof parsePreTelemetryMatrixRunManifest> | undefined;
  let legacyManifest: ReturnType<typeof parseLegacyMatrixRunManifest> | undefined;
  if (manifestValue !== undefined) {
    try {
      manifest = parseMatrixRunManifest(manifestValue, manifestPath);
    } catch (error) {
      if (isPreTelemetryMatrixRunManifest(manifestValue)) {
        preTelemetryManifest = parsePreTelemetryMatrixRunManifest(manifestValue, manifestPath);
      } else if (isLegacyMatrixRunManifest(manifestValue)) {
        legacyManifest = parseLegacyMatrixRunManifest(manifestValue, manifestPath);
      } else {
        throw error;
      }
    }
  }
  const hasExperimentMetadata = experimentMetadataPresent(dir);
  if (hasExperimentMetadata && !manifest) {
    throw new Error("experiment metadata requires a current matrix manifest");
  }
  const experiment = manifest && hasExperimentMetadata
    ? requireValidExperimentTerminalSeal(dir, manifest).evidence
    : undefined;
  const experimentCaseNames = experiment
    ? [...new Set(experiment.experiment.schedule.map((attempt) => attempt.caseName))]
    : undefined;
  if (experiment && experimentCaseNames) {
    assertExperimentCorpusUnchanged(casesDir, experimentCaseNames, experiment.experiment.hashes.corpusSha256);
  }
  if (manifest) preflightTrackedRunSet(dir, resolve(casesDir), manifest);

  const experimentTruth = experiment && experimentCaseNames
    ? new Map(experimentCaseNames.map((caseName) => [caseName, readCaseGroundTruth(casesDir, caseName)]))
    : undefined;
  if (experiment && experimentCaseNames) {
    // Authenticate the exact ground-truth snapshot used below, closing the gap
    // between the initial corpus check and loading the individual truth files.
    assertExperimentCorpusUnchanged(casesDir, experimentCaseNames, experiment.experiment.hashes.corpusSha256);
  }

  const judge = experiment
    ? experimentJudgeSelection(experiment)
    : legacyJudgeSelection();
  if (experiment && existsSync(join(dir, EXPERIMENT_GRADING_SEAL_FILENAME))) {
    requireValidExperimentGradingSeal(dir, manifest!);
    console.log("Experiment grading already complete (seal validated).");
    return;
  }
  const expectedByFile = new Map(
    (manifest?.expectedAttempts ?? preTelemetryManifest?.expectedAttempts ?? legacyManifest?.expectedAttempts ?? [])
      .map((attempt) => [attempt.file, attempt]),
  );
  const metadataFiles = experimentMetadataFiles(experiment !== undefined);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".graded.json") &&
      !metadataFiles.has(f) && f !== "benchmark.json",
  );

  for (const file of files) {
    const path = join(dir, file);
    const raw: unknown = experiment ? readExperimentJson(path) : JSON.parse(readFileSync(path, "utf8"));
    const expected = expectedByFile.get(file);
    if ((manifest || preTelemetryManifest || legacyManifest) && !expected) {
      throw new Error(`${file}: run artifact is not declared by matrix manifest`);
    }
    const run: RunRecord | PreTelemetryRunRecord | LegacySchemaV1RunRecord | LegacyRunRecord = manifest
      ? parseRunRecord(raw, path, expected as (typeof manifest.expectedAttempts)[number])
      : preTelemetryManifest
        ? parsePreTelemetryRunRecord(
            raw,
            path,
            expected as (typeof preTelemetryManifest.expectedAttempts)[number],
          )
        : legacyManifest
          ? parseLegacySchemaV1RunRecord(raw, path, expected as (typeof legacyManifest.expectedAttempts)[number])
          : parseLegacyRun(raw, path);
    let result: EngineResult;
    if ("outcome" in run) {
      if (run.outcome.status === "failed") {
        console.log(`${file}: not graded (${run.outcome.failureKind} failure)`);
        continue;
      }
      result = run.outcome.result;
    } else {
      result = run.result;
    }
    const gt = (experimentTruth?.get(run.caseName) ?? readCaseGroundTruth(casesDir, run.caseName)) as GroundTruth;
    const gradedPath = join(dir, file.replace(/\.json$/, ".graded.json"));
    if (experiment && existsSync(gradedPath)) {
      const experimentAttempt = experiment.experiment.schedule.find((attempt) => attempt.file === file);
      if (!manifest || !experimentAttempt || !("outcome" in run)) {
        throw new Error("experiment grade validation requires a current tracked run");
      }
      const existing = parseGradedRun(
        readExperimentJson(gradedPath),
        gradedPath,
        experimentAttempt,
      );
      try {
        assertGradedMatchesRun(existing, run, gradedPath);
        assertGradeMatchesGroundTruth(existing, gt, gradedPath);
      } catch (error) {
        if (judge.kind === "exact") {
          throw new Error(`${gradedPath} does not match deterministic exact-v1 grading`, { cause: error });
        }
        throw error;
      }
      if (judge.kind !== "exact") {
        throw new Error("resuming semantic experiment grading requires a sealed judge ledger");
      }
      const expectedGrade = await gradeResult(result, gt, judge);
      if (canonicalJson({
        matches: existing.matches,
        falsePositiveIndexes: existing.falsePositiveIndexes,
        grading: existing.grading,
      }) !== canonicalJson({
        matches: expectedGrade.matches,
        falsePositiveIndexes: expectedGrade.falsePositiveIndexes,
        grading: expectedGrade.grading,
      })) {
        throw new Error(`${gradedPath} does not match deterministic exact-v1 grading`);
      }
      console.log(`${file}: already graded (validated)`);
      continue;
    }

    const grade = await gradeResult(result, gt, judge, readAdjudications(casesDir, run.caseName));
    const { matches, falsePositiveIndexes } = grade;

    const normalizedRun = "outcome" in run
      ? run
      : {
          ...run,
          schemaVersion: 1 as const,
          attemptId: `${run.configName}--${run.caseName}--${run.repeat}`,
          caseCorpus: "unknown" as const,
          runner: result.engine,
          finishedAt: run.startedAt,
          outcome: { status: "completed" as const, result },
        };
    const graded: GradedRun | PreTelemetryGradedRun | LegacySchemaV1GradedRun = {
      ...normalizedRun,
      outcome: { status: "completed", result },
      matches,
      falsePositiveIndexes,
      ...(manifest ? { grading: grade.grading } : {}),
    };
    if (experiment) writeExclusiveJson(dir, gradedPath, graded);
    else writeFileSync(gradedPath, JSON.stringify(graded, null, 2));
    const found = Object.values(matches).filter((m) => m !== null).length;
    console.log(
      `${file}: ${found}/${gt.bugs.length} bugs found, ${graded.falsePositiveIndexes.length} FP`,
    );
  }
  if (experiment && experimentCaseNames) {
    options.beforeExperimentSeal?.();
    assertExperimentCorpusUnchanged(casesDir, experimentCaseNames, experiment.experiment.hashes.corpusSha256);
    writeExperimentGradingSeal(dir, manifest!, new Date().toISOString());
  }
  console.log(`\nNext: npm run eval:report -- --runs ${dir}`);
}

function assertExperimentCorpusUnchanged(
  casesDir: string,
  caseNames: readonly string[],
  expectedSha256: string,
): void {
  if (hashExperimentCorpus(casesDir, caseNames) !== expectedSha256) {
    throw new Error("experiment corpus no longer matches the immutable manifest");
  }
}

export async function gradeResult(
  result: EngineResult,
  groundTruth: GroundTruth,
  judge: JudgeSelection,
  adjudications = new Map<string, UnmatchedFindingClassification>(),
  semanticMatcher: typeof semanticMatch = semanticMatch,
): Promise<Pick<GradedRun, "matches" | "falsePositiveIndexes"> & { grading: GradingEvidence }> {
  const candidates: Array<{ bugId: string; findingIndex: number; sameRootCause: boolean; decisionId?: string }> = [];
  const decisions: SemanticJudgeDecision[] = [];
  const claimedFindingGroups = new Map<number, string>();
  for (const bug of groundTruth.bugs) {
    for (let i = 0; i < result.findings.length; i++) {
      const finding = result.findings[i]!;
      let isMatch = false;
      if (judge.kind === "exact") {
        isMatch = exactMatch(finding, bug);
      } else {
        try {
          isMatch = await semanticMatcher(judge.kind, judge.model, finding, bug);
          decisions.push(semanticDecision(bug, finding, isMatch ? "same-root-cause" : "different-root-cause"));
        } catch (error) {
          decisions.push(semanticDecision(bug, finding, "failed", semanticFailureKind(error)));
          continue;
        }
      }
      if (isMatch) {
        const group = rootCauseKey(bug);
        const claimed = claimedFindingGroups.get(i);
        if (claimed !== undefined && claimed !== group) continue;
        claimedFindingGroups.set(i, group);
        candidates.push({ bugId: bug.id, findingIndex: i, sameRootCause: true });
        break;
      }
    }
  }
  const matches = resolveMatches(groundTruth, result.findings.length, candidates);
  const unmatchedFindings = classifyUnmatchedFindings(result.findings, matches, adjudications).map((item) =>
    judge.kind === "exact" ? { ...item, classification: "unsupported" as const } : item);
  return {
    matches,
    // Compatibility field: only curator-confirmed unsupported findings are false
    // discoveries. Exact structural smoke retains its deterministic transport check.
    falsePositiveIndexes: judge.kind === "exact"
      ? unmatchedFindings.map((item) => item.findingIndex)
      : unmatchedFindings.filter((item) => item.classification === "unsupported").map((item) => item.findingIndex),
    grading: {
      version: GRADING_VERSION,
      judge: { kind: judge.kind, version: judge.kind === "exact" ? "exact-v1" : "semantic-v1" },
      decisions,
      rootCauseMatches: rootCauseMatches(groundTruth, matches),
      missStages: Object.fromEntries(groundTruth.bugs.map((bug) => [
        bug.id,
        classifyMissStage({
          matched: matches[bug.id] !== null,
          // Until runner-owned routing/breadth/budget/presentation evidence is
          // present, fail closed instead of guessing a behavioral miss stage.
          infrastructureFailure: matches[bug.id] === null,
        }),
      ])),
      unmatchedFindings,
    },
  };
}

function experimentMetadataPresent(dir: string): boolean {
  return [
    EXPERIMENT_METADATA_FILENAMES.experimentManifest,
    EXPERIMENT_METADATA_FILENAMES.experimentStop,
    EXPERIMENT_METADATA_FILENAMES.stateDirectory,
    EXPERIMENT_TERMINAL_SEAL_FILENAME,
    EXPERIMENT_GRADING_SEAL_FILENAME,
  ].some((name) => existsSync(join(dir, name)));
}

function experimentMetadataFiles(includeExperiment: boolean): ReadonlySet<string> {
  return new Set([
    EXPERIMENT_METADATA_FILENAMES.matrixManifest,
    ...(includeExperiment
      ? [
          EXPERIMENT_METADATA_FILENAMES.experimentManifest,
          EXPERIMENT_METADATA_FILENAMES.experimentStop,
          EXPERIMENT_TERMINAL_SEAL_FILENAME,
          EXPERIMENT_GRADING_SEAL_FILENAME,
        ]
      : []),
  ]);
}

function legacyJudgeSelection(): JudgeSelection {
  const kind = parseJudge(process.env.JUDGE ?? "exact");
  if (kind === "exact") return { kind };
  const config = loadConfig();
  const model = process.env.PEREGRINE_JUDGE_MODEL ??
    (kind === "codex"
      ? process.env.PEREGRINE_CODEX_JUDGE_MODEL ?? config.runners.codex.investigationModel
      : process.env.PEREGRINE_CLAUDE_JUDGE_MODEL ?? config.runners.claude.investigationModel);
  return { kind, model };
}

function experimentJudgeSelection(evidence: ExperimentRunEvidence): JudgeSelection {
  const declared = evidence.experiment.protocol.judge;
  const currentJudgeSha256 = canonicalJsonSha256({
    implementation: hashPathTree(join(packageRoot(), "eval", "grade.ts")),
    gradingContract: hashPathTree(join(packageRoot(), "eval", "grading-contract.ts")),
    resultSchema: hashPathTree(schemaPath("judge-result")),
    evidenceSchema: hashPathTree(join(packageRoot(), "schemas", "grading-evidence.schema.json")),
    judge: declared,
  });
  if (currentJudgeSha256 !== evidence.experiment.hashes.judgeSha256) {
    throw new Error("experiment judge implementation no longer matches the immutable manifest");
  }
  const expectedVersion = declared.kind === "exact" ? "exact-v1" : "semantic-v1";
  if (declared.version !== expectedVersion) {
    throw new Error(
      `experiment judge version ${JSON.stringify(declared.version)} is not supported; expected ${expectedVersion}`,
    );
  }
  if (process.env.JUDGE !== undefined) {
    const requested = parseJudge(process.env.JUDGE);
    if (requested !== declared.kind) {
      throw new Error(
        `JUDGE=${requested} conflicts with immutable experiment judge ${declared.kind}`,
      );
    }
  }
  if (declared.kind === "exact") {
    const modelOverrides = [
      "PEREGRINE_JUDGE_MODEL",
      "PEREGRINE_CLAUDE_JUDGE_MODEL",
      "PEREGRINE_CODEX_JUDGE_MODEL",
    ].filter((name) => process.env[name] !== undefined);
    if (modelOverrides.length > 0) {
      throw new Error(
        `${modelOverrides.join(", ")} conflicts with the immutable exact experiment judge`,
      );
    }
    return { kind: "exact" };
  }
  throw new Error(
    `experiment ${declared.kind} semantic grading remains disabled until contained judge execution and its separate budgeted ledger are integrated`,
  );
}

function assertGradeMatchesGroundTruth(
  graded: GradedRun,
  groundTruth: GroundTruth,
  source: string,
): void {
  const expectedIds = groundTruth.bugs.map((bug) => bug.id).sort();
  const actualIds = Object.keys(graded.matches).sort();
  if (expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])) {
    throw new Error(`${source}.matches does not match ground truth bug IDs`);
  }
  assertMatchReuseMatchesRootCause(groundTruth, graded.matches, source);
  if (graded.grading) {
    assertGradingEvidenceConsistent(
      groundTruth,
      graded.outcome.result.findings,
      graded.matches,
      graded.grading,
      source,
    );
  }
}

function parseLegacyRun(value: unknown, source: string): LegacyRunRecord {
  const parsed = parseLegacyCompletedRun(value, source);
  return {
    caseName: parsed.caseName,
    caseKind: parsed.caseKind,
    configName: parsed.configName,
    repeat: parsed.repeat,
    startedAt: parsed.startedAt,
    result: parsed.result,
  };
}

function parseJudge(value: string): Judge {
  if (value === "exact" || value === "claude" || value === "codex") return value;
  throw new Error(`JUDGE must be one of: exact, claude, codex (received ${JSON.stringify(value)})`);
}

function exactMatch(f: Finding, bug: { file: string; startLine: number; endLine: number }): boolean {
  return (
    f.file === bug.file && f.startLine <= bug.endLine + 2 && f.endLine >= bug.startLine - 2
  );
}

async function semanticMatch(
  judge: Exclude<Judge, "exact">,
  model: string,
  f: Finding,
  bug: GroundTruth["bugs"][number],
): Promise<boolean> {
  const prompt = buildSemanticJudgePrompt(f, bug);

  return judge === "claude" ? claudeMatch(model, prompt) : codexMatch(model, prompt);
}

export function buildSemanticJudgePrompt(f: Finding, bug: GroundTruth["bugs"][number]): string {
  return [
    `You are grading a code-review benchmark. Answer with JSON only: {"same_root_cause": true|false}`,
    ``,
    `Known bug (ground truth): in ${bug.file} — ${bug.description}`,
    `Reachable preconditions: ${bug.reachablePreconditions}`,
    `Observable impact: ${bug.observableImpact}`,
    ``,
    `Reviewer finding: in ${f.file} lines ${f.startLine}-${f.endLine} — ${f.title}. ${f.explanation}`,
    ``,
    `Does the finding describe the same underlying bug (same root cause), even if`,
    `worded differently or pointing at a slightly different line?`,
  ].join("\n");
}

function semanticFailureKind(error: unknown): SemanticJudgeDecision["failureKind"] {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout")) return "timeout";
  if (message.includes("parse") || message.includes("unparseable") || message.includes("invalid verdict")) return "parse";
  if (message.includes("config")) return "configuration";
  if (message.includes("failed")) return "provider";
  return "unknown";
}

async function claudeMatch(model: string, prompt: string): Promise<boolean> {
  const res = await exec(
    "claude",
    [
      "-p",
      prompt,
      "--model",
      model,
      "--output-format",
      "json",
      "--json-schema",
      claudeSchemaJson("judge-result"),
      "--max-turns",
      "1",
      "--permission-mode",
      "dontAsk",
      "--no-session-persistence",
    ],
    { timeoutMs: 60_000 },
  );
  if (res.timedOut || res.code !== 0) {
    throw new Error(
      `Claude judge failed (${model}): ${res.timedOut ? "timeout" : (res.stderr || res.stdout).slice(0, 300)}. ` +
        `Use JUDGE=exact for keyless smoke runs.`,
    );
  }
  let verdict: { same_root_cause?: boolean } | undefined;
  try {
    const parsed = JSON.parse(res.stdout) as {
      structured_output?: unknown;
      result?: unknown;
    };
    verdict = (parsed.structured_output ??
      (typeof parsed.result === "object" ? parsed.result : lastJsonBlock(String(parsed.result ?? "")))) as
      | typeof verdict
      | undefined;
  } catch {
    /* handled below */
  }
  if (verdict?.same_root_cause === undefined) {
    throw new Error(
      `Claude judge returned an unparseable verdict: ${res.stdout.slice(0, 300)}`,
    );
  }
  return verdict.same_root_cause === true;
}

async function codexMatch(model: string, prompt: string): Promise<boolean> {
  const outputDir = mkdtempSync(join(tmpdir(), "peregrine-judge-"));
  const output = join(outputDir, "verdict.json");
  try {
    const res = await exec(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--strict-config",
        "--sandbox",
        "read-only",
        "--model",
        model,
        "--config",
        'model_reasoning_effort="low"',
        "--cd",
        packageRoot(),
        "--output-schema",
        schemaPath("judge-result"),
        "--output-last-message",
        output,
        "--json",
        "--color",
        "never",
        "-",
      ],
      { cwd: packageRoot(), timeoutMs: 60_000, stdin: prompt },
    );
    if (res.timedOut || res.code !== 0) {
      throw new Error(
        `Codex judge failed (${model}): ${res.timedOut ? "timeout" : (res.stderr || res.stdout).slice(0, 300)}. ` +
          `Use JUDGE=exact for keyless smoke runs.`,
      );
    }
    const verdict = JSON.parse(readFileSync(output, "utf8")) as { same_root_cause?: unknown };
    if (typeof verdict.same_root_cause !== "boolean") {
      throw new Error(`Codex judge returned an invalid verdict: ${JSON.stringify(verdict).slice(0, 300)}`);
    }
    return verdict.same_root_cause;
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function latestRunsDir(): string {
  const runs = resolve("eval/runs");
  const dirs = readdirSync(runs).sort();
  const last = dirs[dirs.length - 1];
  if (!last) throw new Error("No run directories under eval/runs — run the matrix first.");
  return join(runs, last);
}
