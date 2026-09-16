import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1 as b, assertPrivateStreamRun, assertPrivateStreamArtifact,
  assertPrivateStreamReport, assertPrivateStreamAttestation, verifyPrivateStreamImageEvidence } from "../eval/private-stream-image-acceptance.js";
import { sha } from "../eval/prediction-contract.js";

const run = () => ({ id: b.workflowRunId, run_attempt: 1, head_sha: b.sourceCommit, head_branch: "main", event: "workflow_dispatch",
  status: "completed", conclusion: "success", workflow_id: 359950056, path: b.workflow, html_url: b.workflowUrl,
  repository: { id: 1304213739, full_name: "PeterGrayCreative/peregrine-bugbot" } });
const byte = (value = "") => ({ bytes: Buffer.byteLength(value), sha256: sha(value) });
const report = (platform: "native" | "linux/amd64" | "linux/arm64") => ({ kind: "private-stream-runtime-probe-v1",
  image: platform === "native" ? "peregrine-eval-runtime:private-stream-v1-pr" : b.image, platform, status: "PASS", failure: null,
  sourceFreezeSha256: b.sourceFreezeSha256, rawMechanicalStreamsPersisted: false, clientForwarderTokenSupplied: false,
  fixedEndpoint: "http://mcp-forwarder:8082/mcp", providerCalls: 0, providerClientSessions: 0,
  credentialFreeVersionChecks: { codex: "0.152.0", claude: "2.1.252" }, runtimeReady: false, executionReady: false,
  providerAuthorized: false, qualification: "Synthetic policy fixture; not authentic publication evidence",
  receipts: [{ sequence: 1, invocation: { command: "docker", argumentCount: 1, argv: byte(), environment: byte() },
    startedAt: 1, closedAt: 2, status: 0, stdout: byte('{"schemaVersion":1,"protocol":"private-stream-containment-v1","status":"passed"}\n'), stderr: byte(), failure: null }] });
const artifact = (item = b.artifacts[0]!) => ({ ...item, expired: false, workflow_run: { id: b.workflowRunId,
  head_sha: b.sourceCommit, repository_id: 1304213739, head_repository_id: 1304213739, head_branch: "main" } });
const repository = "https://github.com/PeterGrayCreative/peregrine-bugbot";
const signer = `${repository}/${b.workflow}@refs/heads/main`;
const invocation = `${b.workflowUrl}/attempts/1`;
const attestation = () => ({ signature: { certificate: {
  subjectAlternativeName: signer, issuer: "https://token.actions.githubusercontent.com", githubWorkflowTrigger: "workflow_dispatch",
  githubWorkflowSHA: b.sourceCommit, githubWorkflowRepository: "PeterGrayCreative/peregrine-bugbot", githubWorkflowRef: "refs/heads/main",
  buildSignerURI: signer, buildSignerDigest: b.sourceCommit, runnerEnvironment: "github-hosted", sourceRepositoryURI: repository,
  sourceRepositoryDigest: b.sourceCommit, sourceRepositoryRef: "refs/heads/main", buildConfigURI: signer, buildConfigDigest: b.sourceCommit,
  buildTrigger: "workflow_dispatch", runInvocationURI: invocation,
} }, verifiedTimestamps: [{ type: "Tlog" }], statement: { _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1",
  subject: [{ name: b.image.split("@")[0], digest: { sha256: b.image.split("@sha256:")[1] } }], predicate: { buildDefinition: {
    buildType: "https://actions.github.io/buildtypes/workflow/v1", externalParameters: { workflow: { path: b.workflow, ref: "refs/heads/main", repository } },
    resolvedDependencies: [{ digest: { gitCommit: b.sourceCommit }, uri: `git+${repository}@refs/heads/main` }],
  }, runDetails: { builder: { id: signer }, metadata: { invocationId: invocation } } } } });

test("publication success requires exact source, workflow, run, attempt and repository", () => {
  assertPrivateStreamRun(run());
  for (const changes of [{ id: 35153807394 }, { run_attempt: 2 }, { head_sha: "a".repeat(40) }, { head_branch: "other" },
    { event: "pull_request" }, { conclusion: "failure" }, { path: ".github/workflows/eval-runtime-image.yml" },
    { repository: { id: 1, full_name: "attacker/peregrine-bugbot" } }]) assert.throws(() => assertPrivateStreamRun({ ...run(), ...changes }));
});

test("artifact IDs, hashes and workflow-source identity cannot be substituted", () => {
  for (const item of b.artifacts) {
    assertPrivateStreamArtifact(artifact(item), item.id);
    for (const changes of [{ id: item.id + 1 }, { digest: "sha256:" + "a".repeat(64) }, { name: "other" }, { expired: true },
      { workflow_run: { ...artifact(item).workflow_run, head_sha: "a".repeat(40) } },
      { workflow_run: { ...artifact(item).workflow_run, id: b.workflowRunId + 1 } }]) {
      assert.throws(() => assertPrivateStreamArtifact({ ...artifact(item), ...changes }, item.id));
    }
  }
  assert.throws(() => assertPrivateStreamArtifact(artifact(), 0));
});

test("native and published reports require exact digest, platform, contract and zero authority", () => {
  for (const platform of ["native", "linux/amd64", "linux/arm64"] as const) {
    const original = report(platform); assertPrivateStreamReport(original, platform);
    for (const changes of [{ image: b.image.replace(/.$/, "0") }, { platform: "linux/s390x" }, { sourceFreezeSha256: "a".repeat(64) },
      { status: "FAIL" }, { receipts: [] }, { failure: {} }, { rawMechanicalStreamsPersisted: true }, { clientForwarderTokenSupplied: true },
      { fixedEndpoint: "http://mcp-forwarder:8082/token" }, { providerCalls: 1 }, { providerClientSessions: 1 }, { runtimeReady: true },
      { executionReady: true }, { providerAuthorized: true }, { arbitraryRawField: "not permitted" }]) {
      assert.throws(() => assertPrivateStreamReport({ ...original, ...changes }, platform));
    }
    const malformed = structuredClone(original); malformed.receipts[0]!.stdout.bytes = 4 * 1024 * 1024 + 1;
    assert.throws(() => assertPrivateStreamReport(malformed, platform));
  }
  assert.throws(() => assertPrivateStreamReport(report("linux/arm64"), "linux/amd64"));
});

test("provenance binds authenticated signer, digest, source, workflow and run attempt", () => {
  assertPrivateStreamAttestation(attestation());
  for (const changes of [{ sourceRepositoryDigest: "a".repeat(40) }, { buildSignerDigest: "a".repeat(40) },
    { subjectAlternativeName: signer.replace("private-stream-", "") }, { issuer: "https://attacker.invalid" },
    { runnerEnvironment: "self-hosted" }, { runInvocationURI: `${b.workflowUrl}/attempts/2` }, { sourceRepositoryRef: "refs/heads/other" }]) {
    const changed = attestation(); Object.assign(changed.signature.certificate, changes);
    assert.throws(() => assertPrivateStreamAttestation(changed));
  }
  const subject = attestation(); subject.statement.subject[0]!.digest.sha256 = "a".repeat(64);
  assert.throws(() => assertPrivateStreamAttestation(subject));
  const runDrift = attestation(); runDrift.statement.predicate.runDetails.metadata.invocationId = `${b.workflowUrl}/attempts/2`;
  assert.throws(() => assertPrivateStreamAttestation(runDrift));
  const sourceDrift = attestation(); sourceDrift.statement.predicate.buildDefinition.resolvedDependencies[0]!.digest.gitCommit = "a".repeat(40);
  assert.throws(() => assertPrivateStreamAttestation(sourceDrift));
  assert.throws(() => assertPrivateStreamAttestation({ ...attestation(), verifiedTimestamps: [] }));
});

test("semantic fixtures alone cannot authenticate evidence or grant launch authority", () => {
  assert.throws(() => verifyPrivateStreamImageEvidence(() => Buffer.from(JSON.stringify(attestation()))), /evidence bytes mismatch/);
  for (const key of ["imageAccepted", "runtimeReady", "executionReady", "publicationAuthorized", "providerAuthorized", "canaryAuthorized", "retryAuthorized", "batchAuthorized", "productionAuthorized"] as const) {
    assert.equal(b[key], false);
  }
  assert.equal(b.independentImageReview, null);
  assert.ok(Object.isFrozen(b)); assert.ok(Object.isFrozen(b.files));
  assert.equal(sha(readFileSync("eval/methodology-runtime-image.ts")), "49d29849c382ae6f7e6fbf912e8098cb867123fb746bc164237d8490188dde9c");
});
