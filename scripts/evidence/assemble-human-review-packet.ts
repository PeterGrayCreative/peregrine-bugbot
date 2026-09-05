import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/;
const PORTABLE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const READY_CARD_NAMES = new Set(["human-evidence-card.md", "human-review-card.md"]);
const LOSS_CARD_NAMES = new Set(["sampled-loss.md"]);
const CLASSIFICATIONS = new Set(["ready-for-human-review", "reconstruction-loss"]);

export type HumanPacketClassification = "ready-for-human-review" | "reconstruction-loss";

export interface HumanPacketFileInput {
  path: string;
  sha256: string;
}

export interface HumanPacketDossierInput {
  dossierId: string;
  sourceRoot: string;
  classification: HumanPacketClassification;
  manifest: HumanPacketFileInput;
  cardPath: string;
  files: HumanPacketFileInput[];
}

export interface HumanPacketAssemblyRequest {
  schemaVersion: 1;
  packetId: string;
  dossiers: HumanPacketDossierInput[];
}

interface CapturedFile {
  sourcePath: string;
  outputPath: string;
  bytes: Buffer;
  sha256: string;
}

interface CapturedDossier {
  dossierId: string;
  sourceRoot: string;
  classification: HumanPacketClassification;
  manifest: CapturedFile;
  cardPath: string;
  files: CapturedFile[];
  bundleSha256: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has missing or unknown fields`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function portableRelativePath(value: unknown, label: string): string {
  const path = text(value, label);
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.trim() !== path ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw new Error(`${label} must be a safe portable relative path`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !PORTABLE_SEGMENT.test(segment) || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a safe portable relative path`);
  }
  return path;
}

function identifier(value: unknown, label: string): string {
  const id = text(value, label);
  if (!PORTABLE_SEGMENT.test(id) || id === "." || id === "..") {
    throw new Error(`${label} must be a portable identifier`);
  }
  return id;
}

function digest(value: unknown, label: string): string {
  const hash = text(value, label);
  if (!SHA256.test(hash)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return hash;
}

function parseFile(value: unknown, label: string): HumanPacketFileInput {
  const input = record(value, label);
  exactKeys(input, ["path", "sha256"], label);
  return {
    path: portableRelativePath(input.path, `${label}.path`),
    sha256: digest(input.sha256, `${label}.sha256`),
  };
}

export function parseHumanPacketAssemblyRequest(value: unknown): HumanPacketAssemblyRequest {
  const input = record(value, "assembly request");
  exactKeys(input, ["schemaVersion", "packetId", "dossiers"], "assembly request");
  if (input.schemaVersion !== 1) throw new Error("assembly request.schemaVersion must be 1");
  if (!Array.isArray(input.dossiers) || input.dossiers.length === 0) {
    throw new Error("assembly request.dossiers must be a non-empty array");
  }

  const seenIds = new Set<string>();
  const dossiers = input.dossiers.map((rawDossier, dossierIndex) => {
    const label = `assembly request.dossiers[${dossierIndex}]`;
    const dossier = record(rawDossier, label);
    exactKeys(dossier, ["dossierId", "sourceRoot", "classification", "manifest", "cardPath", "files"], label);
    const dossierId = identifier(dossier.dossierId, `${label}.dossierId`);
    if (seenIds.has(dossierId)) throw new Error(`duplicate dossierId: ${dossierId}`);
    seenIds.add(dossierId);
    const sourceRoot = text(dossier.sourceRoot, `${label}.sourceRoot`);
    const classification = text(dossier.classification, `${label}.classification`);
    if (!CLASSIFICATIONS.has(classification)) throw new Error(`${label}.classification is invalid`);
    const manifest = parseFile(dossier.manifest, `${label}.manifest`);
    const cardPath = portableRelativePath(dossier.cardPath, `${label}.cardPath`);
    const allowedCards = classification === "reconstruction-loss" ? LOSS_CARD_NAMES : READY_CARD_NAMES;
    if (!allowedCards.has(basename(cardPath))) {
      throw new Error(`${label}.cardPath is not supported for ${classification}`);
    }
    if (!Array.isArray(dossier.files) || dossier.files.length === 0) {
      throw new Error(`${label}.files must be a non-empty array`);
    }
    const seenFiles = new Set<string>([manifest.path]);
    const files = dossier.files.map((rawFile, fileIndex) => {
      const file = parseFile(rawFile, `${label}.files[${fileIndex}]`);
      if (seenFiles.has(file.path)) throw new Error(`${label} has duplicate file path: ${file.path}`);
      seenFiles.add(file.path);
      return file;
    });
    if (!files.some((file) => file.path === cardPath)) throw new Error(`${label}.cardPath must appear in files`);
    return {
      dossierId,
      sourceRoot,
      classification: classification as HumanPacketClassification,
      manifest,
      cardPath,
      files,
    };
  });

  return { schemaVersion: 1, packetId: identifier(input.packetId, "assembly request.packetId"), dossiers };
}

function directRoot(path: string, label: string): string {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct regular directory`);
  return realpathSync(absolute);
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function containsPath(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function directFile(root: string, path: string, label: string): string {
  let current = root;
  const segments = path.split("/");
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not traverse symbolic links`);
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`${label} has a non-directory parent`);
    if (index === segments.length - 1 && !stat.isFile()) throw new Error(`${label} must be a direct regular file`);
  }
  const canonical = realpathSync(current);
  if (relative(root, canonical).startsWith(`..${sep}`) || relative(root, canonical) === "..") {
    throw new Error(`${label} escapes its source root`);
  }
  return canonical;
}

function capture(root: string, input: HumanPacketFileInput, outputPath: string, label: string): CapturedFile {
  const sourcePath = directFile(root, input.path, label);
  const bytes = readFileSync(sourcePath);
  const actual = sha256(bytes);
  if (actual !== input.sha256) throw new Error(`${label} does not match its expected SHA-256`);
  return { sourcePath, outputPath, bytes, sha256: actual };
}

function encodedJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function blankDecision(dossier: CapturedDossier, packetId: string): Buffer {
  return encodedJson({
    schemaVersion: 1,
    templateOnly: true,
    packetId,
    dossierId: dossier.dossierId,
    dossierBundleSha256: dossier.bundleSha256,
    decision: null,
    reason: null,
    correction: null,
    acknowledgedDossierBundleSha256: null,
    humanReviewerIdentity: null,
    reviewedAt: null,
  });
}

function renderIndex(packetId: string, dossiers: CapturedDossier[]): Buffer {
  const ready = dossiers.filter((item) => item.classification === "ready-for-human-review");
  const losses = dossiers.filter((item) => item.classification === "reconstruction-loss");
  const links = (items: CapturedDossier[]) => items.length === 0
    ? "_None._"
    : items.map((item) => `- [${item.dossierId}](dossiers/${item.dossierId}/${item.cardPath})`).join("\n");
  return Buffer.from(`# R2 consolidated human-review packet: ${packetId}\n\n` +
    `This packet is **review-only and non-admissible**. It uses the \`sole-human-review-only-v1\` mode. ` +
    `Only the accountable human reviewer may complete the blank decision templates.\n\n` +
    `Assembly does not establish truth, approval, human confirmation, independent review, protected selection, admission, or partition assignment. ` +
    `AI preparation records cannot satisfy a human gate.\n\n` +
    `The caller is responsible for supplying a complete dossier file list and closing every referenced artifact. ` +
    `The assembler verifies listed bytes and hashes only; it does not authenticate semantic completeness or reference closure.\n\n` +
    `## Ready for human review (${ready.length})\n\n${links(ready)}\n\n` +
    `## Retained reconstruction losses (${losses.length})\n\n${links(losses)}\n\n` +
    `Silence and blank fields are not decisions. Copy the blank files under \`decisions/\` and \`packet-decision.json\` ` +
    `into a separate response folder before completing them. Never edit this sealed packet. A completed response must be authenticated separately ` +
    `and bind the packet and dossier hashes.\n`);
}

function outputRecord(path: string, bytes: Buffer) {
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

export function assembleHumanReviewPacket(rawRequest: unknown, destinationPath: string): {
  packetId: string;
  packetSha256: string;
  destination: string;
} {
  const request = parseHumanPacketAssemblyRequest(rawRequest);
  const requestedDestination = resolve(text(destinationPath, "destination"));
  const destinationAlreadyExists = pathExists(requestedDestination);
  const parent = dirname(requestedDestination);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("packet destination parent must be a direct directory");
  const canonicalParent = realpathSync(parent);
  let destination: string;
  if (destinationAlreadyExists) {
    try {
      destination = realpathSync(requestedDestination);
    } catch {
      throw new Error("refusing to overwrite an existing packet destination");
    }
  } else {
    destination = join(canonicalParent, basename(requestedDestination));
  }

  const seenManifests = new Set<string>();
  const dossiers: CapturedDossier[] = request.dossiers.map((input) => {
    const root = directRoot(input.sourceRoot, `${input.dossierId}.sourceRoot`);
    const manifest = capture(root, input.manifest, `dossiers/${input.dossierId}/${input.manifest.path}`, `${input.dossierId}.manifest`);
    if (seenManifests.has(manifest.sourcePath)) throw new Error(`duplicate dossier manifest source: ${input.dossierId}`);
    seenManifests.add(manifest.sourcePath);
    const files = input.files.map((file) =>
      capture(root, file, `dossiers/${input.dossierId}/${file.path}`, `${input.dossierId}.${file.path}`));
    const bindings = [manifest, ...files].map((file) => ({
      path: file.outputPath.replace(`dossiers/${input.dossierId}/`, ""),
      bytes: file.bytes.byteLength,
      sha256: file.sha256,
    }));
    const bundleSha256 = sha256(Buffer.from(JSON.stringify({
      protocol: "r2-human-review-packet-review-only-v1",
      dossierId: input.dossierId,
      classification: input.classification,
      manifestPath: input.manifest.path,
      files: bindings,
    })));
    return { dossierId: input.dossierId, sourceRoot: root, classification: input.classification, manifest, cardPath: input.cardPath, files, bundleSha256 };
  });
  for (const dossier of dossiers) {
    if (containsPath(dossier.sourceRoot, destination) || containsPath(destination, dossier.sourceRoot)) {
      throw new Error(`packet destination and ${dossier.dossierId} source root must be disjoint`);
    }
  }
  if (destinationAlreadyExists) throw new Error("refusing to overwrite an existing packet destination");

  const index = renderIndex(request.packetId, dossiers);
  const lossLedger = encodedJson({
    schemaVersion: 1,
    packetId: request.packetId,
    retainedLosses: dossiers
      .filter((item) => item.classification === "reconstruction-loss")
      .map((item) => ({ dossierId: item.dossierId, dossierBundleSha256: item.bundleSha256, cardPath: `dossiers/${item.dossierId}/${item.cardPath}` })),
  });
  const decisions = dossiers
    .filter((item) => item.classification === "ready-for-human-review")
    .map((item) => ({ path: `decisions/${item.dossierId}.json`, bytes: blankDecision(item, request.packetId) }));
  const packetDecision = encodedJson({
    schemaVersion: 1,
    templateOnly: true,
    packetId: request.packetId,
    reviewMode: "sole-human-review-only-v1",
    acknowledgedPacketSha256: null,
    humanReviewerIdentity: null,
    soleHumanReviewerAcknowledged: null,
    reviewedEveryDecisionCard: null,
    decisionsBindPacketAndDossierHashes: null,
    duplicateFamiliesAccepted: null,
    limitationsAccepted: null,
    independentTwoHumanConfirmationClaimed: null,
    completedAt: null,
  });
  const generated = [
    { path: "review-index.md", bytes: index },
    { path: "loss-ledger.json", bytes: lossLedger },
    ...decisions,
    { path: "packet-decision.json", bytes: packetDecision },
  ];
  const dossierBindings = dossiers.map((dossier) => ({
    dossierId: dossier.dossierId,
    classification: dossier.classification,
    manifest: outputRecord(dossier.manifest.outputPath, dossier.manifest.bytes),
    cardPath: `dossiers/${dossier.dossierId}/${dossier.cardPath}`,
    dossierBundleSha256: dossier.bundleSha256,
    files: dossier.files.map((file) => outputRecord(file.outputPath, file.bytes)),
  }));
  const generatedBindings = generated.map((file) => outputRecord(file.path, file.bytes));
  const packetCore = {
    protocol: "r2-human-review-packet-review-only-v1",
    packetId: request.packetId,
    reviewMode: "sole-human-review-only-v1",
    claims: {
      reviewOnly: true,
      admissible: false,
      humanDecisionsPresent: false,
      independentHumanConfirmations: 0,
      protectedSelectionEstablished: false,
      partitionAssigned: false,
      sourceFileListCompletenessAuthenticated: false,
      referenceClosureAuthenticated: false,
    },
    counts: {
      proposals: dossiers.filter((item) => item.classification === "ready-for-human-review").length,
      retainedLosses: dossiers.filter((item) => item.classification === "reconstruction-loss").length,
    },
    dossiers: dossierBindings,
    generatedFiles: generatedBindings,
  };
  const packetSha256 = sha256(Buffer.from(JSON.stringify(packetCore)));
  const packetManifest = encodedJson({ schemaVersion: 1, ...packetCore, packetSha256 });

  let created = false;
  try {
    mkdirSync(destination);
    created = true;
    for (const dossier of dossiers) {
      for (const file of [dossier.manifest, ...dossier.files]) {
        const output = join(destination, ...file.outputPath.split("/"));
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, file.bytes, { flag: "wx" });
      }
    }
    for (const file of generated) {
      const output = join(destination, ...file.path.split("/"));
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, file.bytes, { flag: "wx" });
    }
    writeFileSync(join(destination, "packet-manifest.json"), packetManifest, { flag: "wx" });
  } catch (error) {
    if (created) rmSync(destination, { recursive: true, force: true });
    throw error;
  }

  return { packetId: request.packetId, packetSha256, destination };
}

function runCli(): void {
  const [requestPath, destination] = process.argv.slice(2);
  if (!requestPath || !destination || process.argv.length !== 4) {
    throw new Error("usage: assemble-human-review-packet.ts <assembly-request.json> <new-output-directory>");
  }
  const request = JSON.parse(readFileSync(resolve(requestPath), "utf8")) as unknown;
  process.stdout.write(`${JSON.stringify(assembleHumanReviewPacket(request, destination))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
