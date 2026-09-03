import assert from "node:assert/strict";
import test from "node:test";
import { windowItems } from "../src/window.ts";

test("window boundaries preserve full, partial, empty, and zero-size pages", () => {
  const values = ["a", "b", "c", "d", "e"];
  assert.deepEqual(windowItems(values, 0, 2), ["a", "b"]);
  assert.deepEqual(windowItems(values, 4, 2), ["e"]);
  assert.deepEqual(windowItems(values, 5, 2), []);
  assert.deepEqual(windowItems(values, 2, 0), []);
});
