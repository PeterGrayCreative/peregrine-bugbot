import assert from "node:assert/strict";
import test from "node:test";
import { acceptSearchResponse, beginSearch, initialSearchState } from "../src/search-state.ts";

test("an older search response cannot replace the latest query results", () => {
  let state = beginSearch(initialSearchState, 1);
  state = beginSearch(state, 2);
  state = acceptSearchResponse(state, { requestId: 2, items: ["new result"] });
  state = acceptSearchResponse(state, { requestId: 1, items: ["old result"] });
  assert.deepEqual(state.items, ["new result"]);
});
