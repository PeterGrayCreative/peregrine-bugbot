import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CORE_LANE_IDS, type CoreLaneId } from "../src/core/lanes.js";
import type { CaseCorpus, CaseSpec, GroundTruth } from "../src/types.js";
import {
  leakagePolicyForCase,
  materializeCase,
  readSanitizedMetadata,
} from "./case-isolation.js";
import {
  parseHoldoutCommitment,
  readBehavioralCaseAdmission,
  type CaseCuration,
  type ChangeShape,
} from "./case-curation.js";
import { loadCaseSpec } from "./run-matrix.js";

const BEHAVIORAL_CORPORA = ["development", "validation"] as const;
type BehavioralCorpus = (typeof BEHAVIORAL_CORPORA)[number];

export interface CorpusValidationReport {
  schemaVersion: 1;
  visibleBaselineReady: boolean;
  finalHoldoutReady: boolean;
  totalCases: number;
  admittedCases: number;
  draftCases: number;
  bugCases: number;
  cleanCases: number;
  cleanFraction: number | null;
  multiObservationCases: number;
  largeDiffCases: number;
  repositories: number;
  languageFamilies: number;
  architectureFamilies: number;
  corpora: Record<BehavioralCorpus, { total: number; bug: number; clean: number }>;
  defectLaneCoverage: Record<BehavioralCorpus, CoreLaneId[]>;
  comparableCleanLaneCoverage: CoreLaneId[];
  changeShapeCoverage: ChangeShape[];
  holdoutCommitted: boolean;
  unmetRequirements: string[];
  holdoutRequirements: string[];
}

export interface ValidatedBehavioralCase {
  corpus: BehavioralCorpus;
  spec: CaseSpec;
  truth: GroundTruth;
  curation: CaseCuration;
}

export async function validateBehavioralCorpus(casesDir = "eval/cases"): Promise<CorpusValidationReport> {
  const root = realpathSync(resolve(casesDir));
  const cases: ValidatedBehavioralCase[] = [];
  const changeIdentities = new Set<string>();
  const aliasesByRepository = new Map<string, string>();
  const repositoriesByAlias = new Map<string, string>();

  for (const corpus of BEHAVIORAL_CORPORA) {
    const corpusDir = join(root, corpus);
    if (!existsSync(corpusDir) || !lstatSync(corpusDir).isDirectory()) {
      throw new Error(`behavioral corpus is missing ${corpus}/`);
    }
    for (const entry of readdirSync(corpusDir, { withFileTypes: true })) {
      if (entry.name === "README.md" && entry.isFile()) continue;
      if (!entry.isDirectory()) throw new Error(`${corpus}/${entry.name} is not a case directory`);
      const caseDir = join(corpusDir, entry.name);
      const spec = loadCaseSpec(caseDir);
      if (spec.corpus !== corpus) throw new Error(`${corpus}/${entry.name} declares the wrong corpus`);
      const { truth, curation } = readBehavioralCaseAdmission(caseDir, spec, { requireAdmitted: false });
      if (changeIdentities.has(curation.source.changeIdentitySha256)) {
        throw new Error(`${corpus}/${entry.name} reuses another case's source change identity`);
      }
      changeIdentities.add(curation.source.changeIdentitySha256);
      const priorAlias = aliasesByRepository.get(curation.source.repositoryIdentitySha256);
      if (priorAlias !== undefined && priorAlias !== curation.source.repositoryAlias) {
        throw new Error(`${corpus}/${entry.name} changes the alias for an existing repository identity`);
      }
      const priorIdentity = repositoriesByAlias.get(curation.source.repositoryAlias);
      if (priorIdentity !== undefined && priorIdentity !== curation.source.repositoryIdentitySha256) {
        throw new Error(`${corpus}/${entry.name} reuses a repository alias for a different identity`);
      }
      aliasesByRepository.set(curation.source.repositoryIdentitySha256, curation.source.repositoryAlias);
      repositoriesByAlias.set(curation.source.repositoryAlias, curation.source.repositoryIdentitySha256);
      await verifySafeMaterialization(caseDir, spec, truth);
      cases.push({ corpus, spec, truth, curation });
    }
  }

  const holdoutPath = join(dirname(root), "holdout-commitment.json");
  const holdoutCommitted = existsSync(holdoutPath);
  if (holdoutCommitted) {
    parseHoldoutCommitment(JSON.parse(readFileSync(holdoutPath, "utf8")) as unknown);
  }
  return buildCorpusValidationReport(cases, holdoutCommitted);
}

async function verifySafeMaterialization(caseDir: string, spec: CaseSpec, truth: GroundTruth): Promise<void> {
  const policy = leakagePolicyForCase(caseDir, spec);
  readSanitizedMetadata(caseDir, spec, policy);
  const materialized = await materializeCase(caseDir, spec, policy, { prepareProviderAssets: false });
  try {
    for (const bug of truth.bugs) verifyBugLineRange(materialized.repoPath, bug, spec.id);
  } finally {
    materialized.cleanup();
  }
}

function verifyBugLineRange(
  repoPath: string,
  bug: GroundTruth["bugs"][number],
  caseId: string,
): void {
  const root = realpathSync(repoPath);
  const path = resolve(root, bug.file);
  if (!path.startsWith(`${root}${sep}`) || !existsSync(path)) {
    throw new Error(`${caseId} truth file is absent from the reviewed head`);
  }
  const resolved = realpathSync(path);
  if (!resolved.startsWith(`${root}${sep}`) || resolved !== path || !lstatSync(resolved).isFile()) {
    throw new Error(`${caseId} truth file must be a direct regular file in the reviewed head`);
  }
  const bytes = readFileSync(resolved);
  if (bytes.includes(0)) throw new Error(`${caseId} truth line range cannot target a binary file`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${caseId} truth line range cannot target a non-UTF-8 file`);
  }
  const lineCount = bytes.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (bug.endLine > lineCount) throw new Error(`${caseId} truth line range exceeds its reviewed-head file`);
}

export function buildCorpusValidationReport(
  cases: readonly ValidatedBehavioralCase[],
  holdoutCommitted: boolean,
): CorpusValidationReport {
  const admitted = cases.filter((item) => item.curation.status === "admitted");
  const byCorpus = Object.fromEntries(BEHAVIORAL_CORPORA.map((corpus) => {
    const selected = admitted.filter((item) => item.corpus === corpus);
    return [corpus, {
      total: selected.length,
      bug: selected.filter((item) => item.spec.kind !== "clean").length,
      clean: selected.filter((item) => item.spec.kind === "clean").length,
    }];
  })) as CorpusValidationReport["corpora"];
  const defectLaneCoverage = Object.fromEntries(BEHAVIORAL_CORPORA.map((corpus) => [
    corpus,
    CORE_LANE_IDS.filter((lane) => admitted.some((item) => item.corpus === corpus &&
      item.spec.kind !== "clean" && item.truth.bugs.some((bug) => bug.lane === lane))),
  ])) as CorpusValidationReport["defectLaneCoverage"];
  const comparableCleanLaneCoverage = CORE_LANE_IDS.filter((lane) => admitted.some((item) =>
    item.spec.kind === "clean" && item.curation.strata.surfaceLanes.includes(lane)));
  const shapeCoverage = (["direct", "large-diff", "multi-observation", "seam"] as const)
    .filter((shape) => admitted.some((item) => item.curation.strata.changeShapes.includes(shape)));
  const bugCases = admitted.filter((item) => item.spec.kind !== "clean").length;
  const cleanCases = admitted.length - bugCases;
  const multiObservationCases = admitted.filter((item) =>
    item.curation.strata.changeShapes.includes("multi-observation")).length;
  const unmetRequirements: string[] = [];
  if (cases.some((item) => item.curation.status !== "admitted")) unmetRequirements.push("every visible behavioral case is admitted");
  if (admitted.length < 36) unmetRequirements.push("at least 36 admitted visible cases");
  if (byCorpus.development.bug < 12 || byCorpus.development.clean < 8) {
    unmetRequirements.push("development contains at least 12 bug cases and 8 clean controls");
  }
  if (byCorpus.validation.bug < 12 || byCorpus.validation.clean < 4) {
    unmetRequirements.push("validation contains at least 12 bug cases and 4 clean controls");
  }
  if (admitted.length === 0 || cleanCases / admitted.length < 0.25) unmetRequirements.push("clean controls are at least 25% of visible cases");
  for (const corpus of BEHAVIORAL_CORPORA) {
    const missing = CORE_LANE_IDS.filter((lane) => !defectLaneCoverage[corpus].includes(lane));
    if (missing.length > 0) unmetRequirements.push(`${corpus} has a defect case for every core lane`);
  }
  if (comparableCleanLaneCoverage.length !== CORE_LANE_IDS.length) {
    unmetRequirements.push("clean controls cover surfaces comparable to every core lane");
  }
  if (multiObservationCases < 3) unmetRequirements.push("at least three multi-observation cases");
  const largeDiffCases = admitted.filter((item) => item.curation.strata.changeShapes.includes("large-diff")).length;
  if (largeDiffCases < 3) unmetRequirements.push("at least three realistic large-diff cases");
  if (!(["direct", "large-diff", "multi-observation", "seam"] as const).every((shape) => shapeCoverage.includes(shape))) {
    unmetRequirements.push("direct, seam, multi-observation, and large-diff shapes are represented");
  }
  const repositories = new Set(admitted.map((item) => item.curation.source.repositoryIdentitySha256)).size;
  const languageFamilies = new Set(admitted.map((item) => item.curation.strata.languageFamily)).size;
  const architectureFamilies = new Set(admitted.map((item) => item.curation.strata.architectureFamily)).size;
  if (repositories < 3) unmetRequirements.push("at least three independent source repositories");
  if (languageFamilies < 2) unmetRequirements.push("at least two language families");
  if (architectureFamilies < 2) unmetRequirements.push("at least two architecture families");
  const holdoutRequirements = holdoutCommitted
    ? []
    : ["external sealed holdout commitment metadata exists"];

  return {
    schemaVersion: 1,
    visibleBaselineReady: unmetRequirements.length === 0,
    finalHoldoutReady: unmetRequirements.length === 0 && holdoutRequirements.length === 0,
    totalCases: cases.length,
    admittedCases: admitted.length,
    draftCases: cases.length - admitted.length,
    bugCases,
    cleanCases,
    cleanFraction: admitted.length === 0 ? null : cleanCases / admitted.length,
    multiObservationCases,
    largeDiffCases,
    repositories,
    languageFamilies,
    architectureFamilies,
    corpora: byCorpus,
    defectLaneCoverage,
    comparableCleanLaneCoverage,
    changeShapeCoverage: shapeCoverage,
    holdoutCommitted,
    unmetRequirements,
    holdoutRequirements,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unexpected = args.filter((arg) => arg !== "--require-ready" && !arg.startsWith("--cases-dir="));
  if (unexpected.length > 0) throw new Error(`unsupported argument ${unexpected[0]}`);
  const casesArg = args.find((arg) => arg.startsWith("--cases-dir="));
  const report = await validateBehavioralCorpus(casesArg?.slice("--cases-dir=".length) || "eval/cases");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.includes("--require-ready") && !report.visibleBaselineReady) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
