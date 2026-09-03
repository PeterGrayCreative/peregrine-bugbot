import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseMatrixRunManifest } from "./artifacts.js";
import { readCaseGroundTruth } from "./case-truth.js";
import { acquireExperimentLock, hashExperimentCorpus, readExperimentJson } from "./experiment.js";
import { requireValidExperimentTerminalSeal } from "./experiment-seals.js";
import { buildSemanticJudgePrompt } from "./grade.js";
import { buildJudgeManifest, runJudgeLedger, type JudgePairInput, type JudgeRunResult } from "./judge-ledger.js";
import {
  CODEX_SEMANTIC_JUDGE,
  createContainedCodexSemanticJudge,
  semanticJudgeImplementationSha256,
  type SemanticJudgeExecutor,
} from "./judge-runtime.js";
import { probeContainedRuntime } from "./runtime-containment.js";

export async function runSemanticJudge(
  runsDir: string,
  casesDir = "eval/cases",
  options: { execute?: SemanticJudgeExecutor } = {},
): Promise<JudgeRunResult> {
  const root = resolve(runsDir);
  const release = acquireExperimentLock(root);
  try {
    return await runSemanticJudgeLocked(root, casesDir, options);
  } finally {
    release();
  }
}

async function runSemanticJudgeLocked(
  root: string,
  casesDir: string,
  options: { execute?: SemanticJudgeExecutor },
): Promise<JudgeRunResult> {
  const matrixPath = join(root, "matrix-manifest.json");
  const matrix = parseMatrixRunManifest(readExperimentJson(matrixPath), matrixPath);
  const { seal, evidence } = requireValidExperimentTerminalSeal(root, matrix);
  const declared = evidence.experiment.protocol.judge;
  if (declared.kind !== CODEX_SEMANTIC_JUDGE.kind || declared.model !== CODEX_SEMANTIC_JUDGE.model ||
    declared.effort !== CODEX_SEMANTIC_JUDGE.effort || declared.version !== CODEX_SEMANTIC_JUDGE.version || !declared.limits) {
    throw new Error("immutable experiment does not declare the supported Luna medium semantic judge with separate limits");
  }
  if (evidence.experiment.protocol.providerCalls !== "allow") {
    throw new Error("immutable experiment denies provider calls; semantic judge execution is not authorized");
  }
  if (evidence.experiment.protocol.providerAccess === "not-applicable") {
    throw new Error("semantic judge requires an authenticated provider access mode");
  }
  const caseNames = [...new Set(evidence.experiment.schedule.map((item) => item.caseName))];
  const currentCorpus = hashExperimentCorpus(casesDir, caseNames);
  if (currentCorpus !== evidence.experiment.hashes.corpusSha256) throw new Error("case corpus changed after experiment creation");
  const currentImplementation = semanticJudgeImplementationSha256(declared);
  if (currentImplementation !== evidence.experiment.hashes.judgeSha256) throw new Error("semantic judge implementation changed after experiment creation");

  const pairs: JudgePairInput[] = [];
  for (const scheduledRun of evidence.experiment.schedule) {
    const record = evidence.records.find((item) => item.attemptId === scheduledRun.id);
    if (!record || record.outcome.status !== "completed") continue;
    const truth = readCaseGroundTruth(casesDir, scheduledRun.caseName);
    for (const bug of truth.bugs) {
      for (const [findingIndex, finding] of record.outcome.result.findings.entries()) {
        pairs.push({
          runAttemptId: scheduledRun.id,
          bug,
          finding,
          findingIndex,
          prompt: buildSemanticJudgePrompt(finding, bug),
        });
      }
    }
  }
  const judgeManifest = buildJudgeManifest({
    experimentId: evidence.experiment.experimentId,
    experimentManifestSha256: rawSha256(join(root, "experiment-manifest.json")),
    experimentTerminalSealSha256: rawSha256(join(root, "experiment-terminal-seal.json")),
    corpusSha256: currentCorpus,
    judgeImplementationSha256: currentImplementation,
    providerAccess: evidence.experiment.protocol.providerAccess,
    limits: declared.limits,
    pairs,
  });
  if (!options.execute) {
    await probeContainedRuntime({
      runner: "codex",
      providerAccess: evidence.experiment.protocol.providerAccess,
    });
  }
  return runJudgeLedger({
      runDirectory: root,
      manifest: judgeManifest,
      pairs,
      execute: options.execute ?? createContainedCodexSemanticJudge({
        providerAccess: evidence.experiment.protocol.providerAccess,
      }),
  });
}

function rawSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
