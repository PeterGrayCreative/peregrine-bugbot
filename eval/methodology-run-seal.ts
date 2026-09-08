import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { sha256 } from "../src/core/telemetry.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentFile,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import { readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import { readMethodologyAttemptTerminal } from "./methodology-terminal.js";

const SEAL_FILE = "methodology-run-terminal-seal.json";
const REGISTRATION_FILE = "methodology-invocation-registration.json";
const SHA256 = /^[a-f0-9]{64}$/;

export interface MethodologyTerminalReceipt {
  attemptId: string;
  terminalSha256: string;
}

export interface MethodologyRunSeal {
  schemaVersion: 1;
  kind: "methodology-run-terminal-seal";
  registrationSha256: string;
  scheduleSha256: string;
  status: "terminal-complete";
  terminalReceipts: MethodologyTerminalReceipt[];
  attemptAccounting: {
    scheduled: number;
    terminal: number;
    executionCompleted: number;
    executionFailed: number;
  };
  artifactBindings: Array<{
    path: string;
    sha256: string;
  }>;
  claims: {
    providerContact: "not-established-by-this-seal";
    efficacy: "not-evaluated-by-this-seal";
  };
  recordSha256: string;
}

/**
 * Seal a terminal-complete methodology schedule. "Terminal complete" means
 * every scheduled attempt has an authenticated terminal record, including
 * failures. It does not mean every review succeeded or that a provider was
 * contacted, and it makes no efficacy or promotion claim.
 */
export function writeMethodologyRunSeal(
  root: string,
  registrationSha256: string,
  callerHeldTerminalReceipts: MethodologyTerminalReceipt[],
): string {
  assertEvidenceRoot(root);
  const body = deriveSealBody(root, registrationSha256, callerHeldTerminalReceipts);
  const record: MethodologyRunSeal = { ...body, recordSha256: canonicalJsonSha256(body) };
  assertNoSecrets(record, "methodology run terminal seal");
  writeExclusiveJson(root, join(root, SEAL_FILE), record);
  return record.recordSha256;
}

export function readMethodologyRunSeal(
  root: string,
  registrationSha256: string,
  expectedSealSha256: string,
): MethodologyRunSeal {
  assertEvidenceRoot(root);
  if (!isSha256(expectedSealSha256)) throw new Error("caller-held methodology run seal digest is required");
  const raw = readExperimentJson(join(root, SEAL_FILE));
  const record = parseSeal(raw);
  if (record.registrationSha256 !== registrationSha256) {
    throw new Error("methodology run seal registration mismatch");
  }
  const { recordSha256, ...body } = record;
  if (recordSha256 !== expectedSealSha256 || recordSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology run seal digest mismatch");
  }
  const expected = deriveSealBody(root, registrationSha256, record.terminalReceipts);
  if (canonicalJson(body) !== canonicalJson(expected)) {
    throw new Error("methodology run seal does not match authenticated terminal evidence");
  }
  assertNoSecrets(record, "methodology run terminal seal");
  return record;
}

function deriveSealBody(
  root: string,
  registrationSha256: string,
  terminalReceiptsInput: MethodologyTerminalReceipt[],
): Omit<MethodologyRunSeal, "recordSha256"> {
  const registration = readMethodologyInvocationRegistration(root, registrationSha256);
  const terminalReceipts = parseTerminalReceipts(terminalReceiptsInput);
  const scheduledIds = registration.schedule.attempts.map((attempt) => attempt.id);
  if (canonicalJson(terminalReceipts.map((receipt) => receipt.attemptId)) !== canonicalJson(scheduledIds)) {
    throw new Error("methodology run seal requires exactly one terminal receipt per scheduled attempt in schedule order");
  }

  let executionCompleted = 0;
  let executionFailed = 0;
  const expectedIntentFiles: string[] = [];
  const expectedTerminalFiles: string[] = [];
  for (const receipt of terminalReceipts) {
    const result = readMethodologyAttemptTerminal(
      root,
      registrationSha256,
      receipt.attemptId,
      receipt.terminalSha256,
    );
    if (result.outcome.status === "completed") executionCompleted++;
    else executionFailed++;
    for (const intent of result.intentReceipts) {
      expectedIntentFiles.push(`${receipt.attemptId}.stage-${intent.stageIndex}.input.json`);
    }
    expectedTerminalFiles.push(`${receipt.attemptId}.methodology-terminal.json`);
  }

  assertExactArtifactInventory(root, expectedIntentFiles, expectedTerminalFiles);
  const artifactPaths = [REGISTRATION_FILE, ...expectedIntentFiles, ...expectedTerminalFiles].sort(compareText);
  const artifactBindings = artifactPaths.map((path) => ({
    path,
    sha256: sha256(readExperimentFile(join(root, path))),
  }));
  return {
    schemaVersion: 1,
    kind: "methodology-run-terminal-seal",
    registrationSha256,
    scheduleSha256: canonicalJsonSha256(registration.schedule),
    status: "terminal-complete",
    terminalReceipts,
    attemptAccounting: {
      scheduled: scheduledIds.length,
      terminal: terminalReceipts.length,
      executionCompleted,
      executionFailed,
    },
    artifactBindings,
    claims: {
      providerContact: "not-established-by-this-seal",
      efficacy: "not-evaluated-by-this-seal",
    },
  };
}

function parseTerminalReceipts(value: unknown): MethodologyTerminalReceipt[] {
  if (!Array.isArray(value)) throw new Error("methodology terminal receipts must be an array");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const item = strictObject(entry, `methodology terminal receipt ${index}`, ["attemptId", "terminalSha256"]);
    if (typeof item.attemptId !== "string" || !/^attempt-[0-9]{6}$/.test(item.attemptId) ||
        !isSha256(item.terminalSha256)) {
      throw new Error(`methodology terminal receipt ${index} has invalid identity`);
    }
    if (seen.has(item.attemptId)) throw new Error("methodology terminal receipts contain a duplicate attempt");
    seen.add(item.attemptId);
    return { attemptId: item.attemptId, terminalSha256: item.terminalSha256 };
  });
}

function assertExactArtifactInventory(
  root: string,
  expectedIntentFiles: string[],
  expectedTerminalFiles: string[],
): void {
  const inventory = recursiveFileInventory(root);
  const actualIntentFiles = inventory
    .filter((path) => path.endsWith(".input.json"))
    .sort(compareText);
  const actualTerminalFiles = inventory
    .filter((path) => path.endsWith(".methodology-terminal.json"))
    .sort(compareText);
  if (canonicalJson(actualIntentFiles) !== canonicalJson([...expectedIntentFiles].sort(compareText))) {
    throw new Error("methodology run contains an orphaned, missing, or unexpected invocation intent artifact");
  }
  if (canonicalJson(actualTerminalFiles) !== canonicalJson([...expectedTerminalFiles].sort(compareText))) {
    throw new Error("methodology run contains a missing or unexpected terminal artifact");
  }
}

function recursiveFileInventory(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error("methodology run evidence tree must not contain symlinks");
      }
      if (entry.isDirectory()) visit(join(directory, entry.name), relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw new Error("methodology run evidence tree contains an unsupported filesystem entry");
    }
  };
  visit(root, "");
  return files;
}

function assertEvidenceRoot(root: string): void {
  const absolute = resolve(root);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("methodology run evidence root must be a real non-symlink directory");
  }
}

function parseSeal(value: unknown): MethodologyRunSeal {
  const root = strictObject(value, "methodology run seal", [
    "schemaVersion", "kind", "registrationSha256", "scheduleSha256", "status",
    "terminalReceipts", "attemptAccounting", "artifactBindings", "claims", "recordSha256",
  ]);
  if (root.schemaVersion !== 1 || root.kind !== "methodology-run-terminal-seal" ||
      root.status !== "terminal-complete" || !isSha256(root.registrationSha256) ||
      !isSha256(root.scheduleSha256) || !isSha256(root.recordSha256)) {
    throw new Error("methodology run seal identity is invalid");
  }
  const terminalReceipts = parseTerminalReceipts(root.terminalReceipts);
  const accounting = strictObject(root.attemptAccounting, "methodology run seal accounting", [
    "scheduled", "terminal", "executionCompleted", "executionFailed",
  ]);
  for (const [key, count] of Object.entries(accounting)) {
    if (!Number.isSafeInteger(count) || Number(count) < 0) {
      throw new Error(`methodology run seal accounting.${key} is invalid`);
    }
  }
  if (!Array.isArray(root.artifactBindings)) throw new Error("methodology run seal bindings must be an array");
  const artifactBindings = root.artifactBindings.map((entry, index) => {
    const item = strictObject(entry, `methodology run seal binding ${index}`, ["path", "sha256"]);
    if (typeof item.path !== "string" || !safeArtifactPath(item.path) || !isSha256(item.sha256)) {
      throw new Error(`methodology run seal binding ${index} is invalid`);
    }
    return { path: item.path, sha256: item.sha256 };
  });
  if (new Set(artifactBindings.map((entry) => entry.path)).size !== artifactBindings.length) {
    throw new Error("methodology run seal bindings contain duplicate paths");
  }
  const claims = strictObject(root.claims, "methodology run seal claims", ["providerContact", "efficacy"]);
  if (claims.providerContact !== "not-established-by-this-seal" ||
      claims.efficacy !== "not-evaluated-by-this-seal") {
    throw new Error("methodology run seal cannot assert provider contact or efficacy");
  }
  return {
    schemaVersion: 1,
    kind: "methodology-run-terminal-seal",
    registrationSha256: root.registrationSha256,
    scheduleSha256: root.scheduleSha256,
    status: "terminal-complete",
    terminalReceipts,
    attemptAccounting: {
      scheduled: Number(accounting.scheduled),
      terminal: Number(accounting.terminal),
      executionCompleted: Number(accounting.executionCompleted),
      executionFailed: Number(accounting.executionFailed),
    },
    artifactBindings,
    claims: {
      providerContact: "not-established-by-this-seal",
      efficacy: "not-evaluated-by-this-seal",
    },
    recordSha256: root.recordSha256,
  };
}

function strictObject(value: unknown, source: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort(compareText).join("\0") !== [...keys].sort(compareText).join("\0")) {
    throw new Error(`${source} has invalid fields`);
  }
  return value as Record<string, unknown>;
}

function safeArtifactPath(value: string): boolean {
  return value === REGISTRATION_FILE ||
    /^attempt-[0-9]{6}\.stage-[12]\.input\.json$/.test(value) ||
    /^attempt-[0-9]{6}\.methodology-terminal\.json$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
