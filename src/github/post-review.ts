import { Octokit } from "@octokit/rest";
import type { EngineResult, Finding, PeregrineConfig } from "../types.js";
import { formatUsageCost } from "../core/telemetry.js";
import { extractFingerprints, fingerprint, marker } from "./fingerprint.js";
import { assertNoSecrets } from "../security/secrets.js";

export interface PostTarget {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
}

export interface PostResult {
  posted: number;
  skipped: number;
  superseded: boolean;
  bodyFallback: boolean;
}

export interface GitHubReviewClient {
  paginate(method: unknown, args: Record<string, unknown>): Promise<Array<{ body?: string | null }>>;
  pulls: {
    get(args: Record<string, unknown>): Promise<{ data: { head: { sha: string } } }>;
    listReviewComments: unknown;
    listReviews: unknown;
    createReview(args: Record<string, unknown>): Promise<unknown>;
  };
}

const SEVERITY_EMOJI: Record<Finding["severity"], string> = {
  high: "🔴",
  medium: "🟠",
  low: "🟡",
};

export function commentableLines(diffText: string): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  let current: Set<number> | undefined;
  let newLine = 0;
  for (const line of diffText.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      newLine = 0;
      continue;
    }
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
      current.add(newLine++);
    } else if (!line.startsWith("-") && !line.startsWith("\\")) {
      current.add(newLine++);
    }
  }
  return map;
}

function isInline(finding: Finding, commentable: Map<string, Set<number>>): boolean {
  const lines = commentable.get(finding.file);
  if (!lines) return false;
  return (
    lines.has(finding.endLine) &&
    (finding.startLine === finding.endLine || lines.has(finding.startLine))
  );
}

function renderInline(finding: Finding, fingerprintValue: string): string {
  return [
    `${SEVERITY_EMOJI[finding.severity]} **${finding.title}** (\`${finding.category}\`, confidence ${(finding.confidence * 100).toFixed(0)}%)`,
    "",
    finding.explanation,
    "",
    `**How it fails:** ${finding.failurePath}`,
    "",
    marker(fingerprintValue),
  ].join("\n");
}

function renderBodyFinding(finding: Finding, fingerprintValue: string): string {
  return [
    `${SEVERITY_EMOJI[finding.severity]} **${finding.title}** — \`${finding.file}:${finding.startLine}\` (\`${finding.category}\`, confidence ${(finding.confidence * 100).toFixed(0)}%)`,
    "",
    finding.explanation,
    "",
    `**How it fails:** ${finding.failurePath}`,
    "",
    marker(fingerprintValue),
  ].join("\n");
}

export async function postReview(
  result: EngineResult,
  target: PostTarget,
  config: PeregrineConfig,
  token: string,
  diffText: string,
  suppliedClient?: GitHubReviewClient,
): Promise<PostResult> {
  assertNoSecrets(result.findings, "outbound review findings");
  const client =
    suppliedClient ?? (new Octokit({ auth: token }) as unknown as GitHubReviewClient);
  const common = { owner: target.owner, repo: target.repo, pull_number: target.prNumber };
  const current = await client.pulls.get(common);
  const reviewedHead = result.reviewedHeadRef ?? target.headSha;
  if (current.data.head.sha !== target.headSha || current.data.head.sha !== reviewedHead) {
    return { posted: 0, skipped: result.findings.length, superseded: true, bodyFallback: false };
  }

  const existing = new Set<string>();
  const reviewComments = await client.paginate(client.pulls.listReviewComments, {
    ...common,
    per_page: 100,
  });
  const reviews = await client.paginate(client.pulls.listReviews, { ...common, per_page: 100 });
  for (const item of [...reviewComments, ...reviews]) {
    for (const existingFingerprint of extractFingerprints(item.body ?? "")) {
      existing.add(existingFingerprint);
    }
  }

  const eligible = result.findings
    .filter(
      (finding) =>
        finding.disposition === "fix-in-pr" &&
        finding.confidence >= config.limits.minConfidenceToPost,
    )
    .map((finding) => ({ finding, fp: finding.fingerprint ?? fingerprint(finding) }))
    .filter(({ fp }) => !existing.has(fp))
    .sort((left, right) => {
      const severity = severityRank(right.finding.severity) - severityRank(left.finding.severity);
      return severity || right.finding.confidence - left.finding.confidence;
    })
    .slice(0, config.limits.maxCommentsPerPr);
  const skipped = result.findings.length - eligible.length;
  if (eligible.length === 0) {
    return { posted: 0, skipped, superseded: false, bodyFallback: false };
  }

  const commentable = commentableLines(diffText);
  const inline = eligible.filter(({ finding }) => isInline(finding, commentable));
  const outside = eligible.filter(({ finding }) => !isInline(finding, commentable));
  const body = buildBody(result, outside, eligible.length, skipped, "Findings outside this diff");
  const request = {
    ...common,
    commit_id: target.headSha,
    event: "COMMENT",
    body,
    comments: inline.map(({ finding, fp }) => ({
      path: finding.file,
      line: finding.endLine,
      start_line: finding.startLine < finding.endLine ? finding.startLine : undefined,
      start_side: finding.startLine < finding.endLine ? "RIGHT" : undefined,
      side: "RIGHT",
      body: renderInline(finding, fp),
    })),
  };

  try {
    await client.pulls.createReview(request);
    return { posted: eligible.length, skipped, superseded: false, bodyFallback: false };
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined;
    if (status !== 422 || inline.length === 0) throw error;
    await client.pulls.createReview({
      ...common,
      commit_id: target.headSha,
      event: "COMMENT",
      body: buildBody(result, eligible, eligible.length, skipped, "Findings"),
      comments: [],
    });
    return { posted: eligible.length, skipped, superseded: false, bodyFallback: true };
  }
}

function severityRank(severity: Finding["severity"]): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function buildBody(
  result: EngineResult,
  findings: Array<{ finding: Finding; fp: string }>,
  posted: number,
  skipped: number,
  heading: string,
): string {
  const cost = formatUsageCost(result.usage);
  const sections = [
    "### 🦅 peregrine-bugbot",
    "",
    `${posted} finding(s) posted${skipped > 0 ? `, ${skipped} below threshold/duplicate` : ""}.`,
    "",
    `<sub>runner: \`${result.engine}\` (${result.modelConfig}) · cost: ${cost} · ${(result.durationMs / 1000).toFixed(0)}s · reviewed: \`${result.reviewedHeadRef ?? "unknown"}\`</sub>`,
  ];
  if (findings.length > 0) {
    sections.push(
      "",
      `#### ${heading}`,
      "",
      findings.map(({ finding, fp }) => renderBodyFinding(finding, fp)).join("\n\n---\n\n"),
    );
  }
  return sections.join("\n");
}
