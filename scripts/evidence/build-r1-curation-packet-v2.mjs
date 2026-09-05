import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, inspectFrozenV1 } from "./r1-curation-v2.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");
const evidenceRoot = process.env.R1_EVIDENCE_ROOT ? resolve(process.env.R1_EVIDENCE_ROOT) : resolve(repositoryRoot, "docs/validation/artifacts/2026-09-04-r1-historical-reconstructions");
const versionRelative = "curation/versions/r1-case-evidence-v2";
const versionRoot = resolve(evidenceRoot, versionRelative);
const carriedIds = ["r1-vscode-73801", "r1-karma-2714", "r1-webpack-8233"];
const correctedSources = {
  "r1-typescript-37467": ["typescript-pr-37467.json", "typescript-pr-37467-comments.json", "typescript-pr-37467-reviews.json", "typescript-issue-38507.json", "typescript-pr-38599.json"],
  "r1-karma-2846": ["karma-pr-2846.json", "karma-pr-2846-comments.json", "karma-pr-2846-reviews.json"],
};

const relativeFile = (path) => {
  const fullPath = resolve(evidenceRoot, path);
  const stat = lstatSync(fullPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe evidence file: ${path}`);
  const bytes = readFileSync(fullPath);
  return { path, bytes: bytes.byteLength, sha256: digest(bytes) };
};

const v1 = inspectFrozenV1(evidenceRoot);
const cases = carriedIds.map((caseId) => {
  const source = v1.cases.get(caseId);
  const result = v1.results.get(caseId);
  const confirmations = [...result.confirmations.values()].filter((value) => value === "confirm").length;
  if (confirmations < 2 || result.blockers.length) throw new Error(`${caseId} is not eligible for carry-forward`);
  return { caseId, mode: "carried-forward", evidenceVersion: v1.packet.packetVersion, evidenceBundleSha256: source.evidenceBundleSha256, files: source.files };
});

for (const [caseId, sources] of Object.entries(correctedSources)) {
  const files = [
    relativeFile(`${versionRelative}/metadata/${caseId}.json`),
    relativeFile(`${versionRelative}/cases/${caseId}.md`),
    relativeFile("raw/capture-manifest.json"),
    ...sources.map((source) => relativeFile(`raw/${source}`)),
  ].sort((left, right) => left.path.localeCompare(right.path));
  cases.push({
    caseId,
    mode: "corrected",
    evidenceVersion: "r1-case-evidence-v2",
    supersedesEvidenceBundleSha256: v1.cases.get(caseId).evidenceBundleSha256,
    evidenceBundleSha256: digest(Buffer.from(JSON.stringify({ version: "r1-case-evidence-v2", caseId, files }))),
    files,
  });
}

const packet = {
  schemaVersion: 2,
  packetVersion: "r1-case-evidence-v2",
  supersedes: { packetVersion: v1.packet.packetVersion, packetSha256: v1.packet.packetSha256 },
  governanceFiles: [
    relativeFile(`${versionRelative}/confirmation.schema.json`),
    relativeFile(`${versionRelative}/review-protocol.md`),
    relativeFile(`${versionRelative}/reviews/README.md`),
  ].sort((left, right) => left.path.localeCompare(right.path)),
  sourceCapturedAt: v1.packet.sourceCapturedAt,
  cases,
};
packet.packetSha256 = digest(Buffer.from(JSON.stringify({ version: packet.packetVersion, supersedes: packet.supersedes, governanceFiles: packet.governanceFiles, sourceCapturedAt: packet.sourceCapturedAt, cases: packet.cases })));

const packetPath = resolve(versionRoot, "packet-manifest.json");
const encoded = `${JSON.stringify(packet, null, 2)}\n`;
if (existsSync(packetPath)) {
  if (!readFileSync(packetPath).equals(Buffer.from(encoded))) throw new Error("refusing to overwrite drifted frozen v2 curator packet");
} else {
  writeFileSync(packetPath, encoded);
}
console.log(`Bound ${cases.length} cases in mixed curator packet ${packet.packetSha256}`);
