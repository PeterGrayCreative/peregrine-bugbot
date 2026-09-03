import assert from "node:assert/strict";
import test from "node:test";
import { displayNameForInput } from "../src/display-name.ts";

test("an intentionally cleared input remains empty", () => {
  assert.equal(displayNameForInput("", "Ada"), "");
});

test("an absent value uses the cached name", () => {
  assert.equal(displayNameForInput(null, "Ada"), "Ada");
});
