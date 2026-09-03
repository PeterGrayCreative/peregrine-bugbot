import assert from "node:assert/strict";
import test from "node:test";
import { applyFailure, applySuccess, beginSave, initialPreferenceState } from "../src/preferences-state.ts";

test("a stale failed save cannot roll back a newer confirmed preference", () => {
  const first = beginSave(initialPreferenceState, "weekly");
  const second = beginSave(first, "monthly");
  const confirmed = applySuccess(second, second.mutationId);
  const afterLateFailure = applyFailure(confirmed, first.mutationId);
  assert.equal(afterLateFailure.value, "monthly");
  assert.equal(afterLateFailure.confirmedValue, "monthly");
});
