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

/**
 * Lines that can carry an inline review comment: new-side lines that appear
 * in a diff hunk (added or context). The invariant-first skill deliberately
 * reports affected-surface findings in files/lines OUTSIDE the diff; GitHub
 * 422s the entire review if any single inline comment targets such a line,
 * so those findings must go in the review body instead.
 */
export function commentableLines(diffText: string): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  let current: Set<number> | undefined;
  let newLine = 0;
  // Strip only the final trailing newline: splitting it would yield a phantom
  // "" context line and mark a nonexistent line commentable (=> 422 on post).
  // Mid-hunk blank lines stay counted — git emits them space-prefixed, but
  // hand-written patches may not, and both occupy a real line.
  for (const line of diffText.replace(/\n$/, "").split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      current = map.get(fileMatch[1]!) ?? new Set();
      map.set(fileMatch[1]!, current);
      continue;
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.add(newLine);
      newLine++;
    } else if (!line.startsWith("-") && !line.startsWith("\\")) {
      current.add(newLine);
      newLine++;
    }
  }
  return map;
}

function isInline(f: Finding, commentable: Map<string, Set<number>>): boolean {
  const lines = commentable.get(f.file);
  if (!lines) return false;
  return lines.has(f.endLine) && (f.startLine === f.endLine || lines.has(f.startLine));
}

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

function renderOutsideFinding(f: Finding, fp: string): string {
  return [
    `${SEVERITY_EMOJI[f.severity]} **${f.title}** — \`${f.file}:${f.startLine}\` (\`${f.category}\`, confidence ${(f.confidence * 100).toFixed(0)}%)`,
    ``,
    f.explanation,
    ``,
    `**How it fails:** ${f.failurePath}`,
    ``,
    marker(fp),
  ].join("\n");
}

/**
 * Posts findings as a single PR review. Pipeline: confidence threshold ->
 * dedupe against fingerprints already on the PR (inline comments AND review
 * bodies) -> per-PR cap -> partition into inline (on-diff) vs body
 * (outside-diff, the skill's affected-surface findings).
 */
export async function postReview(
  result: EngineResult,
  target: PostTarget,
  config: PeregrineConfig,
  token: string,
  diffText: string,
): Promise<{ posted: number; skipped: number }> {
  const octokit = new Octokit({ auth: token });
  const { owner, repo, prNumber } = target;

  // Fingerprints already posted on this PR — inline comments and review bodies.
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
  const reviews = await octokit.paginate(octokit.pulls.listReviews, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  for (const r of reviews) {
    for (const fp of extractFingerprints(r.body ?? "")) existing.add(fp);
  }

  const eligible = result.findings
    .filter((f) => f.confidence >= config.limits.minConfidenceToPost)
    .map((f) => ({ f, fp: f.fingerprint ?? fingerprint(f) }))
    .filter(({ fp }) => !existing.has(fp))
    .sort((a, b) => b.f.confidence - a.f.confidence)
    .slice(0, config.limits.maxCommentsPerPr);

  const skipped = result.findings.length - eligible.length;
  if (eligible.length === 0) return { posted: 0, skipped };

  const commentable = commentableLines(diffText);
  const inline = eligible.filter(({ f }) => isInline(f, commentable));
  const outside = eligible.filter(({ f }) => !isInline(f, commentable));

  const bodyParts = [summaryBody(result, eligible.length, skipped)];
  if (outside.length > 0) {
    bodyParts.push(
      ``,
      `#### Findings outside this diff (affected surfaces)`,
      ``,
      ...outside.map(({ f, fp }) => renderOutsideFinding(f, fp) + "\n\n---"),
    );
  }

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: target.headSha,
    event: "COMMENT",
    body: bodyParts.join("\n"),
    comments: inline.map(({ f, fp }) => ({
      path: f.file,
      line: f.endLine,
      start_line: f.startLine < f.endLine ? f.startLine : undefined,
      side: "RIGHT" as const,
      body: renderComment(f, fp),
    })),
  });

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
