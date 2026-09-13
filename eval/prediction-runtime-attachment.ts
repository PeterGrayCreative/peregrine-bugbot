import { join } from "node:path";
import { digest, freeze, same } from "./prediction-contract.js";
import { bindPredictionRegistration } from "./prediction-plan.js";
import { bindPredictionMounts, createPredictionCaseReader, PREDICTION_TOOL_POLICY } from "./prediction-mounts.js";
import { predictionMcpToolDefinitions, startPredictionReadMcpTransport, type ReviewReadMcpOptions } from "./methodology-read-mcp.js";
import type { createPredictionCliDeadline } from "./prediction-cli-deadline.js";

export interface PredictionRuntimeAuthority {
  registrationBytes: string; registrationSha256: string;
  manifestBytes: string; manifestSha256: string;
}
export const PREDICTION_MCP_LIMITS = freeze({ maxRequestBytes: 16_384, maxResponseBytes: 8_000_000,
  requestTimeoutMs: 30_000, maxConnections: 4, maxRequests: 110, maxSessions: 1 });
type Deadline = Pick<ReturnType<typeof createPredictionCliDeadline>, "read" | "signal">;

/** Caller creates the whole-attempt deadline before preparation and includes
 * close() in mandatory teardown. No provider runner or dispatch authority exists
 * here. Only the exact scheduled case can reach the neutral four-tool transport. */
export async function attachPredictionReadTools(authority: PredictionRuntimeAuthority, mountsRoot: string,
  attemptId: string, deadline: Deadline, routing: Pick<ReviewReadMcpOptions, "host" | "allowedHosts"> = {}) {
  const registration = deadline.read(() => bindPredictionRegistration(authority.registrationBytes, authority.registrationSha256));
  const mounts = deadline.read(() => bindPredictionMounts(authority.manifestBytes, authority.manifestSha256, registration));
  const scheduled = registration.schedule.find(attempt => attempt.id === attemptId);
  if (!scheduled) throw new Error("unregistered prediction attempt");
  const mount = mounts.find(mount => mount.caseId === scheduled.caseId)!;
  const reader = deadline.read(() => createPredictionCaseReader(join(mountsRoot, mount.reviewerId), mount));
  const definitions = predictionMcpToolDefinitions();
  same(definitions.map(tool => tool.name), PREDICTION_TOOL_POLICY.tools, "prediction MCP tool-policy mismatch");
  let starting: ReturnType<typeof startPredictionReadMcpTransport> | undefined, closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      reader.close();
      closing = Promise.resolve().then(async () => {
        const server = await starting?.catch(() => undefined);
        await server?.close();
        deadline.signal.removeEventListener("abort", aborted);
      });
    }
    return closing;
  };
  const aborted = () => { void close().catch(() => undefined); }; // close() retains its rejection for mandatory teardown.
  deadline.signal.addEventListener("abort", aborted, { once: true });
  try {
    deadline.read(() => undefined);
    starting = startPredictionReadMcpTransport((name, args) => {
      if (closing) throw new Error("prediction attachment closed");
      return deadline.read(() => reader.call(name, args));
    }, { ...routing, ...PREDICTION_MCP_LIMITS, allowedOrigins: [] });
    const server = await starting;
    deadline.read(() => undefined);
    const binding = freeze({ protocol: "prediction-read-attachment-v1", attemptId, inputDigest: mount.inputDigest,
      registrationSha256: authority.registrationSha256, mountManifestSha256: authority.manifestSha256,
      toolPolicySha256: digest(PREDICTION_TOOL_POLICY), toolDefinitionsSha256: digest(definitions), transportLimits: PREDICTION_MCP_LIMITS,
      providerAuthorized: false, providerCalls: 0, executionReady: false });
    return { url: server.url, binding, definitions,
      neutralReadMcp: freeze({ serverName: "source_read", enabledTools: PREDICTION_TOOL_POLICY.tools, url: server.url }),
      replaceAuthorizedHosts: server.replaceAuthorizedHosts, auditSnapshot: server.auditSnapshot, sealAudit: server.sealAudit,
      readerSnapshot: reader.snapshot, close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "prediction attachment setup and cleanup failed"); }
    throw error;
  }
}
