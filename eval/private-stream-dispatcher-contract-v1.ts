import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { digest, exact, freeze, hash, same, sha } from "./prediction-contract.js";
import { privateStreamCanarySource, PRIVATE_STREAM_CANARY_IMAGE, PRIVATE_STREAM_CANARY_POLICY, type PrivateStreamCanaryContract } from "./private-stream-canary-contract.js";

export const DISPATCHER_BASES = freeze({ public: "564d17b823624fb79030f3c1de13b44db823f91c", private: "bea59fdf15afe08b084ae0d135a124072a8a992d" });
export const ACCEPTED_CANARY_CONTRACT = freeze({ commit: "c5a8981f0e500b4ad45798b19729026486e3d49e",
  sha256: "82f18bfba27ea93f38f72f6a39393bfd7b5d22cbb1e90ae4507e96c69656059b",
  freezeSha256: "6128d7ac3b0f798a7721a2afb32ffda8ad81dce381203fee6ee4f6ab111133a6" });
/** Config identities from the two digest-verified publication manifests. The
 * private replay independently reconstructs these from immutable manifest bytes. */
export const ACCEPTED_IMAGE_CONFIGS = freeze({
  amd64: "sha256:11238986e0a3842bfc64ebc9063a5602702182ec9c03b40ae5533157a56372cd",
  arm64: "sha256:747a4e9d13263a69ccecd63a6420115edf46051e50f6c5903de5e716890de0dc",
});
export const DISPATCHER_FILES = ["eval/private-stream-dispatcher-contract-v1.ts", "eval/private-stream-dispatcher-v1.ts",
  "eval/private-stream-dispatcher-runtime-v1.ts", "eval/private-stream-dispatcher-observer-v1.ts",
  "scripts/evidence/private-stream-dispatcher-v1.ts", "tests/eval-private-stream-dispatcher-v1.test.ts",
  "docs/validation/2026-09-16-private-stream-dispatcher-v1.md"] as const;
export function dispatcherSource(root: string) {
  const paths = new Set([...privateStreamCanarySource(root).files.map(file => file.path), ...DISPATCHER_FILES]);
  const files = [...paths].sort().map(path => {
    if (!lstatSync(join(root, path)).isFile()) throw new Error("source must be a regular file");
    const bytes = readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: sha(bytes) };
  });
  return freeze({ files, sha256: digest(files) });
}
export function acceptedCanaryContract(freezeBytes: Buffer): PrivateStreamCanaryContract {
  same(sha(freezeBytes), ACCEPTED_CANARY_CONTRACT.freezeSha256, "accepted contract freeze mismatch");
  const contract = JSON.parse(freezeBytes.toString()).contract as PrivateStreamCanaryContract;
  const { sha256, ...body } = contract;
  same([sha256, digest(body), contract.policy, contract.image],
    [ACCEPTED_CANARY_CONTRACT.sha256, ACCEPTED_CANARY_CONTRACT.sha256, PRIVATE_STREAM_CANARY_POLICY, PRIVATE_STREAM_CANARY_IMAGE], "accepted contract mismatch");
  return freeze(contract);
}
export interface DispatcherBinding {
  publicCommit: string; privateCommit: string; sourceSha256: string; privateFreezeSha256: string;
  contractSha256: string; image: string; stateDirectorySha256: string; observerKeySha256: string;
  runtimeInputsSha256: string;
}
export function verifyDispatcherGate(bytes: Buffer, expectedSha256: string | null, binding: DispatcherBinding) {
  if (!expectedSha256) throw new Error("fresh independent dispatcher gate unavailable");
  same(sha(bytes), hash(expectedSha256), "dispatcher gate bytes mismatch");
  exact(binding, ["publicCommit", "privateCommit", "sourceSha256", "privateFreezeSha256", "contractSha256", "image", "stateDirectorySha256", "observerKeySha256", "runtimeInputsSha256"], "dispatcher binding");
  for (const key of ["publicCommit", "privateCommit"] as const) if (!/^[a-f0-9]{40}$/.test(binding[key])) throw new Error("exact commit required");
  for (const key of ["sourceSha256", "privateFreezeSha256", "stateDirectorySha256", "observerKeySha256", "runtimeInputsSha256"] as const) hash(binding[key]);
  same([binding.contractSha256, binding.image], [ACCEPTED_CANARY_CONTRACT.sha256, PRIVATE_STREAM_CANARY_IMAGE.image], "wrong contract or accepted image");
  const gate = exact(JSON.parse(bytes.toString()), ["kind", "binding", "verdict", "reviewer", "blockingFindings", "scope"], "dispatcher gate");
  const reviewer = exact(gate.reviewer, ["model", "effort", "independent", "identifier"], "reviewer");
  if (typeof reviewer.identifier !== "string" || !/^\/root\/[a-z0-9_]+$/.test(reviewer.identifier)) throw new Error("independent reviewer identity required");
  same([gate.kind, gate.binding, gate.verdict, reviewer.model, reviewer.effort, reviewer.independent, gate.blockingFindings, gate.scope],
    ["private-stream-dispatcher-gate-v1", binding, "PASS", "gpt-6-astra", "medium", true, [], "one-private-stream-canary-only"], "fresh dispatcher gate mismatch");
}
export function observeDispatcherSource(root: string, binding: DispatcherBinding, stateDirectory: string) {
  const git = (args: string[]) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: root, encoding: "utf8", maxBuffer: 4_194_304 }).trim();
  same(git(["rev-parse", "HEAD"]), binding.publicCommit, "public source commit mismatch");
  same(git(["status", "--porcelain", "--untracked-files=all"]), "", "source must be clean");
  same(dispatcherSource(root).sha256, binding.sourceSha256, "dispatcher source drift");
  same(sha(resolve(stateDirectory)), binding.stateDirectorySha256, "durable state location mismatch");
}
