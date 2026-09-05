import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { authenticateFiles, digest, validateR1V2 } from "./r1-curation-v2.mjs";

const declaration = "I independently inspected the authenticated sources and exact historical diff before accepting or rejecting the primary trace.";
const caseIds = ["r1-vscode-73801", "r1-typescript-37467", "r1-karma-2846", "r1-karma-2714", "r1-webpack-8233"];
const checks = ["sourceAuthenticity", "exactHistoricalHead", "provenance", "causalTrace", "reachability", "consequence", "repairBoundary", "truthScope", "license", "limitations"];
const confirmationKeys = ["schemaVersion", "packetVersion", "packetSha256", "caseId", "evidenceBundleSha256", "curatorIdentityRef", "curatorIdentitySha256", "reviewedAt", "independenceDeclaration", "disposition", "checks", "evidenceNotes", "exceptions"];
const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[^\0]+$/;
const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const expected = {
  "r1-vscode-73801": { repository: "microsoft/vscode", base: "0cfb9ad1c3a4ea5983c8dbb458ed14f7581a6846", head: "b239497ecacac5e5c945791530251f1ee897b22b", baseTree: "6f44b1c65a56b58a8ac7c4819d0cab2d5088c143", headTree: "3f3fb544cd8cbe32db074e07f56b2c9bf54f632f", stats: [4, 60, 3], sha256: "a558a94c131a9176bbf4ab728c9a5b02abae12ab56f364c52489e75ad7da2c94", bytes: 6496, sections: 4, old: [["r1-case-evidence-v1", "dcbb98dee1b5e3c271b53067301bf5fad0a4ed64dd21acbe7cb9f5f4998a3db0"]] },
  "r1-typescript-37467": { repository: "microsoft/TypeScript", base: "933c2949236f38e1255a0aa4564246a3fef1518c", head: "6cbbdbcc4c22f7dd82b023059ca8230a927707e7", baseTree: "12cce8acd32216c6da7fa7dd38205440c624f4a1", headTree: "7a399efb616db0313641a8068f7943f9d4db4abc", stats: [10, 135, 6], sha256: "afba6912ead4a12ad7edcd1d232ff2d3697fc6b357696d2d7f69ed691f5dd1e5", bytes: 11947, sections: 12, old: [["r1-case-evidence-v1", "f2aebe7ce37f8b2bc5c8877301b26782ba9b0516f612875f0eaa5b435b320b91"], ["r1-case-evidence-v2", "99d05fda5f0f3173eabf57a55fd41803abaa65cc957607b4d4d72f7a892a9acc"]] },
  "r1-karma-2846": { repository: "karma-runner/karma", base: "e79463b94ff6d3ad87526b3c68b38b90e924ea42", head: "eab78ff696f3de8ae226f930e08b93d20ffbdb66", baseTree: "8c42372cca4b0be9f0d2f75833a3abfba7fe904a", headTree: "72fcd0063020977f14c2c15bdd8d9233e78c4a28", stats: [5, 40, 16], sha256: "6906187983eb2d3fb76b6b208f2f954fb92b8855c940e9b711347c36e3b79965", bytes: 9492, sections: 5, old: [["r1-case-evidence-v1", "7a23b80d43201932ab7a95c876ee99f205c295ea43ffb79acf5d932a46044dfb"], ["r1-case-evidence-v2", "7a23b80d43201932ab7a95c876ee99f205c295ea43ffb79acf5d932a46044dfb"]] },
  "r1-karma-2714": { repository: "karma-runner/karma", base: "2a847c250bb62134d87f5230d97be8483d4a13cf", head: "2789bf57abd977def5caf22609eef74acbad292e", baseTree: "cdc374713370669a20fdbc475096c9bc81a54343", headTree: "4a556b9586f02fc900c472b652919b7fb420847b", stats: [2, 62, 4], sha256: "6a53f7ffc241801032e21dae011a3e1c6502446827b7e82c7fbcbaec3562ce9a", bytes: 3107, sections: 2, old: [["r1-case-evidence-v1", "de5febb6c4011f73a8e192795601b8a27e97ba017d57a3699425a2eb9325ab6f"]] },
  "r1-webpack-8233": { repository: "webpack/webpack", base: "2228daff027113a10790c75f2901c0b804d60a25", head: "dcd38348e5a74e250a6dbfa22e743fc7da0964ff", baseTree: "6fc6ac847bc62e49f5f2ab9f7774b1f234b75267", headTree: "70f9720cdb1e9641bc5e87a2a80822b9c20dc9d7", stats: [3, 101, 1], sha256: "4313dd3d4567eb8c83fc64cbc2e0065de149a6680f06f3b052908ad00d610921", bytes: 4761, sections: 3, old: [["r1-case-evidence-v1", "6b161ba2086b471a6b96502fc68cfd6cc05f0d0760d194757aaafccd974b2687"]] },
};
const fixedPrefix = "git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3";
const expectedRoster = [
  { directorySlug: "curator-alpha", identityRef: "codex-task:/root/r1_curator_alpha", identitySha256: "a2ef45b13113d050014b9cce96a10be569e2114629ceb52ea4668fffa5607cd7" },
  { directorySlug: "curator-beta", identityRef: "codex-task:/root/r1_curator_beta", identitySha256: "d5685cd85a563032fdf19dadfd2e023a8c2b54f6153c85279b9704c1c2f5fe59" },
];
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${label} has missing or unknown fields`);
};
const readObject = (path, label) => {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
};

function validateGovernance(evidenceRoot, files) {
  const paths = ["curation/versions/r1-case-evidence-v3/confirmation.schema.json", "curation/versions/r1-case-evidence-v3/review-protocol.md", "curation/versions/r1-case-evidence-v3/reviews/README.md"];
  if (!Array.isArray(files) || files.length !== paths.length || JSON.stringify(files.map((file) => file.path).sort()) !== JSON.stringify(paths)) throw new Error("v3 packet has the wrong governance files");
  for (const file of files) {
    exactKeys(file, ["path", "bytes", "sha256"], "v3 governance file");
    if (typeof file.path !== "string" || !safePath.test(file.path)) throw new Error("v3 packet has an unsafe governance path");
    const path = resolve(evidenceRoot, file.path);
    const stat = lstatSync(path);
    const bytes = readFileSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`v3 governance file does not match packet: ${file.path}`);
  }
}

function validateMetadata(evidenceRoot, entry, prior) {
  const path = `curation/versions/r1-case-evidence-v3/metadata/${entry.caseId}.json`;
  const file = entry.files.find((item) => item.path === path);
  if (!file) throw new Error(`${entry.caseId} does not bind v3 metadata`);
  const metadata = readObject(resolve(evidenceRoot, path), `${entry.caseId} metadata`);
  exactKeys(metadata, ["schemaVersion", "caseId", "repository", "reviewBase", "reviewHead", "baseTree", "headTree", "logicalDiffStats", "canonicalDiff", "supersededDiffClaims", "priorEvidence", "authority"], `${entry.caseId} metadata`);
  const wanted = expected[entry.caseId];
  if (metadata.schemaVersion !== 3 || metadata.caseId !== entry.caseId || metadata.repository !== wanted.repository || metadata.reviewBase !== wanted.base || metadata.reviewHead !== wanted.head || metadata.baseTree !== wanted.baseTree || metadata.headTree !== wanted.headTree) throw new Error(`${entry.caseId} metadata has wrong canonical identity`);
  exactKeys(metadata.logicalDiffStats, ["files", "insertions", "deletions"], `${entry.caseId} logicalDiffStats`);
  if (JSON.stringify([metadata.logicalDiffStats.files, metadata.logicalDiffStats.insertions, metadata.logicalDiffStats.deletions]) !== JSON.stringify(wanted.stats)) throw new Error(`${entry.caseId} metadata has wrong logical diff stats`);
  exactKeys(metadata.canonicalDiff, ["environment", "gitVersion", "command", "storedFile", "bytes", "sha256", "fileSections"], `${entry.caseId} canonicalDiff`);
  exactKeys(metadata.canonicalDiff.environment, ["LC_ALL", "LANG"], `${entry.caseId} canonicalDiff environment`);
  const command = `${fixedPrefix} ${wanted.base} ${wanted.head} --`;
  const diffPath = `curation/versions/r1-case-evidence-v3/diffs/${entry.caseId}.diff`;
  if (metadata.canonicalDiff.environment.LC_ALL !== "C" || metadata.canonicalDiff.environment.LANG !== "C" || typeof metadata.canonicalDiff.gitVersion !== "string" || !metadata.canonicalDiff.gitVersion.startsWith("git version ") || metadata.canonicalDiff.command !== command || metadata.canonicalDiff.storedFile !== diffPath || metadata.canonicalDiff.bytes !== wanted.bytes || metadata.canonicalDiff.sha256 !== wanted.sha256 || metadata.canonicalDiff.fileSections !== wanted.sections) throw new Error(`${entry.caseId} metadata has wrong canonical diff contract`);
  const diffFile = entry.files.find((item) => item.path === diffPath);
  if (!diffFile || diffFile.bytes !== wanted.bytes || diffFile.sha256 !== wanted.sha256) throw new Error(`${entry.caseId} does not bind the authoritative stored diff`);
  const diffBytes = readFileSync(resolve(evidenceRoot, diffPath));
  if ((diffBytes.toString("utf8").match(/^diff --git /gm) || []).length !== wanted.sections) throw new Error(`${entry.caseId} stored diff section count is invalid`);
  exactKeys(metadata.priorEvidence, ["packetVersion", "evidenceVersion", "evidenceBundleSha256"], `${entry.caseId} priorEvidence`);
  if (metadata.priorEvidence.packetVersion !== "r1-case-evidence-v2" || metadata.priorEvidence.evidenceVersion !== prior.evidenceVersion || metadata.priorEvidence.evidenceBundleSha256 !== prior.evidenceBundleSha256) throw new Error(`${entry.caseId} metadata does not bind prior evidence`);
  if (!Array.isArray(metadata.supersededDiffClaims) || metadata.supersededDiffClaims.length !== wanted.old.length) throw new Error(`${entry.caseId} must disclose every superseded diff claim`);
  for (const [index, claim] of metadata.supersededDiffClaims.entries()) {
    exactKeys(claim, ["packetVersion", "sha256", "reason"], `${entry.caseId} superseded claim`);
    if (claim.packetVersion !== wanted.old[index][0] || claim.sha256 !== wanted.old[index][1] || typeof claim.reason !== "string" || !claim.reason.trim()) throw new Error(`${entry.caseId} has an invalid superseded diff claim`);
  }
  if (metadata.authority !== "The packet-bound stored diff bytes and their SHA-256 are authoritative; superseded hashes in reused prose are provenance only.") throw new Error(`${entry.caseId} lacks the authoritative-byte declaration`);
}

function validateConfirmation(value, label, packet, entry, rosterMember) {
  exactKeys(value, confirmationKeys, label);
  if (value.schemaVersion !== 3 || value.packetVersion !== packet.packetVersion || value.packetSha256 !== packet.packetSha256) throw new Error(`${label} is stale or cross-version`);
  if (value.caseId !== entry.caseId || value.evidenceBundleSha256 !== entry.evidenceBundleSha256) throw new Error(`${label} is stale or cross-case`);
  if (value.curatorIdentityRef !== rosterMember.identityRef || value.curatorIdentitySha256 !== rosterMember.identitySha256 || digest(Buffer.from(value.curatorIdentityRef)) !== value.curatorIdentitySha256) throw new Error(`${label} identity does not match the packet roster`);
  if (value.independenceDeclaration !== declaration || typeof value.reviewedAt !== "string" || !dateTime.test(value.reviewedAt) || Number.isNaN(Date.parse(value.reviewedAt))) throw new Error(`${label} has invalid accountability fields`);
  if (!["confirm", "reject", "defer"].includes(value.disposition)) throw new Error(`${label} has invalid disposition`);
  exactKeys(value.checks, checks, `${label}.checks`);
  if (checks.some((name) => typeof value.checks[name] !== "boolean")) throw new Error(`${label} has a non-boolean check`);
  if (!Array.isArray(value.evidenceNotes) || value.evidenceNotes.length === 0) throw new Error(`${label} needs evidence notes`);
  for (const [index, note] of value.evidenceNotes.entries()) {
    exactKeys(note, ["source", "observation"], `${label}.evidenceNotes[${index}]`);
    if (typeof note.source !== "string" || !note.source.trim() || note.source.length > 512 || typeof note.observation !== "string" || !note.observation.trim() || note.observation.length > 4000) throw new Error(`${label}.evidenceNotes[${index}] is invalid`);
  }
  if (!Array.isArray(value.exceptions) || value.exceptions.some((item) => typeof item !== "string" || !item.trim() || item.length > 4000)) throw new Error(`${label}.exceptions is invalid`);
  if (value.disposition === "confirm" && (checks.some((name) => value.checks[name] !== true) || value.exceptions.length)) throw new Error(`${label} cannot confirm with failed checks or exceptions`);
  if (value.disposition !== "confirm" && value.exceptions.length === 0) throw new Error(`${label} must explain rejection or deferral`);
}

export function validateR1V3(evidenceRoot, options = {}) {
  const v2 = validateR1V2(evidenceRoot);
  if (!v2.ready) throw new Error("v3 requires authenticated ready v2 evidence");
  const versionRoot = resolve(evidenceRoot, "curation/versions/r1-case-evidence-v3");
  const packet = readObject(resolve(versionRoot, "packet-manifest.json"), "v3 packet");
  exactKeys(packet, ["schemaVersion", "packetVersion", "supersedes", "governanceFiles", "curatorRoster", "sourceCapturedAt", "cases", "packetSha256"], "v3 packet");
  if (packet.schemaVersion !== 3 || packet.packetVersion !== "r1-case-evidence-v3" || !Array.isArray(packet.cases)) throw new Error("v3 packet has unsupported shape");
  exactKeys(packet.supersedes, ["packetVersion", "packetSha256"], "v3 supersedes");
  if (packet.supersedes.packetVersion !== v2.packet.packetVersion || packet.supersedes.packetSha256 !== v2.packet.packetSha256) throw new Error("v3 packet is not bound to authenticated v2");
  validateGovernance(evidenceRoot, packet.governanceFiles);
  if (!Array.isArray(packet.curatorRoster) || packet.curatorRoster.length !== 2) throw new Error("v3 packet must have exactly two rostered curators");
  const roster = new Map();
  const identities = new Set();
  for (const member of packet.curatorRoster) {
    exactKeys(member, ["directorySlug", "identityRef", "identitySha256"], "v3 curator roster member");
    if (!/^[a-z0-9-]+$/.test(member.directorySlug) || digest(Buffer.from(member.identityRef)) !== member.identitySha256 || roster.has(member.directorySlug) || identities.has(member.identitySha256)) throw new Error("v3 packet has an invalid or duplicate curator roster member");
    roster.set(member.directorySlug, member);
    identities.add(member.identitySha256);
  }
  if (JSON.stringify(packet.curatorRoster) !== JSON.stringify(expectedRoster)) throw new Error("v3 packet curator roster does not match the approved identities");
  const packetHash = digest(Buffer.from(JSON.stringify({ version: packet.packetVersion, supersedes: packet.supersedes, governanceFiles: packet.governanceFiles, curatorRoster: packet.curatorRoster, sourceCapturedAt: packet.sourceCapturedAt, cases: packet.cases })));
  if (packet.packetSha256 !== packetHash) throw new Error("v3 packet digest does not match its contents");

  const cases = new Map();
  for (const entry of packet.cases) {
    exactKeys(entry, ["caseId", "mode", "evidenceVersion", "supersedes", "evidenceBundleSha256", "files"], "v3 case");
    if (!caseIds.includes(entry.caseId) || cases.has(entry.caseId) || entry.mode !== "canonicalized-diff" || entry.evidenceVersion !== packet.packetVersion) throw new Error("v3 packet has invalid or duplicate case identity");
    const prior = v2.cases.get(entry.caseId);
    exactKeys(entry.supersedes, ["packetVersion", "evidenceVersion", "evidenceBundleSha256"], `${entry.caseId} supersedes`);
    if (entry.supersedes.packetVersion !== v2.packet.packetVersion || entry.supersedes.evidenceVersion !== prior.evidenceVersion || entry.supersedes.evidenceBundleSha256 !== prior.evidenceBundleSha256) throw new Error(`${entry.caseId} is not bound to its prior evidence bundle`);
    authenticateFiles(evidenceRoot, entry, packet.packetVersion);
    validateMetadata(evidenceRoot, entry, prior);
    cases.set(entry.caseId, entry);
  }
  if (JSON.stringify([...cases.keys()].sort()) !== JSON.stringify([...caseIds].sort())) throw new Error("v3 packet does not contain the exact case set");

  const results = new Map(caseIds.map((caseId) => [caseId, { confirmations: new Set(), blockers: [] }]));
  const reviewRoot = resolve(versionRoot, "reviews");
  for (const directorySlug of readdirSync(reviewRoot).filter((name) => name !== "README.md").sort()) {
    const member = roster.get(directorySlug);
    if (!member) throw new Error(`unrostered v3 curator directory: ${directorySlug}`);
    const directory = resolve(reviewRoot, directorySlug);
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe v3 curator directory: ${directorySlug}`);
    for (const fileName of readdirSync(directory).sort()) {
      if (!fileName.endsWith(".json")) throw new Error(`unexpected v3 curator artifact: ${directorySlug}/${fileName}`);
      const confirmationPath = resolve(directory, fileName);
      const confirmationStat = lstatSync(confirmationPath);
      if (!confirmationStat.isFile() || confirmationStat.isSymbolicLink()) {
        throw new Error(`unsafe v3 curator artifact: ${directorySlug}/${fileName}`);
      }
      const value = readObject(confirmationPath, `${directorySlug}/${fileName}`);
      if (fileName !== `${value.caseId}.json`) throw new Error(`${directorySlug}/${fileName} has a cross-case filename`);
      const entry = cases.get(value.caseId);
      if (!entry) throw new Error(`${directorySlug}/${fileName} names an unknown case`);
      validateConfirmation(value, `${directorySlug}/${fileName}`, packet, entry, member);
      const result = results.get(value.caseId);
      if (result.confirmations.has(value.curatorIdentitySha256)) throw new Error(`${value.caseId} has a duplicate v3 curator identity`);
      result.confirmations.add(value.curatorIdentitySha256);
      if (value.disposition !== "confirm") result.blockers.push(`${value.disposition}:${directorySlug}`);
    }
  }
  let ready = true;
  let blocked = false;
  const rows = caseIds.map((caseId) => {
    const result = results.get(caseId);
    const caseReady = result.confirmations.size === roster.size && result.blockers.length === 0;
    ready &&= caseReady;
    blocked ||= result.blockers.length > 0;
    return { caseId, confirmations: result.confirmations.size, blockers: result.blockers, ready: caseReady };
  });
  const status = ready ? "ready" : blocked ? "failed" : "not-ready";
  if (options.log) {
    for (const row of rows) console.log(`R1 v3 ${row.caseId}: ${row.confirmations}/2 confirmations${row.blockers.length ? `; ${row.blockers.join(", ")}` : ""}`);
    console.log(`R1 v3 curator readiness: ${status}`);
  }
  return { packet, cases, rows, ready, status };
}
