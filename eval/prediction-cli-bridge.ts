import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageRoot } from "../src/core/paths.js";
import { parseCodexEvents } from "../src/engines/codex.js";
import type { ProviderExec } from "../src/types.js";
import { canonicalJson } from "./experiment.js";
import { digest, freeze, hash, same, sha, text } from "./prediction-contract.js";
import { preparePredictionPreauthorization, type PredictionPreauthorizationAuthority, type PredictionPreauthorizationPackage } from "./prediction-preauthorization.js";
import { predictionExecutionSourceManifest } from "./prediction-execution-freeze.js";
import { registerPredictionCliSession, assessPredictionCliBatch, observePredictionCliTokens, type PredictionCliTerminal } from "./prediction-cli-session.js";
import { createPredictionCliDeadline, createStructuralPredictionCliDeadline, predictionFailureEvidence } from "./prediction-cli-deadline.js";
import { attachPredictionReadTools, PREDICTION_MCP_LIMITS } from "./prediction-runtime-attachment.js";
import { createMethodologyEgressSupervisor, createStructuralMockMethodologyEgressSupervisor, type DockerExec, type MethodologyEgressSupervisor } from "./methodology-egress.js";
import { createContainedOutputReader, createContainedProviderExec } from "./runtime-containment.js";
import { predictionCliCommand } from "./prediction-cli-command.js";
import { PREDICTION_CLI_BRIDGE_POLICY } from "./prediction-cli-policy.js";
import { predictionSolLowCanaryCommand } from "./prediction-sol-low-command.js";
import { preparePredictionSolLowCanary, type PredictionSolLowCanaryAuthority } from "./prediction-sol-low-canary.js";

export { PREDICTION_CLI_BRIDGE_POLICY } from "./prediction-cli-policy.js";
interface Options {
  authority: PredictionPreauthorizationAuthority; mountsRoot: string;
  freezeBytes: string; freezeSha256: string; directory: string; runId: string;
}
type Purpose = "canary" | "review";
interface Scope {
  runId: string; freezeSha256: string; packageSha256: string; canarySha256: string; sourceSha256: string; policySha256: string;
  executionClass: "provider" | "structural-mock"; purpose: Purpose; attemptId: string; sourceAttemptId: string;
  promptSha256: string; mountSha256: string; rawScopeSha256: string; model: string; effort: string; providerAccess: string;
}
interface Approval { scope: Scope; permission: "one-provider-cli-attempt" | "synthetic-only"; approvalEvidenceSha256: string; independentGateSha256: string; reviewedCanaryEvidenceSha256?: string }
export interface PredictionCliAuthorization { readonly kind: "prediction-cli-authorization"; toJSON(): never }
interface SolLowAmendment { authority: PredictionSolLowCanaryAuthority; freezeBytes: string; freezeSha256: string }
export interface PredictionSolLowCanaryBridgeOptions extends Options { solLowAmendment: SolLowAmendment; recordMechanicalEvidence?: true }

export function createPredictionCliBridge(options: Options) {
  if (Object.hasOwn(options, "solLowAmendment")) throw new Error("use the separate Sol/low canary bridge");
  if (Object.hasOwn(options, "run") || Object.hasOwn(options, "wallMs")) throw new Error("provider bridge cannot inject execution or alter the deadline");
  return createBridge(options);
}
/** Inject only the existing Docker boundary. No injected executor can acquire
 * a provider-class capability or become evidence of actual client support. */
export function createStructuralPredictionCliBridge(options: Options & { run: DockerExec; wallMs?: number }) {
  if (Object.hasOwn(options, "solLowAmendment")) throw new Error("use the separate Sol/low canary bridge");
  if (typeof options.run !== "function") throw new Error("structural bridge requires an injected executor");
  return createBridge(options, { run: options.run, wallMs: options.wallMs });
}
export function createPredictionSolLowCanaryBridge(options: PredictionSolLowCanaryBridgeOptions) {
  if (!options.solLowAmendment) throw new Error("explicit Sol/low canary amendment required");
  if (Object.hasOwn(options, "run") || Object.hasOwn(options, "wallMs")) throw new Error("provider bridge cannot inject execution or alter the deadline");
  return createBridge(options, undefined, options.solLowAmendment);
}
export function createStructuralPredictionSolLowCanaryBridge(options: PredictionSolLowCanaryBridgeOptions & { run: DockerExec; wallMs?: number }) {
  if (!options.solLowAmendment) throw new Error("explicit Sol/low canary amendment required");
  if (typeof options.run !== "function") throw new Error("structural bridge requires an injected executor");
  return createBridge(options, { run: options.run, wallMs: options.wallMs }, options.solLowAmendment);
}
async function createBridge(input: Options, structural?: { run: DockerExec; wallMs?: number }, amendmentInput?: SolLowAmendment) {
  const options = { ...input, authority: freeze(input.authority), mountsRoot: resolve(input.mountsRoot), directory: resolve(input.directory) };
  const amendment = amendmentInput ? freeze(amendmentInput) : null, low = amendment ? preparePredictionSolLowCanary(amendment.authority) : null;
  const mechanical = low && (input as PredictionSolLowCanaryBridgeOptions).recordMechanicalEvidence === true;
  const policy = low?.policy ?? PREDICTION_CLI_BRIDGE_POLICY;
  text(options.runId); hash(options.freezeSha256);
  same(sha(options.freezeBytes), options.freezeSha256, "trusted preauthorization freeze digest mismatch");
  const predecessor = JSON.parse(options.freezeBytes) as { kind: string; package: PredictionPreauthorizationPackage; providerCalls: number; executionReady: boolean; providerAuthorized: boolean };
  same([predecessor.kind, predecessor.providerCalls, predecessor.executionReady, predecessor.providerAuthorized], ["prediction-r4-preauthorization-freeze-v1", 0, false, false], "preauthorization freeze class drift");
  const frozen = predecessor.package, current = await preparePredictionPreauthorization(options.authority, options.mountsRoot);
  // Bridge source is additive. Authenticate scientific bytes exactly; never
  // rewrite the predecessor source seal to pretend this bridge existed then.
  const { source: _oldSource, sha256: _oldSha, ...oldBody } = frozen.preauthorization;
  const { source: _source, sha256: _sha, ...body } = current.preauthorization;
  same(body, oldBody, "preauthorization scientific input drift");
  const { preauthorizationSha256: _oldParent, sha256: _oldCanary, ...oldCanary } = frozen.canary;
  const { preauthorizationSha256: _parent, sha256: _canary, ...canary } = current.canary;
  same(canary, oldCanary, "canary registration drift");
  same(digest({ preauthorization: frozen.preauthorization, canary: frozen.canary }), frozen.sha256, "predecessor package seal drift");
  same(frozen.canary.preauthorizationSha256, frozen.preauthorization.sha256, "canary/package cross-binding drift");
  const source = predictionExecutionSourceManifest(), executionClass = structural ? "structural-mock" as const : "provider" as const;
  if (amendment) {
    same(amendment.authority.r4Freeze, { bytes: options.freezeBytes, expectedSha256: options.freezeSha256 }, "low amendment original freeze mismatch");
    same(sha(amendment.freezeBytes), hash(amendment.freezeSha256), "low amendment freeze byte drift");
    const f = JSON.parse(amendment.freezeBytes);
    same([f.kind, f.amendment, f.source, f.execution, f.providerAuthorized, f.executionReady, f.batchAuthorized, f.providerCalls],
      ["prediction-sol-low-canary-freeze-v1", low, source, { runId: options.runId, directory: options.directory }, false, false, false, 0], "low amendment freeze, execution ledger or source mismatch");
  }
  const selectedCanary = low ?? frozen.canary;
  const p = frozen.preauthorization, registration = registerPredictionCliSession(options.authority.preparation.registrationBytes, options.authority.preparation.registrationSha256, p.scientificRegistration.predecessorFreezeSha256);
  const bindings = freeze({ runId: options.runId, freezeSha256: options.freezeSha256, packageSha256: frozen.sha256, canarySha256: selectedCanary.sha256,
    sourceSha256: source.sourceSha256, policySha256: digest(policy), executionClass,
    ...(low ? { amendmentFreezeSha256: amendment!.freezeSha256, userAuthorizationSha256: low.userAuthorization.sha256,
      predecessorCanarySha256: low.predecessor.canarySha256, predecessorBridgeFreezeSha256: low.predecessor.bridgeFreezeSha256, predecessorAssessmentFreezeSha256: low.predecessor.assessmentFreezeSha256 } : {}) });
  mkdirSync(options.directory, { mode: 0o700 });
  const write = (path: string, value: unknown) => writeFileSync(path, canonicalJson(value) + "\n", { flag: "wx", mode: 0o600 });
  write(join(options.directory, "bridge.json"), { bindings, source, policy, providerAuthorized: false, executionReady: false });
  if (low) write(join(options.directory, "canary-ledger-start.json"), { bindings, ...low.separateLedger, batchAuthorized: false });
  const authorizations = new WeakMap<object, Approval>(), terminals: PredictionCliTerminal[] = [];
  let active = false, blocked = false, canaryUsed = false;
  let canaryLedger: unknown = low?.separateLedger ?? null;
  const freshSource = () => same(predictionExecutionSourceManifest(), source, "stale bridge runtime source");
  const scope = (purpose: Purpose, attemptId: string): Scope => {
    if (purpose !== "canary" && purpose !== "review") throw new Error("invalid prediction purpose");
    if (low && purpose !== "canary") throw new Error("Sol/low amendment authorizes no review or batch slots");
    if (purpose === "canary" && attemptId !== selectedCanary.canaryId) throw new Error("canary cannot consume a review slot");
    const sourceAttemptId = purpose === "canary" ? selectedCanary.sourceAttemptId : attemptId;
    const slot = p.attempts.find(a => a.id === sourceAttemptId);
    if (!slot) throw new Error("unregistered review slot");
    return freeze({ ...bindings, purpose, attemptId, sourceAttemptId, promptSha256: purpose === "canary" ? selectedCanary.promptSha256 : slot.promptSha256,
      mountSha256: slot.mountSha256, rawScopeSha256: slot.rawScopeSha256, model: "gpt-5.6-sol", effort: low ? "low" : "high", providerAccess: "cli-session" });
  };
  const admissible = (s: Scope) => {
    if (active || blocked) throw new Error("bridge is active or stopped");
    if (s.purpose === "canary" ? canaryUsed : assessPredictionCliBatch(registration, terminals).nextAttemptId !== s.attemptId) throw new Error("attempt used, stopped, or not the next registered slot");
    same(s, scope(s.purpose, s.attemptId), "stale, cross-run, route or scope mismatch"); freshSource();
  };
  return {
    bindings, scope,
    /** Trusted operator entry point, not a JSON loader. Calling this requires
     * separate explicit permission and gate evidence; preparation never calls it. */
    authorize(approval: Approval): PredictionCliAuthorization {
      admissible(approval.scope);
      same(approval.permission, structural ? "synthetic-only" : "one-provider-cli-attempt", "execution-class authorization mismatch");
      hash(approval.approvalEvidenceSha256); hash(approval.independentGateSha256);
      if (low) same(approval.approvalEvidenceSha256, low.userAuthorization.sha256, "low canary user authorization mismatch");
      if (approval.scope.purpose === "review") hash(approval.reviewedCanaryEvidenceSha256);
      const token = Object.freeze({ kind: "prediction-cli-authorization" as const, toJSON(): never { throw new Error("authorization is nonserializable"); } });
      authorizations.set(token, freeze(approval)); return token;
    },
    snapshot() { return freeze({ bindings, active, blocked, canaryUsed, ...(low ? { canaryLedger } : {}), batch: assessPredictionCliBatch(registration, terminals), executionReady: false, builtInCatalogVerified: false }); },
    async run(token: PredictionCliAuthorization) {
      const approval = authorizations.get(token);
      if (!approval) throw new Error("explicit nonserializable scoped authorization required");
      admissible(approval.scope); authorizations.delete(token); active = true;
      const s = approval.scope; if (s.purpose === "canary") canaryUsed = true;
      if (low) canaryLedger = freeze({ ...low.separateLedger, status: "started", providerCalls: null });
      const ordinal = terminals.length + 1, directory = join(options.directory, s.purpose === "canary" ? "canary" : `review-${String(ordinal).padStart(6, "0")}`);
      let attachment: Awaited<ReturnType<typeof attachPredictionReadTools>> | undefined, egress: MethodologyEgressSupervisor | undefined;
      let setup: Promise<MethodologyEgressSupervisor> | undefined;
      let execution: Awaited<ReturnType<ProviderExec>> | null = null, failure: ReturnType<typeof predictionFailureEvidence> | null = null, rawOutput: string | null = null;
      let guard: ReturnType<typeof createPredictionCliDeadline> | undefined;
      try {
        mkdirSync(directory, { mode: 0o700 }); write(join(directory, "start.json"), { bindings, scope: s, approval });
        const deadlineOptions = { directory: join(directory, "deadline"), attemptId: s.attemptId, closeReads() {}, teardown: async () => {
          const errors: unknown[] = [];
          await setup?.catch(error => { if (predictionFailureEvidence(error).cleanupUnproven) errors.push(error); });
          try { await egress?.close(); } catch (error) { errors.push(error); }
          try { await attachment?.close(); } catch (error) { errors.push(error); }
          write(join(directory, "cleanup.json"), { sidecars: egress?.auditDiagnostics ?? null, reader: attachment?.readerSnapshot() ?? null, audit: attachment?.sealAudit() ?? null });
          if (errors.length) throw new AggregateError(errors, "prediction bridge mandatory cleanup failed");
        } };
        guard = structural?.wallMs === undefined ? createPredictionCliDeadline(deadlineOptions) : createStructuralPredictionCliDeadline(deadlineOptions, structural.wallMs);
        const mount = p.dryRun.preparation.sourceBindings.find(m => m.caseId === p.attempts.find(a => a.id === s.sourceAttemptId)!.caseId)!;
        const item = p.dryRun.preparation.plan.cases.find(c => c.source.caseId === mount.caseId)!;
        guard.read(() => { same(item.prompts.A.rawScopeSha256, item.prompts.B.rawScopeSha256, "raw arm scope inequality"); same(s.mountSha256, mount.inputDigest, "mount binding drift"); });
        attachment = await attachPredictionReadTools(options.authority.preparation, options.mountsRoot, s.sourceAttemptId, guard, { host: "0.0.0.0", allowedHosts: ["host.docker.internal:1"] });
        same(attachment.binding.inputDigest, s.mountSha256, "reader mount scope mismatch");
        const endpoint = new URL(attachment.url); attachment.replaceAuthorizedHosts([`host.docker.internal:${endpoint.port}`]);
        const { maxSessions: _, ...limits } = PREDICTION_MCP_LIMITS;
        const egressOptions = { attemptId: `attempt-${String(ordinal).padStart(6, "0")}`, armId: p.attempts.find(a => a.id === s.sourceAttemptId)!.arm, sourceHeadTree: mount.headTree,
          providerAuthorities: policy.providerAuthorities, hostMcpPort: Number(endpoint.port), hostMcpToken: endpoint.pathname.slice("/mcp/".length), deadlineSignal: guard.signal, mcpLimits: { ...limits, maxHeaderBytes: 8192 },
          ...(mechanical ? { mechanicalEvidenceDirectory: join(directory, "mechanical-sidecars") } : {}) };
        setup = structural ? createStructuralMockMethodologyEgressSupervisor({ ...egressOptions, run: structural.run }) : createMethodologyEgressSupervisor(egressOptions);
        egress = await setup;
        const checkout = join(directory, "workspace"), assets = join(directory, "assets"), output = join(directory, "output");
        guard.read(() => {
          for (const path of [checkout, assets, output]) mkdirSync(path, { mode: 0o700 });
          if (s.purpose === "review") {
            const schema = readFileSync(join(packageRoot(), "schemas/methodology-review.schema.json"));
            same(sha(schema), p.dryRun.preparation.plan.outputSchemaSha256, "review schema drift");
            writeFileSync(join(assets, "methodology-review.schema.json"), schema, { flag: "wx", mode: 0o600 });
          }
        });
        const prompt = s.purpose === "canary" ? selectedCanary.prompt : item.prompts[p.attempts.find(a => a.id === s.attemptId)!.arm].prompt;
        const args = low ? predictionSolLowCanaryCommand(egress.internalMcpUrl) : predictionCliCommand(egress.internalMcpUrl, s.purpose === "review");
        guard.read(() => { freshSource(); same(sha(prompt), s.promptSha256, "prompt drift"); same(readdirSync(checkout), [], "unexpected agent workspace"); same(readdirSync(assets), s.purpose === "review" ? ["methodology-review.schema.json"] : [], "unexpected method resources"); });
        write(join(directory, "invocation.json"), { scope: s, args, prompt, attachment: attachment.binding, egress: egress.attestation, assets: readdirSync(assets), providerImage: p.runtimeAcceptance.image });
        const run = createContainedProviderExec({ runner: "codex", providerAccess: "cli-session", checkoutDir: checkout, assetsDir: assets, outputDir: output,
          profile: low ? "prediction-sol-low-canary" : "prediction-cli", image: p.runtimeAcceptance.image, methodologyEgress: egress.launchCapability,
          ...(mechanical ? { mechanicalEvidenceDirectory: join(directory, "mechanical-client") } : {}), ...(structural ? { run: structural.run } : {}) });
        const hostArgs = args.map(value => value === "/workspace" ? checkout : value === "/opt/peregrine/methodology-review.schema.json" ? join(assets, "methodology-review.schema.json") : value === "/output/result.json" ? join(output, "result.json") : value);
        try { execution = await guard.run(run, "codex", hostArgs, { stdin: prompt, inheritEnv: false, env: {} }); write(join(directory, "execution.json"), execution); }
        catch (error) { failure = predictionFailureEvidence(error); write(join(directory, "execution-failure.json"), failure); }
        try { rawOutput = createContainedOutputReader(output, policy.maximumOutputBytes)(join(output, "result.json")); }
        catch (error) { failure ??= predictionFailureEvidence(error); write(join(directory, "output-failure.json"), predictionFailureEvidence(error)); }
        const deadline = await guard.finish(), parsed = parseCodexEvents(execution?.stdout ?? "");
        const disallowed = parsed.events.filter((event: any) => {
          const item = event?.item;
          return item && (["command_execution", "file_change", "web_search", "collab_tool_call"].includes(item.type) || item.type === "mcp_tool_call" && (item.server !== "source_read" || !policy.repositoryTools.includes(item.tool)));
        });
        const completeEventStream = execution?.code === 0 && !execution.timedOut && parsed.malformedEventLines === 0;
        const cleanupProven = deadline.teardownCompleted && deadline.evidenceError === null;
        const terminal: PredictionCliTerminal = { attemptId: s.attemptId, status: !failure && execution?.code === 0 && !deadline.deadlineExceeded && cleanupProven && !disallowed.length ? "completed" : rawOutput ? "partial" : "failed",
          events: parsed.events, completeEventStream, rawOutput, cleanupProven, deadlineExceeded: deadline.deadlineExceeded };
        const record = freeze({ kind: "prediction-cli-bridge-terminal-v1", bindings, scope: s, terminal, deadline, failure, tokens: observePredictionCliTokens(parsed.events, completeEventStream),
          disallowed, builtInCatalog: null, builtInCatalogVerified: false, executionReady: false, providerCalls: structural ? 0 : execution ? 1 : null,
          qualification: structural ? "Injected executor only; no provider, client support or containment proof." : "Observed attempt only; catalog, canary and independent review gates remain separate." });
        write(join(directory, "terminal.json"), record);
        if (low) {
          canaryLedger = freeze({ ...low.separateLedger, status: terminal.status, providerCalls: record.providerCalls, terminalSha256: digest(record), terminal, batchAuthorized: false });
          write(join(options.directory, "canary-ledger-terminal.json"), { bindings, ledger: canaryLedger });
        }
        if (s.purpose === "review") terminals.push(terminal);
        if (!cleanupProven || disallowed.length || s.purpose === "canary" && (terminal.status !== "completed" || record.tokens.status === "unknown")) blocked = true;
        return record;
      } catch (error) {
        blocked = true;
        let deadline = null, cleanupError: unknown;
        try { deadline = await guard?.finish() ?? null; } catch (cleanup) { cleanupError = cleanup; }
        if (s.purpose === "review" && !terminals.some(t => t.attemptId === s.attemptId)) terminals.push({ attemptId: s.attemptId, status: "failed", events: [], completeEventStream: false, rawOutput,
          cleanupProven: false, deadlineExceeded: deadline?.deadlineExceeded ?? false });
        const failed = { scope: s, failure: predictionFailureEvidence(error), cleanupFailure: cleanupError === undefined ? null : predictionFailureEvidence(cleanupError), deadline, executionReady: false };
        write(join(directory, "failure.json"), failed);
        if (low) {
          canaryLedger = freeze({ ...low.separateLedger, status: "failed", providerCalls: structural ? 0 : execution ? 1 : null, failure: failed, batchAuthorized: false });
          write(join(options.directory, "canary-ledger-failure.json"), { bindings, ledger: canaryLedger });
        }
        if (cleanupError !== undefined) throw new AggregateError([error, cleanupError], "prediction bridge operation and cleanup failed");
        throw error;
      } finally { active = false; }
    },
  };
}
