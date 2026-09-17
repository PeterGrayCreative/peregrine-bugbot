import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { canonicalJsonSha256, writeExclusiveJson } from "./experiment.js";

export const HISTORICAL_ORACLE_PROTOCOL = "historical-oracle-v1" as const;
export interface OracleArtifact { path: string; sha256: string }
export interface OracleRevision { commit: string; tree: string }
export type OracleRole = "base" | "head" | "repair" | "negative-control";
export interface HistoricalOracleCase {
  schemaVersion: 1;
  protocol: typeof HISTORICAL_ORACLE_PROTOCOL;
  caseId: string;
  partition: "visible-development";
  duplicateFamily: string;
  language: "typescript" | "javascript";
  source: {
    repository: string;
    reviewUrl: string;
    base: OracleRevision;
    head: OracleRevision;
    repair: OracleRevision | null;
    provenance: OracleArtifact;
    diff: OracleArtifact;
    archive: OracleArtifact;
  };
  truth: {
    version: string;
    status: "known-roots" | "reviewed-comparison";
    completeness: "partial";
    scope: string;
    roots: Array<{
      id: string;
      mechanism: string;
      trigger: string;
      consequence: string;
      severity: "low" | "medium" | "high";
      file: string;
      line: number;
    }>;
  };
  oracle: {
    kind: "executable" | "formal";
    contract: OracleArtifact;
    program: OracleArtifact;
    environment: OracleArtifact;
    certificate: OracleArtifact | null;
    negativeControl: null | { description: string; patch: OracleArtifact };
    observations: Array<{
      role: OracleRole;
      revision: OracleRevision;
      command: string[];
      result: OracleArtifact;
      log: OracleArtifact;
    }>;
  };
  reviews: Array<{
    kind: "ai";
    model: string;
    effort: string;
    sessionId: string;
    rubricVersion: string;
    reviewedAt: string;
    evidenceSha256: string;
    decision: "supports-admission";
    rationale: OracleArtifact;
  }>;
}

export interface OracleObservationResult {
  schemaVersion: 1;
  caseId: string;
  role: OracleRole;
  revision: OracleRevision;
  programSha256: string;
  exitCode: number;
  checks: Array<{ targetId: string; outcome: "passed" | "behavioral-failure" | "environment-failure" }>;
}

export interface HistoricalOracleCorpus {
  schemaVersion: 1;
  protocol: typeof HISTORICAL_ORACLE_PROTOCOL;
  partition: "visible-development";
  evidenceClass: "oracle-supported-visible-historical-development";
  humanVerified: false;
  independentConfirmation: false;
  cases: Array<{ caseId: string; record: OracleArtifact; evidenceSha256: string; status: HistoricalOracleCase["truth"]["status"]; duplicateFamily: string; repository: string; language: HistoricalOracleCase["language"] }>;
  counts: { cases: number; knownRootCases: number; comparisonCases: number; roots: number; repositories: number; duplicateFamilies: number };
  corpusSha256: string;
}

type ObjectValue = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function object(value: unknown, keys: string[], label: string): ObjectValue {
  check(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const v = value as ObjectValue;
  check(Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key)), `${label} has missing or unknown fields`);
  return v;
}
function text(value: unknown, label: string): asserts value is string { check(typeof value === "string" && value.trim().length > 0 && value.length <= 16000, `${label} must be nonempty text`); }
function id(value: unknown, label: string): asserts value is string { check(typeof value === "string" && ID.test(value), `${label} must be an identifier`); }
function hash(value: unknown): asserts value is string { check(typeof value === "string" && HASH.test(value), "invalid SHA-256"); }
function safePath(value: unknown): asserts value is string {
  check(typeof value === "string" && value.length > 0 && !value.startsWith("/") && !/[\\\x00-\x1f\x7f]/.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "unsafe artifact path");
}
function artifact(value: unknown): asserts value is OracleArtifact {
  const v = object(value, ["path", "sha256"], "artifact"); safePath(v.path); hash(v.sha256);
}
function revision(value: unknown): asserts value is OracleRevision {
  const v = object(value, ["commit", "tree"], "revision");
  check(typeof v.commit === "string" && GIT.test(v.commit) && typeof v.tree === "string" && GIT.test(v.tree), "invalid Git commit/tree identity");
}
function array(value: unknown, label: string): asserts value is unknown[] { check(Array.isArray(value), `${label} must be an array`); }
function unique(values: string[], label: string): void { check(new Set(values).size === values.length, `${label} contains duplicates`); }
function sameRevision(a: OracleRevision, b: OracleRevision): boolean { return a.commit === b.commit && a.tree === b.tree; }

/** The digest excludes review records, so two separately recorded sessions can bind the same evidence. */
export function historicalOracleEvidenceSha256(value: Omit<HistoricalOracleCase, "reviews"> | HistoricalOracleCase): string {
  const { reviews: _reviews, ...evidence } = value as HistoricalOracleCase;
  return canonicalJsonSha256(evidence);
}

/** Structural parsing never admits a case or treats an AI review as a human decision. */
export function parseHistoricalOracleCase(value: unknown): HistoricalOracleCase {
  const r = object(value, ["schemaVersion", "protocol", "caseId", "partition", "duplicateFamily", "language", "source", "truth", "oracle", "reviews"], "oracle case");
  check(r.schemaVersion === 1 && r.protocol === HISTORICAL_ORACLE_PROTOCOL, "unsupported oracle case protocol");
  check(r.partition === "visible-development", "oracle cases are visible-development only");
  id(r.caseId, "caseId"); id(r.duplicateFamily, "duplicateFamily");
  check(r.language === "typescript" || r.language === "javascript", "unsupported language");
  const s = object(r.source, ["repository", "reviewUrl", "base", "head", "repair", "provenance", "diff", "archive"], "source");
  for (const key of ["repository", "reviewUrl"]) {
    text(s[key], key); check(/^https:\/\//.test(s[key]), `${key} must be an HTTPS source URL`);
  }
  revision(s.base); revision(s.head); if (s.repair !== null) revision(s.repair);
  check(s.base.commit !== s.head.commit, "base and head must differ");
  for (const key of ["provenance", "diff", "archive"]) artifact(s[key]);
  const t = object(r.truth, ["version", "status", "completeness", "scope", "roots"], "truth");
  id(t.version, "truth version"); text(t.scope, "truth scope");
  check(t.completeness === "partial", "truth completeness must be partial");
  check(t.status === "known-roots" || t.status === "reviewed-comparison", "invalid truth status");
  array(t.roots, "roots");
  for (const raw of t.roots) {
    const root = object(raw, ["id", "mechanism", "trigger", "consequence", "severity", "file", "line"], "root");
    id(root.id, "root id"); text(root.mechanism, "mechanism"); text(root.trigger, "trigger"); text(root.consequence, "consequence"); safePath(root.file);
    check(["low", "medium", "high"].includes(String(root.severity)), "invalid severity");
    check(Number.isSafeInteger(root.line) && Number(root.line) > 0, "invalid root line");
  }
  const o = object(r.oracle, ["kind", "contract", "program", "environment", "certificate", "negativeControl", "observations"], "oracle");
  check(o.kind === "executable" || o.kind === "formal", "oracle must be executable or formal");
  for (const key of ["contract", "program", "environment"]) artifact(o[key]);
  if (o.certificate !== null) artifact(o.certificate);
  check(o.kind === "formal" ? o.certificate !== null : o.certificate === null, "formal oracles require a checker certificate; executable oracles have no certificate");
  if (o.negativeControl !== null) {
    const n = object(o.negativeControl, ["description", "patch"], "negative control"); text(n.description, "negative-control description"); artifact(n.patch);
  }
  array(o.observations, "observations");
  for (const raw of o.observations) {
    const obs = object(raw, ["role", "revision", "command", "result", "log"], "observation");
    check(["base", "head", "repair", "negative-control"].includes(String(obs.role)), "invalid observation role");
    revision(obs.revision); array(obs.command, "command"); check(obs.command.length > 0, "empty oracle command");
    for (const arg of obs.command) text(arg, "command argument");
    artifact(obs.result); artifact(obs.log);
  }
  array(r.reviews, "reviews");
  for (const raw of r.reviews) {
    const review = object(raw, ["kind", "model", "effort", "sessionId", "rubricVersion", "reviewedAt", "evidenceSha256", "decision", "rationale"], "review");
    check(review.kind === "ai", "reviews must disclose AI identity");
    check(review.decision === "supports-admission", "unresolved or rejected review cannot admit a case");
    for (const key of ["model", "effort", "sessionId", "rubricVersion"]) text(review[key], key);
    text(review.reviewedAt, "reviewedAt"); check(/^\d{4}-\d{2}-\d{2}T/.test(review.reviewedAt) && Number.isFinite(Date.parse(review.reviewedAt)), "invalid review timestamp");
    hash(review.evidenceSha256); artifact(review.rationale);
  }
  const parsed = value as HistoricalOracleCase;
  unique(parsed.truth.roots.map((root) => root.id), "root IDs");
  unique(parsed.oracle.observations.map((obs) => obs.role), "observation roles");
  unique(parsed.reviews.map((review) => review.sessionId), "AI reviewer sessions");
  return parsed;
}

/** Verify recorded bytes only. The compiler does not execute commands embedded in evidence. */
export function readOracleArtifact(rootValue: string, ref: OracleArtifact): Buffer {
  artifact(ref);
  const root = realpathSync(rootValue);
  const path = resolve(root, ref.path);
  check(path.startsWith(`${root}${sep}`), "artifact escapes evidence store");
  const stat = lstatSync(path);
  check(stat.isFile() && !stat.isSymbolicLink() && realpathSync(path) === path, "artifact must be a direct regular file");
  const bytes = readFileSync(path);
  check(bytes.length > 0, `empty artifact: ${ref.path}`);
  check(createHash("sha256").update(bytes).digest("hex") === ref.sha256, `artifact hash mismatch: ${ref.path}`);
  return bytes;
}

export function readHistoricalOracleAdmission(root: string, ref: OracleArtifact): HistoricalOracleCase {
  const record = parseHistoricalOracleCase(JSON.parse(readOracleArtifact(root, ref).toString("utf8")));
  const bug = record.truth.status === "known-roots";
  check(bug ? record.truth.roots.length > 0 && record.source.repair !== null : record.truth.roots.length === 0 && record.source.repair === null, "truth roots and repair do not match case status");
  check(bug ? record.oracle.negativeControl === null : record.oracle.negativeControl !== null, "comparison requires a negative control; bug cases use their original base");
  if (record.source.repair) check(record.source.repair.commit !== record.source.head.commit, "repair must differ from defective head");
  const expectedRoles: OracleRole[] = bug ? ["base", "head", "repair"] : ["head", "negative-control"];
  check(record.oracle.observations.length === expectedRoles.length && expectedRoles.every((role) => record.oracle.observations.some((obs) => obs.role === role)), "missing or unexpected oracle observations");
  const targets = bug ? record.truth.roots.map((r) => r.id).sort() : ["comparison-scope"];
  for (const ref of [record.source.provenance, record.source.diff, record.source.archive, record.oracle.contract, record.oracle.program, record.oracle.environment, ...(record.oracle.certificate ? [record.oracle.certificate] : []), ...(record.oracle.negativeControl ? [record.oracle.negativeControl.patch] : [])]) readOracleArtifact(root, ref);
  for (const obs of record.oracle.observations) {
    const expectedRevision = obs.role === "negative-control" ? record.source.head : record.source[obs.role];
    check(expectedRevision && sameRevision(obs.revision, expectedRevision), `${obs.role} observation uses the wrong revision`);
    readOracleArtifact(root, obs.log);
    const result = object(JSON.parse(readOracleArtifact(root, obs.result).toString("utf8")), ["schemaVersion", "caseId", "role", "revision", "programSha256", "exitCode", "checks"], "oracle result");
    revision(result.revision);
    check(result.schemaVersion === 1 && result.caseId === record.caseId && result.role === obs.role && sameRevision(result.revision, obs.revision) && result.programSha256 === record.oracle.program.sha256, "oracle result has stale or cross-case bindings");
    array(result.checks, "oracle result checks");
    const expectedFailure = bug ? obs.role === "head" : obs.role === "negative-control";
    check(result.exitCode === (expectedFailure ? 1 : 0), "oracle process exit does not match the expected assertion outcome");
    const checked = result.checks.map((raw) => {
      const item = object(raw, ["targetId", "outcome"], "oracle check"); id(item.targetId, "targetId");
      check(item.outcome === (expectedFailure ? "behavioral-failure" : "passed"), "oracle must establish expected behavior; environment failures cannot admit truth");
      return item.targetId;
    }).sort();
    check(JSON.stringify(checked) === JSON.stringify(targets), "oracle checks must cover every and only the declared target");
  }
  check(record.reviews.length === 2, "exactly two explicit AI review records are required");
  const digest = historicalOracleEvidenceSha256(record);
  for (const review of record.reviews) {
    check(review.evidenceSha256 === digest, "AI review is stale or belongs to another case");
    readOracleArtifact(root, review.rationale);
  }
  return record;
}

export function compileHistoricalOracleCorpus(root: string, refs: OracleArtifact[]): HistoricalOracleCorpus {
  check(refs.length > 0, "cannot compile an empty oracle corpus");
  const rows = refs.map((ref) => ({ ref, record: readHistoricalOracleAdmission(root, ref) })).sort((a, b) => a.record.caseId.localeCompare(b.record.caseId, "en"));
  unique(rows.map(({ record }) => record.caseId), "case IDs");
  unique(rows.map(({ record }) => `${record.source.repository}\0${record.source.base.commit}\0${record.source.head.commit}`), "review opportunities");
  const body = {
    schemaVersion: 1 as const,
    protocol: HISTORICAL_ORACLE_PROTOCOL,
    partition: "visible-development" as const,
    evidenceClass: "oracle-supported-visible-historical-development" as const,
    humanVerified: false as const,
    independentConfirmation: false as const,
    cases: rows.map(({ record, ref }) => ({ caseId: record.caseId, record: ref, evidenceSha256: historicalOracleEvidenceSha256(record), status: record.truth.status, duplicateFamily: record.duplicateFamily, repository: record.source.repository, language: record.language })),
    counts: {
      cases: rows.length,
      knownRootCases: rows.filter(({ record }) => record.truth.status === "known-roots").length,
      comparisonCases: rows.filter(({ record }) => record.truth.status === "reviewed-comparison").length,
      roots: rows.reduce((sum, { record }) => sum + record.truth.roots.length, 0),
      repositories: new Set(rows.map(({ record }) => record.source.repository)).size,
      duplicateFamilies: new Set(rows.map(({ record }) => record.duplicateFamily)).size,
    },
  };
  return { ...body, corpusSha256: canonicalJsonSha256(body) };
}

export function writeHistoricalOracleCorpus(path: string, root: string, refs: OracleArtifact[]): HistoricalOracleCorpus {
  const corpus = compileHistoricalOracleCorpus(root, refs);
  writeExclusiveJson(dirname(resolve(path)), resolve(path), corpus);
  return corpus;
}
