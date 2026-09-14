import { array, digest, exact, freeze, hash, integer, oneOf, same, sha, unique } from "./prediction-contract.js";
import { validateMethodologyDeadlinePhases } from "./methodology-observation.js";
import { mechanicalEvidenceBinding, type MechanicalEvidenceBinding } from "./prediction-mechanical-evidence.js";
import { privateFailureBinding } from "./prediction-typed-evidence.js";

interface Artifact { path: string; bytes: string }
/** This validates retained metadata, NOT omitted raw topology or tool content.
 * A successful result never substitutes for independent live observations. */
export function assessPrivatePredictionReceipts(input: { artifacts: Artifact[]; inventory: { path: string; bytes: number; sha256: string }[];
  inventorySha256: string; binding: MechanicalEvidenceBinding; policySha256: string; deadline: unknown }) {
  let failure: ReturnType<typeof privateFailureBinding> | null = null;
  try {
    const binding = mechanicalEvidenceBinding(input.binding), policy = hash(input.policySha256);
    same(digest(input.inventory), hash(input.inventorySha256), "trusted receipt inventory drift");
    const artifacts = array(input.artifacts) as Artifact[], inventory = array(input.inventory) as typeof input.inventory;
    if (!artifacts.length || artifacts.length > 1000 || artifacts.length % 2) throw new Error("complete bounded receipt pairs required");
    unique(artifacts.map(a => a.path)); unique(inventory.map(a => a.path));
    same(artifacts.map(a => a.path).sort(), inventory.map(a => a.path).sort(), "actual receipt bytes required");
    const records = new Map<string, any>(); let total = 0;
    for (const a of artifacts) {
      exact(a, ["path", "bytes"], "private artifact");
      if (!/^mechanical\/[0-9]{6}-(start|terminal)\.json$/.test(a.path) || typeof a.bytes !== "string") throw new Error("failed, unknown or raw receipt profile");
      const bytes = Buffer.byteLength(a.bytes); total += bytes;
      if (!bytes || bytes > 32768 || total > 8000000) throw new Error("private receipt bound exceeded");
      same(inventory.find(i => i.path === a.path), { path: a.path, bytes, sha256: sha(a.bytes) }, "receipt substituted or truncated");
      records.set(a.path, JSON.parse(a.bytes));
    }
    const byteBinding = (value: unknown) => { const b = exact(value, ["bytes", "sha256"], "one-way byte binding"); integer(b.bytes); hash(b.sha256); };
    const phases = { preparation: [] as any[], execution: [] as any[], teardown: [] as any[] };
    for (let sequence = 1; sequence <= artifacts.length / 2; sequence++) {
      const prefix = `mechanical/${String(sequence).padStart(6, "0")}`, start = records.get(prefix + "-start.json"), terminal = records.get(prefix + "-terminal.json");
      exact(start, ["kind", "clock", "binding", "policySha256", "sequence", "phase", "invocation", "deadlineAttached", "aborted", "timeoutMs", "cleanup"], "private mechanical start");
      exact(terminal, ["kind", "clock", "binding", "policySha256", "sequence", "result", "validation", "persistenceFailed"], "private mechanical terminal");
      same([start.kind, terminal.kind, start.binding, terminal.binding, start.policySha256, terminal.policySha256, start.sequence, terminal.sequence, start.aborted, terminal.validation, terminal.persistenceFailed],
        ["prediction-private-mechanical-start-v1", "prediction-private-mechanical-terminal-v1", binding, binding, policy, policy, sequence, sequence, false, "live-result-shape-validated", false], "receipt binding/completion/persistence mismatch");
      const phase = oneOf(start.phase, ["preparation", "execution", "teardown"]);
      if (typeof start.cleanup !== "boolean" || typeof start.deadlineAttached !== "boolean" || !Number.isFinite(start.timeoutMs) || start.timeoutMs <= 0 || start.timeoutMs > 1200000) throw new Error("receipt deadline metadata unavailable");
      if (phase === "preparation") same([start.cleanup, start.deadlineAttached], [false, true], "preparation cancellation gap");
      if (phase === "teardown") same([start.cleanup, start.deadlineAttached], [true, false], "cleanup must be uncancelled");
      if (phase === "execution") same(start.deadlineAttached, !start.cleanup, "client cleanup cancellation gap");
      const invocation = exact(start.invocation, ["command", "argumentCount", "argv", "environment"], "metadata-only command");
      same(invocation.command, "docker", "unregistered mechanical executable");
      if (!integer(invocation.argumentCount) || Number(invocation.argumentCount) > 1000) throw new Error("command argument count invalid");
      byteBinding(invocation.argv); byteBinding(invocation.environment);
      const result = exact(terminal.result, ["kind", "code", "timedOut", "processId", "cleanupFailed", "outputLimitExceeded", "stdout", "stderr", "cleanup"], "metadata-only result");
      same([result.kind, result.code, result.timedOut, result.cleanupFailed, result.outputLimitExceeded], ["prediction-private-result-v1", 0, false, false, false], "mechanical operation failed");
      if (result.processId !== null && (!integer(result.processId) || Number(result.processId) > 2147483647)) throw new Error("invalid process identity");
      byteBinding(result.stdout); byteBinding(result.stderr); byteBinding(result.cleanup);
      phases[phase].push({ start: { startedAt: start.clock?.unixMs, clock: start.clock }, terminal: { closedAt: terminal.clock?.unixMs, clock: terminal.clock } });
    }
    validateMethodologyDeadlinePhases(input.deadline, phases);
  } catch (error) { failure = privateFailureBinding(error); }
  return freeze({ kind: "prediction-private-receipt-assessment-v1", metadataIntegrity: failure ? "FAIL" : "PASS", failure,
    inventorySha256: typeof input.inventorySha256 === "string" && /^[a-f0-9]{64}$/.test(input.inventorySha256) ? input.inventorySha256 : null,
    eligibility: "not-eligible", externalObserverEvidence: null, rawSemanticEvidenceReconstructable: false,
    boundary: "Metadata integrity only. Raw producer streams are deliberately absent; independent live semantic validation, new image acceptance and fresh user authorization remain required. No canary outcome, batch eligibility or dispatch authority follows.",
    providerAuthorized: false, executionReady: false, batchAuthorized: false });
}
