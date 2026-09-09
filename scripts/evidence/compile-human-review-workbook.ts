import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  buildR2PartitionAttestation,
  type R2CaseClass,
  type R2Partition,
  type R2PartitionAttestation,
  type R2PartitionAttestationDossier,
} from "../../eval/methodology-r2-partition.js";
import {
  verifyHumanReviewPacket,
  verifyHumanReviewResponse,
  type HumanReviewDecision,
  type VerifiedHumanReviewResponse,
} from "./verify-human-review-response.js";

const SHA256 = /^[a-f0-9]{64}$/;
const FAMILY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface CompiledHumanReviewWorkbook {
  response: VerifiedHumanReviewResponse;
  partitionAttestation: R2PartitionAttestation;
  partitionAttestationFileSha256: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

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

export function compileHumanReviewWorkbookWithPartition(input: {
  packetDirectory: string;
  workbookFile: string;
  destination: string;
  partitionAttestationFile: string;
  expectedHumanReviewerIdentitySha256: string;
}): CompiledHumanReviewWorkbook {
  const packetRoot = directDirectory(input.packetDirectory, "packet directory");
  const packet = verifyHumanReviewPacket(packetRoot);
  const workbookPath = directFile(input.workbookFile, "human review workbook");
  const expectedIdentity = digest(input.expectedHumanReviewerIdentitySha256, "expected human reviewer identity");
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(workbookPath, "utf8")) as unknown; }
  catch (error) { throw new Error(`human review workbook is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const root = exactObject(parsed, ["schemaVersion", "protocol", "templateOnly", "packetId", "packetSha256", "humanReviewerIdentitySha256", "decisions", "packetDecision"], "human review workbook");
  if (root.schemaVersion !== 2 || root.protocol !== "r2-sole-human-review-workbook-v2" || root.templateOnly !== false || root.packetId !== packet.packetId || root.packetSha256 !== packet.packetSha256 || root.humanReviewerIdentitySha256 !== expectedIdentity) throw new Error("human review workbook does not bind the completed packet and reviewer identity");
  if (!Array.isArray(root.decisions) || root.decisions.length !== packet.readyDossiers.length) throw new Error("human review workbook decision roster is incomplete");
  const decisions = root.decisions.map((value, index) => {
    const item = exactObject(value, ["dossierId", "dossierBundleSha256", "decision", "reason", "correction", "acknowledgedDossierBundleSha256", "partition", "caseClass", "duplicateFamilyId", "reviewedAt"], `human review workbook decision ${index}`);
    const expected = packet.readyDossiers[index]!;
    if (item.dossierId !== expected.dossierId || item.dossierBundleSha256 !== expected.dossierBundleSha256 || item.acknowledgedDossierBundleSha256 !== expected.dossierBundleSha256) throw new Error(`human review workbook decision ${index} does not bind its canonical dossier`);
    if (item.decision !== "approve" && item.decision !== "reject" && item.decision !== "unresolved") throw new Error(`human review workbook decision ${index} is invalid`);
    const reason = text(item.reason, `human review workbook decision ${index} reason`);
    const correction = item.correction === null ? null : text(item.correction, `human review workbook decision ${index} correction`);
    if (item.decision === "approve" && correction !== null) throw new Error(`human review workbook decision ${index} approval cannot contain a correction`);
    const approved = item.decision === "approve";
    const partition = item.partition === "development" || item.partition === "selection" ? item.partition : null;
    const caseClass = item.caseClass === "bug-bearing" || item.caseClass === "reviewed-comparison" ? item.caseClass : null;
    const duplicateFamilyId = typeof item.duplicateFamilyId === "string" && FAMILY_ID.test(item.duplicateFamilyId)
      ? item.duplicateFamilyId : null;
    if (approved ? partition === null || caseClass === null || duplicateFamilyId === null
      : item.partition !== null || item.caseClass !== null || item.duplicateFamilyId !== null) {
      throw new Error(`human review workbook decision ${index} partition fields do not match its decision`);
    }
    return {
      dossierId: expected.dossierId,
      dossierBundleSha256: expected.dossierBundleSha256,
      decision: item.decision as HumanReviewDecision,
      reason,
      correction,
      acknowledgedDossierBundleSha256: expected.dossierBundleSha256,
      partition,
      caseClass,
      duplicateFamilyId,
      reviewedAt: timestamp(item.reviewedAt, `human review workbook decision ${index} reviewedAt`),
    };
  });
  const familyPartitions = new Map<string, string>();
  for (const item of decisions) {
    if (item.decision !== "approve") continue;
    const prior = familyPartitions.get(item.duplicateFamilyId!);
    if (prior !== undefined && prior !== item.partition) throw new Error("human review workbook duplicate family spans partitions");
    familyPartitions.set(item.duplicateFamilyId!, item.partition!);
  }
  const packetDecision = exactObject(root.packetDecision, ["reviewMode", "acknowledgedPacketSha256", "soleHumanReviewerAcknowledged", "reviewedEveryDecisionCard", "decisionsBindPacketAndDossierHashes", "duplicateFamiliesAccepted", "partitionedEveryApprovedDossier", "soleHumanPartitionAccepted", "limitationsAccepted", "independentTwoHumanConfirmationClaimed", "independentSelectionClaimed", "completedAt"], "human review workbook packetDecision");
  if (packetDecision.reviewMode !== "sole-human-v1" || packetDecision.acknowledgedPacketSha256 !== packet.packetSha256) throw new Error("human review workbook packetDecision does not bind the packet");
  for (const field of ["soleHumanReviewerAcknowledged", "reviewedEveryDecisionCard", "decisionsBindPacketAndDossierHashes", "duplicateFamiliesAccepted", "partitionedEveryApprovedDossier", "soleHumanPartitionAccepted", "limitationsAccepted"]) {
    if (packetDecision[field] !== true) throw new Error(`human review workbook packetDecision.${field} must be true`);
  }
  if (packetDecision.independentTwoHumanConfirmationClaimed !== false) throw new Error("human review workbook must not claim two independent human confirmations");
  if (packetDecision.independentSelectionClaimed !== false) throw new Error("human review workbook must not claim independent selection");
  const completedAt = timestamp(packetDecision.completedAt, "human review workbook packetDecision.completedAt");
  if (decisions.some((item) => item.reviewedAt > completedAt)) throw new Error("human review workbook packetDecision predates an individual decision");

  const requested = resolve(input.destination);
  if (existsSync(requested)) throw new Error("refusing to overwrite an existing compiled response");
  const parent = directDirectory(dirname(requested), "compiled response parent");
  const destination = join(parent, basename(requested));
  const requestedAttestation = resolve(input.partitionAttestationFile);
  if (existsSync(requestedAttestation)) throw new Error("refusing to overwrite an existing partition attestation");
  const attestationParent = directDirectory(dirname(requestedAttestation), "partition attestation parent");
  const partitionAttestationFile = join(attestationParent, basename(requestedAttestation));
  const workbookRoot = realpathSync(dirname(workbookPath));
  if (inside(packetRoot, destination) || inside(destination, packetRoot) || inside(workbookRoot, destination) || inside(destination, workbookRoot) ||
      inside(packetRoot, partitionAttestationFile) || inside(workbookRoot, partitionAttestationFile) || inside(destination, partitionAttestationFile)) {
    throw new Error("packet, workbook, compiled response, and partition attestation must be disjoint");
  }
  let created = false;
  let attestationCreated = false;
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
    const response = verifyHumanReviewResponse(packetRoot, destination, expectedIdentity);
    const approvedDossiers = decisions
      .filter((item) => item.decision === "approve")
      .map((item): R2PartitionAttestationDossier => ({
        dossierId: item.dossierId,
        partition: item.partition! as R2Partition,
        caseClass: item.caseClass! as R2CaseClass,
        duplicateFamilyId: item.duplicateFamilyId!,
      }))
      .sort((left, right) => left.dossierId.localeCompare(right.dossierId));
    const partitionAttestation = buildR2PartitionAttestation({
      schemaVersion: 1,
      protocol: "r2-partition-attestation-v1",
      packetSha256: packet.packetSha256,
      responseSha256: response.responseSha256,
      humanReviewerIdentitySha256: expectedIdentity,
      approvedDossiers,
      soleHumanPartitionAccepted: true,
      independentSelectionClaimed: false,
      reviewedAt: completedAt,
    });
    const attestationBytes = `${JSON.stringify(partitionAttestation, null, 2)}\n`;
    writeFileSync(partitionAttestationFile, attestationBytes, { flag: "wx" });
    attestationCreated = true;
    return { response, partitionAttestation, partitionAttestationFileSha256: sha256(attestationBytes) };
  } catch (error) {
    if (attestationCreated) unlinkSync(partitionAttestationFile);
    if (created) rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

function runCli(): void {
  const args = process.argv.slice(2);
  if (args.length === 4) {
    const [packetDirectory, workbookFile, destination, expectedIdentity] = args as [string, string, string, string];
    process.stdout.write(`${JSON.stringify(compileHumanReviewWorkbook({ packetDirectory, workbookFile, destination, expectedHumanReviewerIdentitySha256: expectedIdentity }))}\n`);
    return;
  }
  if (args.length === 5) {
    const [packetDirectory, workbookFile, destination, partitionAttestationFile, expectedIdentity] = args as [string, string, string, string, string];
    process.stdout.write(`${JSON.stringify(compileHumanReviewWorkbookWithPartition({ packetDirectory, workbookFile, destination, partitionAttestationFile, expectedHumanReviewerIdentitySha256: expectedIdentity }))}\n`);
    return;
  }
  throw new Error("usage: compile-human-review-workbook.ts <packet-directory> <completed-workbook.json> <new-response-directory> [new-partition-attestation.json] <expected-reviewer-identity-sha256>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
