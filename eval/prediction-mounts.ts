import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { createReviewReadTools } from "./methodology-read-tools.js";
import { createPredictionReadBudget } from "./prediction-evidence.js";
import { array, digest, freeze, hash, integer, oneOf, same, sha, text, unique } from "./prediction-contract.js";
import type { PredictionRegistration } from "./prediction-plan.js";

export const PREDICTION_TOOL_POLICY = freeze({ version: 1, tools: ["list_tree", "read_file", "search_text", "read_link"],
  scope: "one authenticated repository-only case root", maxReadCalls: 100, maxReturnedBytes: 2_000_000,
  maxFileBytes: 2_000_000, maxOutputBytes: 2_000_000, maxSearchMatches: 100_000,
  symlinks: "literal link text only; never traverse", authority: "no shell, process, network, curator path, or provider interface" });
export interface PredictionMountEntry { path: string; mode: "100644" | "100755" | "120000"; bytes: number; sha256: string; oid?: string }
export interface PredictionMount { caseId: string; reviewerId: string; base: string; head: string; baseTree: string; headTree: string;
  inputDigest: string; allowedFiles: PredictionMountEntry[]; changedPaths: string[]; diffSha256: string }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mount record must be an object");
  return value as Record<string, unknown>;
}
function safePath(value: unknown): string {
  const path = text(value);
  if (path.startsWith("/") || /[\\\x00-\x1f\x7f]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw new Error("unsafe mount path");
  return path;
}
function oid(value: unknown): string { const id = text(value); if (!/^[a-f0-9]{40}$/.test(id)) throw new Error("invalid Git identity"); return id; }
function entry(value: unknown): PredictionMountEntry {
  const item = object(value);
  return { path: safePath(item.path), mode: oneOf(item.mode, ["100644", "100755", "120000"]), ...(item.oid === undefined ? {} : { oid: oid(item.oid) }), bytes: integer(item.bytes), sha256: hash(item.sha256) };
}
const inventoryDigest = (entries: PredictionMountEntry[]) => sha(`${JSON.stringify(entries, null, 2)}\n`);

/** Digest authority must come from the separately gated private mount artifact.
 * This authenticates the source manifest projection; offline Git closure is the
 * private mount verifier's job, not an inference from a self-supplied checksum. */
export function bindPredictionMounts(bytes: string, expectedSha256: string, registration: PredictionRegistration): PredictionMount[] {
  same(sha(bytes), hash(expectedSha256), "trusted mount manifest digest mismatch");
  const manifest = object(JSON.parse(bytes));
  same(manifest.registrationSha256, registration.registrationSha256, "mount registration mismatch");
  same(manifest.mountVersion, 2, "repository-only successor required");
  same(manifest.contextPolicy, "none-for-every-case", "supplemental context prohibited");
  const cases = array(manifest.cases).map(value => {
    const item = object(value), inventories = object(item.inventories);
    same(item.context, [], "prediction-selected context prohibited");
    const base = array(inventories.base).map(entry), head = array(inventories.head).map(entry), allowedFiles = array(item.allowedFiles).map(entry);
    unique(base.map(e => e.path)); unique(head.map(e => e.path)); unique(allowedFiles.map(e => e.path));
    const diff = object(item.diff);
    const expected = [...head.map(e => ({ ...e, path: `head/${e.path}` })), { path: "review.diff", mode: "100644" as const, bytes: integer(diff.bytes), sha256: hash(diff.sha256) }].sort((a,b) => a.path.localeCompare(b.path, "en"));
    same(allowedFiles, expected, "reviewer inventory must contain the complete head and exact raw diff only");
    same(item.inputDigest, inventoryDigest(allowedFiles), "mount input digest mismatch");
    const reviewerId = text(item.reviewerId);
    if (!/^item-[a-f0-9]{16}$/.test(reviewerId)) throw new Error("opaque reviewer id required");
    const baseByPath = new Map(base.map(e => [e.path, e])), headByPath = new Map(head.map(e => [e.path, e]));
    const changedPaths = [...new Set([...baseByPath.keys(), ...headByPath.keys()])].filter(path => {
      const a = baseByPath.get(path), b = headByPath.get(path);
      return !a || !b || a.mode !== b.mode || a.sha256 !== b.sha256;
    }).sort();
    return { caseId: text(item.caseId), reviewerId, base: oid(item.base), head: oid(item.head), baseTree: oid(item.baseTree), headTree: oid(item.headTree), inputDigest: hash(item.inputDigest), allowedFiles, changedPaths, diffSha256: hash(diff.sha256) };
  });
  same(cases.map(c => c.caseId), registration.cases.map(c => c.caseId), "complete registered mount frame required");
  unique(cases.map(c => c.reviewerId));
  const bindings = array(manifest.attemptBindings).map(object);
  same(bindings.map(b => ({ id: b.id, reviewerId: b.reviewerId, inputDigest: b.inputDigest })), registration.schedule.map(a => {
    const c = cases.find(c => c.caseId === a.caseId)!; return { id: a.id, reviewerId: c.reviewerId, inputDigest: c.inputDigest };
  }), "exact A/B/repeat mount parity required");
  return freeze(cases);
}

/** Check every ancestor without traversing a source symlink. Immutable source
 * ownership is required; this is not containment against a hostile host process. */
function directPath(root: string, path: string): string {
  const absolute = resolve(root);
  let current = absolute;
  if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink()) throw new Error("mount root must be a native directory");
  const parts = safePath(path).split("/");
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("mount parent changed or is a symlink");
  }
  return join(absolute, path);
}
export function readPredictionMountBytes(root: string, expected: PredictionMountEntry): Buffer {
  const path = directPath(root, expected.path), stat = lstatSync(path);
  let bytes: Buffer;
  if (expected.mode === "120000") {
    if (!stat.isSymbolicLink()) throw new Error("native symlink changed");
    bytes = Buffer.from(readlinkSync(path));
  } else {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== (expected.mode === "100755" ? 0o755 : 0o644)) throw new Error("native source file type/mode/link drift");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (before.ino !== stat.ino || before.dev !== stat.dev || before.size !== expected.bytes) throw new Error("source changed during open");
      bytes = readFileSync(fd);
      const after = fstatSync(fd);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("source changed during read");
    } finally { closeSync(fd); }
  }
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256) throw new Error("mount source bytes drift");
  return bytes;
}
export function verifyPredictionMountDirectory(root: string, mount: PredictionMount): void {
  const expected = new Set(mount.allowedFiles.map(e => e.path)), directories = new Set<string>();
  for (const path of expected) { let parent = posix.dirname(path); while (parent !== ".") { directories.add(parent); parent = posix.dirname(parent); } }
  const found: string[] = [];
  const visit = (path: string) => {
    for (const name of readdirSync(join(root, path))) {
      const child = safePath(path ? `${path}/${name}` : name), full = directPath(root, child), stat = lstatSync(full);
      if (stat.isDirectory() && !stat.isSymbolicLink()) { if (!directories.has(child)) throw new Error("unexpected source directory"); visit(child); }
      else { if (!expected.has(child)) throw new Error("unexpected source file"); found.push(child); }
    }
  };
  visit(""); same(found.sort(), [...expected].sort(), "missing source file");
  for (const entry of mount.allowedFiles) readPredictionMountBytes(root, entry);
}

/** Reuses the existing bounded read tools. The wrapper serves one authenticated
 * root and counts every successful or failed call; it never receives a provider.
 * Native symlinks are available only as literal source text via read_link. */
export function createPredictionCaseReader(root: string, mount: PredictionMount) {
  verifyPredictionMountDirectory(root, mount);
  const reader = createReviewReadTools(root, { maxIndexEntries: 100_000_000, maxFileBytes: PREDICTION_TOOL_POLICY.maxFileBytes,
    maxOutputBytes: PREDICTION_TOOL_POLICY.maxOutputBytes, maxSearchMatches: PREDICTION_TOOL_POLICY.maxSearchMatches, excludedNamespaces: [] });
  const budget = createPredictionReadBudget();
  const transcript: { ticket: number; tool: string; arguments: unknown; response: string; delivered: boolean }[] = [];
  let closed = false;
  return {
    call(tool: string, args: unknown): string {
      if (closed) throw new Error("reader is closed");
      const ticket = budget.reserve();
      let response: string, failed = false;
      try {
        const input = object(args);
        if (tool === "read_link") {
          if (Object.keys(input).length !== 1) throw new Error("read_link requires only path");
          const path = safePath(input.path), entry = mount.allowedFiles.find(e => e.path === path && e.mode === "120000");
          if (!entry) throw new Error("not an inventoried native link");
          response = JSON.stringify({ kind: "literal-symlink-source", target: readPredictionMountBytes(root, entry).toString("utf8"), followed: false });
        } else if (tool === "list_tree") response = JSON.stringify(reader.list_tree(input));
        else if (tool === "read_file") response = JSON.stringify(reader.read_file(input as { path: string }));
        else if (tool === "search_text") response = JSON.stringify(reader.search_text(input as { query: string }));
        else throw new Error("tool is not permitted");
      } catch { failed = true; response = JSON.stringify({ status: "incomplete", limitations: ["invalid-or-unavailable-read"], unavailable: true }); }
      const delivered = budget.settle(ticket, response, failed);
      transcript.push(freeze({ ticket, tool, arguments: args, response, delivered }));
      if (!delivered) { closed = true; throw new Error("cumulative returned-byte cap exceeded; response withheld"); }
      return response;
    },
    snapshot() { return freeze({ ...budget.snapshot(), transcript, closed, policySha256: digest(PREDICTION_TOOL_POLICY), inputDigest: mount.inputDigest }); },
    close() { closed = true; },
  };
}
