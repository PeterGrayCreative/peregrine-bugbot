import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const declaration = "I independently inspected the authenticated sources and exact historical diff before accepting or rejecting the primary trace.";
const checks = ["sourceAuthenticity", "exactHistoricalHead", "provenance", "causalTrace", "reachability", "consequence", "repairBoundary", "truthScope", "license", "limitations"];
const confirmationKeys = ["schemaVersion", "packetVersion", "caseId", "evidenceBundleSha256", "curatorIdentityRef", "curatorIdentitySha256", "reviewedAt", "independenceDeclaration", "disposition", "checks", "evidenceNotes", "exceptions"];
const carriedIds = new Set(["r1-vscode-73801", "r1-karma-2714", "r1-webpack-8233"]);
const correctedIds = new Set(["r1-typescript-37467", "r1-karma-2846"]);
const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[^\0]+$/;
const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readObject = (path, label) => {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
};
const exactKeys = (value, expected, label) => {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} has missing or unknown fields`);
};

export function authenticateFiles(evidenceRoot, entry, version) {
  const seen = new Set();
  if (!Array.isArray(entry.files) || entry.files.length === 0) throw new Error(`${entry.caseId} has no evidence files`);
  for (const file of entry.files) {
    exactKeys(file, ["path", "bytes", "sha256"], `${entry.caseId} file`);
    if (typeof file.path !== "string" || !safePath.test(file.path) || seen.has(file.path)) throw new Error(`${entry.caseId} has an unsafe or duplicate evidence path`);
    seen.add(file.path);
    const path = resolve(evidenceRoot, file.path);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${entry.caseId} evidence is not a direct file: ${file.path}`);
    const bytes = readFileSync(path);
    if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`${entry.caseId} evidence file does not match packet: ${file.path}`);
  }
  const bundle = digest(Buffer.from(JSON.stringify({ version, caseId: entry.caseId, files: entry.files })));
  if (bundle !== entry.evidenceBundleSha256) throw new Error(`${entry.caseId} evidence bundle digest is invalid`);
}

function validateConfirmation(value, label, schemaVersion, packetVersion, cases) {
  exactKeys(value, confirmationKeys, label);
  if (value.schemaVersion !== schemaVersion || value.packetVersion !== packetVersion) throw new Error(`${label} uses the wrong packet version`);
  const entry = cases.get(value.caseId);
  if (!entry) throw new Error(`${label} names an unknown or ineligible case`);
  if (value.evidenceBundleSha256 !== entry.evidenceBundleSha256) throw new Error(`${label} is stale or cross-case`);
  if (typeof value.curatorIdentityRef !== "string" || value.curatorIdentityRef.length < 3 || value.curatorIdentityRef.length > 256 ||
      digest(Buffer.from(value.curatorIdentityRef)) !== value.curatorIdentitySha256) throw new Error(`${label} identity digest is invalid`);
  if (value.independenceDeclaration !== declaration) throw new Error(`${label} lacks the exact independence declaration`);
  if (typeof value.reviewedAt !== "string" || !dateTime.test(value.reviewedAt) || Number.isNaN(Date.parse(value.reviewedAt))) throw new Error(`${label} has an invalid review timestamp`);
  if (!["confirm", "reject", "defer"].includes(value.disposition)) throw new Error(`${label} has an invalid disposition`);
  if (!value.checks || typeof value.checks !== "object" || Array.isArray(value.checks)) throw new Error(`${label}.checks must be an object`);
  exactKeys(value.checks, checks, `${label}.checks`);
  if (checks.some((name) => typeof value.checks[name] !== "boolean")) throw new Error(`${label} has a non-boolean check`);
  if (!Array.isArray(value.evidenceNotes) || value.evidenceNotes.length === 0) throw new Error(`${label} needs evidence notes`);
  for (const [index, note] of value.evidenceNotes.entries()) {
    if (!note || typeof note !== "object" || Array.isArray(note)) throw new Error(`${label}.evidenceNotes[${index}] must be an object`);
    exactKeys(note, ["source", "observation"], `${label}.evidenceNotes[${index}]`);
    if (typeof note.source !== "string" || note.source.trim() === "" || note.source.length > 512 || typeof note.observation !== "string" || note.observation.trim() === "" || note.observation.length > 4000) throw new Error(`${label}.evidenceNotes[${index}] is invalid`);
  }
  if (!Array.isArray(value.exceptions) || value.exceptions.some((item) => typeof item !== "string" || item.trim() === "" || item.length > 4000)) throw new Error(`${label}.exceptions is invalid`);
  if (value.disposition === "confirm" && (checks.some((name) => !value.checks[name]) || value.exceptions.length)) throw new Error(`${label} cannot confirm with failed checks or exceptions`);
  if (value.disposition !== "confirm" && value.exceptions.length === 0) throw new Error(`${label} must explain rejection or deferral`);
  return value;
}

export function readConfirmations(reviewRoot, schemaVersion, packetVersion, cases) {
  const results = new Map([...cases].map(([caseId]) => [caseId, { confirmations: new Map(), blockers: [] }]));
  if (!existsSync(reviewRoot)) return results;
  for (const curator of readdirSync(reviewRoot).filter((name) => name !== "README.md").sort()) {
    const directory = resolve(reviewRoot, curator);
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error(`unsafe curator directory: ${curator}`);
    for (const file of readdirSync(directory).sort()) {
      if (!file.endsWith(".json")) throw new Error(`unexpected curator artifact: ${curator}/${file}`);
      const path = resolve(directory, file);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe curator artifact: ${curator}/${file}`);
      const value = validateConfirmation(readObject(path, `${curator}/${file}`), `${curator}/${file}`, schemaVersion, packetVersion, cases);
      const result = results.get(value.caseId);
      if (result.confirmations.has(value.curatorIdentitySha256)) throw new Error(`${value.caseId} has a duplicate curator identity`);
      result.confirmations.set(value.curatorIdentitySha256, value.disposition);
      if (value.disposition !== "confirm") result.blockers.push(`${value.disposition}:${curator}`);
    }
  }
  return results;
}

export function inspectFrozenV1(evidenceRoot) {
  const packet = readObject(resolve(evidenceRoot, "curation/packet-manifest.json"), "v1 packet");
  if (packet.schemaVersion !== 1 || packet.packetVersion !== "r1-case-evidence-v1" || !Array.isArray(packet.cases)) throw new Error("v1 packet has an unsupported shape");
  const packetHash = digest(Buffer.from(JSON.stringify({ version: packet.packetVersion, sourceCapturedAt: packet.sourceCapturedAt, cases: packet.cases })));
  if (packet.packetSha256 !== packetHash) throw new Error("v1 packet digest does not match its contents");
  const cases = new Map();
  for (const entry of packet.cases) {
    if (cases.has(entry.caseId)) throw new Error(`v1 packet repeats case ${entry.caseId}`);
    authenticateFiles(evidenceRoot, entry, packet.packetVersion);
    cases.set(entry.caseId, entry);
  }
  const results = readConfirmations(resolve(evidenceRoot, "curation/reviews"), 1, packet.packetVersion, cases);
  return { packet, cases, results };
}

export function validateR1V2(evidenceRoot, options = {}) {
  const v1 = inspectFrozenV1(evidenceRoot);
  const versionRoot = resolve(evidenceRoot, "curation/versions/r1-case-evidence-v2");
  const packet = readObject(resolve(versionRoot, "packet-manifest.json"), "v2 packet");
  if (packet.schemaVersion !== 2 || packet.packetVersion !== "r1-case-evidence-v2" || !Array.isArray(packet.cases)) throw new Error("v2 packet has an unsupported shape");
  exactKeys(packet.supersedes, ["packetVersion", "packetSha256"], "v2 supersedes");
  if (packet.supersedes.packetVersion !== v1.packet.packetVersion || packet.supersedes.packetSha256 !== v1.packet.packetSha256) throw new Error("v2 packet is not bound to authenticated v1");
  if (!Array.isArray(packet.governanceFiles) || packet.governanceFiles.length !== 3) throw new Error("v2 packet must bind its three governance files");
  const expectedGovernance = [
    "curation/versions/r1-case-evidence-v2/confirmation.schema.json",
    "curation/versions/r1-case-evidence-v2/review-protocol.md",
    "curation/versions/r1-case-evidence-v2/reviews/README.md",
  ];
  if (JSON.stringify(packet.governanceFiles.map((file) => file.path).sort()) !== JSON.stringify(expectedGovernance)) throw new Error("v2 packet has the wrong governance files");
  for (const file of packet.governanceFiles) {
    exactKeys(file, ["path", "bytes", "sha256"], "v2 governance file");
    if (typeof file.path !== "string" || !safePath.test(file.path)) throw new Error("v2 packet has an unsafe governance path");
    const path = resolve(evidenceRoot, file.path);
    const stat = lstatSync(path);
    const bytes = readFileSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`v2 governance file does not match packet: ${file.path}`);
  }
  const packetHash = digest(Buffer.from(JSON.stringify({ version: packet.packetVersion, supersedes: packet.supersedes, governanceFiles: packet.governanceFiles, sourceCapturedAt: packet.sourceCapturedAt, cases: packet.cases })));
  if (packet.packetSha256 !== packetHash) throw new Error("v2 packet digest does not match its contents");

  const allCases = new Map();
  const correctedCases = new Map();
  for (const entry of packet.cases) {
    if (allCases.has(entry.caseId)) throw new Error(`v2 packet repeats case ${entry.caseId}`);
    const prior = v1.cases.get(entry.caseId);
    if (!prior) throw new Error(`v2 packet names a case absent from v1: ${entry.caseId}`);
    if (carriedIds.has(entry.caseId)) {
      exactKeys(entry, ["caseId", "mode", "evidenceVersion", "evidenceBundleSha256", "files"], `v2 carried case ${entry.caseId}`);
      const priorResult = v1.results.get(entry.caseId);
      const confirmations = [...priorResult.confirmations.values()].filter((value) => value === "confirm").length;
      if (entry.mode !== "carried-forward" || entry.evidenceVersion !== v1.packet.packetVersion || entry.evidenceBundleSha256 !== prior.evidenceBundleSha256 || JSON.stringify(entry.files) !== JSON.stringify(prior.files)) throw new Error(`${entry.caseId} is not a byte-identical v1 carry-forward`);
      if (confirmations < 2 || priorResult.blockers.length) throw new Error(`${entry.caseId} is not eligible for v1 carry-forward`);
      authenticateFiles(evidenceRoot, entry, entry.evidenceVersion);
    } else if (correctedIds.has(entry.caseId)) {
      exactKeys(entry, ["caseId", "mode", "evidenceVersion", "supersedesEvidenceBundleSha256", "evidenceBundleSha256", "files"], `v2 corrected case ${entry.caseId}`);
      if (entry.mode !== "corrected" || entry.evidenceVersion !== packet.packetVersion || entry.supersedesEvidenceBundleSha256 !== prior.evidenceBundleSha256) throw new Error(`${entry.caseId} correction is not bound to its superseded v1 bundle`);
      authenticateFiles(evidenceRoot, entry, packet.packetVersion);
      correctedCases.set(entry.caseId, entry);
    } else {
      throw new Error(`v2 packet has unexpected case ${entry.caseId}`);
    }
    allCases.set(entry.caseId, entry);
  }
  const expected = [...carriedIds, ...correctedIds].sort();
  if (JSON.stringify([...allCases.keys()].sort()) !== JSON.stringify(expected)) throw new Error("v2 packet does not contain the exact mixed case set");

  const fresh = readConfirmations(resolve(versionRoot, "reviews"), 2, packet.packetVersion, correctedCases);
  let ready = true;
  let blocked = false;
  const rows = [];
  for (const [caseId, entry] of allCases) {
    if (entry.mode === "carried-forward") {
      rows.push({ caseId, mode: entry.mode, confirmations: 2, blockers: [], ready: true });
      continue;
    }
    const result = fresh.get(caseId);
    const confirmations = [...result.confirmations.values()].filter((value) => value === "confirm").length;
    const caseReady = confirmations >= 2 && result.blockers.length === 0;
    ready &&= caseReady;
    blocked ||= result.blockers.length > 0;
    rows.push({ caseId, mode: entry.mode, confirmations, blockers: result.blockers, ready: caseReady });
  }
  const status = ready ? "ready" : blocked ? "failed" : "not-ready";
  if (options.log) {
    for (const row of rows) console.log(`R1 v2 ${row.caseId} (${row.mode}): ${row.confirmations}/2 confirmations${row.blockers.length ? `; ${row.blockers.join(", ")}` : ""}`);
    console.log(`R1 v2 curator readiness: ${status}`);
  }
  return { packet, cases: allCases, rows, ready, status };
}
