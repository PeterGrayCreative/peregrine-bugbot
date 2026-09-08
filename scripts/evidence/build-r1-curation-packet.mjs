import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");
const evidenceRoot = process.env.R1_EVIDENCE_ROOT
  ? resolve(process.env.R1_EVIDENCE_ROOT)
  : resolve(repositoryRoot, "docs/validation/artifacts/2026-09-04-r1-historical-reconstructions");

const caseSources = {
  "r1-vscode-73801": [
    "vscode-pr-73801.json",
    "vscode-pr-73801-comments.json",
    "vscode-pr-73801-reviews.json",
    "vscode-pr-73801-commits.json",
  ],
  "r1-typescript-37467": [
    "typescript-pr-37467.json",
    "typescript-pr-37467-comments.json",
    "typescript-pr-37467-reviews.json",
    "typescript-issue-38507.json",
    "typescript-pr-38599.json",
  ],
  "r1-karma-2846": [
    "karma-pr-2846.json",
    "karma-pr-2846-comments.json",
    "karma-pr-2846-reviews.json",
  ],
  "r1-karma-2714": [
    "karma-pr-2714.json",
    "karma-pr-2714-comments.json",
    "karma-pr-2714-reviews.json",
  ],
  "r1-webpack-8233": [
    "webpack-pr-8233.json",
    "webpack-pr-8233-comments.json",
    "webpack-pr-8233-reviews.json",
    "webpack-issue-8829.json",
    "webpack-pr-8844.json",
  ],
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relativeFile = (path) => {
  const fullPath = resolve(evidenceRoot, path);
  const stat = lstatSync(fullPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe evidence file: ${path}`);
  const bytes = readFileSync(fullPath);
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
};

const rawManifest = JSON.parse(readFileSync(resolve(evidenceRoot, "raw/capture-manifest.json"), "utf8"));
for (const capture of rawManifest.captures) {
  const bytes = readFileSync(resolve(evidenceRoot, "raw", capture.file));
  if (bytes.byteLength !== capture.bytes || sha256(bytes) !== capture.sha256) {
    throw new Error(`raw source does not match capture manifest: ${capture.file}`);
  }
}

const cases = Object.entries(caseSources).map(([caseId, sources]) => {
  const files = [
    relativeFile("manifest.json"),
    relativeFile(`cases/${caseId}.md`),
    relativeFile("raw/capture-manifest.json"),
    ...sources.map((source) => relativeFile(`raw/${source}`)),
  ].sort((left, right) => left.path.localeCompare(right.path));
  return {
    caseId,
    evidenceBundleSha256: sha256(Buffer.from(JSON.stringify({
      version: "r1-case-evidence-v1",
      caseId,
      files,
    }))),
    files,
  };
});

const packet = {
  schemaVersion: 1,
  packetVersion: "r1-case-evidence-v1",
  sourceCapturedAt: rawManifest.capturedAt,
  cases,
};
packet.packetSha256 = sha256(Buffer.from(JSON.stringify({
  version: packet.packetVersion,
  sourceCapturedAt: packet.sourceCapturedAt,
  cases: packet.cases,
})));

const packetPath = resolve(evidenceRoot, "curation/packet-manifest.json");
const encodedPacket = `${JSON.stringify(packet, null, 2)}\n`;
if (existsSync(packetPath)) {
  if (!readFileSync(packetPath).equals(Buffer.from(encodedPacket))) {
    throw new Error("refusing to overwrite drifted frozen v1 curator packet");
  }
} else {
  writeFileSync(packetPath, encodedPacket);
}
console.log(`Bound ${cases.length} cases in curator packet ${packet.packetSha256}`);
