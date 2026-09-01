import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { extractFingerprints, fingerprint, marker } from "../src/github/fingerprint.js";
import {
  commentableLines,
  postReview,
  type GitHubReviewClient,
} from "../src/github/post-review.js";
import type { EngineResult, Finding, PeregrineConfig } from "../src/types.js";

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/app.ts",
    startLine: 3,
    endLine: 3,
    severity: "medium",
    disposition: "fix-in-pr",
    category: "logic",
    title: "Wrong branch result",
    explanation: "The new branch returns the fallback value.",
    failurePath: "A valid input selects the new branch and receives the wrong result.",
    confidence: 0.9,
    ...overrides,
  };
}

function result(findings = [finding()]): EngineResult {
  return {
    engine: "codex",
    status: findings.length === 0 ? "clean" : "completed",
    modelConfig: "breadth->investigation",
    reviewedBaseRef: "base",
    reviewedHeadRef: "head",
    findings,
    usage: { inputTokens: 100 },
    durationMs: 1_000,
  };
}

function client(args: {
  head?: string;
  comments?: Array<{ body?: string }>;
  failInline?: boolean;
} = {}): { api: GitHubReviewClient; requests: Array<Record<string, unknown>> } {
  const requests: Array<Record<string, unknown>> = [];
  let attempts = 0;
  const listReviewComments = Symbol("comments");
  const listReviews = Symbol("reviews");
  return {
    requests,
    api: {
      async paginate(method) {
        return method === listReviewComments ? (args.comments ?? []) : [];
      },
      pulls: {
        async get() {
          return { data: { head: { sha: args.head ?? "head" } } };
        },
        listReviewComments,
        listReviews,
        async createReview(request) {
          requests.push(request);
          attempts++;
          if (args.failInline && attempts === 1) throw Object.assign(new Error("unprocessable"), { status: 422 });
          return {};
        },
      },
    },
  };
}

const diff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,3 @@",
  " existing",
  "+added",
  " tail",
  "",
].join("\n");

test("commentable line mapping includes context and additions but not deletions", () => {
  const lines = commentableLines(diff).get("src/app.ts");
  assert.deepEqual([...lines ?? []], [1, 2, 3]);
});

test("posting refuses stale results before loading or creating comments", async () => {
  const fake = client({ head: "new-head" });
  const posted = await postReview(
    result(),
    { owner: "o", repo: "r", prNumber: 1, headSha: "head" },
    config(),
    "token",
    diff,
    fake.api,
  );
  assert.equal(posted.superseded, true);
  assert.equal(fake.requests.length, 0);
});

test("posting deduplicates fingerprints and falls back to a body review on inline 422", async () => {
  const duplicate = finding({ title: "Already posted" });
  const newFinding = finding({ title: "Fresh root cause", startLine: 2, endLine: 2 });
  const fake = client({
    comments: [{ body: marker(fingerprint(duplicate)) }],
    failInline: true,
  });
  const posted = await postReview(
    result([duplicate, newFinding]),
    { owner: "o", repo: "r", prNumber: 1, headSha: "head" },
    config(),
    "token",
    diff,
    fake.api,
  );
  assert.deepEqual(posted, { posted: 1, skipped: 1, superseded: false, bodyFallback: true });
  assert.equal(fake.requests.length, 2);
  assert.deepEqual(fake.requests[1]?.comments, []);
  assert.match(String(fake.requests[1]?.body), /Fresh root cause/);
});

test("posting keeps follow-up findings in the artifact but out of PR comments", async () => {
  const fake = client();
  const posted = await postReview(
    result([finding({ disposition: "follow-up" })]),
    { owner: "o", repo: "r", prNumber: 1, headSha: "head" },
    config(),
    "token",
    diff,
    fake.api,
  );
  assert.deepEqual(posted, { posted: 0, skipped: 1, superseded: false, bodyFallback: false });
  assert.equal(fake.requests.length, 0);
});

test("fingerprints tolerate title punctuation but keep distinct nearby root causes", () => {
  const first = finding({ title: "Missing tenant boundary!" });
  const punctuation = finding({ title: "missing TENANT boundary" });
  const distinct = finding({ title: "Retry loop drops final write" });
  assert.equal(fingerprint(first), fingerprint(punctuation));
  assert.notEqual(fingerprint(first), fingerprint(distinct));
  assert.deepEqual(extractFingerprints(`x ${marker(fingerprint(first))}`), [fingerprint(first)]);
});
