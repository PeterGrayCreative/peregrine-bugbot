import assert from "node:assert/strict";
import test from "node:test";
import { loadAccount } from "../src/load-account.ts";

test("a failed account lookup remains observable to the request handler", async () => {
  const failure = new Error("upstream unavailable");
  const warnings = [];
  await assert.rejects(
    loadAccount({ get: async () => { throw failure; } }, { warn: (message) => warnings.push(message) }, "acct-7"),
    failure,
  );
  assert.deepEqual(warnings, ["account lookup failed"]);
});
