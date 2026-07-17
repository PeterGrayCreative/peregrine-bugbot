import { Octokit } from "@octokit/rest";
import type { EngineResult, Finding, PeregrineConfig } from "../types.js";
import { extractFingerprints, fingerprint, marker } from "./fingerprint.js";

export interface PostTarget {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
}

const SEVERITY_EMOJI: Record<Finding["severity"], string> = {
  high: "🔴",
  medium: "🟠",
  low: "🟡",
};

function renderComment(f: Finding, fp: string): string {
  return [
    `${SEVERITY_EMOJI[f.severity]} **${f.title}** (\`${f.category}\`, confidence ${(f.confidence * 100).toFixed(0)}%)`,
    ``,
    f.explanation,
    ``,
    `**How it fails:** ${f.failurePath}`,
    ``,
    marker(fp),
  ].join("\n");
}

/**
 * Posts findings as a single PR review with inline comments.
 * Applies, in order: confidence threshold -> dedupe against already-posted
 * fingerprints -> per-PR comment cap. Also leaves a summary comment with
 * usage/cost so cost-per-PR is visible from day one.
 */
export async function postReview(
  result: EngineResult,
  target: PostTarget,
  config: PeregrineConfig,
  token: string,
): Promise<{ posted: number; skipped: number }> {
  const octokit = new Octokit({ auth: token });
  const { owner, repo, prNumber } = target;

  // Collect fingerprints we've already posted on this PR.
  const existing = new Set<string>();
  const reviewComments = await octokit.paginate(octokit.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  for (const c of reviewComments) {
    for (const fp of extractFingerprints(c.body ?? "")) existing.add(fp);
  }

  const eligible = result.findings
    .filter((f) => f.confidence >= config.limits.minConfidenceToPost)
    .map((f) => ({ f, fp: f.fingerprint ?? fingerprint(f) }))
    .filter(({ fp }) => !existing.has(fp))
    .sort((a, b) => b.f.confidence - a.f.confidence)
    .slice(0, config.limits.maxCommentsPerPr);

  const skipped = result.findings.length - eligible.length;

  if (eligible.length > 0) {
    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: target.headSha,
      event: "COMMENT",
      body: summaryBody(result, eligible.length, skipped),
      comments: eligible.map(({ f, fp }) => ({
        path: f.file,
        line: f.endLine,
        start_line: f.startLine < f.endLine ? f.startLine : undefined,
        side: "RIGHT" as const,
        body: renderComment(f, fp),
      })),
    });
  }

  return { posted: eligible.length, skipped };
}

function summaryBody(result: EngineResult, posted: number, skipped: number): string {
  const cost = result.usage.costUsd !== undefined ? `$${result.usage.costUsd.toFixed(3)}` : "n/a";
  return [
    `### 🦅 peregrine-bugbot`,
    ``,
    `${posted} finding(s) posted${skipped > 0 ? `, ${skipped} below threshold/duplicate` : ""}.`,
    ``,
    `<sub>engine: \`${result.engine}\` (${result.modelConfig}) · cost: ${cost} · ${(result.durationMs / 1000).toFixed(0)}s · mention \`@peregrine-bugbot\` for a deep re-review</sub>`,
  ].join("\n");
}
