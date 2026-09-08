import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture, capturePages } from "../scripts/evidence/public-capture-store.mjs";

function store(t) {
  const path = mkdtempSync(join(tmpdir(), "peregrine-public-capture-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test("interrupted pagination resumes exact stored bytes without refetching prior pages", (t) => {
  const root = store(t);
  let calls = 0;
  const transport = (_endpoint, params) => {
    calls++;
    if (params.page === 2) throw new Error("interrupted");
    return ` ${JSON.stringify(Array(100).fill({ id: 1 }))}\n`;
  };
  assert.throws(() => capturePages(root, "repos/a/b/pulls", {}, transport), /interrupted/);
  const pages = capturePages(root, "repos/a/b/pulls", {}, (_e, p) => {
    assert.equal(p.page, 2);
    return "[]";
  });
  assert.equal(pages.length, 2);
  assert.equal(calls, 2);
  assert.equal(readFileSync(join(root, "objects", `${pages[0].receipt.sha256}.json`), "utf8")[0], " ");
});

test("resume rejects corrupted evidence instead of replacing it", (t) => {
  const root = store(t);
  capture(root, "repos/a/b", {}, () => "{}");
  const object = join(root, "objects", readdirSync(join(root, "objects"))[0]);
  writeFileSync(object, "[]");
  assert.throws(() => capture(root, "repos/a/b", {}, () => assert.fail("must not refetch")), /hash mismatch/);
});

test("truncated search results and exhausted pagination cannot look complete", (t) => {
  const root = store(t);
  assert.throws(() => capturePages(root, "search/issues", {}, () => JSON.stringify({ items: [], total_count: 1001 })), /incomplete/);
  assert.throws(() => capturePages(root, "repos/a/b/pulls", {}, () => JSON.stringify(Array(100).fill({})), 1), /ceiling/);
});
