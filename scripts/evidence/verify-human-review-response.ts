import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;
const DOSSIER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type HumanReviewDecision = "approve" | "reject" | "unresolved";

export interface VerifiedHumanReviewResponse {
  schemaVersion: 1;
  protocol: "r2-sole-human-response-v1";
  packetId: string;
  packetSha256: string;
  humanReviewerIdentitySha256: string;
  decisions: Array<{
    dossierId: string;
    dossierBundleSha256: string;
    decision: HumanReviewDecision;
    reason: string;
    correction: string | null;
    reviewedAt: string;
    responseFileSha256: string;
  }>;
  packetDecisionSha256: string;
  counts: Record<HumanReviewDecision, number>;
  completedAt: string;
  verificationBoundary: "caller-registered-identity-and-byte-binding-only";
  responseSha256: string;
}

interface PacketDossier {
  dossierId: string;
  classification: "ready-for-human-review" | "reconstruction-loss";
  dossierBundleSha256: string;
}

interface PacketManifest {
  packetId: string;
  packetSha256: string;
  dossiers: PacketDossier[];
}

interface BoundFile {
  path: string;
  bytes: number;
  sha256: string;
}

export function verifyHumanReviewResponse(
  packetDirectory: string,
  responseDirectory: string,
  expectedHumanIdentitySha256: string,
): VerifiedHumanReviewResponse {
  const expectedIdentity = digest(expectedHumanIdentitySha256, "expected human identity");
  const packetRoot = directDirectory(packetDirectory, "packet directory");
  const responseRoot = directDirectory(responseDirectory, "response directory");
  if (contains(packetRoot, responseRoot) || contains(responseRoot, packetRoot)) {
    throw new Error("packet and response directories must be disjoint");
  }
  const packet = readPacketManifest(packetRoot);
  assertResponseLayout(responseRoot, packet.dossiers);

  const ready = packet.dossiers.filter((item) => item.classification === "ready-for-human-review");
  const decisions = ready.map((dossier) => {
    const path = directFile(responseRoot, `decisions/${dossier.dossierId}.json`, `${dossier.dossierId} decision`);
    const bytes = readFileSync(path);
    const value = parseJson(bytes, `${dossier.dossierId} decision`);
    const root = exactObject(value, `${dossier.dossierId} decision`, [
      "schemaVersion", "templateOnly", "packetId", "dossierId", "dossierBundleSha256",
      "decision", "reason", "correction", "acknowledgedDossierBundleSha256",
      "humanReviewerIdentitySha256", "reviewedAt",
    ]);
    if (root.schemaVersion !== 1 || root.templateOnly !== false || root.packetId !== packet.packetId ||
        root.dossierId !== dossier.dossierId || root.dossierBundleSha256 !== dossier.dossierBundleSha256 ||
        root.acknowledgedDossierBundleSha256 !== dossier.dossierBundleSha256) {
      throw new Error(`${dossier.dossierId} decision does not bind its packet dossier`);
    }
    if (root.humanReviewerIdentitySha256 !== expectedIdentity) {
      throw new Error(`${dossier.dossierId} decision does not use the registered human identity`);
    }
    if (root.decision !== "approve" && root.decision !== "reject" && root.decision !== "unresolved") {
      throw new Error(`${dossier.dossierId} decision is invalid`);
    }
    const reason = boundedText(root.reason, `${dossier.dossierId} decision reason`);
    const correction = root.correction === null ? null : boundedText(root.correction, `${dossier.dossierId} correction`);
    const reviewedAt = timestamp(root.reviewedAt, `${dossier.dossierId} reviewedAt`);
    return {
      dossierId: dossier.dossierId,
      dossierBundleSha256: dossier.dossierBundleSha256,
      decision: root.decision as HumanReviewDecision,
      reason,
      correction,
      reviewedAt,
      responseFileSha256: sha256(bytes),
    };
  });

  const packetDecisionPath = directFile(responseRoot, "packet-decision.json", "packet decision");
  const packetDecisionBytes = readFileSync(packetDecisionPath);
  const packetDecision = exactObject(parseJson(packetDecisionBytes, "packet decision"), "packet decision", [
    "schemaVersion", "templateOnly", "packetId", "reviewMode", "acknowledgedPacketSha256",
    "humanReviewerIdentitySha256", "soleHumanReviewerAcknowledged", "reviewedEveryDecisionCard",
    "decisionsBindPacketAndDossierHashes", "duplicateFamiliesAccepted", "limitationsAccepted",
    "independentTwoHumanConfirmationClaimed", "completedAt",
  ]);
  if (packetDecision.schemaVersion !== 1 || packetDecision.templateOnly !== false ||
      packetDecision.packetId !== packet.packetId || packetDecision.reviewMode !== "sole-human-v1" ||
      packetDecision.acknowledgedPacketSha256 !== packet.packetSha256 ||
      packetDecision.humanReviewerIdentitySha256 !== expectedIdentity) {
    throw new Error("packet decision does not bind the packet and registered human identity");
  }
  for (const field of [
    "soleHumanReviewerAcknowledged", "reviewedEveryDecisionCard",
    "decisionsBindPacketAndDossierHashes", "duplicateFamiliesAccepted", "limitationsAccepted",
  ]) {
    if (packetDecision[field] !== true) throw new Error(`packet decision.${field} must be true`);
  }
  if (packetDecision.independentTwoHumanConfirmationClaimed !== false) {
    throw new Error("packet decision must not claim two independent human confirmations");
  }
  const completedAt = timestamp(packetDecision.completedAt, "packet decision completedAt");
  if (decisions.some((decision) => Date.parse(decision.reviewedAt) > Date.parse(completedAt))) {
    throw new Error("packet decision predates an individual decision");
  }

  const counts = {
    approve: decisions.filter((item) => item.decision === "approve").length,
    reject: decisions.filter((item) => item.decision === "reject").length,
    unresolved: decisions.filter((item) => item.decision === "unresolved").length,
  };
  const body = {
    schemaVersion: 1 as const,
    protocol: "r2-sole-human-response-v1" as const,
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    humanReviewerIdentitySha256: expectedIdentity,
    decisions,
    packetDecisionSha256: sha256(packetDecisionBytes),
    counts,
    completedAt,
    verificationBoundary: "caller-registered-identity-and-byte-binding-only" as const,
  };
  return { ...body, responseSha256: sha256(Buffer.from(JSON.stringify(body))) };
}

function readPacketManifest(root: string): PacketManifest {
  const path = directFile(root, "packet-manifest.json", "packet manifest");
  const manifest = exactObject(parseJson(readFileSync(path), "packet manifest"), "packet manifest", [
    "schemaVersion", "protocol", "packetId", "reviewMode", "claims", "counts",
    "dossiers", "generatedFiles", "packetSha256",
  ]);
  if (manifest.schemaVersion !== 1 || manifest.protocol !== "r2-human-review-packet-review-only-v1" ||
      manifest.reviewMode !== "sole-human-v1" || typeof manifest.packetId !== "string" ||
      !DOSSIER_ID.test(manifest.packetId)) throw new Error("packet manifest identity is invalid");
  const packetSha256 = digest(manifest.packetSha256, "packet manifest.packetSha256");
  const { schemaVersion: _version, packetSha256: _digest, ...core } = manifest;
  if (sha256(Buffer.from(JSON.stringify(core))) !== packetSha256) {
    throw new Error("packet manifest digest is invalid");
  }
  if (!Array.isArray(manifest.dossiers) || manifest.dossiers.length === 0) {
    throw new Error("packet manifest has no dossiers");
  }
  const seen = new Set<string>();
  const boundPaths = new Set<string>(["packet-manifest.json"]);
  const dossiers = manifest.dossiers.map((value, index): PacketDossier => {
    const item = exactObject(value, `packet dossier ${index}`, [
      "dossierId", "classification", "manifest", "cardPath", "dossierBundleSha256", "files",
    ]);
    if (typeof item.dossierId !== "string" || !DOSSIER_ID.test(item.dossierId) || seen.has(item.dossierId)) {
      throw new Error("packet manifest has an invalid or duplicate dossier ID");
    }
    seen.add(item.dossierId);
    if (item.classification !== "ready-for-human-review" && item.classification !== "reconstruction-loss") {
      throw new Error(`${item.dossierId} has an invalid packet classification`);
    }
    const dossierPrefix = `dossiers/${item.dossierId}/`;
    const dossierManifest = verifyBoundFile(root, item.manifest, `${item.dossierId} manifest`);
    if (!dossierManifest.path.startsWith(dossierPrefix)) {
      throw new Error(`${item.dossierId} manifest path is outside its dossier`);
    }
    if (!Array.isArray(item.files) || item.files.length === 0) throw new Error(`${item.dossierId} has no files`);
    const files = item.files.map((file, fileIndex) => {
      const parsed = verifyBoundFile(root, file, `${item.dossierId} file ${fileIndex}`);
      if (!parsed.path.startsWith(dossierPrefix)) throw new Error(`${item.dossierId} file is outside its dossier`);
      return parsed;
    });
    for (const file of [dossierManifest, ...files]) {
      if (boundPaths.has(file.path)) throw new Error(`packet manifest repeats bound path ${file.path}`);
      boundPaths.add(file.path);
    }
    if (typeof item.cardPath !== "string" || !files.some((file) => file.path === item.cardPath)) {
      throw new Error(`${item.dossierId} card is not a bound dossier file`);
    }
    const dossierBundle = digest(item.dossierBundleSha256, `${item.dossierId} bundle`);
    const manifestPath = dossierManifest.path.slice(dossierPrefix.length);
    const bindings = [dossierManifest, ...files].map((file) => ({
      path: file.path.slice(dossierPrefix.length),
      bytes: file.bytes,
      sha256: file.sha256,
    }));
    const expectedBundle = sha256(Buffer.from(JSON.stringify({
      protocol: "r2-human-review-packet-review-only-v1",
      dossierId: item.dossierId,
      classification: item.classification,
      manifestPath,
      files: bindings,
    })));
    if (dossierBundle !== expectedBundle) {
      throw new Error(`${item.dossierId} dossier bundle digest is invalid`);
    }
    return {
      dossierId: item.dossierId,
      classification: item.classification,
      dossierBundleSha256: dossierBundle,
    };
  });
  if (!Array.isArray(manifest.generatedFiles)) throw new Error("packet manifest.generatedFiles must be an array");
  const generatedPaths: string[] = [];
  for (const [index, file] of manifest.generatedFiles.entries()) {
    const parsed = verifyBoundFile(root, file, `generated file ${index}`);
    if (boundPaths.has(parsed.path)) throw new Error(`packet manifest repeats bound path ${parsed.path}`);
    boundPaths.add(parsed.path);
    generatedPaths.push(parsed.path);
  }
  const claims = exactObject(manifest.claims, "packet manifest.claims", [
    "reviewOnly", "admissible", "humanDecisionsPresent", "independentHumanConfirmations",
    "protectedSelectionEstablished", "partitionAssigned", "sourceFileListCompletenessAuthenticated",
    "referenceClosureAuthenticated",
  ]);
  if (claims.reviewOnly !== true || claims.admissible !== false || claims.humanDecisionsPresent !== false ||
      claims.independentHumanConfirmations !== 0 || claims.protectedSelectionEstablished !== false ||
      claims.partitionAssigned !== false || claims.sourceFileListCompletenessAuthenticated !== false ||
      claims.referenceClosureAuthenticated !== false) throw new Error("packet manifest claims are invalid");
  const counts = exactObject(manifest.counts, "packet manifest.counts", ["proposals", "retainedLosses"]);
  if (counts.proposals !== dossiers.filter((item) => item.classification === "ready-for-human-review").length ||
      counts.retainedLosses !== dossiers.filter((item) => item.classification === "reconstruction-loss").length) {
    throw new Error("packet manifest counts are invalid");
  }
  const requiredGeneratedPaths = [
    "review-index.md",
    "loss-ledger.json",
    ...dossiers.filter((item) => item.classification === "ready-for-human-review")
      .map((item) => `decisions/${item.dossierId}.json`),
    "packet-decision.json",
  ].sort();
  if (JSON.stringify(generatedPaths.sort()) !== JSON.stringify(requiredGeneratedPaths)) {
    throw new Error("packet generated files do not match required review templates");
  }
  assertPacketClosure(root, boundPaths);
  return { packetId: manifest.packetId, packetSha256, dossiers };
}

function verifyBoundFile(root: string, value: unknown, label: string): BoundFile {
  const file = exactObject(value, label, ["path", "bytes", "sha256"]);
  if (typeof file.path !== "string" || file.path.startsWith("/") || file.path.includes("\\") ||
      file.path.split("/").some((part) => !DOSSIER_ID.test(part) || part === "." || part === "..")) {
    throw new Error(`${label}.path is unsafe`);
  }
  if (!Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0) throw new Error(`${label}.bytes is invalid`);
  const expected = digest(file.sha256, `${label}.sha256`);
  const bytes = readFileSync(directFile(root, file.path, label));
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== expected) throw new Error(`${label} bytes do not match`);
  return { path: file.path, bytes: Number(file.bytes), sha256: expected };
}

function assertPacketClosure(root: string, expected: ReadonlySet<string>): void {
  const actual: string[] = [];
  const visit = (directory: string, prefix = ""): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`packet contains symbolic link ${relativePath}`);
      if (stat.isDirectory()) visit(path, relativePath);
      else if (stat.isFile()) actual.push(relativePath);
      else throw new Error(`packet contains unsupported entry ${relativePath}`);
    }
  };
  visit(root);
  const wanted = [...expected].sort();
  actual.sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error("packet file closure does not match its manifest");
  }
}

function assertResponseLayout(root: string, dossiers: readonly PacketDossier[]): void {
  const rootEntries = readdirSync(root, { withFileTypes: true });
  if (rootEntries.length !== 2 || !rootEntries.some((entry) => entry.isFile() && entry.name === "packet-decision.json") ||
      !rootEntries.some((entry) => entry.isDirectory() && entry.name === "decisions")) {
    throw new Error("response directory must contain only packet-decision.json and decisions/");
  }
  const decisionsRoot = directDirectory(join(root, "decisions"), "response decisions directory");
  const expected = dossiers
    .filter((item) => item.classification === "ready-for-human-review")
    .map((item) => `${item.dossierId}.json`).sort();
  const actual = readdirSync(decisionsRoot, { withFileTypes: true });
  if (actual.some((entry) => !entry.isFile()) ||
      JSON.stringify(actual.map((entry) => entry.name).sort()) !== JSON.stringify(expected)) {
    throw new Error("response decisions must exactly match ready packet dossiers");
  }
}

function directDirectory(path: string, label: string): string {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct non-symlink directory`);
  return realpathSync(absolute);
}

function directFile(root: string, relativePath: string, label: string): string {
  let current = root;
  for (const [index, part] of relativePath.split("/").entries()) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not traverse symbolic links`);
    if (index < relativePath.split("/").length - 1 && !stat.isDirectory()) throw new Error(`${label} parent is not a directory`);
    if (index === relativePath.split("/").length - 1 && !stat.isFile()) throw new Error(`${label} is not a regular file`);
  }
  const canonical = realpathSync(current);
  if (!contains(root, canonical)) throw new Error(`${label} escapes its root`);
  return canonical;
}

function contains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function exactObject(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const root = value as Record<string, unknown>;
  if (Object.keys(root).length !== keys.length || keys.some((key) => !Object.hasOwn(root, key))) {
    throw new Error(`${label} has an invalid shape`);
  }
  return root;
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
  return value;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_000) {
    throw new Error(`${label} must contain 1-4000 characters`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp`);
  }
  return value;
}
