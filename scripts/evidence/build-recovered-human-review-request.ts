import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleHumanReviewPacket,
  type HumanPacketAssemblyRequest,
  type HumanPacketClassification,
  type HumanPacketDossierInput,
  type HumanPacketFileInput,
} from "./assemble-human-review-packet.js";
/*
 * This adapter is intentionally specific to the restore-tested 2026-09-07
 * checkpoint. General collection belongs in the later R2 collector, not here.
 */
const PORTABLE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const EXPECTED_READY = 30;
const EXPECTED_LOSSES = 10;
const SUPPLEMENTARY_IDS: Readonly<Record<string, readonly string[]>> = {
  v1: ["r2-post-merge-alpha-002", "r2-post-merge-alpha-004"],
  v2: ["r2-post-merge-alpha-003", "r2-post-merge-alpha-005"],
  v3: ["r2-post-merge-alpha-007", "r2-post-merge-alpha-009"],
  v4: [
    "r2-post-merge-alpha-008",
    "r2-post-merge-alpha-011",
    "r2-post-merge-alpha-012",
    "r2-post-merge-alpha-013",
  ],
};
const COMPARISON_V1_IDS = ["r2-random-001", "r2-random-002", "r2-random-004", "r2-random-007"];
const COMPARISON_V2_IDS = ["r2-random-008", "r2-random-012", "r2-random-014"];
const SAMPLED_LOSS_IDS = [
  "r2-random-003", "r2-random-005", "r2-random-006", "r2-random-009", "r2-random-010",
  "r2-random-011", "r2-random-013", "r2-random-015", "r2-random-016",
];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function directDirectory(path: string, label: string): string {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct non-symlink directory`);
  return realpathSync(absolute);
}

function portablePath(path: string, label: string): string {
  const parts = path.split("/");
  if (parts.some((part) => part === "." || part === ".." || !PORTABLE_SEGMENT.test(part))) {
    throw new Error(`${label} has a non-portable path: ${path}`);
  }
  return path;
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const rel = portablePath(relative(root, path).split(sep).join("/"), "recovered source");
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`recovered source must not contain symlink: ${rel}`);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) files.push(rel);
      else throw new Error(`recovered source has unsupported entry: ${rel}`);
    }
  };
  visit(root);
  return files.sort();
}

function fileBinding(root: string, path: string): HumanPacketFileInput {
  return { path, sha256: sha256(readFileSync(join(root, ...path.split("/")))) };
}

function dossier(
  dossierId: string,
  sourceRoot: string,
  classification: HumanPacketClassification,
  manifestPath: string,
  cardPath: string,
): HumanPacketDossierInput {
  const root = directDirectory(sourceRoot, `${dossierId} source`);
  const paths = walkFiles(root);
  if (!paths.includes(manifestPath)) throw new Error(`${dossierId} is missing manifest ${manifestPath}`);
  if (!paths.includes(cardPath)) throw new Error(`${dossierId} is missing card ${cardPath}`);
  return {
    dossierId,
    sourceRoot: root,
    classification,
    manifest: fileBinding(root, manifestPath),
    cardPath,
    files: paths.filter((path) => path !== manifestPath).map((path) => fileBinding(root, path)),
  };
}

function childDirectories(root: string, label: string): string[] {
  return readdirSync(directDirectory(root, label), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function selectCard(root: string, names: readonly string[], dossierId: string): string {
  const present = names.filter((name) => {
    try {
      return lstatSync(join(root, name)).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  });
  if (present.length !== 1) throw new Error(`${dossierId} must have exactly one supported review card`);
  return present[0]!;
}

function assertIds(actual: readonly string[], expected: readonly string[], label: string): void {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} does not match the recovered checkpoint inventory`);
  }
}

export function buildRecoveredHumanReviewRequest(
  recoveryRootPath: string,
  packetId = "r2-recovered-human-review-v1",
): HumanPacketAssemblyRequest {
  const recoveryRoot = directDirectory(recoveryRootPath, "recovery root");
  const stores = directDirectory(join(recoveryRoot, "source-copy", "curator-stores"), "recovered curator stores");
  const dossiers: HumanPacketDossierInput[] = [];

  const exposedRoot = directDirectory(join(stores, "exposed-development-recovery-v1"), "exposed recovery");
  const exposedIds = childDirectories(join(exposedRoot, "dossiers"), "exposed dossiers");
  assertIds(exposedIds, Array.from({ length: 12 }, (_, index) => `exposed-${String(index + 1).padStart(2, "0")}`), "exposed dossiers");
  for (const id of exposedIds) {
    dossiers.push(dossier(
      id,
      exposedRoot,
      "ready-for-human-review",
      "recovery-manifest.json",
      `dossiers/${id}/human-review-card.md`,
    ));
  }
  dossiers.push(dossier(
    "exposed-vscode-98988",
    exposedRoot,
    "reconstruction-loss",
    "recovery-manifest.json",
    "losses/exposed-vscode-98988/sampled-loss.md",
  ));

  for (const version of ["v1", "v2", "v3", "v4"]) {
    const batchRoot = directDirectory(join(stores, `supplementary-recovery-${version}`), `supplementary ${version}`);
    const ids = childDirectories(join(batchRoot, "dossiers"), `supplementary ${version} dossiers`);
    assertIds(ids, SUPPLEMENTARY_IDS[version]!, `supplementary ${version} dossiers`);
    for (const id of ids) {
      const root = join(batchRoot, "dossiers", id);
      dossiers.push(dossier(
        id,
        root,
        "ready-for-human-review",
        "bundle-manifest.json",
        selectCard(root, ["human-review-card.json", "human-review-card.md"], id),
      ));
    }
  }

  const linkedRoot = directDirectory(join(stores, "linked-defect-recovery-v1"), "linked defect recovery");
  dossiers.push(dossier(
    "r2-linked-family-001",
    linkedRoot,
    "ready-for-human-review",
    "bundle-manifest.json",
    "review-card.md",
  ));

  const comparisonV1 = directDirectory(join(stores, "comparison-recovery-v1"), "comparison recovery v1");
  const comparisonV1Ids = childDirectories(comparisonV1, "comparison v1 dossiers").filter((id) => id.startsWith("r2-random-"));
  assertIds(comparisonV1Ids, COMPARISON_V1_IDS, "comparison v1 dossiers");
  for (const id of comparisonV1Ids) {
    const root = join(comparisonV1, id);
    dossiers.push(dossier(id, root, "ready-for-human-review", "case-manifest.json", "human-review-card.md"));
  }

  const comparisonV2 = directDirectory(join(stores, "comparison-recovery-v2"), "comparison recovery v2");
  const comparisonV2Ids = childDirectories(comparisonV2, "comparison v2 dossiers").filter((id) => id.startsWith("r2-random-"));
  assertIds(comparisonV2Ids, COMPARISON_V2_IDS, "comparison v2 dossiers");
  for (const id of comparisonV2Ids) {
    const root = join(comparisonV2, id);
    dossiers.push(dossier(id, root, "ready-for-human-review", "bundle-manifest.json", "dossier.json"));
  }

  const lossRoot = directDirectory(join(stores, "sampled-loss-recovery-v1", "losses"), "sampled losses");
  const sampledLossIds = childDirectories(lossRoot, "sampled loss dossiers");
  assertIds(sampledLossIds, SAMPLED_LOSS_IDS, "sampled loss dossiers");
  for (const id of sampledLossIds) {
    const root = join(lossRoot, id);
    dossiers.push(dossier(id, root, "reconstruction-loss", "loss.json", "sampled-loss.md"));
  }

  const ids = dossiers.map((item) => item.dossierId);
  if (new Set(ids).size !== ids.length) throw new Error("recovered packet contains duplicate dossier IDs");
  const ready = dossiers.filter((item) => item.classification === "ready-for-human-review").length;
  const losses = dossiers.filter((item) => item.classification === "reconstruction-loss").length;
  if (ready !== EXPECTED_READY || losses !== EXPECTED_LOSSES) {
    throw new Error(`recovered packet expected ${EXPECTED_READY} proposals and ${EXPECTED_LOSSES} losses; found ${ready} and ${losses}`);
  }
  return { schemaVersion: 1, packetId, dossiers: dossiers.sort((a, b) => a.dossierId.localeCompare(b.dossierId)) };
}

export function assembleRecoveredHumanReviewPacket(
  recoveryRootPath: string,
  destinationPath: string,
  packetId = "r2-recovered-human-review-v1",
): { packetId: string; packetSha256: string; destination: string } {
  return assembleHumanReviewPacket(
    buildRecoveredHumanReviewRequest(recoveryRootPath, packetId),
    destinationPath,
  );
}

function runCli(): void {
  const [recoveryRoot, destination, packetId] = process.argv.slice(2);
  if (!recoveryRoot || !destination || process.argv.length > 5) {
    throw new Error("usage: build-recovered-human-review-request.ts <recovery-root> <new-packet-directory> [packet-id]");
  }
  process.stdout.write(`${JSON.stringify(assembleRecoveredHumanReviewPacket(recoveryRoot, destination, packetId))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
