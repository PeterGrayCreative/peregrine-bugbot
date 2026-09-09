import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createStructuralMockMethodologyProviderAttacher,
  assertMethodologyProviderScopeRecord,
  assertMethodologyProviderScopeFinalizer,
  type MethodologyProviderAttachment,
  type MethodologyProviderAttachmentRequest,
  type MethodologyProviderNeutralReadMcp,
} from "../eval/methodology-provider-attachment.js";
import { METHODOLOGY_EGRESS_RUNTIME_IMAGE } from "../eval/runtime-containment.js";
import {
  buildMethodologyScopeRecordV2,
  validateMethodologyScopeRecordV2,
  validateMethodologyScopeRecordV1,
  type MethodologyNeutralReadPolicyV3,
  type MethodologySidecarAuditDiagnostic,
  type MethodologyScopeRecordV2Input,
  type MethodologyScopeRecord,
} from "../eval/methodology-scope-record.js";

const READ_LIMITS = {
  maxIndexEntries: 20,
  maxFileBytes: 10_000,
  maxOutputBytes: 20_000,
  maxSearchMatches: 10,
  excludedNamespaces: ["private"],
} as const;
const MCP_LIMITS = {
  maxRequestBytes: 4096,
  maxResponseBytes: 8192,
  requestTimeoutMs: 3000,
  maxConnections: 4,
  maxRequests: 100,
} as const;
const TREE = "a".repeat(40);
const REGISTERED_SCOPE = "b".repeat(64);
const MODEL_LIMITATIONS = [] as const;
process.env.OPENAI_API_KEY ??= "synthetic-test-key";

type Paths = { repo: string; home: string; assets: string; output: string };
type Reply = { status: number; text: string; headers: Record<string, string | string[] | undefined> };

function fixture(): { root: string; paths: Paths } {
  const root = mkdtempSync(join(tmpdir(), "methodology-scope-record-"));
  const paths = {
    repo: join(root, "repo"),
    home: join(root, "home"),
    assets: join(root, "assets"),
    output: join(root, "output"),
  };
  for (const path of Object.values(paths)) {
    mkdirSync(path);
  }
  writeFileSync(join(paths.repo, "source.ts"), "export const scopeSecret = 'scope-source-content';\n");
  return { root, paths };
}

function requestValue(paths: Paths, armId: "A" | "B" | "C" | "D" = "A"): MethodologyProviderAttachmentRequest {
  return { attemptId: "attempt-000001", armId, sourceHeadTree: TREE, paths };
}

function fakeDocker() {
  return async (_command: string, _args: string[]) => ({ stdout: "", stderr: "", code: 0, timedOut: false });
}

function rpc(method: string, params?: unknown, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

function call(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    // The attachment intentionally gives the provider a container-only host;
    // tests reach the local listener while retaining its exact Host authority.
    const client = request({
      hostname: "127.0.0.1",
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: {
        Host: parsed.host,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode!,
        text: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
      }));
      response.on("error", reject);
    });
    client.on("error", reject);
    client.end(JSON.stringify(body));
  });
}

async function ready(attachment: MethodologyProviderAttachment): Promise<Record<string, string>> {
  const initialized = await call(attachment.neutralReadMcp.url, rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "scope-record-test", version: "1" },
  }));
  assert.equal(initialized.status, 200);
  const headers = {
    "Mcp-Session-Id": String(initialized.headers["mcp-session-id"]),
    "MCP-Protocol-Version": "2025-06-18",
  };
  const notification = await call(attachment.neutralReadMcp.url, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }, headers);
  assert.equal(notification.status, 202);
  return headers;
}

function finalizerInput() {
  return {
    registeredReviewScopeSha256: REGISTERED_SCOPE,
    modelLimitations: MODEL_LIMITATIONS,
    findingCount: 0,
  } as const;
}

function expectedFor(
  attachment: MethodologyProviderAttachment,
  policy: MethodologyProviderNeutralReadMcp = attachment.neutralReadMcp,
) {
  return {
    attemptId: "attempt-000001",
    armId: "A" as const,
    registeredReviewScopeSha256: REGISTERED_SCOPE,
    toolPolicy: policy,
    modelLimitations: MODEL_LIMITATIONS,
    findingCount: 0,
  };
}

function v3Policy(providerAuthoritiesSha256 = "9".repeat(64)): MethodologyNeutralReadPolicyV3 {
  const attachment = {
    schemaVersion: 2 as const,
    protocol: "methodology-provider-attachment-reference-v2" as const,
    attemptId: "attempt-000001",
    armId: "A" as const,
    sourceHeadTree: TREE,
    effectiveRootsSha256: "c".repeat(64),
    image: METHODOLOGY_EGRESS_RUNTIME_IMAGE,
    runner: "codex" as const,
    providerAccess: "api-key" as const,
    profile: "methodology-review" as const,
    executionClass: "provider" as const,
    outputByteLimit: 1024,
    readLimitsSha256: "e".repeat(64),
    mcpLimitsSha256: "f".repeat(64),
    attestationSha256: "1".repeat(64),
    egressProtocol: "methodology-egress-supervisor-v1" as const,
    egressAttestationSha256: "2".repeat(64),
    egressNetwork: "peregrine-egress-attempt-000001",
    proxyUrl: "http://egress-gateway:8081",
    internalMcpUrl: "http://mcp-forwarder:8082/mcp/" + "0".repeat(64),
    providerAuthoritiesSha256,
  };
  return {
    protocol: "neutral-read-mcp-v3",
    url: attachment.internalMcpUrl,
    serverName: "source_read",
    enabledTools: ["list_tree", "read_file", "search_text"],
    attachment,
  };
}

async function structuralAttachment(): Promise<{ root: string; attachment: MethodologyProviderAttachment }> {
  const { root, paths } = fixture();
  const attacher = createStructuralMockMethodologyProviderAttacher({
    providerAccess: "api-key",
    readToolLimits: READ_LIMITS,
    mcpLimits: MCP_LIMITS,
    outputByteLimit: 1024,
    run: fakeDocker(),
  });
  return { root, attachment: await attacher(requestValue(paths)) };
}

test("a branded attachment finalizer produces the v1 historical methodology scope record", async () => {
  const { root, attachment } = await structuralAttachment();
  try {
    assertMethodologyProviderScopeFinalizer(attachment.finalizeScope);
    const record = attachment.finalizeScope(finalizerInput());
    assert.equal(record.protocol, "historical-methodology-scope-record-v1");
    assert.equal(record.schemaVersion, 1);
    assert.match(record.recordSha256, /^[a-f0-9]{64}$/);
    assert.equal(record.result.verdict, "unverified");
    assert.ok(record.result.reasons.includes("missing-runner-availability:tool.credential-bearing-canary"));
    assert.throws(() => assertMethodologyProviderScopeFinalizer(() => record), /not trusted/);
  } finally {
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("structural-mock and provider execution classes cannot produce complete scope without a canary", async () => {
  const cases = [
    ["structural-mock", async () => structuralAttachment()],
  ] as const;
  for (const [executionClass, make] of cases) {
    const { root, attachment } = await make();
    try {
      assert.equal(attachment.neutralReadMcp.attachment.executionClass, executionClass);
      const record = attachment.finalizeScope(finalizerInput());
      assert.notEqual(record.result.verdict, "complete");
      assert.ok(record.result.reasons.some((reason) => reason.includes("credential-bearing-canary")));
    } finally {
      await attachment.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("scope finalizer is single-use and rejects after attachment cleanup", async () => {
  const first = await structuralAttachment();
  try {
    first.attachment.finalizeScope(finalizerInput());
    assert.throws(() => first.attachment.finalizeScope(finalizerInput()), /only be finalized once/);
  } finally {
    await first.attachment.close();
    rmSync(first.root, { recursive: true, force: true });
  }

  const second = await structuralAttachment();
  try {
    await second.attachment.close();
    assert.throws(() => second.attachment.finalizeScope(finalizerInput()), /after attachment cleanup/);
  } finally {
    await second.attachment.close();
    rmSync(second.root, { recursive: true, force: true });
  }

  const retryable = await structuralAttachment();
  try {
    assert.throws(() => retryable.attachment.finalizeScope({
      ...finalizerInput(),
      registeredReviewScopeSha256: "invalid",
    }), /input identity is invalid/);
    const record = retryable.attachment.finalizeScope(finalizerInput());
    assert.equal(record.result.verdict, "unverified");
    assert.throws(() => retryable.attachment.finalizeScope(finalizerInput()), /only be finalized once/);
  } finally {
    await retryable.attachment.close();
    rmSync(retryable.root, { recursive: true, force: true });
  }
});

test("a scope record is bound to the exact trusted finalizer that produced it", async () => {
  const first = await structuralAttachment();
  const second = await structuralAttachment();
  try {
    const record = first.attachment.finalizeScope(finalizerInput());
    assertMethodologyProviderScopeRecord(record, first.attachment.finalizeScope);
    assert.throws(
      () => assertMethodologyProviderScopeRecord(record, second.attachment.finalizeScope),
      /not bound to this trusted finalizer/,
    );
    assert.throws(
      () => assertMethodologyProviderScopeRecord(structuredClone(record), first.attachment.finalizeScope),
      /not bound to this trusted finalizer/,
    );
  } finally {
    await first.attachment.close();
    await second.attachment.close();
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});

test("observed incomplete and denied MCP calls make the finalized scope incomplete", async () => {
  const { root, attachment } = await structuralAttachment();
  try {
    const headers = await ready(attachment);
    const incomplete = await call(attachment.neutralReadMcp.url, rpc("tools/call", {
      name: "read_file",
      arguments: { path: "missing-sensitive-source.ts" },
    }), headers);
    assert.equal(incomplete.status, 200);
    const denied = await call(attachment.neutralReadMcp.url, rpc("tools/call", {
      name: "private-super-secret-tool",
      arguments: {},
    }), headers);
    assert.equal(denied.status, 200);

    const record = attachment.finalizeScope(finalizerInput());
    assert.equal(record.result.verdict, "incomplete");
    assert.ok(record.result.reasons.includes("runner-unavailable:tool.neutral-read-attachment"));
    assert.equal(record.audit.tools.incomplete, 1);
    assert.equal(record.audit.tools.denied, 1);
    assert.ok(record.audit.denialCodes.some((entry) => entry.code === "invalid-tool-call"));
  } finally {
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("record validation rejects changed audit, result, tool policy, and scope digests", async () => {
  const { root, attachment } = await structuralAttachment();
  try {
    const record = attachment.finalizeScope(finalizerInput());
    const expected = expectedFor(attachment);
    assert.deepEqual(validateMethodologyScopeRecordV1(record, expected), record);

    const changedAudit = structuredClone(record) as unknown as { audit: { snapshotSha256: string } };
    changedAudit.audit.snapshotSha256 = "c".repeat(64);
    assert.throws(() => validateMethodologyScopeRecordV1(changedAudit, expected), /audit.*digest mismatch/);

    const changedResult = structuredClone(record) as unknown as { result: { verdict: string } };
    changedResult.result.verdict = "complete";
    assert.throws(() => validateMethodologyScopeRecordV1(changedResult, expected), /differs from authenticated runner evidence/);

    const changedPolicy = structuredClone(attachment.neutralReadMcp) as unknown as { url: string };
    changedPolicy.url = "http://host.docker.internal:65535/mcp/changed";
    assert.throws(() => validateMethodologyScopeRecordV1(record, expectedFor(attachment, changedPolicy as MethodologyProviderNeutralReadMcp)),
      /differs from authenticated runner evidence/);

    const changedScope = structuredClone(record) as unknown as { result: { evidence: { registeredScopeSha256: string } } };
    changedScope.result.evidence.registeredScopeSha256 = "d".repeat(64);
    assert.throws(() => validateMethodologyScopeRecordV1(changedScope, expected), /differs from authenticated runner evidence/);
  } finally {
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("persisted audit contains digests and allowlisted status only, never raw query, path, or source", async () => {
  const { root, attachment } = await structuralAttachment();
  try {
    const headers = await ready(attachment);
    await call(attachment.neutralReadMcp.url, rpc("tools/call", {
      name: "read_file",
      arguments: { path: "source.ts" },
    }), headers);
    await call(attachment.neutralReadMcp.url, rpc("tools/call", {
      name: "search_text",
      arguments: { query: "scopeSecret" },
    }), headers);
    const record = attachment.finalizeScope(finalizerInput());
    const persistedAudit = JSON.stringify(record.audit);
    for (const forbidden of [
      root,
      "source.ts",
      "scopeSecret",
      "scope-source-content",
      "private-super-secret-tool",
      "missing-sensitive-source.ts",
    ]) {
      assert.ok(!persistedAudit.includes(forbidden), `persisted audit leaked ${forbidden}`);
    }
    assert.ok(record.audit.toolCalls.every((call) => /^[a-f0-9]{64}$/.test(call.resultSha256)));
  } finally {
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("v2 binds a v3 egress policy and sealed diagnostics while remaining unverified without a canary", async () => {
  const { root, attachment } = await structuralAttachment();
  try {
    const v2Input: MethodologyScopeRecordV2Input = {
      attemptId: "attempt-000001",
      armId: "A",
      registeredReviewScopeSha256: REGISTERED_SCOPE,
      toolPolicy: v3Policy("a".repeat(64)),
      audit: attachment.finalizeScope(finalizerInput()).audit,
      sidecarDiagnostics: [
        { sidecar: "gateway", ready: true, sealed: true, selfDigestValid: true, lineObserved: true },
        { sidecar: "forwarder", ready: true, sealed: true, selfDigestValid: true, lineObserved: true },
      ],
      modelLimitations: MODEL_LIMITATIONS,
      findingCount: 0,
    };
    const record = buildMethodologyScopeRecordV2(v2Input);
    assert.equal(record.schemaVersion, 2);
    assert.equal(record.protocol, "historical-methodology-scope-record-v2");
    assert.equal(record.result.verdict, "unverified");
    assert.ok(record.result.reasons.includes("missing-runner-availability:tool.credential-bearing-canary"));
    assert.equal(record.toolPolicyBinding.egressAttestationSha256, "2".repeat(64));
    assert.equal(record.toolPolicyBinding.providerAuthoritiesSha256, "a".repeat(64));
    assert.equal(record.toolPolicyBinding.internalMcpUrl, v2Input.toolPolicy.url);
    // A pure builder result is not trusted terminal evidence by itself.
    assert.throws(() => assertMethodologyProviderScopeRecord(record, attachment.finalizeScope), /not bound/);
    assert.deepEqual(validateMethodologyScopeRecordV2(record, {
      attemptId: v2Input.attemptId,
      armId: v2Input.armId,
      registeredReviewScopeSha256: v2Input.registeredReviewScopeSha256,
      toolPolicy: v2Input.toolPolicy,
      modelLimitations: v2Input.modelLimitations,
      findingCount: v2Input.findingCount,
    }), record);
  } finally {
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("v2 validation rejects policy, binding, and cross-policy mutations", async () => {
  const { root, attachment } = await structuralAttachment();
  try {
    const policy = v3Policy();
    const input = {
      attemptId: "attempt-000001",
      armId: "A" as const,
      registeredReviewScopeSha256: REGISTERED_SCOPE,
      toolPolicy: policy,
      audit: attachment.finalizeScope(finalizerInput()).audit,
      sidecarDiagnostics: [
        { sidecar: "gateway" as const, ready: true, sealed: true, selfDigestValid: true, lineObserved: true },
        { sidecar: "forwarder" as const, ready: true, sealed: true, selfDigestValid: true, lineObserved: true },
      ],
      modelLimitations: MODEL_LIMITATIONS,
      findingCount: 0,
    };
    const record = buildMethodologyScopeRecordV2(input);
    const expected = {
      attemptId: input.attemptId,
      armId: input.armId,
      registeredReviewScopeSha256: input.registeredReviewScopeSha256,
      toolPolicy: input.toolPolicy,
      modelLimitations: input.modelLimitations,
      findingCount: input.findingCount,
    };
    const changedPolicy = structuredClone(record) as unknown as { toolPolicy: { url: string } };
    changedPolicy.toolPolicy.url = "http://mcp-forwarder:8082/mcp/" + "1".repeat(64);
    assert.throws(() => validateMethodologyScopeRecordV2(changedPolicy, expected), /differs|trusted v3/);
    const changedImage = structuredClone(record) as unknown as { toolPolicy: { attachment: { image: string } } };
    changedImage.toolPolicy.attachment.image = "ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:" + "d".repeat(64);
    assert.throws(() => validateMethodologyScopeRecordV2(changedImage, expected), /differs|trusted v3/);
    const changedBinding = structuredClone(record) as unknown as { toolPolicyBinding: { egressNetwork: string } };
    changedBinding.toolPolicyBinding.egressNetwork = "other-network";
    assert.throws(() => validateMethodologyScopeRecordV2(changedBinding, expected), /differs/);
    const crossPolicy = { ...expected, toolPolicy: v3Policy("b".repeat(64)) };
    assert.throws(() => validateMethodologyScopeRecordV2(record, crossPolicy), /differs/);

    const badOutputLimit = structuredClone(input);
    badOutputLimit.toolPolicy.attachment.outputByteLimit = "bad" as never;
    assert.throws(() => buildMethodologyScopeRecordV2(badOutputLimit), /trusted v3/);

    const reservedNetwork = structuredClone(input);
    reservedNetwork.toolPolicy.attachment.egressNetwork = "bridge";
    assert.throws(() => buildMethodologyScopeRecordV2(reservedNetwork), /trusted v3/);

    const badLimitation = { ...input, modelLimitations: [{ kind: "made-up", detail: "invalid" }] as never };
    assert.throws(() => buildMethodologyScopeRecordV2(badLimitation), /observations/);
  } finally {
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("v2 rejects missing, duplicate, extra, reordered, and unproven sidecar diagnostics", async () => {
  const { root, attachment } = await structuralAttachment();
  try {
    const audit = attachment.finalizeScope(finalizerInput()).audit;
    const base = {
      attemptId: "attempt-000001" as const,
      armId: "A" as const,
      registeredReviewScopeSha256: REGISTERED_SCOPE,
      toolPolicy: v3Policy(),
      audit,
      modelLimitations: MODEL_LIMITATIONS,
      findingCount: 0,
    };
    const valid = [
      { sidecar: "gateway" as const, ready: true, sealed: true, selfDigestValid: true, lineObserved: true },
      { sidecar: "forwarder" as const, ready: true, sealed: true, selfDigestValid: true, lineObserved: true },
    ];
    for (const diagnostics of [
      valid.slice(0, 1),
      [valid[0], valid[0]],
      [...valid, { sidecar: "extra" as never, ready: true, sealed: true, selfDigestValid: true, lineObserved: true }],
      [valid[1], valid[0]],
      [{ ...valid[0], sealed: false }, valid[1]],
      [{ ...valid[0], extra: true }, valid[1]],
    ]) {
      assert.throws(() => buildMethodologyScopeRecordV2({
        ...base,
        sidecarDiagnostics: diagnostics as readonly MethodologySidecarAuditDiagnostic[],
      }), /sidecar/);
    }
  } finally {
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});
