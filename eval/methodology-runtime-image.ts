/** Experimental methodology/prediction acceptance only. The general review
 * runtime and all provider-authorization gates remain separate and unchanged. */
export const METHODOLOGY_EGRESS_RUNTIME_IMAGE =
  "ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:ccad8c4087d95936231b9c0ac38f4db0782e74da7183c08eee59b71114e15826" as const;
export const PREVIOUS_METHODOLOGY_EGRESS_RUNTIME_IMAGE =
  "ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:d62b740e61ef05f0813531544e5de89ce76e2eb4a8d55248d9f364b9afd7a171" as const;

/** Historical record validation only; never a launch-image allowlist. */
export function isRecordedMethodologyEgressImage(image: unknown): boolean {
  return image === METHODOLOGY_EGRESS_RUNTIME_IMAGE || image === PREVIOUS_METHODOLOGY_EGRESS_RUNTIME_IMAGE;
}

export const METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE = Object.freeze({
  protocol: "methodology-runtime-image-acceptance-v1",
  image: METHODOLOGY_EGRESS_RUNTIME_IMAGE,
  previousImage: PREVIOUS_METHODOLOGY_EGRESS_RUNTIME_IMAGE,
  sourceCommit: "b01d15680705ff7e8d28047f5b529298acbb1c95",
  workflow: ".github/workflows/eval-runtime-image.yml",
  workflowRunId: 34758654512,
  workflowRunAttempt: 1,
  workflowUrl: "https://github.com/PeterGrayCreative/peregrine-bugbot/actions/runs/34758654512",
  platforms: Object.freeze({
    "linux/amd64": "sha256:6c02658ab4ce790c3ecb090c0e99d862cd20eeed342277e957f82c0c75814d3a",
    "linux/arm64": "sha256:0042d215ff539773cd80cf7ee9e2ec2fd9ffaf63d95120e49055b3c484eee07b",
  }),
  evidenceSha256: Object.freeze({
    workflowRun: "e7dfd023b5b5b9d33dadb04e54eeab5ffc61af5a7c20b55a1f65b708e3ede7c7",
    workflowJobs: "8174e26700ac8fb3fe7d2e73afc1d8e547de2500a024959d69020404a4b40097",
    workflowLogArchive: "e36b8ee466a846a7141fe5bba9557bca1d451aeba6e29306c42ce375763ed334",
    attestationBundle: "560e112a1770abdbeecb5c4372c214144999eb5218f729ff7b3b1dd2936fb0d4",
    attestationVerification: "707f6e39270b72b4748671337ce5d6de49f952581435df4d2e307c3b701c39cb",
  }),
  sourceSha256: Object.freeze({
    ".github/workflows/eval-runtime-image.yml": "0be04a27ab5d4f753ec9b07259f7c8a7ed49f8c4f10809234c7972a65902e34a",
    "container/eval-runtime/Dockerfile": "426cad820ecf82a626719fe69f4fb37383962afd41fa37adec0fc1affa8d6479",
    "container/eval-runtime/package.json": "32937e66901b38b344f433bfc888b0ba6514b99460efd813fba7fa979f8fb3ce",
    "container/eval-runtime/package-lock.json": "b54417ff4987a901b5a5142d74ec02fe394af89c9c100e83e130b25d97ce9036",
    "container/eval-runtime/methodology-mcp-forwarder.mjs": "558db6e7e5521ae4836577f7272e4f415bb4d8a9c6f6ff65899611ff575f2f0a",
    "container/eval-runtime/egress-gateway.mjs": "ebecf9225b5db317c896ff75531829c3a38ec8d353fb3f4e86381a79dfeb310b",
    "eval/prediction-runtime-client.mjs": "456b97bc5c5dfc35f9747eddc4cff445dd3d66367f778e249dcc31c56150926f",
  }),
  boundary: "Accepted experimental runtime distribution with workflow containment/egress probes on both platforms; not an authorized CLI-agent/provider canary or served-identity receipt.",
  providerAuthorized: false,
  cliAgentCanaryProven: false,
  exactServedModel: null,
  exactServedVersion: null,
});
