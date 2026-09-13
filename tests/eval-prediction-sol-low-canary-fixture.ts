import type { TestContext } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest, sha } from "../eval/prediction-contract.js";
import { preparePredictionPreauthorization } from "../eval/prediction-preauthorization.js";
import { registerPredictionCliSession, assessPredictionCliBatch } from "../eval/prediction-cli-session.js";
import { METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "../eval/methodology-runtime-image.js";
import { PREDICTION_CLI_BRIDGE_POLICY } from "../eval/prediction-cli-policy.js";
import { preparePredictionSolLowCanary, SOL_LOW_CANARY_USER_AUTHORIZATION } from "../eval/prediction-sol-low-canary.js";
import { predictionExecutionSourceManifest } from "../eval/prediction-execution-freeze.js";
import { predictionMountFixture } from "./eval-prediction-mount-fixture.js";

export const trustedLowFixture = (value: unknown) => { const bytes = JSON.stringify(value); return { bytes, expectedSha256: sha(bytes) }; };
/** Synthetic authority and client state, never real authorization or model evidence. */
export async function predictionSolLowFixture(t: TestContext) {
  const f = predictionMountFixture(t), cli = registerPredictionCliSession(f.authority.registrationBytes, f.authority.registrationSha256, sha("synthetic predecessor"));
  const authority = { preparation: f.authority, cliSessionFreeze: trustedLowFixture({ kind: "prospective-cli-session-registration-freeze-v4", registration: cli, initialLedger: assessPredictionCliBatch(cli, []) }),
    runtimeAcceptanceFreeze: trustedLowFixture({ kind: "prediction-runtime-acceptance-freeze-v1", acceptance: METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE, scientificRegistration: cli, providerCalls: 0, providerAuthorized: false, executionReady: false, cliAgentCanaryProven: false }) };
  const pack = await preparePredictionPreauthorization(authority, f.root), r4Freeze = trustedLowFixture({ kind: "prediction-r4-preauthorization-freeze-v1", package: pack, providerCalls: 0, providerAuthorized: false, executionReady: false });
  const bridgeFreeze = trustedLowFixture({ kind: "prediction-cli-bridge-freeze-v1", predecessorFreezeSha256: r4Freeze.expectedSha256, packageSha256: pack.sha256, canarySha256: pack.canary.sha256,
    bridgePolicy: PREDICTION_CLI_BRIDGE_POLICY, bridgePolicySha256: digest(PREDICTION_CLI_BRIDGE_POLICY), acceptedRuntime: { acceptance: METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE, freezeSha256: authority.runtimeAcceptanceFreeze.expectedSha256 },
    providerCalls: 0, providerAuthorized: false, executionReady: false });
  const amendmentAuthority = { r4Freeze, bridgeFreeze, assessmentFreeze: trustedLowFixture({ kind: "prediction-canary-assessment-freeze-v4", providerCalls: 0, providerAuthorized: false, executionReady: false,
    reviewAttemptsStarted: 0, unstartedReviewAttempts: 64, batchAuthorized: false, privateBindings: [["r4-preauthorization-v1/freeze-1.json", r4Freeze.expectedSha256], ["cli-bridge-v1/freeze-1.json", bridgeFreeze.expectedSha256]].map(([path, sha256]) => ({ path: `ai-exploratory/prediction-development-v1/${path}`, sha256 })) }),
    userAuthorization: { bytes: SOL_LOW_CANARY_USER_AUTHORIZATION, expectedSha256: sha(SOL_LOW_CANARY_USER_AUTHORIZATION) } };
  const amendment = preparePredictionSolLowCanary(amendmentAuthority), directory = join(f.root, "low-canary"), runId = "synthetic-low-run";
  const frozen = { kind: "prediction-sol-low-canary-freeze-v1", amendment, source: predictionExecutionSourceManifest(), execution: { runId, directory }, providerAuthorized: false, executionReady: false, batchAuthorized: false, providerCalls: 0 };
  const lowFreeze = trustedLowFixture(frozen), session = join(f.root, "synthetic-session"); mkdirSync(session, { mode: 0o700 }); writeFileSync(join(session, "auth.json"), "synthetic-not-a-credential", { mode: 0o600 });
  const old = process.env.PEREGRINE_CODEX_SESSION_DIR; process.env.PEREGRINE_CODEX_SESSION_DIR = session;
  t.after(() => { if (old === undefined) delete process.env.PEREGRINE_CODEX_SESSION_DIR; else process.env.PEREGRINE_CODEX_SESSION_DIR = old; });
  const options = { authority, mountsRoot: f.root, freezeBytes: r4Freeze.bytes, freezeSha256: r4Freeze.expectedSha256, directory, runId,
    solLowAmendment: { authority: amendmentAuthority, freezeBytes: lowFreeze.bytes, freezeSha256: lowFreeze.expectedSha256 } };
  return { ...f, pack, amendment, amendmentAuthority, frozen, options };
}
