import assert from "node:assert/strict";
import test from "node:test";
import { listOrders } from "../src/list-orders.ts";

test("the first public page starts at storage offset zero", async () => {
  let observed;
  await listOrders({ list: async (input) => { observed = input; return []; } }, 1, 25);
  assert.deepEqual(observed, { limit: 25, offset: 0 });
});
