import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { verifyHumanReviewPacket } from "./verify-human-review-response.js";

const PORTABLE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface HumanReviewWorkspaceInitialization {
  schemaVersion: 1;
  protocol: "r2-sole-human-review-workspace-v1";
  packetId: string;
  packetSha256: string;
  reviewerIdentity: {
    descriptor: string;
    sha256: string;
    claim: "operator-prepared-identity-not-a-review-decision";
  };
  responseDirectory: "response";
  copiedTemplates: Array<{ path: string; bytes: number; sha256: string }>;
  guideSha256: string;
  claims: {
    decisionsPresent: false;
    packetMutated: false;
    humanReviewComplete: false;
    independentVerificationClaimed: false;
  };
  initializationSha256: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function inside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function directDirectory(pathValue: string, label: string): string {
  const absolute = resolve(pathValue);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct non-symlink directory`);
  return realpathSync(absolute);
}

function directFile(root: string, relativePath: string, label: string): string {
  const parts = relativePath.split("/");
  if (parts.some((part) => !PORTABLE_SEGMENT.test(part) || part === "." || part === "..")) throw new Error(`${label} path is unsafe`);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not traverse symbolic links`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`${label} parent is not a directory`);
    if (index === parts.length - 1 && !stat.isFile()) throw new Error(`${label} is not a regular file`);
  }
  const canonical = realpathSync(current);
  if (!inside(root, canonical)) throw new Error(`${label} escapes its root`);
  return canonical;
}

function reviewerDescriptor(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || !/^[A-Za-z0-9:/._-]+$/.test(normalized)) throw new Error("reviewer identity descriptor must contain 1-256 portable identity characters");
  return normalized;
}

function renderGuide(input: {
  packetId: string;
  packetSha256: string;
  identityDescriptor: string;
  identitySha256: string;
  packetLink: string;
  dossiers: ReturnType<typeof verifyHumanReviewPacket>["readyDossiers"];
}): Buffer {
  const rows = input.dossiers.map((item, index) =>
    `${index + 1}. [${item.dossierId}](${input.packetLink}/${item.cardPath}) — [decision](response/decisions/${item.dossierId}.json)`,
  ).join("\n");
  return Buffer.from(`# R2 sole-human review workspace\n\n` +
    `Review all ${input.dossiers.length} proposals before completing the packet decision. This workspace starts with blank templates; its creation is not a review decision.\n\n` +
    `- Packet: \`${input.packetId}\`\n` +
    `- Packet SHA-256: \`${input.packetSha256}\`\n` +
    `- Reviewer identity: \`${input.identityDescriptor}\`\n` +
    `- Reviewer identity SHA-256: \`${input.identitySha256}\`\n` +
    `- Governance: one accountable human; do not claim independent confirmation or a sealed holdout.\n\n` +
    `For each decision JSON, set \`templateOnly\` to \`false\`, choose \`approve\`, \`reject\`, or \`unresolved\`, supply a concrete reason, copy its dossier bundle digest into \`acknowledgedDossierBundleSha256\`, use the reviewer identity digest above, and record a canonical UTC timestamp. An approval cannot contain a correction; corrections require a new dossier version.\n\n` +
    `After all proposal decisions are complete, finish \`response/packet-decision.json\`. A packet-level acknowledgment cannot convert unresolved or rejected proposals into admissions. Do not edit the sealed packet.\n\n` +
    `## Proposals\n\n${rows}\n`);
}

export function initializeHumanReviewWorkspace(input: {
  packetDirectory: string;
  destination: string;
  reviewerIdentityDescriptor: string;
}): HumanReviewWorkspaceInitialization {
  const packetRoot = directDirectory(input.packetDirectory, "packet directory");
  const packet = verifyHumanReviewPacket(packetRoot);
  const descriptor = reviewerDescriptor(input.reviewerIdentityDescriptor);
  const reviewerIdentitySha256 = sha256(`peregrine-human-reviewer-v1\0${descriptor}`);
  const requested = resolve(input.destination);
  if (existsSync(requested)) throw new Error("refusing to overwrite an existing review workspace");
  const parent = directDirectory(dirname(requested), "review workspace parent");
  const destination = join(parent, basename(requested));
  if (inside(packetRoot, destination) || inside(destination, packetRoot)) throw new Error("packet and review workspace must be disjoint");
  const packetLink = relative(destination, packetRoot).split(sep).join("/") || ".";
  const templatePaths = [
    "packet-decision.json",
    ...packet.readyDossiers.map((item) => `decisions/${item.dossierId}.json`),
  ];
  const copiedTemplates = templatePaths.map((path) => {
    const bytes = readFileSync(directFile(packetRoot, path, `packet template ${path}`));
    return {
      path: `response/${path}`,
      bytes,
      binding: { path: `response/${path}`, bytes: bytes.byteLength, sha256: sha256(bytes) },
    };
  });
  const reviewGuide = renderGuide({
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    identityDescriptor: descriptor,
    identitySha256: reviewerIdentitySha256,
    packetLink,
    dossiers: packet.readyDossiers,
  });
  const body: Omit<HumanReviewWorkspaceInitialization, "initializationSha256"> = {
    schemaVersion: 1,
    protocol: "r2-sole-human-review-workspace-v1",
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    reviewerIdentity: {
      descriptor,
      sha256: reviewerIdentitySha256,
      claim: "operator-prepared-identity-not-a-review-decision",
    },
    responseDirectory: "response",
    copiedTemplates: copiedTemplates.map((item) => item.binding),
    guideSha256: sha256(reviewGuide),
    claims: {
      decisionsPresent: false,
      packetMutated: false,
      humanReviewComplete: false,
      independentVerificationClaimed: false,
    },
  };
  const artifact = { ...body, initializationSha256: sha256(JSON.stringify(body)) };
  let created = false;
  try {
    mkdirSync(destination);
    created = true;
    mkdirSync(join(destination, "response", "decisions"), { recursive: true });
    for (const template of copiedTemplates) {
      writeFileSync(join(destination, ...template.path.split("/")), template.bytes, { flag: "wx" });
    }
    writeFileSync(join(destination, "REVIEW.md"), reviewGuide, { flag: "wx" });
    writeFileSync(join(destination, "initialization.json"), `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
    if (JSON.stringify(verifyHumanReviewPacket(packetRoot)) !== JSON.stringify(packet)) {
      throw new Error("packet changed while the review workspace was initialized");
    }
  } catch (error) {
    if (created) rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  return artifact;
}

function runCli(): void {
  const [packetDirectory, destination, reviewerIdentityDescriptor] = process.argv.slice(2);
  if (!packetDirectory || !destination || !reviewerIdentityDescriptor || process.argv.length !== 5) {
    throw new Error("usage: initialize-human-review-workspace.ts <packet-directory> <new-workspace-directory> <reviewer-identity-descriptor>");
  }
  process.stdout.write(`${JSON.stringify(initializeHumanReviewWorkspace({ packetDirectory, destination, reviewerIdentityDescriptor }))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
