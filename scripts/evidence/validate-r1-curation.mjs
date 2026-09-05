import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateR1V2 } from "./r1-curation-v2.mjs";
import { validateR1V3 } from "./r1-curation-v3.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");
const evidenceRoot = process.env.R1_EVIDENCE_ROOT
  ? resolve(process.env.R1_EVIDENCE_ROOT)
  : resolve(repositoryRoot, "docs/validation/artifacts/2026-09-04-r1-historical-reconstructions");
const reviewRoot = resolve(evidenceRoot, "curation/reviews");
const requireComplete = process.argv.includes("--require-complete");
const declaration = "I independently inspected the authenticated sources and exact historical diff before accepting or rejecting the primary trace.";
const checkNames = [
  "sourceAuthenticity",
  "exactHistoricalHead",
  "provenance",
  "causalTrace",
  "reachability",
  "consequence",
  "repairBoundary",
  "truthScope",
  "license",
  "limitations",
];
const confirmationKeys = [
  "schemaVersion",
  "packetVersion",
  "caseId",
  "evidenceBundleSha256",
  "curatorIdentityRef",
  "curatorIdentitySha256",
  "reviewedAt",
  "independenceDeclaration",
  "disposition",
  "checks",
  "evidenceNotes",
  "exceptions",
];
const safeEvidencePath = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[^\0]+$/;
const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
};
const exactKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} has missing or unknown fields`);
};
const nonEmpty = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
};
const boundedString = (value, minimum, maximum, label) => {
  nonEmpty(value, label);
  if (value.length < minimum || value.length > maximum) throw new Error(`${label} length is invalid`);
  return value;
};

const packet = object(JSON.parse(readFileSync(resolve(evidenceRoot, "curation/packet-manifest.json"), "utf8")), "packet");
if (packet.schemaVersion !== 1 || packet.packetVersion !== "r1-case-evidence-v1" || !Array.isArray(packet.cases)) {
  throw new Error("curation packet has an unsupported shape");
}
const packetDigest = sha256(Buffer.from(JSON.stringify({
  version: packet.packetVersion,
  sourceCapturedAt: packet.sourceCapturedAt,
  cases: packet.cases,
})));
if (packet.packetSha256 !== packetDigest) throw new Error("curation packet digest does not match its contents");

const cases = new Map();
for (const entry of packet.cases) {
  object(entry, "packet case");
  if (cases.has(entry.caseId)) throw new Error(`curation packet repeats case ${entry.caseId}`);
  const seenPaths = new Set();
  const files = entry.files.map((file) => {
    object(file, `${entry.caseId} file`);
    if (typeof file.path !== "string" || !safeEvidencePath.test(file.path) || seenPaths.has(file.path)) {
      throw new Error(`${entry.caseId} has an unsafe or duplicate evidence path`);
    }
    seenPaths.add(file.path);
    const fullPath = resolve(evidenceRoot, file.path);
    const stat = lstatSync(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${entry.caseId} evidence is not a direct file: ${file.path}`);
    const bytes = readFileSync(fullPath);
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`${entry.caseId} evidence file does not match packet: ${file.path}`);
    }
    return file;
  });
  const bundle = sha256(Buffer.from(JSON.stringify({
    version: packet.packetVersion,
    caseId: entry.caseId,
    files,
  })));
  if (bundle !== entry.evidenceBundleSha256) throw new Error(`${entry.caseId} evidence bundle digest is invalid`);
  cases.set(entry.caseId, { ...entry, confirmations: new Map(), blocked: [] });
}

for (const curatorName of readdirSync(reviewRoot).filter((name) => name !== "README.md").sort()) {
  const curatorDir = resolve(reviewRoot, curatorName);
  const curatorStat = lstatSync(curatorDir);
  if (!curatorStat.isDirectory() || curatorStat.isSymbolicLink()) throw new Error(`unsafe curator directory: ${curatorName}`);
  for (const fileName of readdirSync(curatorDir).sort()) {
    if (!fileName.endsWith(".json")) throw new Error(`unexpected curator artifact: ${curatorName}/${fileName}`);
    const filePath = resolve(curatorDir, fileName);
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe curator artifact: ${curatorName}/${fileName}`);
    const label = `${curatorName}/${fileName}`;
    const value = object(JSON.parse(readFileSync(filePath, "utf8")), label);
    exactKeys(value, confirmationKeys, label);
    if (value.schemaVersion !== 1 || value.packetVersion !== packet.packetVersion) throw new Error(`${label} uses the wrong version`);
    const caseEntry = cases.get(value.caseId);
    if (!caseEntry) throw new Error(`${label} names an unknown case`);
    if (value.evidenceBundleSha256 !== caseEntry.evidenceBundleSha256) throw new Error(`${label} is stale or cross-case`);

    const identity = boundedString(value.curatorIdentityRef, 3, 256, `${label}.curatorIdentityRef`);
    if (sha256(Buffer.from(identity)) !== value.curatorIdentitySha256) throw new Error(`${label} identity digest is invalid`);
    if (caseEntry.confirmations.has(value.curatorIdentitySha256)) throw new Error(`${value.caseId} has a duplicate curator identity`);
    if (value.independenceDeclaration !== declaration) throw new Error(`${label} lacks the exact independence declaration`);
    if (typeof value.reviewedAt !== "string" || !dateTime.test(value.reviewedAt) || Number.isNaN(Date.parse(value.reviewedAt))) {
      throw new Error(`${label} has an invalid review timestamp`);
    }
    if (!["confirm", "reject", "defer"].includes(value.disposition)) throw new Error(`${label} has an invalid disposition`);

    const checks = object(value.checks, `${label}.checks`);
    exactKeys(checks, checkNames, `${label}.checks`);
    for (const name of checkNames) if (typeof checks[name] !== "boolean") throw new Error(`${label}.checks.${name} must be boolean`);
    if (!Array.isArray(value.evidenceNotes) || value.evidenceNotes.length === 0) throw new Error(`${label} needs evidence notes`);
    for (const [index, note] of value.evidenceNotes.entries()) {
      object(note, `${label}.evidenceNotes[${index}]`);
      exactKeys(note, ["source", "observation"], `${label}.evidenceNotes[${index}]`);
      boundedString(note.source, 1, 512, `${label}.evidenceNotes[${index}].source`);
      boundedString(note.observation, 1, 4000, `${label}.evidenceNotes[${index}].observation`);
    }
    if (!Array.isArray(value.exceptions) || value.exceptions.some((item) =>
      typeof item !== "string" || item.trim() === "" || item.length > 4000)) {
      throw new Error(`${label}.exceptions must contain only non-empty strings`);
    }
    if (value.disposition === "confirm" && (checkNames.some((name) => checks[name] !== true) || value.exceptions.length !== 0)) {
      throw new Error(`${label} cannot confirm with failed checks or exceptions`);
    }
    if (value.disposition !== "confirm" && value.exceptions.length === 0) throw new Error(`${label} must explain rejection or deferral`);

    caseEntry.confirmations.set(value.curatorIdentitySha256, value.disposition);
    if (value.disposition !== "confirm") caseEntry.blocked.push(`${value.disposition}:${curatorName}`);
  }
}

let ready = true;
let hasBlocker = false;
for (const [caseId, entry] of cases) {
  const confirmed = [...entry.confirmations.values()].filter((value) => value === "confirm").length;
  const caseReady = confirmed >= 2 && entry.blocked.length === 0;
  ready &&= caseReady;
  hasBlocker ||= entry.blocked.length > 0;
  console.log(`${caseId}: ${confirmed}/2 confirmations${entry.blocked.length ? `; ${entry.blocked.join(", ")}` : ""}`);
}
console.log(`R1 v1 curator readiness: ${ready ? "ready" : hasBlocker ? "failed" : "not-ready"}`);
const v2 = validateR1V2(evidenceRoot, { log: true });
const v3 = validateR1V3(evidenceRoot, { log: true });
if (requireComplete && !v3.ready) process.exitCode = 1;
