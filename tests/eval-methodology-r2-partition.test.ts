import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  duplicateFamilySha256,
  buildR2PartitionAttestation,
  parseR2PartitionArtifact,
  parseR2PartitionAttestation,
  readR2PartitionAttestation,
  buildR2PartitionArtifact,
  readR2PartitionArtifact,
  writeR2PartitionArtifact,
  type R2PartitionInput,
  type R2PartitionArtifact,
  type R2PartitionAttestation,
} from "../eval/methodology-r2-partition.js";
import {
  parseR2TruthBindingArtifact,
  readR2TruthBindingArtifact,
  writeR2TruthBindingArtifact,
} from "../eval/methodology-r2-truth-binding.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import type { SoleHumanHistoricalCuratorPolicy } from "../eval/historical-curator-policy.js";
import type { HistoricalCaseSpec } from "../src/types.js";
import { assembleHumanReviewPacket, type HumanPacketAssemblyRequest } from "../scripts/evidence/assemble-human-review-packet.js";
import { buildSoleHumanAdmissionFromResponse } from "../scripts/evidence/build-sole-human-admission.js";
import { verifyHumanReviewResponse } from "../scripts/evidence/verify-human-review-response.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const hash = "a".repeat(64);

function attestation(): R2PartitionAttestation {
  const body = {
    schemaVersion: 1 as const,
    protocol: "r2-partition-attestation-v1" as const,
    packetSha256: hash,
    responseSha256: "b".repeat(64),
    humanReviewerIdentitySha256: "c".repeat(64),
    approvedDossiers: [
      {
        dossierId: "case-alpha",
        partition: "development" as const,
        caseClass: "bug-bearing" as const,
        duplicateFamilyId: "family-alpha",
      },
    ],
    soleHumanPartitionAccepted: true as const,
    independentSelectionClaimed: false as const,
    reviewedAt: "2026-09-07T15:00:00.000Z",
  };
  return { ...body, selfSha256: canonicalJsonSha256(body) };
}

function artifact(): R2PartitionArtifact {
  const one = {
    caseName: "development/case-alpha",
    corpus: "development" as const,
    reviewDossierId: "case-alpha",
    registrationSha256: hash,
    curationSha256: "b".repeat(64),
    caseBundleSha256: "c".repeat(64),
    truthScopeSha256: "d".repeat(64),
    repositoryIdentitySha256: "e".repeat(64),
    caseClass: "bug-bearing" as const,
    partition: "development" as const,
    duplicateFamilyId: "family-alpha",
    duplicateFamilySha256: duplicateFamilySha256("family-alpha"),
  };
  const body = {
    schemaVersion: 1 as const,
    protocol: "r2-post-admission-partition-v1" as const,
    version: 1,
    previousArtifactSha256: null,
    packetSha256: hash,
    responseSha256: "b".repeat(64),
    responseCompletedAt: "2026-09-07T14:00:00.000Z",
    humanReviewerIdentitySha256: "c".repeat(64),
    partitionAttestationFileSha256: "d".repeat(64),
    partitionAttestationSelfSha256: "e".repeat(64),
    partitionAttestationReviewedAt: "2026-09-07T15:00:00.000Z",
    claims: {
      soleHumanPartitionAccepted: true as const,
      duplicateFamilyAssignments: "sole-human-partition-attestation" as const,
      independentSelectionClaimed: false as const,
      protectedSelectionEstablished: false as const,
    },
    counts: {
      packet: { proposals: 1, retainedLosses: 0 },
      response: { approve: 1, reject: 0, unresolved: 0 },
      approved: 1,
      development: { total: 1, bugBearing: 1, reviewedComparison: 0 },
      selection: { total: 0, bugBearing: 0, reviewedComparison: 0 },
    },
    cases: [one],
    result: "insufficient-corpus" as const,
    deficits: [
      "exactly 36 approved cases required (received 1)",
      "development requires 12 cases (received 1)",
      "development requires 8 bug-bearing cases (received 1)",
      "development requires 4 reviewed-comparison cases (received 0)",
      "selection requires 24 cases (received 0)",
      "selection requires 16 bug-bearing cases (received 0)",
      "selection requires 8 reviewed-comparison cases (received 0)",
    ],
    recordedAt: "2026-09-07T16:00:00.000Z",
  };
  return { ...body, artifactSha256: canonicalJsonSha256(body) };
}

test("parses a self-authenticating attestation and derives domain-separated family IDs", () => {
  const value = attestation();
  assert.deepEqual(parseR2PartitionAttestation(value), value);
  const { selfSha256: _selfSha256, ...body } = value;
  assert.deepEqual(buildR2PartitionAttestation(body), value);
  assert.notEqual(duplicateFamilySha256("family-alpha"), digest("family-alpha"));
  assert.throws(() => duplicateFamilySha256("../unsafe"), /safe portable/);
  const reordered = {
    ...value,
    approvedDossiers: [...value.approvedDossiers].reverse(),
  };
  assert.doesNotThrow(() => parseR2PartitionAttestation(reordered));
  assert.throws(() => parseR2PartitionAttestation({ ...value, selfSha256: "f".repeat(64) }), /self digest/);
});

test("reads only direct non-symlink attestation JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "r2-attestation-"));
  try {
    const path = join(root, "partition-attestation.json");
    writeFileSync(path, `${JSON.stringify(attestation(), null, 2)}\n`);
    const read = readR2PartitionAttestation(path);
    assert.equal(read.attestation.selfSha256, attestation().selfSha256);
    assert.equal(read.fileSha256, digest(readFileSync(path).toString()));
    const link = join(root, "attestation-link.json");
    symlinkSync(path, link);
    assert.throws(() => readR2PartitionAttestation(link), /non-symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deeply validates counts, deficits, order, family binding, claims, and digest", () => {
  const value = artifact();
  assert.deepEqual(parseR2PartitionArtifact(value), value);
  const mutations: Array<[string, (input: R2PartitionArtifact) => void, RegExp]> = [
    [
      "nested count",
      (input) => {
        input.counts.development.total = 99;
      },
      /counts are inconsistent/,
    ],
    [
      "response count binding",
      (input) => {
        input.counts.response.reject = 1;
      },
      /response counts do not cover/,
    ],
    [
      "chronology",
      (input) => {
        input.responseCompletedAt = "2026-09-07T15:30:00.000Z";
      },
      /chronology/,
    ],
    [
      "result",
      (input) => {
        input.result = "admitted";
      },
      /result or deficits/,
    ],
    [
      "family digest",
      (input) => {
        input.cases[0]!.duplicateFamilySha256 = hash;
      },
      /does not match duplicateFamilyId/,
    ],
    [
      "claim",
      (input) => {
        (input.claims as unknown as Record<string, unknown>).protectedSelectionEstablished = true;
      },
      /claims are invalid/,
    ],
    [
      "unknown nested key",
      (input) => {
        (input.cases[0] as unknown as Record<string, unknown>).extra = true;
      },
      /invalid shape/,
    ],
  ];
  for (const [, mutate, error] of mutations) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => parseR2PartitionArtifact(changed), error);
  }
  const duplicateFamily = structuredClone(value);
  const second = {
    ...duplicateFamily.cases[0]!,
    caseName: "validation/case-beta",
    reviewDossierId: "case-beta",
    corpus: "validation" as const,
    partition: "selection" as const,
  };
  duplicateFamily.cases.push(second);
  assert.throws(() => parseR2PartitionArtifact(duplicateFamily), /family spans partitions|counts/);
});

interface PartitionFixture {
  root: string;
  packetDirectory: string;
  responseDirectory: string;
  attestationFile: string;
  storageRoot: string;
  policy: SoleHumanHistoricalCuratorPolicy;
  caseDirectories: string[];
  cleanup: () => void;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function historicalCase(root: string, index: number, corpus: "development" | "validation", identity: string, dossierId: string, packetSha256: string, responseSha256: string, responseDecisionSha256: string): string {
  const caseId = `case-${index.toString(16).padStart(8, "0")}`;
  const directory = join(root, corpus, caseId);
  mkdirSync(directory, { recursive: true });
  const diff = `diff --git a/src/file-${index}.ts b/src/file-${index}.ts\n+retry();\n`;
  const proof = `Historical proof for ${caseId}.\n`;
  const knownRoot = index % 3 !== 0;
  const truthValue = {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status: knownRoot ? "known-roots" : "reviewed-comparison",
      completeness: "partial",
      reviewedScope: `Review scope for ${caseId}.`,
      permittedMetrics: historicalPermittedMetrics(knownRoot ? "known-roots" : "reviewed-comparison"),
    },
    bugs: knownRoot ? [{
      id: `bug-${index.toString(16).padStart(8, "0")}`,
      lane: "other-unclassified",
      mechanismFamily: "callback-loss",
      proofLevel: "complete-static-trace",
      expectedDisposition: "fix-in-pr",
      expectedSeverity: "high",
      file: `src/file-${index}.ts`,
      startLine: 1,
      endLine: 2,
      description: "The retry path loses completion.",
      reachablePreconditions: "A request retries.",
      observableImpact: "The request remains pending.",
      provenance: "Historical source review.",
    }] : [],
  };
  const truth = parseHistoricalGroundTruth(truthValue);
  const spec: HistoricalCaseSpec = {
    id: caseId,
    corpus,
    kind: "historical",
    evaluationProtocol: "historical-efficacy-v1",
    repoSource: `/curator/repository-${identity}`,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    diffFile: "diff.patch",
    metadataFile: "metadata.json",
  };
  const curation = {
    schemaVersion: 3,
    protocol: "historical-efficacy-v1",
    caseId,
    status: "admitted",
    curatorPolicyId: "sole-human-historical-v1",
    reviewMode: "sole-human-v1",
    reviewDossierId: dossierId,
    truth: { truthVersion: truth.scope.truthVersion, status: truth.scope.status, completeness: "partial", scopeSha256: historicalTruthScopeSha256(truth) },
    source: { kind: "historical", repositoryAlias: `repository-${identity}`, repositoryIdentitySha256: digest(identity), changeIdentitySha256: digest(diff), access: "public" },
    strata: { languageFamily: "typescript", architectureFamily: "library", size: "small", changeShapes: ["seam"], secondarySurfaceLanes: [], mechanismFamilies: knownRoot ? ["callback-loss"] : [] },
    proof: { kind: knownRoot ? "reasoned-analysis" : "reviewed-comparison-analysis", artifact: "proof.md", sha256: digest(proof) },
    preparationEvidence: [],
    humanDecision: {
      decision: "approve",
      humanReviewerIdentitySha256: "c".repeat(64),
      reviewedAt: "2026-09-07T15:00:00.000Z",
      packetSha256,
      dossierBundleSha256: hash,
      responseSha256,
      responseDecisionSha256,
      caseBundleSha256: hash,
      truthScopeSha256: historicalTruthScopeSha256(truth),
      checks: [],
    },
  };
  writeJson(join(directory, "case.json"), spec);
  writeJson(join(directory, "ground_truth.json"), truthValue);
  writeFileSync(join(directory, "diff.patch"), diff);
  writeFileSync(join(directory, "proof.md"), proof);
  writeJson(join(directory, "metadata.json"), { title: `Historical case ${index}`, body: "Review this change and report supported defects." });
  // The admitted curation is completed after response verification, because its case bundle is source-derived.
  writeJson(join(directory, "curation.json"), { ...curation, status: "draft", humanDecision: null });
  return directory;
}

function makePartitionFixture(options: { overConcentratedRepository?: boolean } = {}): PartitionFixture {
  const root = mkdtempSync(join(tmpdir(), "r2-partition-integration-"));
  const packetSources = join(root, "packet-sources");
  const caseRoot = join(root, "cases");
  const packetDirectory = join(root, "packet");
  const responseDirectory = join(root, "response");
  const attestationFile = join(root, "partition-attestation.json");
  const storageRoot = join(root, "storage");
  mkdirSync(packetSources, { recursive: true });
  mkdirSync(caseRoot, { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  const humanIdentity = "c".repeat(64);
  const policy: SoleHumanHistoricalCuratorPolicy = { schemaVersion: 2, policyId: "sole-human-historical-v1", trustRoot: "accountable-human-review", reviewMode: "sole-human-v1", minimumHumanDecisions: 1, registeredHumanIdentitySha256: humanIdentity, aiPreparationCanSatisfyHumanGate: false };
  const dossiers: HumanPacketAssemblyRequest["dossiers"] = [];
  const caseDirectories: string[] = [];
  for (let index = 1; index <= 36; index += 1) {
    const dossierId = `dossier-${index.toString().padStart(2, "0")}`;
    const source = join(packetSources, dossierId);
    mkdirSync(source, { recursive: true });
    const manifest = Buffer.from(`manifest-${index}\n`);
    const card = Buffer.from(`# Review ${index}\n\nAuthenticated dossier card.\n`);
    writeFileSync(join(source, "dossier.json"), manifest);
    writeFileSync(join(source, "human-evidence-card.md"), card);
    dossiers.push({ dossierId, sourceRoot: source, classification: "ready-for-human-review", manifest: { path: "dossier.json", sha256: digest(manifest.toString()) }, cardPath: "human-evidence-card.md", files: [{ path: "human-evidence-card.md", sha256: digest(card.toString()) }] });
    const corpus = index <= 12 ? "development" : "validation";
    const identity = options.overConcentratedRepository
      ? (index <= 10 ? "repo-1" : `repo-${((index - 11) % 3) + 2}`)
      : `repo-${((index - 1) % 4) + 1}`;
    caseDirectories.push(historicalCase(caseRoot, index, corpus, identity, dossierId, hash, "b".repeat(64), "d".repeat(64)));
  }
  assembleHumanReviewPacket({ schemaVersion: 1, packetId: "r2-integration-packet", dossiers }, packetDirectory);
  mkdirSync(join(responseDirectory, "decisions"), { recursive: true });
  const packetManifest = JSON.parse(readFileSync(join(packetDirectory, "packet-manifest.json"), "utf8")) as { packetSha256: string };
  for (let index = 1; index <= 36; index += 1) {
    const dossierId = `dossier-${index.toString().padStart(2, "0")}`;
    const template = JSON.parse(readFileSync(join(packetDirectory, `decisions/${dossierId}.json`), "utf8")) as Record<string, unknown>;
    writeJson(join(responseDirectory, `decisions/${dossierId}.json`), { ...template, templateOnly: false, decision: "approve", reason: "Reviewed the authenticated dossier.", correction: null, acknowledgedDossierBundleSha256: template.dossierBundleSha256, humanReviewerIdentitySha256: humanIdentity, reviewedAt: "2026-09-07T15:00:00.000Z" });
  }
  const packetDecision = JSON.parse(readFileSync(join(packetDirectory, "packet-decision.json"), "utf8")) as Record<string, unknown>;
  writeJson(join(responseDirectory, "packet-decision.json"), { ...packetDecision, templateOnly: false, acknowledgedPacketSha256: packetManifest.packetSha256, humanReviewerIdentitySha256: humanIdentity, soleHumanReviewerAcknowledged: true, reviewedEveryDecisionCard: true, decisionsBindPacketAndDossierHashes: true, duplicateFamiliesAccepted: true, limitationsAccepted: true, independentTwoHumanConfirmationClaimed: false, completedAt: "2026-09-07T16:00:00.000Z" });
  const response = verifyHumanReviewResponse(packetDirectory, responseDirectory, humanIdentity);
  for (let index = 0; index < caseDirectories.length; index += 1) {
    const caseDirectory = caseDirectories[index]!;
    const spec = JSON.parse(readFileSync(join(caseDirectory, "case.json"), "utf8")) as HistoricalCaseSpec;
    const admitted = buildSoleHumanAdmissionFromResponse({ caseDirectory, caseSpec: spec, trustedPolicy: policy, packetDirectory, responseDirectory });
    assert.equal(admitted.status, "admitted");
    if (admitted.status !== "admitted") throw new Error("fixture admission unexpectedly failed");
    writeFileSync(join(caseDirectory, "curation.json"), admitted.curationBytes);
  }
  const approvedDossiers = caseDirectories.map((caseDirectory, index) => ({ dossierId: `dossier-${(index + 1).toString().padStart(2, "0")}`, partition: index < 12 ? "development" as const : "selection" as const, caseClass: ((index + 1) % 3 === 0 ? "reviewed-comparison" : "bug-bearing") as "bug-bearing" | "reviewed-comparison", duplicateFamilyId: `${index < 12 ? "development" : "selection"}-family-${Math.floor(index / 2)}` })).sort((a, b) => a.dossierId.localeCompare(b.dossierId));
  const attestationBody = { schemaVersion: 1 as const, protocol: "r2-partition-attestation-v1" as const, packetSha256: packetManifest.packetSha256, responseSha256: response.responseSha256, humanReviewerIdentitySha256: humanIdentity, approvedDossiers, soleHumanPartitionAccepted: true as const, independentSelectionClaimed: false as const, reviewedAt: "2026-09-07T16:30:00.000Z" };
  writeJson(attestationFile, buildR2PartitionAttestation(attestationBody));
  return { root, packetDirectory, responseDirectory, attestationFile, storageRoot, policy, caseDirectories, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function inputFor(fixture: PartitionFixture, expectedPreviousArtifactSha256: string | null, recordedAt = "2026-09-07T17:00:00.000Z"): R2PartitionInput {
  return { packetDirectory: fixture.packetDirectory, responseDirectory: fixture.responseDirectory, partitionAttestationFile: fixture.attestationFile, trustedPolicy: fixture.policy, expectedHumanIdentitySha256: fixture.policy.registeredHumanIdentitySha256, cases: fixture.caseDirectories, recordedAt, expectedPreviousArtifactSha256 };
}

test("builds and stores an authenticated 36-case 8/4 plus 16/8 partition", () => {
  const fixture = makePartitionFixture();
  try {
    const first = buildR2PartitionArtifact(inputFor(fixture, null));
    assert.equal(first.result, "admitted");
    assert.deepEqual(first.deficits, []);
    assert.deepEqual(first.counts.development, { total: 12, bugBearing: 8, reviewedComparison: 4 });
    assert.deepEqual(first.counts.selection, { total: 24, bugBearing: 16, reviewedComparison: 8 });
    const identityCounts = new Map<string, number>();
    for (const item of first.cases) identityCounts.set(item.repositoryIdentitySha256, (identityCounts.get(item.repositoryIdentitySha256) ?? 0) + 1);
    assert.equal(Math.max(...identityCounts.values()), 9);
    const samePartitionFamilies = new Map<string, string>();
    for (const item of first.cases) { const prior = samePartitionFamilies.get(item.duplicateFamilySha256); if (prior) assert.equal(prior, item.partition); samePartitionFamilies.set(item.duplicateFamilySha256, item.partition); }
    const written = writeR2PartitionArtifact(fixture.storageRoot, inputFor(fixture, null));
    assert.equal(written.artifactSha256, first.artifactSha256);
    const second = writeR2PartitionArtifact(fixture.storageRoot, inputFor(fixture, written.artifactSha256, "2026-09-07T18:00:00.000Z"));
    assert.equal(second.version, 2);
    assert.equal(readR2PartitionArtifact(fixture.storageRoot, written.artifactSha256).artifactSha256, written.artifactSha256);
    assert.equal(readR2PartitionArtifact(fixture.storageRoot, second.artifactSha256).artifactSha256, second.artifactSha256);
    assert.throws(() => writeR2PartitionArtifact(fixture.storageRoot, inputFor(fixture, null, "2026-09-07T19:00:00.000Z")), /predecessor/);
  } finally { fixture.cleanup(); }
});

test("marks a repository family above nine of 36 cases as insufficient", () => {
  const fixture = makePartitionFixture({ overConcentratedRepository: true });
  try {
    const result = buildR2PartitionArtifact(inputFor(fixture, null));
    assert.equal(result.result, "insufficient-corpus");
    assert.ok(result.deficits.some((deficit) => /exceeds 25%.*10 cases; maximum 9/.test(deficit)));
  } finally {
    fixture.cleanup();
  }
});

test("seals an honest insufficient result when approvals are absent", () => {
  const fixture = makePartitionFixture();
  try {
    const rejectId = "dossier-01";
    const unresolvedId = "dossier-02";
    for (const [dossierId, decision] of [[rejectId, "reject"], [unresolvedId, "unresolved"]] as const) {
      const path = join(fixture.responseDirectory, `decisions/${dossierId}.json`);
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      value.decision = decision;
      value.reason = `Human marked this dossier ${decision}.`;
      writeJson(path, value);
    }
    const response = verifyHumanReviewResponse(fixture.packetDirectory, fixture.responseDirectory, fixture.policy.registeredHumanIdentitySha256);
    for (const [index, caseDirectory] of fixture.caseDirectories.entries()) {
      const curationPath = join(caseDirectory, "curation.json");
      const curation = JSON.parse(readFileSync(curationPath, "utf8")) as Record<string, unknown>;
      writeJson(curationPath, { ...curation, status: "draft", humanDecision: null });
      if (index < 2) continue;
      const spec = JSON.parse(readFileSync(join(caseDirectory, "case.json"), "utf8")) as HistoricalCaseSpec;
      const admission = buildSoleHumanAdmissionFromResponse({ caseDirectory, caseSpec: spec, trustedPolicy: fixture.policy, packetDirectory: fixture.packetDirectory, responseDirectory: fixture.responseDirectory });
      assert.equal(admission.status, "admitted");
      if (admission.status === "admitted") writeFileSync(curationPath, admission.curationBytes);
    }
    const packet = JSON.parse(readFileSync(join(fixture.packetDirectory, "packet-manifest.json"), "utf8")) as { packetSha256: string };
    const approvedDossiers = fixture.caseDirectories.slice(2).map((_, index) => ({ dossierId: `dossier-${(index + 3).toString().padStart(2, "0")}`, partition: index + 3 <= 12 ? "development" as const : "selection" as const, caseClass: ((index + 3) % 3 === 0 ? "reviewed-comparison" : "bug-bearing") as "bug-bearing" | "reviewed-comparison", duplicateFamilyId: `${index + 3 <= 12 ? "development" : "selection"}-family-${Math.floor((index + 2) / 2)}` })).sort((a, b) => a.dossierId.localeCompare(b.dossierId));
    const body = { schemaVersion: 1 as const, protocol: "r2-partition-attestation-v1" as const, packetSha256: packet.packetSha256, responseSha256: response.responseSha256, humanReviewerIdentitySha256: fixture.policy.registeredHumanIdentitySha256, approvedDossiers, soleHumanPartitionAccepted: true as const, independentSelectionClaimed: false as const, reviewedAt: "2026-09-07T16:30:00.000Z" };
    writeJson(fixture.attestationFile, buildR2PartitionAttestation(body));
    const result = buildR2PartitionArtifact({ ...inputFor(fixture, null), cases: fixture.caseDirectories.slice(2) });
    assert.equal(result.result, "insufficient-corpus");
    assert.equal(result.counts.approved, 34);
    assert.equal(result.counts.response.reject, 1);
    assert.equal(result.counts.response.unresolved, 1);
    assert.ok(result.deficits.some((deficit) => deficit.includes("exactly 36 approved cases")));
  } finally { fixture.cleanup(); }
});

test("rejects stale sources, wrong identity, and storage tampering", () => {
  const fixture = makePartitionFixture();
  try {
    const validInput = inputFor(fixture, null);
    const packetIndex = join(fixture.packetDirectory, "review-index.md");
    const packetBytes = readFileSync(packetIndex);
    writeFileSync(packetIndex, "stale packet\n");
    assert.throws(() => buildR2PartitionArtifact(validInput), /packet|manifest|closure|generated file/i);
    writeFileSync(packetIndex, packetBytes);
    const responsePath = join(fixture.responseDirectory, "decisions/dossier-01.json");
    const responseBytes = readFileSync(responsePath);
    const responseValue = JSON.parse(responseBytes.toString()) as Record<string, unknown>;
    responseValue.reason = "stale response";
    writeJson(responsePath, responseValue);
    assert.throws(() => buildR2PartitionArtifact(validInput), /attestation|response|stale/i);
    writeFileSync(responsePath, responseBytes);
    const diffPath = join(fixture.caseDirectories[0]!, "diff.patch");
    const diffBytes = readFileSync(diffPath);
    writeFileSync(diffPath, "stale case\n");
    assert.throws(() => buildR2PartitionArtifact(validInput), /change identity|stale|diff/i);
    writeFileSync(diffPath, diffBytes);
    const staleAttestation = JSON.parse(readFileSync(fixture.attestationFile, "utf8")) as Record<string, unknown>;
    staleAttestation.packetSha256 = "f".repeat(64);
    const staleBody = { ...staleAttestation };
    delete staleBody.selfSha256;
    staleAttestation.selfSha256 = canonicalJsonSha256(staleBody);
    writeJson(fixture.attestationFile, staleAttestation);
    assert.throws(() => buildR2PartitionArtifact(validInput), /attestation|stale/i);
    fixture.cleanup();
  } finally { if (existsSync(fixture.root)) fixture.cleanup(); }

  const wrongIdentity = makePartitionFixture();
  try { assert.throws(() => buildR2PartitionArtifact({ ...inputFor(wrongIdentity, null), expectedHumanIdentitySha256: "d".repeat(64) }), /registered sole-human/); } finally { wrongIdentity.cleanup(); }

  const storage = makePartitionFixture();
  try {
    const first = writeR2PartitionArtifact(storage.storageRoot, inputFor(storage, null));
    const directory = join(storage.storageRoot, "r2-partitions");
    writeFileSync(join(directory, "extra.txt"), "extra\n");
    assert.throws(() => readR2PartitionArtifact(storage.storageRoot, first.artifactSha256), /extra|mixed/);
    unlinkSync(join(directory, "extra.txt"));
    symlinkSync(join(directory, "r2-partition-000001.json"), join(directory, "r2-partition-000002.json"));
    assert.throws(() => readR2PartitionArtifact(storage.storageRoot, first.artifactSha256), /symlink|mixed/);
    unlinkSync(join(directory, "r2-partition-000002.json"));
    writeFileSync(join(directory, "partition-000001.json"), "{}\n");
    assert.throws(() => readR2PartitionArtifact(storage.storageRoot, first.artifactSha256), /extra|mixed/);
    unlinkSync(join(directory, "partition-000001.json"));
    renameSync(join(directory, "r2-partition-000001.json"), join(directory, "r2-partition-000003.json"));
    assert.throws(() => readR2PartitionArtifact(storage.storageRoot, first.artifactSha256), /contiguous|canonical/);
    renameSync(join(directory, "r2-partition-000003.json"), join(directory, "r2-partition-000001.json"));
    writeFileSync(join(storage.storageRoot, ".r2-partition.lock"), "held\n");
    assert.throws(() => writeR2PartitionArtifact(storage.storageRoot, inputFor(storage, first.artifactSha256, "2026-09-07T18:00:00.000Z")), /already being written/);
    unlinkSync(join(storage.storageRoot, ".r2-partition.lock"));
  } finally { storage.cleanup(); }
});

test("derives and append-only stores operator truth and severity from the exact R2 partition", () => {
  const fixture = makePartitionFixture();
  try {
    const partition = writeR2PartitionArtifact(fixture.storageRoot, inputFor(fixture, null));
    const first = writeR2TruthBindingArtifact(fixture.storageRoot, {
      partitionStorageRoot: fixture.storageRoot,
      expectedPartitionArtifactSha256: partition.artifactSha256,
      trustedPolicy: fixture.policy,
      caseDirectories: fixture.caseDirectories,
      recordedAt: "2026-09-07T18:00:00.000Z",
      expectedPreviousBindingSha256: null,
    });
    assert.deepEqual(first.claims, {
      operatorOnly: true,
      reviewerVisible: false,
      truthDerived: true,
      independentVerificationClaimed: false,
    });
    assert.deepEqual(first.counts, {
      cases: 36,
      bugBearing: 24,
      reviewedComparison: 12,
      registeredRoots: 24,
      highSeverityRoots: 24,
    });
    assert.equal(first.cases.find((item) => item.caseClass === "reviewed-comparison")?.roots.length, 0);
    assert.match(first.cases.find((item) => item.caseClass === "bug-bearing")?.roots[0]?.rootCause ?? "", /^\["bug","bug-/);
    assert.deepEqual(parseR2TruthBindingArtifact(first), first);
    assert.equal(readR2TruthBindingArtifact(fixture.storageRoot, first.bindingSha256).bindingSha256, first.bindingSha256);

    const second = writeR2TruthBindingArtifact(fixture.storageRoot, {
      partitionStorageRoot: fixture.storageRoot,
      expectedPartitionArtifactSha256: partition.artifactSha256,
      trustedPolicy: fixture.policy,
      caseDirectories: fixture.caseDirectories,
      recordedAt: "2026-09-07T19:00:00.000Z",
      expectedPreviousBindingSha256: first.bindingSha256,
    });
    assert.equal(second.version, 2);
    assert.equal(second.previousBindingSha256, first.bindingSha256);
    assert.throws(() => writeR2TruthBindingArtifact(fixture.storageRoot, {
      partitionStorageRoot: fixture.storageRoot,
      expectedPartitionArtifactSha256: partition.artifactSha256,
      trustedPolicy: fixture.policy,
      caseDirectories: fixture.caseDirectories,
      recordedAt: "2026-09-07T20:00:00.000Z",
      expectedPreviousBindingSha256: first.bindingSha256,
    }), /predecessor/);
  } finally { fixture.cleanup(); }
});

test("truth binding rejects source drift, partial coverage, and forged derived fields", () => {
  const fixture = makePartitionFixture();
  try {
    const partition = writeR2PartitionArtifact(fixture.storageRoot, inputFor(fixture, null));
    const base = {
      partitionStorageRoot: fixture.storageRoot,
      expectedPartitionArtifactSha256: partition.artifactSha256,
      trustedPolicy: fixture.policy,
      caseDirectories: fixture.caseDirectories,
      recordedAt: "2026-09-07T18:00:00.000Z",
      expectedPreviousBindingSha256: null,
    };
    assert.throws(() => writeR2TruthBindingArtifact(fixture.storageRoot, { ...base, caseDirectories: fixture.caseDirectories.slice(1) }), /exact partition/);

    const truthPath = join(fixture.caseDirectories[0]!, "ground_truth.json");
    const truthBytes = readFileSync(truthPath);
    const truth = JSON.parse(truthBytes.toString()) as { bugs: Array<{ expectedSeverity: string }> };
    truth.bugs[0]!.expectedSeverity = "low";
    writeJson(truthPath, truth);
    assert.throws(() => writeR2TruthBindingArtifact(fixture.storageRoot, base), /bundle|decision|stale|truth/i);
    writeFileSync(truthPath, truthBytes);

    const valid = writeR2TruthBindingArtifact(fixture.storageRoot, base);
    const forged = structuredClone(valid);
    forged.cases.find((item) => item.roots.length > 0)!.roots[0]!.expectedSeverity = "low";
    assert.throws(() => parseR2TruthBindingArtifact(forged), /counts|digest/);
    const leakingClaim = structuredClone(valid);
    (leakingClaim.claims as unknown as Record<string, unknown>).reviewerVisible = true;
    assert.throws(() => parseR2TruthBindingArtifact(leakingClaim), /claims/);
  } finally { fixture.cleanup(); }
});
