import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  assembleHumanReviewPacket,
  type HumanPacketAssemblyRequest,
} from "../scripts/evidence/assemble-human-review-packet.js";

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
    assert.equal(decision.humanReviewerIdentity, null);
    assert.equal(packetDecision.reviewedEveryDecisionCard, null);
    assert.equal(packetDecision.acknowledgedPacketSha256, null);
    assert.equal(packetDecision.soleHumanReviewerAcknowledged, null);
    assert.equal(packetDecision.independentTwoHumanConfirmationClaimed, null);

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

test("rejects traversal, unsafe cards, duplicate dossiers, duplicate paths, and duplicate manifests", () => {
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

    const duplicateManifest = structuredClone(paths.request);
    duplicateManifest.dossiers[1]!.sourceRoot = duplicateManifest.dossiers[0]!.sourceRoot;
    duplicateManifest.dossiers[1]!.classification = "ready-for-human-review";
    duplicateManifest.dossiers[1]!.manifest = { ...duplicateManifest.dossiers[0]!.manifest };
    duplicateManifest.dossiers[1]!.files = [{ ...duplicateManifest.dossiers[0]!.files[0]! }];
    duplicateManifest.dossiers[1]!.cardPath = "human-evidence-card.md";
    assert.throws(() => assembleHumanReviewPacket(duplicateManifest, paths.output), /duplicate dossier manifest source/);
  } finally {
    paths.cleanup();
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
