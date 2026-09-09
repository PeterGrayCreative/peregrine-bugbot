import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ACCEPTED_EVAL_RUNTIME_IMAGE,
  createMethodologyProviderAttacher,
  createStructuralMockMethodologyProviderAttacher,
  assertMethodologyProviderAttachment,
  type MethodologyProviderAttachmentRequest,
} from "../eval/methodology-provider-attachment.js";

const READ_LIMITS = { maxIndexEntries: 20, maxFileBytes: 10_000, maxOutputBytes: 20_000,
  maxSearchMatches: 10, excludedNamespaces: ["private"] } as const;
const MCP_LIMITS = { maxRequestBytes: 4096, maxResponseBytes: 8192, requestTimeoutMs: 3000,
  maxConnections: 4, maxRequests: 100 } as const;
const TREE = "a".repeat(40);
process.env.OPENAI_API_KEY ??= "synthetic-test-key";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "methodology-provider-attachment-"));
  const paths = { repo: join(root, "repo"), home: join(root, "home"), assets: join(root, "assets"), output: join(root, "output") };
  for (const path of Object.values(paths)) mkdirSync(path);
  chmodSync(paths.output, 0o700);
  mkdirSync(join(paths.output, "methodology-test"));
  mkdirSync(join(paths.assets, "schemas"));
  writeFileSync(join(paths.assets, "schemas", "methodology-review.schema.json"), "{}\n");
  writeFileSync(join(paths.repo, "source.ts"), "export const visible = true;\n");
  return { root, paths };
}
function req(paths: ReturnType<typeof fixture>["paths"], armId: "A" | "B" | "C" | "D" = "A"): MethodologyProviderAttachmentRequest {
  return { attemptId: "attempt-000001", armId, sourceHeadTree: TREE, paths };
}
function fakeDocker(calls: string[][]) {
  return async (command: string, args: string[]) => {
    calls.push([command, ...args]);
    if (args[0] === "rm") return { stdout: "", stderr: "", code: 0, timedOut: false };
    if (args[0] === "ps") return { stdout: "", stderr: "", code: 0, timedOut: false };
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  };
}
function call(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    // host.docker.internal is intentionally a container-only URL; use the
    // listener address while preserving the exact authorized Host authority.
    const req = request({ hostname: "127.0.0.1", port: parsed.port, path: parsed.pathname,
      method: "POST", headers: { Host: parsed.host, Accept: "application/json, text/event-stream",
        "Content-Type": "application/json", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString("utf8"),
        headers: res.headers }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("attachment canonicalizes exact roots, uses methodology profile, and exposes source through MCP", async () => {
  const { root, paths } = fixture();
  const calls: string[][] = [];
  const requestValue = req(paths);
  const attacher = createStructuralMockMethodologyProviderAttacher({ providerAccess: "api-key", readToolLimits: READ_LIMITS,
    mcpLimits: MCP_LIMITS, outputByteLimit: 1024, run: fakeDocker(calls) });
  const attachment = await attacher(requestValue);
  try {
    assert.equal(attachment.attestation.image, ACCEPTED_EVAL_RUNTIME_IMAGE);
    assert.equal(attachment.attestation.runner, "codex");
    assert.equal(attachment.attestation.profile, "methodology-review");
    assert.equal(attachment.neutralReadMcp.protocol, "neutral-read-mcp-v2");
    assert.equal(attachment.neutralReadMcp.attachment.attemptId, requestValue.attemptId);
    assert.equal(attachment.neutralReadMcp.attachment.sourceHeadTree, requestValue.sourceHeadTree);
    assert.equal(attachment.neutralReadMcp.attachment.executionClass, "structural-mock");
    assert.equal(attachment.neutralReadMcp.attachment.outputByteLimit, 1024);
    assert.equal(attachment.neutralReadMcp.attachment.attestationSha256.length, 64);
    assert.deepEqual(attachment.attestation.effectiveRoots, Object.fromEntries(
      Object.entries(paths).map(([key, value]) => [key, requireCanonical(value)]),
    ));
    assert.match(attachment.neutralReadMcp.url, /^http:\/\/host\.docker\.internal:\d+\/mcp\/[a-f0-9]{64}$/);
    assert.equal((await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "spoof", version: "1" } } },
    { Host: "host.docker.internal:1" })).status, 403);
    const initialized = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    assert.equal(initialized.status, 200);
    assert.ok(JSON.parse(initialized.text).result);
    const headers = { "Mcp-Session-Id": String(initialized.headers["mcp-session-id"]),
      "MCP-Protocol-Version": "2025-06-18" };
    assert.match(headers["Mcp-Session-Id"], /^[a-f0-9]{64}$/);
    assert.equal((await call(attachment.neutralReadMcp.url,
      { jsonrpc: "2.0", method: "notifications/initialized" }, headers)).status, 202);
    const read = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "read_file", arguments: { path: "source.ts" } } }, headers);
    assert.equal(JSON.parse(JSON.parse(read.text).result.content[0].text).text,
      "export const visible = true;\n");
    await attachment.runProvider("codex", ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
      "--config", "project_doc_max_bytes=0", "--config", "project_doc_fallback_filenames=[]", "--config",
      'projects."/workspace".trust_level="untrusted"', "--disable", "shell_tool", "--disable", "unified_exec",
      "--config", `mcp_servers.source_read.url=${JSON.stringify(attachment.neutralReadMcp.url)}`,
      "--config", 'mcp_servers.source_read.enabled_tools=["list_tree","read_file","search_text"]',
      "--config", "mcp_servers.source_read.required=true",
      "--strict-config", "--sandbox", "read-only", "--model", "gpt-5.6-sol", "--config",
      'model_reasoning_effort="high"', "--cd", paths.repo, "--output-schema", join(paths.assets, "schemas", "methodology-review.schema.json"),
      "--output-last-message", join(paths.output, "methodology-test", "stage-1.json"), "--json", "--color", "never", "-"], { inheritEnv: false });
    const run = calls.find((entry) => entry[0] === "docker" && entry[1] === "run");
    assert.ok(run);
    assert.ok(run.includes("--network") && run.includes("bridge"));
    assert.ok(run.includes(`type=bind,source=${requireCanonical(paths.repo)},target=/workspace,readonly`));
    assert.ok(run.includes(`type=bind,source=${requireCanonical(paths.assets)},target=/opt/peregrine,readonly`));
    assert.ok(run.includes(`type=bind,source=${requireCanonical(paths.output)},target=/output`));
    assert.ok(run.includes("--add-host") && run.includes("host.docker.internal:host-gateway"));
  } finally {
    await attachment.close();
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("A/B allow one session while C/D allow two, and Host/Origin remain strict", async () => {
  for (const armId of ["A", "C"] as const) {
    const { root, paths } = fixture();
    const attachment = await createMethodologyProviderAttacher({ providerAccess: "api-key", readToolLimits: READ_LIMITS,
      mcpLimits: MCP_LIMITS, outputByteLimit: 1024 })(req(paths, armId));
    try {
      const first = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "one", version: "1" } } });
      assert.equal(first.status, 200);
      const second = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 2, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "two", version: "1" } } });
      assert.equal(second.status, armId === "C" ? 200 : 409);
      const wrongOrigin = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 3, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } }, { Origin: "https://attacker.invalid" });
      assert.equal(wrongOrigin.status, 403);
    } finally {
      await attachment.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("branding rejects cross-request substitution, forged shape, and mutable request drift", async () => {
  const first = fixture();
  const second = fixture();
  const original = req(first.paths);
  const attachment = await createMethodologyProviderAttacher({ providerAccess: "api-key", readToolLimits: READ_LIMITS,
    mcpLimits: MCP_LIMITS, outputByteLimit: 1024 })(original);
  const attestation = attachment.attestation;
  try {
    assertMethodologyProviderAttachment(attachment, original, attestation);
    assert.throws(() => assertMethodologyProviderAttachment({ ...attachment }, req(first.paths), attestation), /not trusted/);
    assert.throws(() => assertMethodologyProviderAttachment(attachment, req(second.paths), attestation), /mismatch/);
    const bound = await createMethodologyProviderAttacher({ providerAccess: "api-key", readToolLimits: READ_LIMITS,
      mcpLimits: MCP_LIMITS, outputByteLimit: 1024 })(original);
    original.sourceHeadTree = "b".repeat(40);
    assert.throws(() => assertMethodologyProviderAttachment(bound, original, bound.attestation), /mismatch/);
    await bound.close();
  } finally {
    await attachment.close();
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});

function requireCanonical(path: string): string {
  // macOS temp directories may be exposed through /var while realpath uses
  // /private/var; this keeps the assertion about canonicalization explicit.
  return realpathSync(path);
}

test("cross-root and substitution paths are rejected before an MCP listener is created", async () => {
  const { root, paths } = fixture();
  try {
    const factory = createMethodologyProviderAttacher({ providerAccess: "api-key", readToolLimits: READ_LIMITS,
      mcpLimits: MCP_LIMITS, outputByteLimit: 1024 });
    await assert.rejects(() => factory(req({ ...paths, output: paths.repo })), /roots must be distinct/);
    await assert.rejects(() => factory(req({ ...paths, assets: join(paths.repo, "missing") })), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("production attachments cannot inject a mock executor", () => {
  assert.throws(() => createMethodologyProviderAttacher({ providerAccess: "api-key", readToolLimits: READ_LIMITS,
    mcpLimits: MCP_LIMITS, outputByteLimit: 1024, run: fakeDocker([]) } as never),
  /cannot inject/);
});
