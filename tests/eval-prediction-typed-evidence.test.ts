import assert from "node:assert/strict";
import test from "node:test";
import { privateCommandBinding, privateFailureBinding, privateResultBinding } from "../eval/prediction-typed-evidence.js";

const token = "73a9b4dc0f2e65817aa305de92bff01873a9b4dc0f2e65817aa305de92bff018";
const encodings = [token, Buffer.from(token).toString("base64"), Buffer.from(token).toString("hex"),
  [...token].map(c => "%" + c.charCodeAt(0).toString(16)).join(""), [...token].map(c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join(""), token.split("").reverse().join("")];

test("typed evidence discards arbitrary producer strings instead of detecting token encodings", () => {
  for (const encoded of encodings) {
    const command = privateCommandBinding("docker", ["run", "--env", "MCP_FORWARDER_TOKEN=" + token], { MCP_FORWARDER_TOKEN: token });
    const result = privateResultBinding({ stdout: encoded, stderr: encoded, code: 0, timedOut: false, processId: 42, cleanupErrors: [encoded], extra: encoded } as never);
    const failure = privateFailureBinding(new AggregateError([new Error(encoded, { cause: new Error(encoded) })], encoded));
    const persisted = JSON.stringify({ command, result, failure });
    for (const secret of encodings) assert.equal(persisted.includes(secret), false);
    assert.equal(result.cleanupFailed, true); assert.equal(failure.cleanupUnproven, true);
    assert.equal(Object.hasOwn(result, "extra"), false);
    assert.equal(Object.hasOwn(command, "args"), false);
  }
});

test("malformed nested failure metadata remains bounded and never serializes arbitrary objects", () => {
  const error = new Error(token); error.cause = error;
  const failure = privateFailureBinding(error);
  assert.equal(failure.cleanupUnproven, true); assert.equal(failure.truncated, true);
  assert.equal(JSON.stringify(failure).includes(token), false);
  assert.throws(() => privateResultBinding({ stdout: token, stderr: token, code: 999, timedOut: false }), /metadata/);
});
