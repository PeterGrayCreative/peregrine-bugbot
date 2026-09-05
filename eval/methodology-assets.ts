import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { packageRoot } from "../src/core/paths.js";
import { assertLeakageFreeText, type LeakagePolicy } from "./case-isolation.js";
import { canonicalJson } from "./experiment.js";
import { METHODOLOGY_ARM_IDS, type MethodologyArmId } from "./methodology-schedule.js";

const REVIEW_SCHEMA = "schemas/methodology-review.schema.json";
const DISCOVERY_SCHEMA = "schemas/methodology-discovery.schema.json";
const BREADTH_SCHEMA = "schemas/breadth-result.schema.json";
const BREADTH_PACKET = "skills/invariant-first-pr-review/references/breadth-worker-packet.md";
const SHA256 = /^[a-f0-9]{64}$/;

const ARM_ASSETS = {
  A: [REVIEW_SCHEMA],
  B: [REVIEW_SCHEMA],
  C: [DISCOVERY_SCHEMA, REVIEW_SCHEMA],
  D: [REVIEW_SCHEMA, BREADTH_SCHEMA, BREADTH_PACKET],
} as const satisfies Record<MethodologyArmId, readonly string[]>;

export interface MethodologyAssetEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface MethodologyAssetManifest {
  schemaVersion: 1;
  protocol: "historical-methodology-assets-v1";
  armId: MethodologyArmId;
  files: MethodologyAssetEntry[];
  treeSha256: string;
}

/**
 * Returns the existing materializeCase assetPreparer shape. This copies only
 * the arm allowlist; method prompts are intentionally outside this S2 slice.
 */
export function createMethodologyAssetPreparer(
  armId: MethodologyArmId,
): (target: string, policy: LeakagePolicy) => void {
  const validatedArm = parseArmId(armId);
  return (target, policy) => {
    if (existsSync(target)) throw new Error("methodology asset target must not exist");
    const sourceRoot = realpathSync(packageRoot());
    mkdirSync(target);
    for (const relativePath of ARM_ASSETS[validatedArm]) {
      const source = directRegularFile(sourceRoot, relativePath, "methodology asset source");
      const bytes = readFileSync(source);
      // Static method assets may contain generic bug-marker vocabulary, but
      // case-specific forbidden terms remain denied.
      assertLeakageFreeText(
        "repository file",
        bytes,
        { ...policy, corpus: "structural-smoke" },
      );
      const destination = join(target, ...relativePath.split("/"));
      mkdirSync(dirname(destination), { recursive: true });
      // Copy the exact bytes that passed leakage validation; do not reopen the
      // source and create a time-of-check/time-of-copy gap.
      writeFileSync(destination, bytes, { flag: "wx" });
    }
    readMethodologyAssetManifest(target, validatedArm);
  };
}

/** Reads actual bytes and rejects missing, extra, non-regular, or linked entries. */
export function readMethodologyAssetManifest(
  target: string,
  armId: MethodologyArmId,
): MethodologyAssetManifest {
  const validatedArm = parseArmId(armId);
  const targetRoot = existingDirectory(target);
  const expectedPaths = [...ARM_ASSETS[validatedArm]].sort(compareText);
  const expectedDirectories = directoryPaths(expectedPaths);
  const actual = listTreeEntries(targetRoot);
  if (canonicalJson(actual.files) !== canonicalJson(expectedPaths) ||
      canonicalJson(actual.directories) !== canonicalJson(expectedDirectories)) {
    throw new Error("methodology asset tree does not match the arm allowlist");
  }
  const files = expectedPaths.map((path): MethodologyAssetEntry => {
    const file = directRegularFile(targetRoot, path, "methodology copied asset");
    const bytes = readFileSync(file);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return {
    schemaVersion: 1,
    protocol: "historical-methodology-assets-v1",
    armId: validatedArm,
    files,
    treeSha256: assetTreeSha256(validatedArm, files),
  };
}

/**
 * Verifies a caller-retained manifest against current bytes. Authentication or
 * external sealing of that manifest remains the experiment consumer's job.
 */
export function verifyMethodologyAssetManifest(
  target: string,
  expected: unknown,
): MethodologyAssetManifest {
  const parsed = parseManifest(expected);
  const actual = readMethodologyAssetManifest(target, parsed.armId);
  if (canonicalJson(actual) !== canonicalJson(parsed)) {
    throw new Error("methodology asset manifest does not match current bytes");
  }
  return actual;
}

export function parseMethodologyAssetManifest(value: unknown): MethodologyAssetManifest {
  const root = strictObject(value, "methodology asset manifest", [
    "schemaVersion", "protocol", "armId", "files", "treeSha256",
  ]);
  if (root.schemaVersion !== 1 || root.protocol !== "historical-methodology-assets-v1") {
    throw new Error("methodology asset manifest protocol is invalid");
  }
  const armId = parseArmId(root.armId);
  if (!Array.isArray(root.files)) throw new Error("methodology asset manifest files must be an array");
  const files = root.files.map((value, index): MethodologyAssetEntry => {
    const item = strictObject(value, `methodology asset manifest file ${index}`, ["path", "bytes", "sha256"]);
    if (typeof item.path !== "string" || !ARM_ASSETS[armId].includes(item.path as never)) {
      throw new Error("methodology asset manifest file path is invalid");
    }
    if (!Number.isSafeInteger(item.bytes) || Number(item.bytes) < 0) {
      throw new Error("methodology asset manifest file bytes is invalid");
    }
    if (typeof item.sha256 !== "string" || !SHA256.test(item.sha256)) {
      throw new Error("methodology asset manifest file digest is invalid");
    }
    return { path: item.path, bytes: Number(item.bytes), sha256: item.sha256 };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length ||
      canonicalJson(files.map((file) => file.path)) !== canonicalJson([...ARM_ASSETS[armId]].sort(compareText))) {
    throw new Error("methodology asset manifest files do not exactly match the arm allowlist");
  }
  if (typeof root.treeSha256 !== "string" || !SHA256.test(root.treeSha256) ||
      root.treeSha256 !== assetTreeSha256(armId, files)) {
    throw new Error("methodology asset manifest tree digest is invalid");
  }
  return {
    schemaVersion: 1,
    protocol: "historical-methodology-assets-v1",
    armId,
    files,
    treeSha256: root.treeSha256,
  };
}

const parseManifest = parseMethodologyAssetManifest;

function listTreeEntries(root: string): { files: string[]; directories: string[] } {
  const files: string[] = [];
  const directories: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("methodology asset tree must not contain symlinks");
      const path = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        directories.push(relativePath);
        visit(path, relativePath);
      } else if (entry.isFile()) files.push(relativePath);
      else throw new Error("methodology asset tree contains a non-regular entry");
    }
  };
  visit(root, "");
  return { files: files.sort(compareText), directories: directories.sort(compareText) };
}

function directoryPaths(files: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.split("/");
    for (let index = 1; index < segments.length; index++) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return [...directories].sort(compareText);
}

function directRegularFile(root: string, relativePath: string, source: string): string {
  const candidate = resolve(root, ...relativePath.split("/"));
  const rel = relative(root, candidate);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`${source} is not confined`);
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${source} must be a direct regular file`);
  const resolved = realpathSync(candidate);
  if (resolved !== candidate) throw new Error(`${source} must not traverse symlinks`);
  const resolvedRel = relative(root, resolved);
  if (!resolvedRel || resolvedRel === ".." || resolvedRel.startsWith(`..${sep}`)) {
    throw new Error(`${source} escapes its root`);
  }
  return resolved;
}

function existingDirectory(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("methodology asset target must be a direct directory");
  return realpathSync(path);
}

function assetTreeSha256(armId: MethodologyArmId, files: MethodologyAssetEntry[]): string {
  return createHash("sha256")
    .update("peregrine-historical-methodology-assets-v1\0")
    .update(canonicalJson({ armId, files }))
    .digest("hex");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseArmId(value: unknown): MethodologyArmId {
  if (!METHODOLOGY_ARM_IDS.includes(value as MethodologyArmId)) throw new Error("methodology arm id is invalid");
  return value as MethodologyArmId;
}

function strictObject(value: unknown, source: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const root = value as Record<string, unknown>;
  const expected = new Set(keys);
  if (Object.keys(root).some((key) => !expected.has(key))) throw new Error(`${source} contains unsupported fields`);
  if (keys.some((key) => !Object.hasOwn(root, key))) throw new Error(`${source} is missing required fields`);
  return root;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
