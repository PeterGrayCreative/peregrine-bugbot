import assert from "node:assert/strict";
import test from "node:test";
import { readSettings } from "../src/read-settings.ts";

test("logging preserves the original settings failure", async () => {
  const failure = new Error("timeout");
  await assert.rejects(
    readSettings({ read: async () => { throw failure; } }, { warn: () => undefined }),
    failure,
  );
});
