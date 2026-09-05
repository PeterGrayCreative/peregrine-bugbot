import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = process.cwd();
const sourceEvidence = resolve(repositoryRoot, "docs/validation/artifacts/2026-09-04-r1-historical-reconstructions");
const validator = resolve(repositoryRoot, "scripts/evidence/validate-r1-curation.mjs");
const v1Builder = resolve(repositoryRoot, "scripts/evidence/build-r1-curation-packet.mjs");
const v3Builder = resolve(repositoryRoot, "scripts/evidence/build-r1-curation-packet-v3.mjs");
const declaration = "I independently inspected the authenticated sources and exact historical diff before accepting or rejecting the primary trace.";
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function copyEvidence(): { root: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "peregrine-r1-v2-"));
  const root = join(parent, "evidence");
  cpSync(sourceEvidence, root, { recursive: true });
  const v3ReviewRoot = join(root, "curation/versions/r1-case-evidence-v3/reviews");
  for (const curator of ["curator-alpha", "curator-beta"]) rmSync(join(v3ReviewRoot, curator), { recursive: true, force: true });
  return { root, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

function run(script: string, root: string, args: string[] = []): string {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, R1_EVIDENCE_ROOT: root },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}` || `process exited ${result.status}`);
  return result.stdout;
}

function confirmation(packet: { packetVersion: string; packetSha256: string }, caseId: string, bundle: string, member: { identityRef: string; identitySha256: string }) {
  return {
    schemaVersion: 3,
    packetVersion: packet.packetVersion,
    packetSha256: packet.packetSha256,
    caseId,
    evidenceBundleSha256: bundle,
    curatorIdentityRef: member.identityRef,
    curatorIdentitySha256: member.identitySha256,
    reviewedAt: "2026-09-05T04:00:00Z",
    independenceDeclaration: declaration,
    disposition: "confirm",
    checks: {
      sourceAuthenticity: true, exactHistoricalHead: true, provenance: true, causalTrace: true,
      reachability: true, consequence: true, repairBoundary: true, truthScope: true,
      license: true, limitations: true,
    },
    evidenceNotes: [{ source: "deterministic-test", observation: "Synthetic confirmation used only to exercise the zero-provider integrity gate." }],
    exceptions: [],
  };
}

test("R1 preserves failed v1 and ready v2 while v3 without fresh confirmations is not-ready", () => {
  const { root, cleanup } = copyEvidence();
  try {
    assert.equal(existsSync(join(root, "curation/versions/r1-case-evidence-v2/reviews/curator-alpha/r1-typescript-37467.json")), true);
    const v1 = JSON.parse(readFileSync(join(root, "curation/packet-manifest.json"), "utf8"));
    const v2 = JSON.parse(readFileSync(join(root, "curation/versions/r1-case-evidence-v2/packet-manifest.json"), "utf8"));
    for (const caseId of ["r1-vscode-73801", "r1-karma-2714", "r1-webpack-8233"]) {
      const before = v1.cases.find((item: { caseId: string }) => item.caseId === caseId);
      const after = v2.cases.find((item: { caseId: string }) => item.caseId === caseId);
      assert.equal(after.mode, "carried-forward");
      assert.equal(after.evidenceBundleSha256, before.evidenceBundleSha256);
      assert.deepEqual(after.files, before.files);
    }
    const output = run(validator, root);
    assert.match(output, /R1 v1 curator readiness: failed/);
    assert.match(output, /R1 v2 curator readiness: ready/);
    assert.match(output, /R1 v3 curator readiness: not-ready/);
    assert.throws(() => run(validator, root, ["--require-complete"]));
  } finally {
    cleanup();
  }
});

test("R1 v3 requires rostered confirmations bound to packet and case", () => {
  const { root, cleanup } = copyEvidence();
  try {
    const versionRoot = join(root, "curation/versions/r1-case-evidence-v3");
    const packet = JSON.parse(readFileSync(join(versionRoot, "packet-manifest.json"), "utf8"));
    for (const member of packet.curatorRoster) {
      const directory = join(versionRoot, "reviews", member.directorySlug);
      mkdirSync(directory);
      for (const caseId of ["r1-vscode-73801", "r1-typescript-37467", "r1-karma-2846", "r1-karma-2714", "r1-webpack-8233"]) {
        const entry = packet.cases.find((item: { caseId: string }) => item.caseId === caseId);
        writeFileSync(join(directory, `${caseId}.json`), `${JSON.stringify(confirmation(packet, caseId, entry.evidenceBundleSha256, member), null, 2)}\n`);
      }
    }
    assert.match(run(validator, root, ["--require-complete"]), /R1 v3 curator readiness: ready/);

    const crossCasePath = join(versionRoot, "reviews/curator-alpha/r1-typescript-37467.json");
    const original = readFileSync(crossCasePath, "utf8");
    const crossPacket = JSON.parse(original);
    crossPacket.packetVersion = "r1-case-evidence-v2";
    writeFileSync(crossCasePath, `${JSON.stringify(crossPacket, null, 2)}\n`);
    assert.throws(() => run(validator, root), /stale or cross-version/);

    const crossCase = JSON.parse(original);
    crossCase.evidenceBundleSha256 = packet.cases.find((item: { caseId: string }) => item.caseId === "r1-karma-2846").evidenceBundleSha256;
    writeFileSync(crossCasePath, `${JSON.stringify(crossCase, null, 2)}\n`);
    assert.throws(() => run(validator, root), /stale or cross-case/);
    writeFileSync(crossCasePath, original);

    const outsider = join(versionRoot, "reviews/outsider");
    mkdirSync(outsider);
    writeFileSync(join(outsider, "r1-vscode-73801.json"), `${JSON.stringify(confirmation(packet, "r1-vscode-73801", packet.cases[0].evidenceBundleSha256, { identityRef: "invented", identitySha256: sha256("invented") }), null, 2)}\n`);
    assert.throws(() => run(validator, root), /unrostered v3 curator directory/);
    rmSync(outsider, { recursive: true });

    const betaPath = join(versionRoot, "reviews/curator-beta/r1-vscode-73801.json");
    const originalBeta = readFileSync(betaPath, "utf8");
    const duplicate = JSON.parse(originalBeta);
    duplicate.curatorIdentityRef = packet.curatorRoster[0].identityRef;
    duplicate.curatorIdentitySha256 = packet.curatorRoster[0].identitySha256;
    writeFileSync(betaPath, `${JSON.stringify(duplicate, null, 2)}\n`);
    assert.throws(() => run(validator, root), /identity does not match the packet roster/);
    writeFileSync(betaPath, originalBeta);

    const alphaPath = join(versionRoot, "reviews/curator-alpha/r1-vscode-73801.json");
    rmSync(alphaPath);
    symlinkSync(betaPath, alphaPath);
    assert.throws(() => run(validator, root), /unsafe v3 curator artifact/);
  } finally {
    cleanup();
  }
});

test("R1 v3 rejects evidence and governance drift and v1 refuses frozen packet drift", () => {
  const { root, cleanup } = copyEvidence();
  try {
    const diff = join(root, "curation/versions/r1-case-evidence-v3/diffs/r1-vscode-73801.diff");
    const originalDiff = readFileSync(diff);
    writeFileSync(diff, Buffer.concat([originalDiff, Buffer.from(" ")]));
    assert.throws(() => run(validator, root), /evidence file does not match packet/);
    writeFileSync(diff, originalDiff);

    const metadata = join(root, "curation/versions/r1-case-evidence-v3/metadata/r1-karma-2846.json");
    const originalMetadata = readFileSync(metadata, "utf8");
    writeFileSync(metadata, `${originalMetadata} `);
    assert.throws(() => run(validator, root), /evidence file does not match packet/);
    writeFileSync(metadata, originalMetadata);

    const protocol = join(root, "curation/versions/r1-case-evidence-v3/review-protocol.md");
    writeFileSync(protocol, `${readFileSync(protocol, "utf8")} `);
    assert.throws(() => run(validator, root), /v3 governance file does not match packet/);

    const v3Packet = join(root, "curation/versions/r1-case-evidence-v3/packet-manifest.json");
    writeFileSync(v3Packet, `${readFileSync(v3Packet, "utf8")} `);
    assert.throws(() => run(v3Builder, root), /refusing to overwrite drifted frozen v3 curator packet/);

    const v1Packet = join(root, "curation/packet-manifest.json");
    writeFileSync(v1Packet, `${readFileSync(v1Packet, "utf8")} `);
    assert.throws(() => run(v1Builder, root), /refusing to overwrite drifted frozen v1 curator packet/);
  } finally {
    cleanup();
  }
});

test("R1 v3 rejects unknown packet fields, duplicate roster identities, and stale confirmations after governance reseal", () => {
  const makeComplete = (root: string) => {
    const versionRoot = join(root, "curation/versions/r1-case-evidence-v3");
    const packet = JSON.parse(readFileSync(join(versionRoot, "packet-manifest.json"), "utf8"));
    for (const member of packet.curatorRoster) {
      const directory = join(versionRoot, "reviews", member.directorySlug);
      mkdirSync(directory);
      for (const entry of packet.cases) writeFileSync(join(directory, `${entry.caseId}.json`), `${JSON.stringify(confirmation(packet, entry.caseId, entry.evidenceBundleSha256, member), null, 2)}\n`);
    }
    return { versionRoot, packet };
  };

  const first = copyEvidence();
  try {
    const { versionRoot, packet } = makeComplete(first.root);
    packet.untrustedSummary = "misleading";
    writeFileSync(join(versionRoot, "packet-manifest.json"), `${JSON.stringify(packet, null, 2)}\n`);
    assert.throws(() => run(validator, first.root), /v3 packet has missing or unknown fields/);
  } finally {
    first.cleanup();
  }

  const second = copyEvidence();
  try {
    const { versionRoot, packet } = makeComplete(second.root);
    packet.curatorRoster[1] = { ...packet.curatorRoster[0], directorySlug: "curator-beta" };
    packet.packetSha256 = sha256(Buffer.from(JSON.stringify({ version: packet.packetVersion, supersedes: packet.supersedes, governanceFiles: packet.governanceFiles, curatorRoster: packet.curatorRoster, sourceCapturedAt: packet.sourceCapturedAt, cases: packet.cases })));
    writeFileSync(join(versionRoot, "packet-manifest.json"), `${JSON.stringify(packet, null, 2)}\n`);
    assert.throws(() => run(validator, second.root), /invalid or duplicate curator roster member/);
  } finally {
    second.cleanup();
  }

  const third = copyEvidence();
  try {
    const { versionRoot, packet } = makeComplete(third.root);
    const protocolPath = join(versionRoot, "review-protocol.md");
    const bytes = Buffer.from(`${readFileSync(protocolPath, "utf8")}\n`);
    writeFileSync(protocolPath, bytes);
    const protocol = packet.governanceFiles.find((file: { path: string }) => file.path.endsWith("review-protocol.md"));
    protocol.bytes = bytes.byteLength;
    protocol.sha256 = sha256(bytes);
    packet.packetSha256 = sha256(Buffer.from(JSON.stringify({ version: packet.packetVersion, supersedes: packet.supersedes, governanceFiles: packet.governanceFiles, curatorRoster: packet.curatorRoster, sourceCapturedAt: packet.sourceCapturedAt, cases: packet.cases })));
    writeFileSync(join(versionRoot, "packet-manifest.json"), `${JSON.stringify(packet, null, 2)}\n`);
    assert.throws(() => run(validator, third.root), /stale or cross-version/);
  } finally {
    third.cleanup();
  }
});
