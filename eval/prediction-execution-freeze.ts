import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { packageRoot } from "../src/core/paths.js";
import { canonicalJson } from "./experiment.js";
import { digest, freeze, hash, same, sha, unique } from "./prediction-contract.js";
import { PREDICTION_LIMITS } from "./prediction-plan.js";
import { PREDICTION_TOOL_POLICY } from "./prediction-mounts.js";
import { PREDICTION_RUBRIC } from "./prediction-adjudication.js";
import { verifyPredictionDryRun, type PredictionDryRun, type PredictionPreparationAuthority } from "./prediction-preparation.js";
import { PREDICTION_CODEX_SUPPORT, PREDICTION_RUNTIME_REQUIREMENTS, predictionRuntimePreflight } from "./prediction-execution-contract.js";

const ROOTS = ["eval/prediction-execution-freeze.ts", "eval/prediction-attempt-monitor.ts", "eval/prediction-adjudication-gate.ts", "src/engines/codex.ts", "src/security/provider-env.ts"];
export interface PredictionPrivateBinding { role: string; path: string; sha256: string; commit: string }
export interface PredictionExecutionFreezeInput {
  authority: PredictionPreparationAuthority; mountsRoot: string;
  predecessorBytes: string; predecessorFileSha256: string;
  publicBaseCommit: string; privateBaseCommit: string; privateDriverSha256: string; privateBindings: PredictionPrivateBinding[];
}

/** Parse import/export edges rather than treating a hand-picked short list as
 * complete source closure. Runtime data files are explicitly included below.
 * npm dependencies are lockfile-bound; installed package bytes are not attested. */
export function predictionExecutionSourceManifest(root = packageRoot()) {
  const pending = [...ROOTS], found = new Set<string>(), packageImports = new Set<string>();
  for (let i = 0; i < pending.length; i++) {
    const path = pending[i]!;
    if (found.has(path)) continue;
    found.add(path);
    const bytes = readFileSync(join(root, path), "utf8");
    for (const imported of ts.preProcessFile(bytes, true, true).importedFiles) {
      const name = imported.fileName;
      if (!name.startsWith(".")) { if (!name.startsWith("node:")) packageImports.add(name); continue; }
      const candidate = resolve(root, dirname(path), name.replace(/\.js$/, ".ts"));
      const local = relative(root, candidate).replaceAll("\\", "/");
      if (local.startsWith("../") || !existsSync(candidate)) throw new Error(`unresolved local runtime source: ${path}: ${name}`);
      pending.push(local);
    }
  }
  const include = (path: string) => {
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) throw new Error("runtime source symlink prohibited");
    if (stat.isDirectory()) for (const child of readdirSync(join(root, path)).sort()) include(`${path}/${child}`);
    else if (stat.isFile()) found.add(path);
    else throw new Error("unsupported runtime source entry");
  };
  for (const path of [".nvmrc", "package.json", "package-lock.json", "tsconfig.json", "schemas", "container/eval-runtime", "skills/invariant-first-pr-review"]) include(path);
  const files = [...found].sort().map(path => { const bytes = readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: sha(bytes) }; });
  return freeze({ files, npmImports: [...packageImports].sort(), sourceSha256: digest(files),
    boundary: "Local import closure plus schemas, method resources, container sources and dependency lock; installed runtime/image/CLI provenance remains external." });
}
export async function buildPredictionExecutionFreeze(input: PredictionExecutionFreezeInput) {
  same(sha(input.predecessorBytes), hash(input.predecessorFileSha256), "trusted predecessor file digest mismatch");
  const predecessor = JSON.parse(input.predecessorBytes) as PredictionDryRun;
  await verifyPredictionDryRun(predecessor, input.authority, input.mountsRoot);
  for (const commit of [input.publicBaseCommit, input.privateBaseCommit]) if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("full base commit identities required");
  same(input.privateBindings.map(b => b.role).sort(), ["conditions", "mount-gate", "mount-manifest", "preparation-gate", "preparation-result", "registration"], "complete private authority roles required");
  unique(input.privateBindings.map(b => b.path));
  for (const b of input.privateBindings) {
    hash(b.sha256); if (!/^[a-f0-9]{40}$/.test(b.commit) || b.path.startsWith("/") || b.path.split("/").some(p => !p || p === "." || p === "..")) throw new Error("invalid private artifact binding");
  }
  const privateHash = (role: string) => input.privateBindings.find(b => b.role === role)!.sha256;
  same(privateHash("registration"), input.authority.registrationSha256, "private registration binding drift");
  same(privateHash("mount-manifest"), input.authority.manifestSha256, "private mount binding drift");
  same(privateHash("conditions"), input.authority.conditionsSha256, "private conditions binding drift");
  same(privateHash("preparation-result"), input.predecessorFileSha256, "private predecessor binding drift");
  const p = predecessor.preparation, source = predictionExecutionSourceManifest();
  const common = { kind: "prediction-zero-provider-execution-freeze-v1", publicBaseCommit: input.publicBaseCommit, privateBaseCommit: input.privateBaseCommit, privateDriverSha256: hash(input.privateDriverSha256),
    privateBindings: input.privateBindings, predecessorFileSha256: input.predecessorFileSha256, predecessorResultSha256: predecessor.sha256,
    preparation: p, source, limits: PREDICTION_LIMITS, toolPolicy: PREDICTION_TOOL_POLICY,
    runtimeRequirements: PREDICTION_RUNTIME_REQUIREMENTS, runtimeSupport: PREDICTION_CODEX_SUPPORT,
    rubric: PREDICTION_RUBRIC, rubricSha256: digest(PREDICTION_RUBRIC), analysisImplementationSha256: source.files.find(f => f.path === "eval/prediction-analysis.ts")!.sha256,
    schedule: p.plan.registration.schedule.map((a, index) => ({ ...a, runtimeAttemptId: `attempt-${String(index + 1).padStart(6, "0")}` })),
    authorization: "absent-default-deny", observedServedRoute: null, assessorIdentityReceipts: null, reviewedBlindingReceipt: null,
    providerAuthorized: false, executionReady: false, providerCalls: 0,
    remainingExternalRequirements: ["Explicit user approval bound to this freeze and exact attempts, with a concrete served version.",
      "A supported provider bridge with hard aggregate/output token limits and complete live accounting, including preprocessing and reasoning semantics.",
      "Prediction read policy and cumulative budgets attached to the branded one-attempt containment runtime; verify credentials, source/assets and network scope.",
      "Whole-attempt AbortSignal wired to provider/container/network cancellation, with independent termination/cleanup evidence.",
      "Authenticated served identity and fresh assessor-session receipts; separately reviewed free-text blinding before adjudication."],
    qualification: "Complete deterministic freeze of local preparation and fail-closed requirements. External capabilities are explicitly absent; this is not execution readiness or a provider experiment." };
  const freezeSha256 = digest(common);
  const preflights = common.schedule.map(a => predictionRuntimePreflight({ freezeSha256, attemptId: a.id, runtimeAttemptId: a.runtimeAttemptId, arm: a.arm,
    sourceHeadTree: p.sourceBindings.find(c => c.caseId === a.caseId)!.headTree, requestedVersion: null }));
  const body = { ...common, freezeSha256, preflights, scheduleClosure: { startedProviderAttempts: 0, completedProviderAttempts: 0, missingProviderAttempts: 64,
    unstartedAttemptIds: common.schedule.map(a => a.id), reason: "all preflights fail closed; no provider dispatch function exists in this section" } };
  return freeze({ ...body, sha256: digest(body) });
}
export type PredictionExecutionFreeze = Awaited<ReturnType<typeof buildPredictionExecutionFreeze>>;
export async function verifyPredictionExecutionFreeze(record: PredictionExecutionFreeze, input: PredictionExecutionFreezeInput) {
  same(record, await buildPredictionExecutionFreeze(input), "execution freeze differs from complete authenticated reconstruction");
}
export async function persistPredictionExecutionFreeze(directory: string, input: PredictionExecutionFreezeInput) {
  mkdirSync(directory, { mode: 0o700 });
  const write = (name: string, value: unknown) => writeFileSync(join(directory, name), `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
  write("start.json", { kind: "prediction-execution-freeze-start", predecessorFileSha256: input.predecessorFileSha256, providerCalls: 0 });
  try {
    const result = await buildPredictionExecutionFreeze(input);
    write(`${result.sha256}.json`, result);
    write("terminal.json", { status: "zero-provider-freeze-complete", sha256: result.sha256, executionReady: false, providerAuthorized: false, providerCalls: 0 });
    return result;
  } catch (error) {
    write("failure.json", { status: "freeze-failed", error: error instanceof Error ? error.message : "unknown", providerCalls: 0 });
    throw error;
  }
}
