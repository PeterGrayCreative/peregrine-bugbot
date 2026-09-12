import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  historicalTruthScopeSha256,
  parseHistoricalCuration,
  readHistoricalCaseAdmission,
} from "../eval/historical-curation.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import type { SoleHumanHistoricalCuratorPolicy } from "../eval/historical-curator-policy.js";
import type { HistoricalCaseSpec } from "../src/types.js";
import {
  assembleHumanReviewPacket,
  type HumanPacketAssemblyRequest,
} from "../scripts/evidence/assemble-human-review-packet.js";
import {
  verifyHumanReviewPacket,
  verifyHumanReviewResponse,
} from "../scripts/evidence/verify-human-review-response.js";
import { buildSoleHumanAdmissionFromResponse } from "../scripts/evidence/build-sole-human-admission.js";
import { buildRecoveredHumanReviewRequest } from "../scripts/evidence/build-recovered-human-review-request.js";
import { initializeHumanReviewWorkspace } from "../scripts/evidence/initialize-human-review-workspace.js";
import {
  compileHumanReviewWorkbook,
  compileHumanReviewWorkbookWithPartition,
} from "../scripts/evidence/compile-human-review-workbook.js";
import { renderHumanReviewBundle } from "../scripts/evidence/render-human-review-bundle.js";
import { readR2PartitionAttestation } from "../eval/methodology-r2-partition.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function fixture(): { root: string; request: HumanPacketAssemblyRequest; output: string; cleanup: () => void } {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-human-packet-"));
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  mkdirSync(join(alpha, "proofs"), { recursive: true });
  mkdirSync(beta, { recursive: true });
  const alphaManifest = Buffer.from("opaque alpha manifest bytes\n");
  const alphaCard = Buffer.from("# Alpha card\n\nSynthetic causal content is not parsed. [Proof](proofs/trace.md).\n");
  const alphaProof = Buffer.from("synthetic proof\n");
  const betaManifest = Buffer.from("opaque beta loss manifest bytes\n");
  const betaCard = Buffer.from("# Beta sampled loss\n");
  writeFileSync(join(alpha, "dossier.json"), alphaManifest);
  writeFileSync(join(alpha, "human-evidence-card.md"), alphaCard);
  writeFileSync(join(alpha, "proofs", "trace.md"), alphaProof);
  writeFileSync(join(beta, "loss.json"), betaManifest);
  writeFileSync(join(beta, "sampled-loss.md"), betaCard);
  return {
    root,
    output: join(root, "packet"),
    request: {
      schemaVersion: 1,
      packetId: "r2-human-review-v1",
      dossiers: [
        {
          dossierId: "case-alpha",
          sourceRoot: alpha,
          classification: "ready-for-human-review",
          manifest: { path: "dossier.json", sha256: hash(alphaManifest) },
          cardPath: "human-evidence-card.md",
          files: [
            { path: "human-evidence-card.md", sha256: hash(alphaCard) },
            { path: "proofs/trace.md", sha256: hash(alphaProof) },
          ],
        },
        {
          dossierId: "loss-beta",
          sourceRoot: beta,
          classification: "reconstruction-loss",
          manifest: { path: "loss.json", sha256: hash(betaManifest) },
          cardPath: "sampled-loss.md",
          files: [{ path: "sampled-loss.md", sha256: hash(betaCard) }],
        },
      ],
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("assembles byte-bound portable copies, retained losses, and blank sole-human templates", () => {
  const data = fixture();
  try {
    const sourceSnapshots = data.request.dossiers.flatMap((dossier) =>
      [dossier.manifest, ...dossier.files].map((file) => ({
        path: join(dossier.sourceRoot, ...file.path.split("/")),
        bytes: readFileSync(join(dossier.sourceRoot, ...file.path.split("/"))),
      })));
    const result = assembleHumanReviewPacket(data.request, data.output);
    const manifest = JSON.parse(readFileSync(join(data.output, "packet-manifest.json"), "utf8"));
    const index = readFileSync(join(data.output, "review-index.md"), "utf8");
    const lossLedger = JSON.parse(readFileSync(join(data.output, "loss-ledger.json"), "utf8"));
    const decision = JSON.parse(readFileSync(join(data.output, "decisions/case-alpha.json"), "utf8"));
    const packetDecision = JSON.parse(readFileSync(join(data.output, "packet-decision.json"), "utf8"));

    assert.equal(result.packetSha256, manifest.packetSha256);
    const { schemaVersion, packetSha256, ...packetCore } = manifest;
    assert.equal(schemaVersion, 1);
    assert.equal(hash(Buffer.from(JSON.stringify(packetCore))), packetSha256);
    assert.deepEqual(manifest.claims, {
      reviewOnly: true,
      admissible: false,
      humanDecisionsPresent: false,
      independentHumanConfirmations: 0,
      protectedSelectionEstablished: false,
      partitionAssigned: false,
      sourceFileListCompletenessAuthenticated: false,
      referenceClosureAuthenticated: false,
    });
    assert.deepEqual(manifest.counts, { proposals: 1, retainedLosses: 1 });
    assert.equal(manifest.dossiers.some((entry: { sourceRoot?: string }) => entry.sourceRoot !== undefined), false);
    assert.match(index, /review-only and non-admissible/);
    assert.match(index, /dossiers\/case-alpha\/human-evidence-card\.md/);
    assert.match(index, /dossiers\/loss-beta\/sampled-loss\.md/);
    assert.match(index, /does not establish truth, approval, human confirmation, independent review, protected selection/);
    assert.match(index, /caller is responsible for supplying a complete dossier file list/);
    assert.match(index, /Copy the blank files.*into a separate response folder/s);
    assert.match(index, /Never edit this sealed packet/);
    assert.deepEqual(
      readFileSync(join(data.output, "dossiers/case-alpha/proofs/trace.md")),
      Buffer.from("synthetic proof\n"),
    );
    assert.deepEqual(lossLedger.retainedLosses.map((entry: { dossierId: string }) => entry.dossierId), ["loss-beta"]);
    assert.equal(existsSync(join(data.output, "decisions/loss-beta.json")), false);
    assert.equal(decision.decision, null);
    assert.equal(decision.reason, null);
    assert.equal(decision.humanReviewerIdentitySha256, null);
    assert.equal(packetDecision.reviewedEveryDecisionCard, null);
    assert.equal(packetDecision.acknowledgedPacketSha256, null);
    assert.equal(packetDecision.soleHumanReviewerAcknowledged, null);
    assert.equal(packetDecision.independentTwoHumanConfirmationClaimed, null);
    assert.equal(packetDecision.reviewMode, "sole-human-v1");

    for (const dossier of manifest.dossiers) {
      for (const file of [dossier.manifest, ...dossier.files]) {
        const bytes = readFileSync(join(data.output, ...file.path.split("/")));
        assert.equal(bytes.byteLength, file.bytes);
        assert.equal(hash(bytes), file.sha256);
      }
    }
    for (const file of manifest.generatedFiles) {
      const bytes = readFileSync(join(data.output, ...file.path.split("/")));
      assert.equal(bytes.byteLength, file.bytes);
      assert.equal(hash(bytes), file.sha256);
    }
    for (const snapshot of sourceSnapshots) assert.deepEqual(readFileSync(snapshot.path), snapshot.bytes);

    const secondOutput = join(data.root, "packet-two");
    const second = assembleHumanReviewPacket(data.request, secondOutput);
    assert.equal(second.packetSha256, result.packetSha256);
    assert.deepEqual(
      readFileSync(join(secondOutput, "packet-manifest.json")),
      readFileSync(join(data.output, "packet-manifest.json")),
    );
  } finally {
    data.cleanup();
  }
});

test("initializes one durable all-at-once response workspace without making human decisions", () => {
  const data = fixture();
  try {
    const assembled = assembleHumanReviewPacket(data.request, data.output);
    const workspace = join(data.root, "human-response-workspace");
    const packetBefore = readFileSync(join(data.output, "packet-manifest.json"));
    const initialized = initializeHumanReviewWorkspace({
      packetDirectory: data.output,
      destination: workspace,
      reviewerIdentityDescriptor: "github-user:https://github.com/PeterGrayCreative",
    });
    assert.equal(initialized.packetSha256, assembled.packetSha256);
    assert.equal(initialized.copiedTemplates.length, 2);
    assert.equal(initialized.workbookSha256, hash(readFileSync(join(workspace, "RESPONSE.json"))));
    assert.equal(initialized.claims.decisionsPresent, false);
    assert.equal(initialized.claims.humanReviewComplete, false);
    assert.equal(initialized.reviewerIdentity.descriptor, "github-user:https://github.com/PeterGrayCreative");
    assert.equal(initialized.reviewerIdentity.sha256, hash(`peregrine-human-reviewer-v1\0${initialized.reviewerIdentity.descriptor}`));
    assert.deepEqual(readFileSync(join(workspace, "response/decisions/case-alpha.json")), readFileSync(join(data.output, "decisions/case-alpha.json")));
    assert.deepEqual(readFileSync(join(workspace, "response/packet-decision.json")), readFileSync(join(data.output, "packet-decision.json")));
    assert.deepEqual(readFileSync(join(data.output, "packet-manifest.json")), packetBefore);
    const guide = readFileSync(join(workspace, "REVIEW.md"), "utf8");
    assert.match(guide, /Review all 1 proposals/);
    assert.match(guide, /dossiers\/case-alpha\/human-evidence-card\.md/);
    assert.match(guide, /response\/decisions\/case-alpha\.json/);
    assert.match(guide, /single `RESPONSE\.json` workbook/);
    assert.match(guide, /assign `development` or `selection`/);
    assert.match(guide, /partition-attestation\.json/);
    assert.match(guide, /do not claim independent confirmation/i);
    assert.throws(() => verifyHumanReviewResponse(data.output, join(workspace, "response"), initialized.reviewerIdentity.sha256), /template|decision/i);
    assert.throws(() => initializeHumanReviewWorkspace({ packetDirectory: data.output, destination: workspace, reviewerIdentityDescriptor: "same" }), /overwrite/);
    assert.throws(() => initializeHumanReviewWorkspace({ packetDirectory: data.output, destination: join(data.output, "response"), reviewerIdentityDescriptor: "same" }), /disjoint|overwrite/);
  } finally {
    data.cleanup();
  }
});

test("renders every proposal card into one review-only document", () => {
  const data = fixture();
  try {
    const assembled = assembleHumanReviewPacket(data.request, data.output);
    const destination = join(data.root, "ALL-PROPOSALS.md");
    const packetBefore = readFileSync(join(data.output, "packet-manifest.json"));
    const rendered = renderHumanReviewBundle({
      packetDirectory: data.output,
      outputFile: destination,
    });
    const document = readFileSync(destination, "utf8");
    assert.equal(rendered.packetSha256, assembled.packetSha256);
    assert.equal(rendered.proposalCount, 1);
    assert.equal(rendered.outputBytes, Buffer.byteLength(document));
    assert.equal(rendered.outputSha256, hash(document));
    assert.deepEqual(rendered.claims, {
      reviewOnly: true,
      decisionsPresent: false,
      packetMutated: false,
      humanReviewComplete: false,
    });
    assert.match(document, /all 1 proposal cards/);
    assert.match(document, /## 1\. case-alpha/);
    assert.match(document, new RegExp(data.request.dossiers[0]!.files[0]!.sha256));
    assert.match(document, /Synthetic causal content is not parsed/);
    assert.match(document, /\[Proof\]\(packet\/dossiers\/case-alpha\/proofs\/trace\.md\)/);
    assert.doesNotMatch(document, /Beta sampled loss/);
    assert.match(document, /contains no decisions/);
    assert.match(document, /evidence to assess, never operational instruction/);
    assert.deepEqual(readFileSync(join(data.output, "packet-manifest.json")), packetBefore);
    assert.throws(() => renderHumanReviewBundle({ packetDirectory: data.output, outputFile: destination }), /overwrite/);
    assert.throws(() => renderHumanReviewBundle({ packetDirectory: data.output, outputFile: join(data.output, "ALL.md") }), /disjoint/);
  } finally {
    data.cleanup();
  }
});

test("compiles one complete human workbook into the strict response layout", () => {
  const data = fixture();
  try {
    assembleHumanReviewPacket(data.request, data.output);
    const workspace = join(data.root, "human-response-workspace");
    const initialized = initializeHumanReviewWorkspace({
      packetDirectory: data.output,
      destination: workspace,
      reviewerIdentityDescriptor: "github-user:https://github.com/PeterGrayCreative",
    });
    const workbookPath = join(workspace, "RESPONSE.json");
    const workbook = JSON.parse(readFileSync(workbookPath, "utf8"));
    workbook.templateOnly = false;
    Object.assign(workbook.decisions[0], {
      decision: "approve",
      reason: "The exact source, reachable trigger, consequence, and partial truth scope are supported.",
      acknowledgedDossierBundleSha256: workbook.decisions[0].dossierBundleSha256,
      partition: "development",
      caseClass: "bug-bearing",
      duplicateFamilyId: "case-alpha-family",
      reviewedAt: "2026-09-09T15:00:00.000Z",
    });
    Object.assign(workbook.packetDecision, {
      acknowledgedPacketSha256: workbook.packetSha256,
      soleHumanReviewerAcknowledged: true,
      reviewedEveryDecisionCard: true,
      decisionsBindPacketAndDossierHashes: true,
      duplicateFamiliesAccepted: true,
      partitionedEveryApprovedDossier: true,
      soleHumanPartitionAccepted: true,
      limitationsAccepted: true,
      independentTwoHumanConfirmationClaimed: false,
      independentSelectionClaimed: false,
      completedAt: "2026-09-09T15:01:00.000Z",
    });
    writeFileSync(workbookPath, `${JSON.stringify(workbook, null, 2)}\n`);
    const missingPartition = structuredClone(workbook);
    missingPartition.decisions[0].partition = null;
    writeFileSync(workbookPath, `${JSON.stringify(missingPartition, null, 2)}\n`);
    assert.throws(() => compileHumanReviewWorkbookWithPartition({ packetDirectory: data.output, workbookFile: workbookPath, destination: join(data.root, "missing-partition-response"), partitionAttestationFile: join(data.root, "missing-partition-attestation.json"), expectedHumanReviewerIdentitySha256: initialized.reviewerIdentity.sha256 }), /partition fields/);
    assert.equal(existsSync(join(data.root, "missing-partition-response")), false);
    assert.equal(existsSync(join(data.root, "missing-partition-attestation.json")), false);
    writeFileSync(workbookPath, `${JSON.stringify(workbook, null, 2)}\n`);
    const destination = join(data.root, "compiled-response");
    const attestationFile = join(data.root, "partition-attestation.json");
    const compiled = compileHumanReviewWorkbookWithPartition({ packetDirectory: data.output, workbookFile: workbookPath, destination, partitionAttestationFile: attestationFile, expectedHumanReviewerIdentitySha256: initialized.reviewerIdentity.sha256 });
    assert.deepEqual(compiled.response.counts, { approve: 1, reject: 0, unresolved: 0 });
    assert.deepEqual(verifyHumanReviewResponse(data.output, destination, initialized.reviewerIdentity.sha256), compiled.response);
    assert.deepEqual(readR2PartitionAttestation(attestationFile).attestation, compiled.partitionAttestation);
    assert.deepEqual(compiled.partitionAttestation.approvedDossiers, [{
      dossierId: "case-alpha",
      partition: "development",
      caseClass: "bug-bearing",
      duplicateFamilyId: "case-alpha-family",
    }]);
    const legacyWorkbook = structuredClone(workbook);
    legacyWorkbook.schemaVersion = 1;
    legacyWorkbook.protocol = "r2-sole-human-review-workbook-v1";
    delete legacyWorkbook.decisions[0].partition;
    delete legacyWorkbook.decisions[0].caseClass;
    delete legacyWorkbook.decisions[0].duplicateFamilyId;
    delete legacyWorkbook.packetDecision.partitionedEveryApprovedDossier;
    delete legacyWorkbook.packetDecision.soleHumanPartitionAccepted;
    delete legacyWorkbook.packetDecision.independentSelectionClaimed;
    const legacyWorkbookPath = join(workspace, "LEGACY-RESPONSE.json");
    writeFileSync(legacyWorkbookPath, `${JSON.stringify(legacyWorkbook, null, 2)}\n`);
    const legacyDestination = join(data.root, "legacy-compiled-response");
    const legacyCompiled = compileHumanReviewWorkbook({ packetDirectory: data.output, workbookFile: legacyWorkbookPath, destination: legacyDestination, expectedHumanReviewerIdentitySha256: initialized.reviewerIdentity.sha256 });
    assert.deepEqual(legacyCompiled.counts, { approve: 1, reject: 0, unresolved: 0 });
    assert.deepEqual(verifyHumanReviewResponse(data.output, legacyDestination, initialized.reviewerIdentity.sha256), legacyCompiled);
    assert.throws(() => compileHumanReviewWorkbookWithPartition({ packetDirectory: data.output, workbookFile: workbookPath, destination, partitionAttestationFile: attestationFile, expectedHumanReviewerIdentitySha256: initialized.reviewerIdentity.sha256 }), /overwrite/);

    workbook.decisions[0].acknowledgedDossierBundleSha256 = "f".repeat(64);
    writeFileSync(workbookPath, `${JSON.stringify(workbook, null, 2)}\n`);
    assert.throws(() => compileHumanReviewWorkbookWithPartition({ packetDirectory: data.output, workbookFile: workbookPath, destination: join(data.root, "invalid-response"), partitionAttestationFile: join(data.root, "invalid-attestation.json"), expectedHumanReviewerIdentitySha256: initialized.reviewerIdentity.sha256 }), /canonical dossier/);
    assert.equal(existsSync(join(data.root, "invalid-response")), false);
    assert.equal(existsSync(join(data.root, "invalid-attestation.json")), false);
  } finally {
    data.cleanup();
  }
});

function writeCompletedResponse(packet: string, response: string, humanIdentity: string): void {
  mkdirSync(join(response, "decisions"), { recursive: true });
  const decision = JSON.parse(readFileSync(join(packet, "decisions/case-alpha.json"), "utf8"));
  Object.assign(decision, {
    templateOnly: false,
    decision: "approve",
    reason: "Source, reachability, consequence, and stated partial scope are supported.",
    correction: null,
    acknowledgedDossierBundleSha256: decision.dossierBundleSha256,
    humanReviewerIdentitySha256: humanIdentity,
    reviewedAt: "2026-09-07T15:00:00.000Z",
  });
  writeFileSync(join(response, "decisions/case-alpha.json"), `${JSON.stringify(decision, null, 2)}\n`);
  const packetDecision = JSON.parse(readFileSync(join(packet, "packet-decision.json"), "utf8"));
  const packetManifest = JSON.parse(readFileSync(join(packet, "packet-manifest.json"), "utf8"));
  Object.assign(packetDecision, {
    templateOnly: false,
    acknowledgedPacketSha256: packetManifest.packetSha256,
    humanReviewerIdentitySha256: humanIdentity,
    soleHumanReviewerAcknowledged: true,
    reviewedEveryDecisionCard: true,
    decisionsBindPacketAndDossierHashes: true,
    duplicateFamiliesAccepted: true,
    limitationsAccepted: true,
    independentTwoHumanConfirmationClaimed: false,
    completedAt: "2026-09-07T16:00:00.000Z",
  });
  writeFileSync(join(response, "packet-decision.json"), `${JSON.stringify(packetDecision, null, 2)}\n`);
}

function historicalDraft(root: string, humanIdentity: string): {
  caseDirectory: string;
  caseSpec: HistoricalCaseSpec;
  policy: SoleHumanHistoricalCuratorPolicy;
} {
  const caseDirectory = join(root, "development", "case-alpha");
  mkdirSync(caseDirectory, { recursive: true });
  const caseSpec: HistoricalCaseSpec = {
    id: "case-alpha",
    corpus: "development",
    kind: "historical",
    evaluationProtocol: "historical-efficacy-v1",
    repoSource: "/curator/source.git",
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    diffFile: "diff.patch",
  };
  const diff = "diff --git a/src/retry.ts b/src/retry.ts\n+retry();\n";
  const proof = "Complete static trace of one historical callback-loss root.\n";
  const truthValue = {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status: "known-roots",
      completeness: "partial",
      reviewedScope: "The exact review change and one independently supported callback-loss root.",
      permittedMetrics: historicalPermittedMetrics("known-roots"),
    },
    bugs: [{
      id: "bug-aaaaaaaa",
      lane: "other-unclassified",
      mechanismFamily: "callback-loss",
      proofLevel: "complete-static-trace",
      expectedDisposition: "fix-in-pr",
      expectedSeverity: "high",
      file: "src/retry.ts",
      startLine: 8,
      endLine: 10,
      description: "The retry path omits the completion callback.",
      reachablePreconditions: "A request takes the retry branch.",
      observableImpact: "The request remains pending.",
      provenance: "The historical head and later repair support this root.",
    }],
  };
  const truth = parseHistoricalGroundTruth(truthValue);
  writeFileSync(join(caseDirectory, "case.json"), `${JSON.stringify(caseSpec, null, 2)}\n`);
  writeFileSync(join(caseDirectory, "ground_truth.json"), `${JSON.stringify(truthValue, null, 2)}\n`);
  writeFileSync(join(caseDirectory, "diff.patch"), diff);
  writeFileSync(join(caseDirectory, "proof.md"), proof);
  const curation = {
    schemaVersion: 3,
    protocol: "historical-efficacy-v1",
    caseId: "case-alpha",
    status: "draft",
    curatorPolicyId: "sole-human-historical-v1",
    reviewMode: "sole-human-v1",
    reviewDossierId: "case-alpha",
    truth: {
      truthVersion: "truth-v1",
      status: "known-roots",
      completeness: "partial",
      scopeSha256: historicalTruthScopeSha256(truth),
    },
    source: {
      kind: "historical",
      repositoryAlias: "public-history",
      repositoryIdentitySha256: hash("repository-family"),
      changeIdentitySha256: hash(diff),
      access: "public",
    },
    strata: {
      languageFamily: "typescript",
      architectureFamily: "library",
      size: "small",
      changeShapes: ["seam"],
      secondarySurfaceLanes: [],
      mechanismFamilies: ["callback-loss"],
    },
    proof: { kind: "reasoned-analysis", artifact: "proof.md", sha256: hash(proof) },
    preparationEvidence: [],
    humanDecision: null,
  };
  parseHistoricalCuration(curation, caseSpec, truth);
  writeFileSync(join(caseDirectory, "curation.json"), `${JSON.stringify(curation, null, 2)}\n`);
  return {
    caseDirectory,
    caseSpec,
    policy: {
      schemaVersion: 2,
      policyId: "sole-human-historical-v1",
      trustRoot: "accountable-human-review",
      reviewMode: "sole-human-v1",
      minimumHumanDecisions: 1,
      registeredHumanIdentitySha256: humanIdentity,
      aiPreparationCanSatisfyHumanGate: false,
    },
  };
}

test("authenticates one complete sole-human response against exact packet bytes", () => {
  const data = fixture();
  const humanIdentity = "9".repeat(64);
  try {
    const assembled = assembleHumanReviewPacket(data.request, data.output);
    const response = join(data.root, "response");
    writeCompletedResponse(data.output, response, humanIdentity);
    const verified = verifyHumanReviewResponse(data.output, response, humanIdentity);
    assert.equal(verified.packetSha256, assembled.packetSha256);
    assert.equal(verified.humanReviewerIdentitySha256, humanIdentity);
    assert.deepEqual(verified.counts, { approve: 1, reject: 0, unresolved: 0 });
    assert.equal(verified.decisions[0]?.dossierId, "case-alpha");
    assert.equal(verified.verificationBoundary, "caller-registered-identity-and-byte-binding-only");
    assert.match(verified.responseSha256, /^[a-f0-9]{64}$/);
  } finally {
    data.cleanup();
  }
});

test("derives an append-only admission from an authenticated approval without mutating the draft", () => {
  const data = fixture();
  const humanIdentity = "9".repeat(64);
  try {
    assembleHumanReviewPacket(data.request, data.output);
    const response = join(data.root, "response");
    writeCompletedResponse(data.output, response, humanIdentity);
    const historical = historicalDraft(data.root, humanIdentity);
    const result = buildSoleHumanAdmissionFromResponse({
      caseDirectory: historical.caseDirectory,
      caseSpec: historical.caseSpec,
      trustedPolicy: historical.policy,
      packetDirectory: data.output,
      responseDirectory: response,
    });
    assert.equal(result.status, "admitted");
    if (result.status !== "admitted") assert.fail("expected admitted result");
    assert.equal(result.curation.humanDecision?.responseSha256, result.responseSha256);
    assert.equal(result.curation.humanDecision?.caseBundleSha256, result.caseBundleSha256);
    assert.equal(JSON.parse(readFileSync(join(historical.caseDirectory, "curation.json"), "utf8")).status, "draft");

    writeFileSync(join(historical.caseDirectory, "curation.json"), result.curationBytes);
    const admission = readHistoricalCaseAdmission(
      historical.caseDirectory,
      historical.caseSpec,
      historical.policy,
    );
    assert.equal(admission.caseBundleSha256, result.caseBundleSha256);
  } finally {
    data.cleanup();
  }
});

test("fails closed when an approval includes a correction", () => {
  const data = fixture();
  const humanIdentity = "9".repeat(64);
  try {
    assembleHumanReviewPacket(data.request, data.output);
    const response = join(data.root, "response");
    writeCompletedResponse(data.output, response, humanIdentity);
    const decisionPath = join(response, "decisions/case-alpha.json");
    const decision = JSON.parse(readFileSync(decisionPath, "utf8")) as Record<string, unknown>;
    decision.correction = "The dossier needs a corrected evidence reference.";
    writeFileSync(decisionPath, `${JSON.stringify(decision, null, 2)}\n`);
    const historical = historicalDraft(data.root, humanIdentity);
    assert.throws(() => buildSoleHumanAdmissionFromResponse({
      caseDirectory: historical.caseDirectory,
      caseSpec: historical.caseSpec,
      trustedPolicy: historical.policy,
      packetDirectory: data.output,
      responseDirectory: response,
    }), /approve decision cannot include a correction.*new packet\/dossier version/i);
    assert.equal(JSON.parse(readFileSync(join(historical.caseDirectory, "curation.json"), "utf8")).status, "draft");
  } finally {
    data.cleanup();
  }
});

test("response verification rejects missing decisions, wrong identities, false attestations, and packet drift", () => {
  for (const mutate of [
    (packet: string, response: string) => rmSync(join(response, "decisions/case-alpha.json")),
    (_packet: string, response: string) => {
      const value = JSON.parse(readFileSync(join(response, "decisions/case-alpha.json"), "utf8"));
      value.humanReviewerIdentitySha256 = "8".repeat(64);
      writeFileSync(join(response, "decisions/case-alpha.json"), JSON.stringify(value));
    },
    (_packet: string, response: string) => {
      const value = JSON.parse(readFileSync(join(response, "packet-decision.json"), "utf8"));
      value.independentTwoHumanConfirmationClaimed = true;
      writeFileSync(join(response, "packet-decision.json"), JSON.stringify(value));
    },
    (packet: string) => writeFileSync(join(packet, "review-index.md"), "tampered\n"),
    (packet: string) => writeFileSync(join(packet, "unbound.txt"), "not in manifest\n"),
  ]) {
    const data = fixture();
    const humanIdentity = "9".repeat(64);
    try {
      assembleHumanReviewPacket(data.request, data.output);
      const response = join(data.root, "response");
      writeCompletedResponse(data.output, response, humanIdentity);
      mutate(data.output, response);
      assert.throws(() => verifyHumanReviewResponse(data.output, response, humanIdentity));
    } finally {
      data.cleanup();
    }
  }
});

test("rejects manifest and included-file tampering without leaving a packet", () => {
  const first = fixture();
  try {
    writeFileSync(join(first.request.dossiers[0]!.sourceRoot, "dossier.json"), "tampered\n");
    assert.throws(() => assembleHumanReviewPacket(first.request, first.output), /manifest does not match/);
    assert.equal(existsSync(first.output), false);
  } finally {
    first.cleanup();
  }

  const second = fixture();
  try {
    writeFileSync(join(second.request.dossiers[0]!.sourceRoot, "proofs/trace.md"), "tampered\n");
    assert.throws(() => assembleHumanReviewPacket(second.request, second.output), /does not match its expected SHA-256/);
    assert.equal(existsSync(second.output), false);
  } finally {
    second.cleanup();
  }
});

test("rejects traversal, unsafe cards, duplicate dossiers, and duplicate paths", () => {
  const paths = fixture();
  try {
    const traversal = structuredClone(paths.request);
    traversal.dossiers[0]!.files[0]!.path = "../human-evidence-card.md";
    assert.throws(() => assembleHumanReviewPacket(traversal, paths.output), /safe portable relative path/);

    const unsafeCard = structuredClone(paths.request);
    unsafeCard.dossiers[0]!.cardPath = "proofs/trace.md";
    assert.throws(() => assembleHumanReviewPacket(unsafeCard, paths.output), /cardPath is not supported/);

    const duplicateId = structuredClone(paths.request);
    duplicateId.dossiers[1]!.dossierId = "case-alpha";
    assert.throws(() => assembleHumanReviewPacket(duplicateId, paths.output), /duplicate dossierId/);

    const duplicatePath = structuredClone(paths.request);
    duplicatePath.dossiers[0]!.files.push(duplicatePath.dossiers[0]!.files[0]!);
    assert.throws(() => assembleHumanReviewPacket(duplicatePath, paths.output), /duplicate file path/);

  } finally {
    paths.cleanup();
  }
});

test("accepts shared batch manifests, JSON review cards, and source filenames used by recovered repositories", () => {
  const data = fixture();
  try {
    writeFileSync(join(data.request.dossiers[0]!.sourceRoot, ".babelrc"), "{}\n");
    writeFileSync(join(data.request.dossiers[0]!.sourceRoot, "_error.tsx"), "export default null;\n");
    writeFileSync(join(data.request.dossiers[0]!.sourceRoot, "human-review-card.json"), "{}\n");
    const request = structuredClone(data.request);
    request.dossiers[0]!.cardPath = "human-review-card.json";
    request.dossiers[0]!.files = [
      { path: "human-review-card.json", sha256: hash("{}\n") },
      { path: ".babelrc", sha256: hash("{}\n") },
      { path: "_error.tsx", sha256: hash("export default null;\n") },
    ];
    request.dossiers[1]!.sourceRoot = request.dossiers[0]!.sourceRoot;
    request.dossiers[1]!.classification = "ready-for-human-review";
    request.dossiers[1]!.manifest = { ...request.dossiers[0]!.manifest };
    request.dossiers[1]!.cardPath = "human-review-card.json";
    request.dossiers[1]!.files = [{ ...request.dossiers[0]!.files[0]! }];
    const result = assembleHumanReviewPacket(request, data.output);
    assert.match(result.packetSha256, /^[a-f0-9]{64}$/);
    assert.equal(verifyHumanReviewPacket(data.output).packetSha256, result.packetSha256);
  } finally {
    data.cleanup();
  }
});

test("builds the exact recovered checkpoint inventory without interpreting card content", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-recovered-request-"));
  const stores = join(root, "source-copy", "curator-stores");
  const make = (path: string, files: Record<string, string>): void => {
    for (const [name, bytes] of Object.entries(files)) {
      const output = join(path, ...name.split("/"));
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, bytes);
    }
  };
  try {
    const exposed = join(stores, "exposed-development-recovery-v1");
    make(exposed, { "recovery-manifest.json": "{}\n" });
    for (let index = 1; index <= 12; index += 1) {
      make(exposed, { [`dossiers/exposed-${String(index).padStart(2, "0")}/human-review-card.md`]: "# Review\n" });
    }
    make(exposed, { "losses/exposed-vscode-98988/sampled-loss.md": "# Loss\n" });
    const supplementaryIds = [
      ["v1", "r2-post-merge-alpha-002"], ["v1", "r2-post-merge-alpha-004"],
      ["v2", "r2-post-merge-alpha-003"], ["v2", "r2-post-merge-alpha-005"],
      ["v3", "r2-post-merge-alpha-007"], ["v3", "r2-post-merge-alpha-009"],
      ["v4", "r2-post-merge-alpha-008"], ["v4", "r2-post-merge-alpha-011"],
      ["v4", "r2-post-merge-alpha-012"], ["v4", "r2-post-merge-alpha-013"],
    ];
    for (const [version, id] of supplementaryIds) {
      make(join(stores, `supplementary-recovery-${version}`, "dossiers", id!), {
        "bundle-manifest.json": "{}\n", "human-review-card.json": "{}\n",
      });
    }
    make(join(stores, "linked-defect-recovery-v1"), {
      "bundle-manifest.json": "{}\n", "review-card.md": "# Review\n",
    });
    for (const id of ["001", "002", "004", "007"]) {
      make(join(stores, "comparison-recovery-v1", `r2-random-${id}`), {
        "case-manifest.json": "{}\n", "human-review-card.md": "# Review\n",
      });
    }
    for (const id of ["008", "012", "014"]) {
      make(join(stores, "comparison-recovery-v2", `r2-random-${id}`), {
        "bundle-manifest.json": "{}\n", "dossier.json": "{}\n",
      });
    }
    for (const id of ["003", "005", "006", "009", "010", "011", "013", "015", "016"]) {
      make(join(stores, "sampled-loss-recovery-v1", "losses", `r2-random-${id}`), {
        "loss.json": "{}\n", "sampled-loss.md": "# Loss\n",
      });
    }
    const request = buildRecoveredHumanReviewRequest(root);
    assert.equal(request.dossiers.filter((item) => item.classification === "ready-for-human-review").length, 30);
    assert.equal(request.dossiers.filter((item) => item.classification === "reconstruction-loss").length, 10);
    assert.equal(new Set(request.dossiers.map((item) => item.dossierId)).size, 40);
    assert.equal(request.dossiers.find((item) => item.dossierId === "r2-random-008")?.cardPath, "dossier.json");
    assert.equal(request.dossiers.find((item) => item.dossierId === "exposed-01")?.manifest.path, "recovery-manifest.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects source symlinks and an existing output without changing it", () => {
  const data = fixture();
  try {
    const original = join(data.request.dossiers[0]!.sourceRoot, "proofs/trace.md");
    const linked = join(data.request.dossiers[0]!.sourceRoot, "linked.md");
    symlinkSync(original, linked);
    const request = structuredClone(data.request);
    request.dossiers[0]!.files[1] = { path: "linked.md", sha256: hash(readFileSync(original)) };
    assert.throws(() => assembleHumanReviewPacket(request, data.output), /must not traverse symbolic links/);
    assert.equal(existsSync(data.output), false);

    mkdirSync(data.output);
    writeFileSync(join(data.output, "sentinel"), "preserve\n");
    assert.throws(() => assembleHumanReviewPacket(data.request, data.output), /refusing to overwrite/);
    assert.equal(readFileSync(join(data.output, "sentinel"), "utf8"), "preserve\n");
  } finally {
    data.cleanup();
  }
});

test("rejects source and destination tree overlap through canonical paths", () => {
  const data = fixture();
  try {
    assert.throws(
      () => assembleHumanReviewPacket(data.request, join(data.request.dossiers[0]!.sourceRoot, "packet")),
      /source root must be disjoint/,
    );
    assert.throws(
      () => assembleHumanReviewPacket(data.request, data.root),
      /source root must be disjoint/,
    );

    const nestedParent = join(data.request.dossiers[0]!.sourceRoot, "nested-parent");
    mkdirSync(nestedParent);
    const alias = join(dirname(data.root), `${basename(data.root)}-alias`);
    symlinkSync(data.request.dossiers[0]!.sourceRoot, alias);
    try {
      assert.throws(
        () => assembleHumanReviewPacket(data.request, join(alias, "nested-parent", "packet")),
        /source root must be disjoint/,
      );
    } finally {
      rmSync(alias);
    }
  } finally {
    data.cleanup();
  }
});
