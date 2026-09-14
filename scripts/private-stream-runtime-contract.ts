import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { predictionExecutionSourceManifest } from "../eval/prediction-execution-freeze.js";
import { digest, freeze, sha } from "../eval/prediction-contract.js";

export const PRIVATE_STREAM_PUBLICATION_PROFILE = "private-stream-v1";
export const PRIVATE_STREAM_IMAGE_NAME = "ghcr.io/petergraycreative/peregrine-eval-runtime";
const inputs = [".github/workflows/eval-private-stream-runtime-image.yml", "scripts/run-eval-runtime-probe.ts", "scripts/run-eval-egress-probe.ts",
  "scripts/run-private-stream-runtime-probe.ts", "scripts/private-stream-runtime-contract.ts", "scripts/eval-egress-probe-fixture.mjs",
  "scripts/eval-private-stream-probe-fixture-v1.mjs"];

/** Source/acceptance INPUT only. A successful reconstruction grants no runtime authority. */
export function preparePrivateStreamRuntimePublication(root: string, revision: string) {
  if (!process.version.startsWith("v22.") || !/^[a-f0-9]{40}$/.test(revision) || readFileSync(resolve(root, ".nvmrc"), "utf8").trim() !== "22") throw new Error("exact revision and Node22 pin required");
  const git = (args: string[]) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  if (git(["rev-parse", "HEAD"]).toString().trim() !== revision) throw new Error("publication checkout revision mismatch");
  const source = predictionExecutionSourceManifest(root);
  const files = [...new Set([...inputs, ...source.files.map(f => f.path)])].sort().map(path => {
    const bytes = readFileSync(resolve(root, path));
    if (!bytes.equals(git(["show", `${revision}:${path}`]))) throw new Error("publication source differs from committed input");
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  });
  const body = { kind: "private-stream-runtime-publication-input-v1", profile: PRIVATE_STREAM_PUBLICATION_PROFILE, revision, hostNodeVersion: process.version,
    imageName: PRIVATE_STREAM_IMAGE_NAME, tag: `${PRIVATE_STREAM_IMAGE_NAME}:private-stream-v1-${revision}`,
    dockerfile: "container/eval-runtime/Dockerfile.private-stream-v1", platforms: ["linux/amd64", "linux/arm64"], files,
    workflow: ".github/workflows/eval-private-stream-runtime-image.yml", requiredProbes: ["zero-credential-containment", "fixed-endpoint-egress", "metadata-only-persistence"],
    requiredAttestation: "GitHub build provenance for exact published digest and source revision",
    publishedDigest: null, workflowRun: null, independentReview: null, imageAccepted: false,
    runtimeReady: false, executionReady: false, providerAuthorized: false, batchAuthorized: false, retryAuthorized: false,
    limitations: ["No published candidate or architecture proof exists at source preparation time", "Successful workflow results still require independent digest/source/artifact review", "Image acceptance cannot authorize a canary; fresh exact authorization remains required"] };
  return freeze({ ...body, sha256: digest(body) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== "--revision" || args[2] !== "--output") throw new Error("exact source-freeze arguments required");
    const body = preparePrivateStreamRuntimePublication(process.cwd(), args[1]!);
    writeFileSync(resolve(args[3]!), JSON.stringify(body, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    process.stdout.write(JSON.stringify({ sourceFreezeSha256: body.sha256, runtimeReady: false }) + "\n");
  } catch { process.stderr.write("Private-stream source preparation failed; no runtime authorized.\n"); process.exitCode = 1; }
}
