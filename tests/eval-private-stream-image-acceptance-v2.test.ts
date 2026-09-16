import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson } from "../eval/experiment.js";
import { PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1 } from "../eval/private-stream-image-acceptance.js";
import { PRIVATE_STREAM_IMAGE_ACCEPTANCE_V2 as accepted, PRIVATE_STREAM_IMAGE_GATE_V1 as gate,
  PRIVATE_STREAM_IMAGE_GATE_FILE_SHA256, verifyPrivateStreamImageGate, verifyAcceptedPrivateStreamImage } from "../eval/private-stream-image-acceptance-v2.js";
import { sha } from "../eval/prediction-contract.js";

const bytes = () => Buffer.from(canonicalJson(gate) + "\n");
test("exact independent gate binds reviewed commits, freeze, reconstruction and publication", () => {
  assert.equal(sha(bytes()), PRIVATE_STREAM_IMAGE_GATE_FILE_SHA256);
  assert.deepEqual(verifyPrivateStreamImageGate(bytes()), gate);
  assert.deepEqual(verifyPrivateStreamImageGate(readFileSync("eval/private-stream-image-gate-v1.json")), gate);
  assert.equal(gate.reviewed.publicCommit, "97913d4c98eb217a0d716d58b5526a2589c43552");
  assert.equal(gate.reviewed.privateCommit, "2a0ca1cd9bec5cfd78a1811092cb72606f07f87f");
  assert.equal(gate.reviewed.freezeSha256, "df8eaa464e01315f71b2ca082afa503be65abe9944151015ad45a4fa5cbdb15f");
  assert.equal(gate.reviewed.reconstructionSha256, "f5b162a1750fca4b235608a4c9c3d76aaeada6415c69ff1be3e9086c4edf68fe");
  assert.equal(gate.publication.image, accepted.image);
  assert.equal(gate.publication.sourceCommit, accepted.sourceCommit);
  assert.equal(gate.publication.workflowRunId, accepted.workflowRunId);
  assert.deepEqual(gate.publication.artifacts, accepted.artifacts);
  assert.equal(sha(readFileSync("eval/private-stream-image-acceptance-v1.json")), gate.reviewed.publicationRecordSha256);
});

test("stale, wrong, failed, substituted or expanded gates reject before any evidence read", () => {
  const mutations: Array<(value: typeof gate) => void> = [
    value => { value.verdict = "FAIL"; },
    value => { value.reviewed.publicCommit = "a".repeat(40); },
    value => { value.reviewed.privateCommit = "a".repeat(40); },
    value => { value.reviewed.freezeSha256 = "a".repeat(64); },
    value => { value.reviewed.reconstructionSha256 = "a".repeat(64); },
    value => { value.reviewed.publicationRecordSha256 = "a".repeat(64); },
    value => { value.reviewed.publicationBindingSha256 = "a".repeat(64); },
    value => { value.publication.image = value.publication.image.replace(/.$/, "0"); },
    value => { value.publication.sourceCommit = "a".repeat(40); },
    value => { value.publication.workflowRunId++; },
    value => { value.publication.workflowRunAttempt++; },
    value => { value.publication.artifacts[0]!.id++; },
    value => { value.publication.artifacts[0]!.digest = "sha256:" + "a".repeat(64); },
    value => { value.publication.attestationBundleSha256 = "a".repeat(64); },
    value => { value.publication.attestationVerificationSha256 = "a".repeat(64); },
    value => { value.reviewer.identifier = "/root/implementation-agent"; },
    value => { value.reviewer.reasoning = "low"; },
    value => { value.reviewedState.imageAccepted = true; },
    value => { value.reviewedState.providerAuthorized = true; },
    value => { Object.assign(value, { providerAuthorized: true }); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(gate); mutate(changed);
    let reads = 0;
    assert.throws(() => verifyAcceptedPrivateStreamImage(Buffer.from(canonicalJson(changed) + "\n"), () => { reads++; return Buffer.alloc(0); }), /gate bytes mismatch/);
    assert.equal(reads, 0);
  }
  for (const stale of [Buffer.alloc(0), Buffer.from(JSON.stringify(PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1)), Buffer.concat([bytes(), Buffer.from("\n")])]) {
    assert.throws(() => verifyPrivateStreamImageGate(stale), /gate bytes mismatch/);
  }
});

test("valid gate alone cannot accept missing publication evidence", () => {
  assert.throws(() => verifyAcceptedPrivateStreamImage(bytes(), () => Buffer.alloc(0)), /evidence bytes mismatch/);
});

test("accepted image evidence preserves prior records, runtime selection and default denial", () => {
  assert.equal(accepted.imageAccepted, true); assert.equal(accepted.runtimeEvidenceReady, true);
  assert.equal(accepted.imageAcceptanceScope, "credential-free-distribution-evidence");
  for (const key of ["runtimeReady", "executionReady", "publicationAuthorized", "providerAuthorized", "canaryAuthorized", "retryAuthorized", "batchAuthorized", "productionAuthorized"] as const) assert.equal(accepted[key], false);
  assert.equal(accepted.finalAcceptanceStateGate, "pending-independent-review");
  assert.equal(PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1.imageAccepted, false);
  assert.equal(PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1.independentImageReview, null);
  assert.equal(gate.reviewedState.imageAccepted, false);
  assert.equal(gate.reviewedState.runtimeReady, false);
  assert.match(gate.provenance, /Coordinator-relayed.*not a cryptographic reviewer signature/);
  assert.ok(Object.isFrozen(accepted)); assert.ok(Object.isFrozen(accepted.independentImageReview.reviewed));
  assert.equal(sha(readFileSync("eval/methodology-runtime-image.ts")), "49d29849c382ae6f7e6fbf912e8098cb867123fb746bc164237d8490188dde9c");
});
