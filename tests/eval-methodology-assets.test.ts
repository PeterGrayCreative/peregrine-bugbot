import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createMethodologyAssetPreparer,
  readMethodologyAssetManifest,
  verifyMethodologyAssetManifest,
} from "../eval/methodology-assets.js";
import type { LeakagePolicy } from "../eval/case-isolation.js";
import { packageRoot } from "../src/core/paths.js";

const policy: LeakagePolicy = {
  caseId: "case-aaaaaaaa",
  corpus: "development",
  forbiddenTerms: ["case specific secret root"],
  documentedMarkerHashes: new Set(),
};

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "peregrine-methodology-assets-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("A and C receive only their exact neutral schema allowlists", () => withRoot((root) => {
  const a = join(root, "a");
  createMethodologyAssetPreparer("A")(a, policy);
  assert.deepEqual(readMethodologyAssetManifest(a, "A").files.map((file) => file.path), [
    "schemas/methodology-review.schema.json",
  ]);

  const c = join(root, "c");
  createMethodologyAssetPreparer("C")(c, policy);
  assert.deepEqual(readMethodologyAssetManifest(c, "C").files.map((file) => file.path), [
    "schemas/methodology-discovery.schema.json",
    "schemas/methodology-review.schema.json",
  ]);
  assert.ok(!readMethodologyAssetManifest(a, "A").files.some((file) =>
    file.path.includes("review-result") || file.path.includes("skills/")));
  assert.ok(!readMethodologyAssetManifest(c, "C").files.some((file) =>
    file.path.includes("breadth-result") || file.path.includes("skills/")));
}));

test("B remains schema-only while D receives exactly the static breadth packet", () => withRoot((root) => {
  const b = join(root, "b");
  createMethodologyAssetPreparer("B")(b, policy);
  assert.deepEqual(readMethodologyAssetManifest(b, "B").files.map((file) => file.path), [
    "schemas/methodology-review.schema.json",
  ]);

  const d = join(root, "d");
  createMethodologyAssetPreparer("D")(d, policy);
  assert.deepEqual(readMethodologyAssetManifest(d, "D").files.map((file) => file.path), [
    "schemas/breadth-result.schema.json",
    "schemas/methodology-review.schema.json",
    "skills/invariant-first-pr-review/references/breadth-worker-packet.md",
  ]);
  assert.equal(
    readFileSync(join(d, "skills/invariant-first-pr-review/references/breadth-worker-packet.md"), "utf8"),
    readFileSync(join(packageRoot(), "skills/invariant-first-pr-review/references/breadth-worker-packet.md"), "utf8"),
  );
}));

test("manifests deterministically bind copied paths and bytes", () => withRoot((root) => {
  const first = join(root, "first");
  const second = join(root, "second");
  createMethodologyAssetPreparer("D")(first, policy);
  createMethodologyAssetPreparer("D")(second, policy);
  const manifest = readMethodologyAssetManifest(first, "D");
  assert.deepEqual(readMethodologyAssetManifest(second, "D"), manifest);
  assert.deepEqual(verifyMethodologyAssetManifest(first, structuredClone(manifest)), manifest);
  assert.throws(() => createMethodologyAssetPreparer("D")(first, policy), /must not exist/);
}));

test("verification rejects tampering and unexpected files", () => withRoot((root) => {
  const target = join(root, "assets");
  createMethodologyAssetPreparer("C")(target, policy);
  const manifest = readMethodologyAssetManifest(target, "C");
  writeFileSync(join(target, "schemas/methodology-review.schema.json"), "{}\n");
  assert.throws(() => verifyMethodologyAssetManifest(target, manifest), /does not match current bytes/);

  const extraTarget = join(root, "extra");
  createMethodologyAssetPreparer("A")(extraTarget, policy);
  writeFileSync(join(extraTarget, "schemas/unexpected.json"), "{}\n");
  assert.throws(() => readMethodologyAssetManifest(extraTarget, "A"), /does not match the arm allowlist/);

  const extraDirectoryTarget = join(root, "extra-directory");
  createMethodologyAssetPreparer("A")(extraDirectoryTarget, policy);
  mkdirSync(join(extraDirectoryTarget, "skills"));
  assert.throws(() => readMethodologyAssetManifest(extraDirectoryTarget, "A"), /does not match the arm allowlist/);
}));

test("verification rejects symlinks and untrusted arm identifiers", () => withRoot((root) => {
  const target = join(root, "assets");
  createMethodologyAssetPreparer("A")(target, policy);
  symlinkSync(join(target, "schemas/methodology-review.schema.json"), join(target, "linked-schema"));
  assert.throws(() => readMethodologyAssetManifest(target, "A"), /must not contain symlinks/);
  assert.throws(
    () => createMethodologyAssetPreparer("A/../../D" as "A"),
    /arm id is invalid/,
  );
}));

test("a retained manifest rejects path, digest, arm, and tree tampering", () => withRoot((root) => {
  const target = join(root, "assets");
  createMethodologyAssetPreparer("A")(target, policy);
  const original = readMethodologyAssetManifest(target, "A");
  for (const mutate of [
    (value: any) => { value.files[0].path = "schemas/review-result.schema.json"; },
    (value: any) => { value.files[0].sha256 = "f".repeat(64); },
    (value: any) => { value.armId = "D"; },
    (value: any) => { value.treeSha256 = "f".repeat(64); },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() => verifyMethodologyAssetManifest(target, changed));
  }
}));

test("asset preparation applies the case-specific leakage policy", () => withRoot((root) => {
  assert.throws(() => createMethodologyAssetPreparer("A")(join(root, "assets"), {
    ...policy,
    forbiddenTerms: ["limitations"],
  }), /forbidden answer-bearing term/);
}));
