import assert from "node:assert/strict";
import test from "node:test";
import { pageItems } from "../src/page-items.ts";

test("each full page contains exactly the requested number of items", () => {
  assert.deepEqual(pageItems(["a", "b", "c", "d", "e"], 1, 2), ["a", "b"]);
  assert.deepEqual(pageItems(["a", "b", "c", "d", "e"], 2, 2), ["c", "d"]);
});
