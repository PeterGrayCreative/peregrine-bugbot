import { fileURLToPath } from "node:url";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  verifyHumanReviewPacket,
  verifyHumanReviewResponse,
  type HumanReviewDecision,
  type VerifiedHumanReviewResponse,
} from "./verify-human-review-response.js";

const SHA256 = /^[a-f0-9]{64}$/;

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const root = value as Record<string, unknown>;
  if (Object.keys(root).length !== keys.length || keys.some((key) => !Object.hasOwn(root, key))) throw new Error(`${label} has an invalid shape`);
  return root;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_000) throw new Error(`${label} must contain 1-4000 characters`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical UTC timestamp`);
  return value;
}

function directFile(pathValue: string, label: string): string {
  const absolute = resolve(pathValue);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct non-symlink file`);
  return realpathSync(absolute);
}

function directDirectory(pathValue: string, label: string): string {
  const absolute = resolve(pathValue);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct non-symlink directory`);
  return realpathSync(absolute);
}

function inside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

export function compileHumanReviewWorkbook(input: {
  packetDirectory: string;
  workbookFile: string;
  destination: string;
  expectedHumanReviewerIdentitySha256: string;
}): VerifiedHumanReviewResponse {
  const packetRoot = directDirectory(input.packetDirectory, "packet directory");
  const packet = verifyHumanReviewPacket(packetRoot);
  const workbookPath = directFile(input.workbookFile, "human review workbook");
  const expectedIdentity = digest(input.expectedHumanReviewerIdentitySha256, "expected human reviewer identity");
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(workbookPath, "utf8")) as unknown; }
  catch (error) { throw new Error(`human review workbook is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const root = exactObject(parsed, ["schemaVersion", "protocol", "templateOnly", "packetId", "packetSha256", "humanReviewerIdentitySha256", "decisions", "packetDecision"], "human review workbook");
  if (root.schemaVersion !== 1 || root.protocol !== "r2-sole-human-review-workbook-v1" || root.templateOnly !== false || root.packetId !== packet.packetId || root.packetSha256 !== packet.packetSha256 || root.humanReviewerIdentitySha256 !== expectedIdentity) throw new Error("human review workbook does not bind the completed packet and reviewer identity");
  if (!Array.isArray(root.decisions) || root.decisions.length !== packet.readyDossiers.length) throw new Error("human review workbook decision roster is incomplete");
  const decisions = root.decisions.map((value, index) => {
    const item = exactObject(value, ["dossierId", "dossierBundleSha256", "decision", "reason", "correction", "acknowledgedDossierBundleSha256", "reviewedAt"], `human review workbook decision ${index}`);
    const expected = packet.readyDossiers[index]!;
    if (item.dossierId !== expected.dossierId || item.dossierBundleSha256 !== expected.dossierBundleSha256 || item.acknowledgedDossierBundleSha256 !== expected.dossierBundleSha256) throw new Error(`human review workbook decision ${index} does not bind its canonical dossier`);
    if (item.decision !== "approve" && item.decision !== "reject" && item.decision !== "unresolved") throw new Error(`human review workbook decision ${index} is invalid`);
    const reason = text(item.reason, `human review workbook decision ${index} reason`);
    const correction = item.correction === null ? null : text(item.correction, `human review workbook decision ${index} correction`);
    if (item.decision === "approve" && correction !== null) throw new Error(`human review workbook decision ${index} approval cannot contain a correction`);
    return {
      dossierId: expected.dossierId,
      dossierBundleSha256: expected.dossierBundleSha256,
      decision: item.decision as HumanReviewDecision,
      reason,
      correction,
      acknowledgedDossierBundleSha256: expected.dossierBundleSha256,
      reviewedAt: timestamp(item.reviewedAt, `human review workbook decision ${index} reviewedAt`),
    };
  });
  const packetDecision = exactObject(root.packetDecision, ["reviewMode", "acknowledgedPacketSha256", "soleHumanReviewerAcknowledged", "reviewedEveryDecisionCard", "decisionsBindPacketAndDossierHashes", "duplicateFamiliesAccepted", "limitationsAccepted", "independentTwoHumanConfirmationClaimed", "completedAt"], "human review workbook packetDecision");
  if (packetDecision.reviewMode !== "sole-human-v1" || packetDecision.acknowledgedPacketSha256 !== packet.packetSha256) throw new Error("human review workbook packetDecision does not bind the packet");
  for (const field of ["soleHumanReviewerAcknowledged", "reviewedEveryDecisionCard", "decisionsBindPacketAndDossierHashes", "duplicateFamiliesAccepted", "limitationsAccepted"]) {
    if (packetDecision[field] !== true) throw new Error(`human review workbook packetDecision.${field} must be true`);
  }
  if (packetDecision.independentTwoHumanConfirmationClaimed !== false) throw new Error("human review workbook must not claim two independent human confirmations");
  const completedAt = timestamp(packetDecision.completedAt, "human review workbook packetDecision.completedAt");
  if (decisions.some((item) => item.reviewedAt > completedAt)) throw new Error("human review workbook packetDecision predates an individual decision");

  const requested = resolve(input.destination);
  if (existsSync(requested)) throw new Error("refusing to overwrite an existing compiled response");
  const parent = directDirectory(dirname(requested), "compiled response parent");
  const destination = join(parent, basename(requested));
  const workbookRoot = realpathSync(dirname(workbookPath));
  if (inside(packetRoot, destination) || inside(destination, packetRoot) || inside(workbookRoot, destination) || inside(destination, workbookRoot)) throw new Error("packet, workbook, and compiled response must be disjoint");
  let created = false;
  try {
    mkdirSync(join(destination, "decisions"), { recursive: true });
    created = true;
    for (const item of decisions) {
      writeFileSync(join(destination, "decisions", `${item.dossierId}.json`), `${JSON.stringify({
        schemaVersion: 1,
        templateOnly: false,
        packetId: packet.packetId,
        dossierId: item.dossierId,
        dossierBundleSha256: item.dossierBundleSha256,
        decision: item.decision,
        reason: item.reason,
        correction: item.correction,
        acknowledgedDossierBundleSha256: item.acknowledgedDossierBundleSha256,
        humanReviewerIdentitySha256: expectedIdentity,
        reviewedAt: item.reviewedAt,
      }, null, 2)}\n`, { flag: "wx" });
    }
    writeFileSync(join(destination, "packet-decision.json"), `${JSON.stringify({
      schemaVersion: 1,
      templateOnly: false,
      packetId: packet.packetId,
      reviewMode: "sole-human-v1",
      acknowledgedPacketSha256: packet.packetSha256,
      humanReviewerIdentitySha256: expectedIdentity,
      soleHumanReviewerAcknowledged: true,
      reviewedEveryDecisionCard: true,
      decisionsBindPacketAndDossierHashes: true,
      duplicateFamiliesAccepted: true,
      limitationsAccepted: true,
      independentTwoHumanConfirmationClaimed: false,
      completedAt,
    }, null, 2)}\n`, { flag: "wx" });
    return verifyHumanReviewResponse(packetRoot, destination, expectedIdentity);
  } catch (error) {
    if (created) rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

function runCli(): void {
  const [packetDirectory, workbookFile, destination, expectedIdentity] = process.argv.slice(2);
  if (!packetDirectory || !workbookFile || !destination || !expectedIdentity || process.argv.length !== 6) throw new Error("usage: compile-human-review-workbook.ts <packet-directory> <completed-workbook.json> <new-response-directory> <expected-reviewer-identity-sha256>");
  process.stdout.write(`${JSON.stringify(compileHumanReviewWorkbook({ packetDirectory, workbookFile, destination, expectedHumanReviewerIdentitySha256: expectedIdentity }))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
