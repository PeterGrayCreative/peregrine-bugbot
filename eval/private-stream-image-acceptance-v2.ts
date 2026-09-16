import recordedGate from "./private-stream-image-gate-v1.json" with { type: "json" };
import { PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1, verifyPrivateStreamImageEvidence } from "./private-stream-image-acceptance.js";
import { digest, freeze, same, sha } from "./prediction-contract.js";

/** Coordinator-relayed independent review. Hash binding is integrity, not reviewer signing. */
export const PRIVATE_STREAM_IMAGE_GATE_V1 = freeze(recordedGate);
export const PRIVATE_STREAM_IMAGE_GATE_FILE_SHA256 = "ac503d440314e589e18caaa4443c0089ab2e7f38e833e5c2223e9d429f4f7e76";

/** Acceptance of credential-free image evidence only; never an image-selection allowlist. */
export const PRIVATE_STREAM_IMAGE_ACCEPTANCE_V2 = freeze({
  ...PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1,
  protocol: "private-stream-image-acceptance-v2",
  predecessorPublicationBindingSha256: PRIVATE_STREAM_IMAGE_GATE_V1.reviewed.publicationBindingSha256,
  independentImageReview: {
    verdict: "PASS", reviewer: PRIVATE_STREAM_IMAGE_GATE_V1.reviewer,
    provenance: PRIVATE_STREAM_IMAGE_GATE_V1.provenance,
    reviewed: PRIVATE_STREAM_IMAGE_GATE_V1.reviewed,
    gateFileSha256: PRIVATE_STREAM_IMAGE_GATE_FILE_SHA256,
  },
  imageAccepted: true,
  runtimeEvidenceReady: true,
  imageAcceptanceScope: "credential-free-distribution-evidence",
  finalAcceptanceStateGate: "pending-independent-review",
  qualification: "Independent PASS recorded for exact credential-free publication/image evidence. Runtime selection is unchanged. Runtime/execution readiness and publication/provider/canary/retry/batch/production authority remain false. This additive state transition still requires a fresh final acceptance-state gate.",
});

/** Authenticate this one reviewed gate; no caller-supplied expected hash or verdict. */
export function verifyPrivateStreamImageGate(bytes: Buffer) {
  same(sha(bytes), PRIVATE_STREAM_IMAGE_GATE_FILE_SHA256, "independent image gate bytes mismatch");
  same(JSON.parse(bytes.toString()), PRIVATE_STREAM_IMAGE_GATE_V1, "independent image gate content mismatch");
  same(PRIVATE_STREAM_IMAGE_GATE_V1.verdict, "PASS", "independent image gate did not pass");
  same(PRIVATE_STREAM_IMAGE_GATE_V1.reviewed.publicationBindingSha256, digest(PRIVATE_STREAM_IMAGE_ACCEPTANCE_V1), "reviewed publication binding drift");
  return PRIVATE_STREAM_IMAGE_GATE_V1;
}

/** Positive reconstruction needs both the exact gate and every original evidence byte. */
export function verifyAcceptedPrivateStreamImage(gateBytes: Buffer, readEvidence: (path: string) => Buffer) {
  const gate = verifyPrivateStreamImageGate(gateBytes);
  const publication = verifyPrivateStreamImageEvidence(readEvidence);
  same(digest(publication), gate.reviewed.publicationBindingSha256, "gate belongs to different publication");
  return PRIVATE_STREAM_IMAGE_ACCEPTANCE_V2;
}
