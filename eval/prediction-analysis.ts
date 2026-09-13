import { digest, freeze, unique } from "./prediction-contract.js";
import { verifySyntheticAdjudicationBundle, verifySyntheticPredictionLedger, type SyntheticAdjudicationBundle, type SyntheticPredictionLedger } from "./prediction-adjudication.js";
import { type PredictionUsage, type SyntheticPredictionRun } from "./prediction-evidence.js";
import { type PredictionArm, type PredictionPlan } from "./prediction-plan.js";

export interface PredictionInterval { lower: number; upper: number }
export interface PairedPredictionInterval extends PredictionInterval { caseId: string }
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
function average(rows: PredictionInterval[]): PredictionInterval { return { lower: mean(rows.map(row => row.lower)), upper: mean(rows.map(row => row.upper)) }; }
function paired(A: PredictionInterval, B: PredictionInterval): PredictionInterval { return { lower: B.lower - A.upper, upper: B.upper - A.lower }; }
const zero = (): PredictionInterval => ({ lower: 0, upper: 0 });
const unknown = (): PredictionInterval => ({ lower: 0, upper: 1 });

/** Exhaustive assumption bounds, without sampling probabilities or calibrated inference. */
export function predictionLabelSensitivity(rows: PairedPredictionInterval[], maximumInvalid: number) {
  if (rows.length < 1 || rows.length > 16 || !Number.isInteger(maximumInvalid) || maximumInvalid < 0 || maximumInvalid > rows.length) throw new Error("invalid label sensitivity frame");
  unique(rows.map(row => row.caseId));
  if (rows.some(row => typeof row.caseId !== "string" || !row.caseId || !Number.isFinite(row.lower) || !Number.isFinite(row.upper) || row.lower < -1 || row.upper > 1 || row.lower > row.upper)) throw new Error("invalid paired intervals");
  let lower = Infinity, upper = -Infinity, scenarios = 0;
  for (let mask = 1; mask < 2 ** rows.length; mask++) {
    const retained = rows.filter((_, index) => mask & (1 << index));
    if (rows.length - retained.length > maximumInvalid) continue;
    const interval = average(retained); lower = Math.min(lower, interval.lower); upper = Math.max(upper, interval.upper); scenarios++;
  }
  return { maximumInvalid, lower, upper, scenarios, emptyTruthSetPossible: maximumInvalid === rows.length, emptyTruthSetResult: maximumInvalid === rows.length ? "undefined" : "excluded-by-assumption", interpretation: "assumption-bound-sensitivity-not-calibrated-inference" };
}

export function analyzeSyntheticPredictions(plan: PredictionPlan, run: SyntheticPredictionRun, bundle: SyntheticAdjudicationBundle, ledger: SyntheticPredictionLedger, predecessors: SyntheticPredictionLedger[] = []) {
  verifySyntheticAdjudicationBundle(plan, run, bundle); verifySyntheticPredictionLedger(bundle, ledger, predecessors);
  const attempts = run.attempts.map(attempt => {
    const scheduled = plan.registration.schedule.find(item => item.id === attempt.attemptId)!;
    const source = plan.cases.find(item => item.source.caseId === scheduled.caseId)!.source;
    const votes = bundle.binding.mapping.filter(item => item.attemptId === attempt.attemptId).map(item => ledger.judgments.find(row => row.findingId === item.id)!.final);
    const conflictingRoots = new Set(votes.filter(vote => new Set(votes.filter(other => other.causalRoot === vote.causalRoot).map(other => other.category)).size > 1).map(vote => vote.causalRoot));
    const matched = new Set(votes.filter(vote => !conflictingRoots.has(vote.causalRoot)).flatMap(vote => vote.matchedConditions));
    const disputed = conflictingRoots.size > 0 || votes.some(vote => vote.category === "unresolved");
    const complete = attempt.status === "completed";
    const full = source.conditions.every(condition => matched.has(condition.id));
    const observed = complete ? { lower: Number(full), upper: Number(full || disputed) } : zero();
    // Causal roots are predictions too. Inconsistent classifications within a deduplicated
    // root remain unresolved, including matched-vs-unsupported contradictions.
    const roots = [...new Set(votes.map(vote => vote.causalRoot))].map(root => {
      const categories = [...new Set(votes.filter(vote => vote.causalRoot === root).map(vote => vote.category))];
      return categories.length === 1 ? categories[0]! : "unresolved";
    });
    const unsupported = roots.filter(category => category === "predicted-unsupported").length;
    const unresolved = roots.filter(category => category === "unresolved").length;
    return { ...scheduled, status: attempt.status, complete, observed, missingExecution: complete ? observed : unknown(), unboundedMatching: complete ? unknown() : zero(),
      conditions: source.conditions.map(condition => ({ id: condition.id, coverage: complete ? { lower: Number(matched.has(condition.id)), upper: Number(matched.has(condition.id) || disputed) } : zero() })),
      unsupported, unresolved, roots: roots.length, rawFindings: attempt.findings.length, missingOutput: attempt.rawResponse === null };
  });
  const cases = plan.registration.cases.map(item => {
    const arms = Object.fromEntries((["A", "B"] as const).map(arm => {
      const rows = attempts.filter(row => row.caseId === item.caseId && row.arm === arm);
      return [arm, { observed: average(rows.map(row => row.observed)), missingExecution: average(rows.map(row => row.missingExecution)), unboundedMatching: average(rows.map(row => row.unboundedMatching)), unsupportedPerScheduledReview: mean(rows.map(row => row.unsupported)), unresolvedPerScheduledReview: mean(rows.map(row => row.unresolved)), rawFindingBurden: mean(rows.map(row => row.rawFindings)), completed: rows.filter(row => row.complete).length }];
    })) as Record<PredictionArm, { observed: PredictionInterval; missingExecution: PredictionInterval; unboundedMatching: PredictionInterval; unsupportedPerScheduledReview: number; unresolvedPerScheduledReview: number; rawFindingBurden: number; completed: number }>;
    return { caseId: item.caseId, repository: item.repository, family: item.family, proposedClass: item.proposedClass, arms,
      observed: paired(arms.A.observed, arms.B.observed), missingExecution: paired(arms.A.missingExecution, arms.B.missingExecution), unboundedMatching: paired(arms.A.unboundedMatching, arms.B.unboundedMatching) };
  });
  const bugs = cases.filter(item => item.proposedClass === "bug-bearing");
  const sensitivity = Object.fromEntries((["observed", "missingExecution", "unboundedMatching"] as const).map(mode => [mode, Array.from({ length: 10 }, (_, maximumInvalid) => predictionLabelSensitivity(bugs.map(item => ({ caseId: item.caseId, ...item[mode] })), maximumInvalid))]));
  const repositories = [...new Set(bugs.map(item => item.repository))];
  const repositoryViews = repositories.map(repository => ({ repository, caseCount: bugs.filter(item => item.repository === repository).length, ...average(bugs.filter(item => item.repository === repository).map(item => item.observed)) }));
  const families = [...new Set(bugs.map(item => item.family))];
  const familyViews = families.map(family => ({ family, caseCount: bugs.filter(item => item.family === family).length, ...average(bugs.filter(item => item.family === family).map(item => item.observed)) }));
  const noise = (["A", "B"] as const).map(arm => {
    const rows = attempts.filter(row => row.arm === arm);
    const sum = (key: "unsupported" | "unresolved" | "rawFindings" | "roots", selected = rows) => selected.reduce((total, row) => total + row[key], 0);
    const completed = rows.filter(row => row.complete);
    const comparisonCases = cases.filter(row => row.proposedClass === "reviewed-comparison");
    return { arm, scheduledReviews: rows.length, completedReviews: completed.length, incompleteReviews: rows.length - completed.length, missingOutputs: rows.filter(row => row.missingOutput).length,
      unsupportedRootsPerScheduledReview: sum("unsupported") / rows.length, unresolvedRootsPerScheduledReview: sum("unresolved") / rows.length, rawFindingBurdenPerScheduledReview: sum("rawFindings") / rows.length,
      unresolvedNoiseBounds: { lower: sum("unsupported") / rows.length, upper: (sum("unsupported") + sum("unresolved")) / rows.length },
      unrestrictedClassificationErrorBounds: { lower: 0, upper: sum("roots") / rows.length },
      completedOnly: completed.length === 0 ? null : { unsupportedRootsPerReview: sum("unsupported", completed) / completed.length, unresolvedRootsPerReview: sum("unresolved", completed) / completed.length, rawFindingBurdenPerReview: sum("rawFindings", completed) / completed.length },
      comparisonCasesWithPredictedUnsupportedRoot: comparisonCases.filter(item => rows.some(row => row.caseId === item.caseId && row.unsupported > 0)).length,
      comparisonCaseCount: comparisonCases.length,
    };
  });
  const familyNoise = (["A", "B"] as const).map(arm => {
    const groups = [...new Set(cases.map(item => item.family))].map(family => {
      const members = cases.filter(item => item.family === family);
      return { family, memberCount: members.length, unsupportedPerScheduledReview: mean(members.map(item => item.arms[arm].unsupportedPerScheduledReview)), unresolvedPerScheduledReview: mean(members.map(item => item.arms[arm].unresolvedPerScheduledReview)), rawFindingBurden: mean(members.map(item => item.arms[arm].rawFindingBurden)) };
    });
    return { arm, families: groups, unsupportedPerScheduledReview: mean(groups.map(row => row.unsupportedPerScheduledReview)), unresolvedPerScheduledReview: mean(groups.map(row => row.unresolvedPerScheduledReview)), rawFindingBurden: mean(groups.map(row => row.rawFindingBurden)) };
  });
  const usage = Object.fromEntries((Object.keys(run.attempts[0]!.usage) as (keyof PredictionUsage)[]).map(key => {
    const values = run.attempts.map(row => row.usage[key]);
    const observedValues = values.filter(value => value !== null);
    const observedTotal = observedValues.reduce((sum, value) => sum + value, 0);
    return [key, { total: values.every(value => value !== null) ? observedTotal : null, observedTotal: observedValues.length > 0 ? observedTotal : null, observedAttempts: observedValues.length, unknownAttempts: values.length - observedValues.length }];
  }));
  const body = { kind: "synthetic-prediction-analysis-v1", metric: "prediction agreement", interpretation: "descriptive AI predictions and assumption bounds; no efficacy or calibrated inference", runSha256: run.sha256, ledgerSha256: ledger.sha256,
    counts: { cases: cases.length, bugBundles: bugs.length, comparisons: cases.length - bugs.length, repositories: new Set(cases.map(item => item.repository)).size, families: new Set(cases.map(item => item.family)).size, conditions: plan.cases.reduce((sum, row) => sum + row.source.conditions.length, 0), repeats: 2, scheduledAttempts: attempts.length },
    predictionAgreement: average(bugs.map(item => item.observed)), sensitivity, attempts, cases,
    robustness: { repositoryViews, equalRepository: average(repositoryViews), leaveOneRepositoryOut: repositories.map(repository => ({ omitted: repository, ...average(bugs.filter(item => item.repository !== repository).map(item => item.observed)) })), familyViews, equalFamily: average(familyViews) },
    noise, familyNoise, usage,
    limitation: "Missing output and completion loss never certify absence of noise. Classification-error bounds apply only to emitted predicted roots. Frozen condition decomposition and arm-blinding of free-form content require external semantic review." };
  return freeze({ ...body, sha256: digest(body) });
}
