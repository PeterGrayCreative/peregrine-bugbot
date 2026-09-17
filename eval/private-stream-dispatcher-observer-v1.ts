import { createPublicKey, randomBytes, verify } from "node:crypto";
import { lstatSync } from "node:fs";
import { request } from "node:http";
import { isAbsolute } from "node:path";
import { canonicalJson } from "./experiment.js";
import { exact, hash, same, sha } from "./prediction-contract.js";
import type { DispatcherBinding } from "./private-stream-dispatcher-contract-v1.js";

export interface ObserverContext { binding: DispatcherBinding; runId: string; sessionIdentitySha256: string; }
export type ObserverPhase = "ready" | "complete";
export type Observer = (phase: ObserverPhase, context: ObserverContext, signal: AbortSignal) => Promise<unknown>;

/** Only a separately deployed, gate-reviewed observer holding the pinned
 * Ed25519 private key can attest provider identity/accounting/client catalog.
 * Hashes of model output and unverified request parameters are never authority. */
export function verifyObserverEnvelope(bytes: Buffer, publicKey: string, expectedKeySha256: string,
  challenge: { phase: ObserverPhase; nonce: string; context: ObserverContext }) {
  if (bytes.length > 65_536) throw new Error("observer response too large");
  same(sha(publicKey), hash(expectedKeySha256), "observer key mismatch");
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 observer key required");
  const envelope = exact(JSON.parse(bytes.toString("utf8")), ["payload", "signature"], "observer envelope");
  const payload = exact(envelope.payload, ["kind", "phase", "nonce", "context", "observation"], "observer payload");
  same([payload.kind, payload.phase, payload.nonce, payload.context],
    ["private-stream-observer-v1", challenge.phase, challenge.nonce, challenge.context], "observer replay or binding mismatch");
  if (typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) ||
    !verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(envelope.signature, "base64"))) throw new Error("observer signature invalid");
  return payload.observation;
}

/** Local, private Unix socket only. No authorization header, forwarding token,
 * credential file, provider request, redirect, retry, or raw durable response. */
export function createSignedObserver(socketPath: string, publicKey: string, expectedKeySha256: string): Observer {
  if (!isAbsolute(socketPath) || /[\0\r\n]/.test(socketPath)) throw new Error("absolute observer socket required");
  return async (phase, context, signal) => {
    const stat = lstatSync(socketPath);
    if (!stat.isSocket() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error("private evaluator-owned observer socket required");
    const challenge = { phase, nonce: randomBytes(32).toString("hex"), context };
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const req = request({ socketPath, path: "/private-stream-observer-v1", method: "POST", signal,
        headers: { "content-type": "application/json" }, timeout: 10_000 }, res => {
        let length = 0; const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 65_536) res.destroy(new Error("observer response too large")); else chunks.push(chunk);
        });
        res.on("error", reject); res.on("end", () => {
          if (res.statusCode !== 200) reject(new Error("observer unavailable")); else resolve(Buffer.concat(chunks));
        });
      });
      req.on("error", reject); req.on("timeout", () => req.destroy(new Error("observer timeout")));
      req.end(canonicalJson(challenge));
    });
    return verifyObserverEnvelope(bytes, publicKey, expectedKeySha256, challenge);
  };
}
