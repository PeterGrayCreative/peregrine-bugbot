import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, validateR1V2 } from "./r1-curation-v2.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");
const evidenceRoot = process.env.R1_EVIDENCE_ROOT ? resolve(process.env.R1_EVIDENCE_ROOT) : resolve(repositoryRoot, "docs/validation/artifacts/2026-09-04-r1-historical-reconstructions");
const versionRelative = "curation/versions/r1-case-evidence-v3";
const versionRoot = resolve(evidenceRoot, versionRelative);
const sourceFiles = {
  "r1-vscode-73801": ["vscode-pr-73801.json", "vscode-pr-73801-comments.json", "vscode-pr-73801-reviews.json", "vscode-pr-73801-commits.json"],
  "r1-typescript-37467": ["typescript-pr-37467.json", "typescript-pr-37467-comments.json", "typescript-pr-37467-reviews.json", "typescript-issue-38507.json", "typescript-pr-38599.json"],
  "r1-karma-2846": ["karma-pr-2846.json", "karma-pr-2846-comments.json", "karma-pr-2846-reviews.json"],
  "r1-karma-2714": ["karma-pr-2714.json", "karma-pr-2714-comments.json", "karma-pr-2714-reviews.json"],
  "r1-webpack-8233": ["webpack-pr-8233.json", "webpack-pr-8233-comments.json", "webpack-pr-8233-reviews.json", "webpack-issue-8829.json", "webpack-pr-8844.json"],
};
const caseDocuments = {
  "r1-vscode-73801": "cases/r1-vscode-73801.md",
  "r1-typescript-37467": "curation/versions/r1-case-evidence-v2/cases/r1-typescript-37467.md",
  "r1-karma-2846": "curation/versions/r1-case-evidence-v2/cases/r1-karma-2846.md",
  "r1-karma-2714": "cases/r1-karma-2714.md",
  "r1-webpack-8233": "cases/r1-webpack-8233.md",
};
const roster = [
  { directorySlug: "curator-alpha", identityRef: "codex-task:/root/r1_curator_alpha", identitySha256: "a2ef45b13113d050014b9cce96a10be569e2114629ceb52ea4668fffa5607cd7" },
  { directorySlug: "curator-beta", identityRef: "codex-task:/root/r1_curator_beta", identitySha256: "d5685cd85a563032fdf19dadfd2e023a8c2b54f6153c85279b9704c1c2f5fe59" },
];

const relativeFile = (path) => {
  const fullPath = resolve(evidenceRoot, path);
  const stat = lstatSync(fullPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe evidence file: ${path}`);
  const bytes = readFileSync(fullPath);
  return { path, bytes: bytes.byteLength, sha256: digest(bytes) };
};

const v2 = validateR1V2(evidenceRoot);
if (!v2.ready) throw new Error("v3 cannot be built until authenticated v2 is ready");
const cases = Object.entries(sourceFiles).map(([caseId, sources]) => {
  const prior = v2.cases.get(caseId);
  const files = [
    relativeFile(`${versionRelative}/metadata/${caseId}.json`),
    relativeFile(`${versionRelative}/diffs/${caseId}.diff`),
    relativeFile(caseDocuments[caseId]),
    relativeFile("raw/capture-manifest.json"),
    ...sources.map((source) => relativeFile(`raw/${source}`)),
  ].sort((left, right) => left.path.localeCompare(right.path));
  return {
    caseId,
    mode: "canonicalized-diff",
    evidenceVersion: "r1-case-evidence-v3",
    supersedes: { packetVersion: v2.packet.packetVersion, evidenceVersion: prior.evidenceVersion, evidenceBundleSha256: prior.evidenceBundleSha256 },
    evidenceBundleSha256: digest(Buffer.from(JSON.stringify({ version: "r1-case-evidence-v3", caseId, files }))),
    files,
  };
});
const governanceFiles = [
  relativeFile(`${versionRelative}/confirmation.schema.json`),
  relativeFile(`${versionRelative}/review-protocol.md`),
  relativeFile(`${versionRelative}/reviews/README.md`),
].sort((left, right) => left.path.localeCompare(right.path));
const packet = {
  schemaVersion: 3,
  packetVersion: "r1-case-evidence-v3",
  supersedes: { packetVersion: v2.packet.packetVersion, packetSha256: v2.packet.packetSha256 },
  governanceFiles,
  curatorRoster: roster,
  sourceCapturedAt: v2.packet.sourceCapturedAt,
  cases,
};
packet.packetSha256 = digest(Buffer.from(JSON.stringify({ version: packet.packetVersion, supersedes: packet.supersedes, governanceFiles: packet.governanceFiles, curatorRoster: packet.curatorRoster, sourceCapturedAt: packet.sourceCapturedAt, cases: packet.cases })));

const packetPath = resolve(versionRoot, "packet-manifest.json");
const encoded = `${JSON.stringify(packet, null, 2)}\n`;
if (existsSync(packetPath)) {
  if (!readFileSync(packetPath).equals(Buffer.from(encoded))) throw new Error("refusing to overwrite drifted frozen v3 curator packet");
} else {
  writeFileSync(packetPath, encoded);
}
console.log(`Bound ${cases.length} cases in canonical-diff packet ${packet.packetSha256}`);
