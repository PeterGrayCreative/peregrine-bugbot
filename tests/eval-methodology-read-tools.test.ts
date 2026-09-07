import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReviewReadTools, REVIEW_READ_TOOLS_BOUNDARY, type ReviewReadToolLimits } from "../eval/methodology-read-tools.js";

const LIMITS: ReviewReadToolLimits = { maxIndexEntries: 100, maxFileBytes: 4096,
  maxOutputBytes: 8192, maxSearchMatches: 20, excludedNamespaces: ["private"] };
function fixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "methodology-read-tools-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("read tools expose sorted source paths, exact UTF8, literal line matches, and legitimate auth.json", () => fixture((root) => {
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "const value = '[a.*]';\n// café\n");
  writeFileSync(join(root, "auth.json"), '{"example":"source fixture"}');
  writeFileSync(join(root, "bom.txt"), "\uFEFFsource\n");
  const tools = createReviewReadTools(root, LIMITS);
  assert.deepEqual(tools.list_tree().entries?.map((entry) => entry.path), ["auth.json", "bom.txt", "src", "src/a.ts"]);
  assert.equal(tools.list_tree().status, "complete-for-indexed-export");
  assert.equal(tools.read_file({ path: "auth.json" }).text, '{"example":"source fixture"}');
  assert.equal(tools.read_file({ path: "src/a.ts" }).text, "const value = '[a.*]';\n// café\n");
  assert.equal(tools.read_file({ path: "bom.txt" }).text, "\uFEFFsource\n");
  assert.deepEqual(tools.search_text({ query: "[a.*]" }).matches,
    [{ path: "src/a.ts", line: 1, text: "const value = '[a.*]';" }]);
  assert.deepEqual(tools.search_text({ query: "a.+" }).matches, []);
  assert.match(REVIEW_READ_TOOLS_BOUNDARY, /No transport.*credential containment/);
}));

test("traversal, absolute paths, extra arguments, namespaces and symlinks cannot disclose content", () => fixture((root) => {
  mkdirSync(join(root, "private"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "private", "secret"), "excluded fixture");
  writeFileSync(join(root, ".git", "config"), "git fixture");
  symlinkSync(join(root, "private"), join(root, "alias"));
  symlinkSync(join(root, "private", "secret"), join(root, "file-link"));
  const tools = createReviewReadTools(root, LIMITS);
  for (const path of ["../outside", "/etc/passwd", "src/../file", "./file", "file/", "a\\b", "a\0b"]) {
    assert.throws(() => tools.read_file({ path }), /canonical relative/);
  }
  for (const path of [".git/config", "private/secret", "nested/.git/config"]) assert.throws(() => tools.read_file({ path }), /excluded/);
  assert.throws(() => tools.search_text({ query: "x", command: "pwd" } as never), /arguments/);
  assert.throws(() => tools.search_text({ query: "" }), /query/);
  assert.throws(() => tools.search_text({ query: "a\nb" }), /query/);
  assert.throws(() => tools.list_tree({ path: null } as never), /canonical relative/);
  assert.equal(tools.read_file({ path: "file-link" }).text, null);
  const listed = tools.list_tree();
  assert.equal(listed.status, "incomplete");
  assert.ok(listed.unavailable.some((item) => item.reason === "excluded-namespace"));
  assert.ok(listed.unavailable.some((item) => item.reason === "unsupported-file-type"));
  assert.deepEqual(tools.search_text({ query: "fixture" }).matches, []);
  assert.throws(() => createReviewReadTools(join(root, "alias"), LIMITS), /direct directory/);
}));

test("byte, binary, UTF8, and search caps are explicit and JSON output is bounded", () => fixture((root) => {
  writeFileSync(join(root, "large"), "x".repeat(2000));
  writeFileSync(join(root, "nul"), Buffer.from([97, 0, 98]));
  writeFileSync(join(root, "control"), Buffer.from([1, 2, 3]));
  writeFileSync(join(root, "invalid"), Buffer.from([0xc3, 0x28]));
  writeFileSync(join(root, "matches"), "match\nmatch\nmatch\n");
  const tools = createReviewReadTools(root, { ...LIMITS, maxFileBytes: 1000, maxSearchMatches: 1, maxOutputBytes: 512 });
  assert.equal(tools.read_file({ path: "large" }).unavailable[0]?.reason, "file-byte-limit");
  assert.equal(tools.read_file({ path: "nul" }).unavailable[0]?.reason, "binary-content");
  assert.equal(tools.read_file({ path: "control" }).unavailable[0]?.reason, "binary-content");
  assert.equal(tools.read_file({ path: "invalid" }).unavailable[0]?.reason, "invalid-utf8");
  const search = tools.search_text({ query: "match", path: "matches" });
  assert.equal(search.truncated, true);
  assert.equal(search.status, "incomplete");
  assert.equal(search.matches?.length, 1);
  assert.ok(search.unavailable.some((item) => item.reason === "search-match-limit"));
  const outputLimited = createReviewReadTools(root, { ...LIMITS, maxOutputBytes: 512 }).read_file({ path: "large" });
  assert.equal(outputLimited.text, null);
  assert.equal(outputLimited.truncated, true);
  assert.equal(outputLimited.unavailable[0]?.reason, "output-byte-limit");
  for (const result of [search, outputLimited, tools.list_tree()]) assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 512);
}));

test("entry cap, missing paths and source drift never imply complete scope", () => fixture((root) => {
  for (let index = 0; index < 20; index++) writeFileSync(join(root, `file-${index}`), "value");
  const capped = createReviewReadTools(root, { ...LIMITS, maxIndexEntries: 2 });
  assert.equal(capped.list_tree().truncated, true);
  assert.ok(capped.list_tree().entries!.length <= 2);
  assert.equal(capped.search_text({ query: "absent" }).status, "incomplete");
  assert.equal(capped.read_file({ path: "missing" }).text, null);
  const tools = createReviewReadTools(root, LIMITS);
  writeFileSync(join(root, "file-0"), "changed source");
  assert.equal(tools.read_file({ path: "file-0" }).unavailable[0]?.reason, "export-changed");
  assert.equal(tools.search_text({ query: "absent" }).status, "incomplete");
  rmSync(join(root, "file-1"));
  symlinkSync(join(root, "file-2"), join(root, "file-1"));
  assert.equal(tools.read_file({ path: "file-1" }).text, null);
}));

test("output cap includes escaped JSON envelopes and limit options are strict", () => fixture((root) => {
  for (let index = 0; index < 30; index++) writeFileSync(join(root, `file-${index}-${"é".repeat(15)}`), '"'.repeat(250));
  const tools = createReviewReadTools(root, { ...LIMITS, maxOutputBytes: 512 });
  for (const response of [tools.list_tree(), tools.search_text({ query: '"' }), tools.read_file({ path: `file-0-${"é".repeat(15)}` })]) {
    assert.equal(response.status, "incomplete");
    assert.equal(response.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 512);
  }
  assert.throws(() => createReviewReadTools(root, { ...LIMITS, maxOutputBytes: 511 }), /at least 512/);
  assert.throws(() => createReviewReadTools(root, { ...LIMITS, maxIndexEntries: Infinity }), /invalid/);
  assert.throws(() => createReviewReadTools(root, { ...LIMITS, excludedNamespaces: ["../outside"] }), /canonical/);
}));

test("search checks indexed empty directories before claiming its scope is complete", () => fixture((root) => {
  mkdirSync(join(root, "nested"));
  mkdirSync(join(root, "nested", "empty"));
  const tools = createReviewReadTools(root, LIMITS);
  assert.equal(tools.search_text({ query: "new content" }).status, "complete-for-indexed-export");
  writeFileSync(join(root, "nested", "empty", "new.txt"), "new content");
  const result = tools.search_text({ query: "new content" });
  assert.equal(result.status, "incomplete");
  assert.ok(result.unavailable.some((item) => item.path === "nested/empty" && item.reason === "export-changed"));
  assert.deepEqual(result.matches, []);
}));
