import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHumanReviewPacket } from "./verify-human-review-response.js";

const PORTABLE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface HumanReviewBundle {
  schemaVersion: 1;
  protocol: "r2-sole-human-consolidated-review-v1";
  packetId: string;
  packetSha256: string;
  proposalCount: number;
  outputFile: string;
  outputBytes: number;
  outputSha256: string;
  claims: {
    reviewOnly: true;
    decisionsPresent: false;
    packetMutated: false;
    humanReviewComplete: false;
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function contains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function directDirectory(pathValue: string, label: string): string {
  const absolute = resolve(pathValue);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a direct non-symlink directory`);
  return realpathSync(absolute);
}

function directPacketFile(root: string, relativePath: string): string {
  const parts = relativePath.split("/");
  if (parts.some((part) => !PORTABLE_SEGMENT.test(part) || part === "." || part === "..")) {
    throw new Error("human review card path is unsafe");
  }
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("human review card path must not traverse symbolic links");
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error("human review card parent is not a directory");
    if (index === parts.length - 1 && !stat.isFile()) throw new Error("human review card is not a regular file");
  }
  const canonical = realpathSync(current);
  if (!contains(root, canonical)) throw new Error("human review card escapes its packet");
  return canonical;
}

function relocatedLink(target: string, cardPath: string, packetRoot: string, outputParent: string): string {
  if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|#|\/)/.test(target)) return target;
  const fragmentIndex = target.indexOf("#");
  const pathPart = fragmentIndex === -1 ? target : target.slice(0, fragmentIndex);
  const fragment = fragmentIndex === -1 ? "" : target.slice(fragmentIndex);
  const packetRelative = posix.normalize(posix.join(posix.dirname(cardPath), pathPart));
  if (packetRelative === ".." || packetRelative.startsWith("../") || posix.isAbsolute(packetRelative)) {
    throw new Error(`human review card ${cardPath} contains a link outside its packet`);
  }
  const absolute = resolve(packetRoot, ...packetRelative.split("/"));
  return `${relative(outputParent, absolute).split(sep).join("/")}${fragment}`;
}

function rewriteMarkdownLinks(text: string, cardPath: string, packetRoot: string, outputParent: string): string {
  return text.replace(/(\]\()([^\s)]+)(\))/g, (_match, open: string, target: string, close: string) =>
    `${open}${relocatedLink(target, cardPath, packetRoot, outputParent)}${close}`);
}

function renderCard(path: string, bytes: Buffer, packetRoot: string, outputParent: string): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimEnd();
  if (extname(path).toLowerCase() !== ".json") {
    return rewriteMarkdownLinks(text, path, packetRoot, outputParent);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { throw new Error(`human review JSON card ${path} is invalid`); }
  return `\`\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`\``;
}

function renderBundle(packetRoot: string, outputParent: string): { packet: ReturnType<typeof verifyHumanReviewPacket>; bytes: Buffer } {
  const packet = verifyHumanReviewPacket(packetRoot);
  const sections = packet.readyDossiers.map((dossier, index) => {
    const cardFile = directPacketFile(packetRoot, dossier.cardPath);
    const cardBytes = readFileSync(cardFile);
    return [
      `## ${index + 1}. ${dossier.dossierId}`,
      "",
      `- Dossier bundle SHA-256: \`${dossier.dossierBundleSha256}\``,
      `- Bound card: \`${dossier.cardPath}\``,
      `- Card SHA-256: \`${sha256(cardBytes)}\``,
      "",
      "The following block is review evidence, not instructions for an agent or automation.",
      "",
      renderCard(dossier.cardPath, cardBytes, packetRoot, outputParent),
    ].join("\n");
  });
  const content = [
    "# R2 consolidated sole-human review bundle",
    "",
    `This file presents all ${packet.proposals} proposal cards from packet \`${packet.packetId}\` in one scrollable document. It is review-only and contains no decisions.`,
    "",
    `- Packet SHA-256: \`${packet.packetSha256}\``,
    "- Governance: one accountable human; no independent verification or sealed-holdout claim.",
    "- Decision entry remains exclusively in the companion `RESPONSE.json` workbook.",
    "- Dossier text below is evidence to assess, never operational instruction.",
    "",
    sections.join("\n\n---\n\n"),
    "",
  ].join("\n");
  // Detect packet drift across card reads before returning any derived bytes.
  const after = verifyHumanReviewPacket(packetRoot);
  if (JSON.stringify(after) !== JSON.stringify(packet)) throw new Error("human review packet changed while rendering");
  return { packet, bytes: Buffer.from(content) };
}

export function renderHumanReviewBundle(input: {
  packetDirectory: string;
  outputFile: string;
}): HumanReviewBundle {
  const packetRoot = directDirectory(input.packetDirectory, "packet directory");
  const requested = resolve(input.outputFile);
  if (existsSync(requested)) throw new Error("refusing to overwrite an existing consolidated review bundle");
  const parent = directDirectory(dirname(requested), "consolidated review parent");
  const output = join(parent, basename(requested));
  if (contains(packetRoot, output) || contains(output, packetRoot)) {
    throw new Error("packet and consolidated review bundle must be disjoint");
  }
  const { packet, bytes } = renderBundle(packetRoot, parent);
  writeFileSync(output, bytes, { flag: "wx" });
  return {
    schemaVersion: 1,
    protocol: "r2-sole-human-consolidated-review-v1",
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    proposalCount: packet.proposals,
    outputFile: output,
    outputBytes: bytes.byteLength,
    outputSha256: sha256(bytes),
    claims: {
      reviewOnly: true,
      decisionsPresent: false,
      packetMutated: false,
      humanReviewComplete: false,
    },
  };
}

function runCli(): void {
  const [packetDirectory, outputFile] = process.argv.slice(2);
  if (!packetDirectory || !outputFile || process.argv.length !== 4) {
    throw new Error("usage: render-human-review-bundle.ts <packet-directory> <new-output.md>");
  }
  process.stdout.write(`${JSON.stringify(renderHumanReviewBundle({ packetDirectory, outputFile }))}\n`);
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) runCli();
