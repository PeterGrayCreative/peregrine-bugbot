import binding from "./private-stream-image-acceptance-v1.json" with { type: "json" };
import { array, digest, exact, freeze, hash, integer, same, sha } from "./prediction-contract.js";

/** Additive evidence input. Never imported by launchers or an image-selection allowlist. */
export const PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1 = freeze(binding);
const accepted = PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1;
const repository = "PeterGrayCreative/peregrine-bugbot";
const repositoryUrl = `https://github.com/${repository}`;
const signer = `${repositoryUrl}/${accepted.workflow}@refs/heads/main`;
const invocation = `${accepted.workflowUrl}/attempts/1`;
const imageName = accepted.image.split("@")[0]!;
const imageDigest = accepted.image.split("@sha256:")[1]!;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected evidence object");
  return value as Record<string, unknown>;
}
function fields(value: unknown, expected: Record<string, unknown>, label: string): void {
  const record = object(value);
  for (const [key, field] of Object.entries(expected)) same(record[key], field, `${label}: ${key} mismatch`);
}

// These semantic assertions grant no acceptance. Only verifyPrivateStreamImageEvidence
// authenticates original bytes against the separately reviewed, fixed hash inventory.
export function assertPrivateStreamRun(value: unknown): void {
  fields(value, { id: accepted.workflowRunId, run_attempt: 1, head_sha: accepted.sourceCommit,
    head_branch: "main", event: "workflow_dispatch", status: "completed", conclusion: "success",
    workflow_id: 359950056, path: accepted.workflow, html_url: accepted.workflowUrl }, "workflow run");
  fields(object(value).repository, { id: 1304213739, full_name: repository }, "run repository");
}

export function assertPrivateStreamArtifact(value: unknown, id: number): void {
  const expected = accepted.artifacts.find(item => item.id === id);
  if (!expected) throw new Error("unknown artifact identity");
  fields(value, { ...expected, expired: false }, "artifact");
  fields(object(value).workflow_run, { id: accepted.workflowRunId, head_sha: accepted.sourceCommit,
    repository_id: 1304213739, head_repository_id: 1304213739, head_branch: "main" }, "artifact run");
}

export function assertPrivateStreamReport(value: unknown, platform: "native" | "linux/amd64" | "linux/arm64"): void {
  const report = exact(value, ["kind", "image", "platform", "status", "failure", "receipts", "rawMechanicalStreamsPersisted",
    "clientForwarderTokenSupplied", "fixedEndpoint", "providerCalls", "providerClientSessions", "credentialFreeVersionChecks",
    "runtimeReady", "executionReady", "providerAuthorized", "qualification", "sourceFreezeSha256"], "typed probe report");
  fields(report, { kind: "private-stream-runtime-probe-v1", image: platform === "native" ? "peregrine-eval-runtime:private-stream-v1-pr" : accepted.image,
    platform, status: "PASS", failure: null, sourceFreezeSha256: accepted.sourceFreezeSha256,
    rawMechanicalStreamsPersisted: false, clientForwarderTokenSupplied: false, fixedEndpoint: "http://mcp-forwarder:8082/mcp",
    providerCalls: 0, providerClientSessions: 0, credentialFreeVersionChecks: { codex: "0.152.0", claude: "2.1.252" },
    runtimeReady: false, executionReady: false, providerAuthorized: false }, "typed probe report");
  const receipts = array(report.receipts);
  if (!receipts.length) throw new Error("probe receipts absent");
  let closedAt = 0;
  for (const [index, value] of receipts.entries()) {
    const receipt = exact(value, ["sequence", "invocation", "startedAt", "closedAt", "status", "stdout", "stderr", "failure"], "probe receipt");
    same(receipt.sequence, index + 1, "receipt sequence mismatch");
    same(receipt.failure, null, "failed probe receipt");
    if (![0, 1].includes(Number(receipt.status)) || typeof receipt.status !== "number") throw new Error("invalid receipt status");
    if (integer(receipt.startedAt) < closedAt || integer(receipt.closedAt) < integer(receipt.startedAt)) throw new Error("receipt time mismatch");
    closedAt = integer(receipt.closedAt);
    const command = exact(receipt.invocation, ["command", "argumentCount", "argv", "environment"], "command binding");
    same(command.command, "docker", "unexpected probe command"); integer(command.argumentCount);
    for (const bytes of [command.argv, command.environment, receipt.stdout, receipt.stderr]) {
      const bound = exact(bytes, ["bytes", "sha256"], "byte binding");
      if (integer(bound.bytes) > 4 * 1024 * 1024) throw new Error("receipt byte bound exceeded");
      hash(bound.sha256);
    }
    if (integer(object(receipt.stdout).bytes) + integer(object(receipt.stderr).bytes) > 4 * 1024 * 1024) throw new Error("combined receipt bound exceeded");
  }
  fields(receipts[0], { status: 0, stdout: { bytes: 81, sha256: "be76c7f0bfa000a43ffeb4870caf81199659a9469ffe02b334d740aef76fcd58" },
    stderr: { bytes: 0, sha256: sha("") } }, "fixed containment tuple");
}

export function assertPrivateStreamAttestation(value: unknown): void {
  const verified = object(value), certificate = object(object(verified.signature).certificate), statement = object(verified.statement);
  fields(certificate, { subjectAlternativeName: signer, issuer: "https://token.actions.githubusercontent.com",
    githubWorkflowTrigger: "workflow_dispatch", githubWorkflowSHA: accepted.sourceCommit, githubWorkflowRepository: repository,
    githubWorkflowRef: "refs/heads/main", buildSignerURI: signer, buildSignerDigest: accepted.sourceCommit,
    runnerEnvironment: "github-hosted", sourceRepositoryURI: repositoryUrl, sourceRepositoryDigest: accepted.sourceCommit,
    sourceRepositoryRef: "refs/heads/main", buildConfigURI: signer, buildConfigDigest: accepted.sourceCommit,
    buildTrigger: "workflow_dispatch", runInvocationURI: invocation }, "verified certificate");
  if (!array(verified.verifiedTimestamps).length) throw new Error("verified timestamp absent");
  fields(statement, { _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: imageName, digest: { sha256: imageDigest } }] }, "provenance subject");
  const predicate = object(statement.predicate), definition = object(predicate.buildDefinition);
  fields(definition, { buildType: "https://actions.github.io/buildtypes/workflow/v1",
    resolvedDependencies: [{ digest: { gitCommit: accepted.sourceCommit }, uri: `git+${repositoryUrl}@refs/heads/main` }] }, "provenance source");
  fields(object(definition.externalParameters).workflow, { path: accepted.workflow, ref: "refs/heads/main", repository: repositoryUrl }, "provenance workflow");
  fields(object(predicate.runDetails).metadata, { invocationId: invocation }, "provenance invocation");
  fields(object(predicate.runDetails).builder, { id: signer }, "provenance builder");
}

/** Offline exact replay of a fixed publication; not a signature-verification substitute
 * for new evidence. The pinned gh verification receipt records actual crypto verification. */
export function verifyPrivateStreamImageEvidence(read: (path: string) => Buffer) {
  const bytes = new Map<string, Buffer>();
  for (const [path, expected] of Object.entries(accepted.files)) {
    const content = Buffer.from(read(path));
    same({ bytes: content.length, sha256: sha(content) }, expected, `evidence bytes mismatch: ${path}`);
    bytes.set(path, content);
  }
  const parse = (path: string): Record<string, unknown> => object(JSON.parse(bytes.get(path)!.toString()));
  assertPrivateStreamRun(parse("run.json"));
  const jobs = array(parse("jobs.json").jobs);
  same(jobs.map(job => object(job).id).sort(), [104988322633, 104988537737], "workflow jobs mismatch");
  for (const job of jobs) {
    fields(job, { run_id: accepted.workflowRunId, head_sha: accepted.sourceCommit, status: "completed", conclusion: "success" }, "job");
    for (const step of array(object(job).steps)) fields(step, { status: "completed", conclusion: "success" }, "step");
  }
  const artifacts = array(parse("artifacts.json").artifacts);
  same(artifacts.map(a => object(a).id).sort(), accepted.artifacts.map(a => a.id).sort(), "artifact set mismatch");
  for (const artifact of artifacts) {
    const id = integer(object(artifact).id); assertPrivateStreamArtifact(artifact, id);
    same("sha256:" + sha(bytes.get(`artifact-${id}.archive`)!), object(artifact).digest, "archive identity mismatch");
  }
  const source = parse("private-stream-source.json"), { sha256, ...sourceBody } = source;
  same(digest(sourceBody), sha256, "publication contract seal mismatch");
  fields(source, { kind: "private-stream-runtime-publication-input-v1", revision: accepted.sourceCommit,
    sha256: accepted.sourceFreezeSha256, tag: accepted.tag, workflow: accepted.workflow, profile: "private-stream-v1",
    platforms: ["linux/amd64", "linux/arm64"], hostNodeVersion: "v22.23.2", publishedDigest: null, workflowRun: null,
    independentReview: null, imageAccepted: false, runtimeReady: false, executionReady: false, providerAuthorized: false,
    batchAuthorized: false, retryAuthorized: false }, "publication input");
  for (const platform of ["native", "linux/amd64", "linux/arm64"] as const) {
    const name = `private-stream-${platform.replace("linux/", "")}.json`;
    assertPrivateStreamReport(parse(name), platform);
    const start = parse(name + ".start.json");
    fields(start, { kind: "private-stream-runtime-probe-start-v1", providerCalls: 0, source,
      options: platform === "native" ? { image: "peregrine-eval-runtime:private-stream-v1-pr" } : { image: accepted.image, platform } }, "probe start");
  }
  same(sha(bytes.get("index.json")!), imageDigest, "image index digest mismatch");
  if (!bytes.get("index.json")!.equals(bytes.get("tag-index.json")!)) throw new Error("commit tag mismatch");
  const manifests = array(parse("index.json").manifests);
  same(manifests.length, 2, "platform count mismatch");
  const platforms = manifests.map(m => `linux/${object(object(m).platform).architecture}`).sort();
  same(platforms, Object.keys(accepted.platforms).sort(), "platform set mismatch");
  for (const manifest of manifests) {
    const m = object(manifest), platform = object(m.platform), arch = String(platform.architecture);
    same(platform.os, "linux", "platform OS mismatch");
    const expected = accepted.platforms[`linux/${arch}` as keyof typeof accepted.platforms];
    same(m.digest, expected, "platform digest mismatch");
    same("sha256:" + sha(bytes.get(`manifest-${arch}.json`)!), expected, "child manifest mismatch");
  }
  const verified = array(JSON.parse(bytes.get("attestation-verification-v2.json")!.toString()));
  same(verified.length, 1, "verified attestation count mismatch");
  const entry = object(verified[0]), result = object(entry.verificationResult);
  assertPrivateStreamAttestation(result);
  const bundles = array(parse("attestations.json").attestations);
  same(bundles.length, 1, "signed bundle count mismatch");
  same(object(bundles[0]).bundle, object(entry.attestation).bundle, "verified bundle mismatch");
  const envelope = object(object(object(bundles[0]).bundle).dsseEnvelope);
  same(envelope.payloadType, "application/vnd.in-toto+json", "signed payload type mismatch");
  same(JSON.parse(Buffer.from(String(envelope.payload), "base64").toString()), result.statement, "signed statement mismatch");
  fields(parse("attestation-verification-v2.receipt.json"), { code: 0, command: "gh",
    stdoutSha256: sha(bytes.get("attestation-verification-v2.json")!) }, "crypto verification receipt");
  return accepted;
}
