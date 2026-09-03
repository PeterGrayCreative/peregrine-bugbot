import assert from "node:assert/strict";
import test from "node:test";
import { processImport } from "../src/repository-import.ts";

test("failed import persistence rejects and does not enqueue indexing", async () => {
  const queued = [];
  const failure = new Error("database unavailable");
  await assert.rejects(
    processImport(
      { persist: async () => { throw failure; } },
      { enqueue: async (id) => { queued.push(id); } },
      "repo-4",
    ),
    failure,
  );
  assert.deepEqual(queued, []);
});
