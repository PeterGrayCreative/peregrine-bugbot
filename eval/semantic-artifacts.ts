import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { UnmatchedFindingClassification } from "../src/types.js";

export interface AdjudicationRecord {
  findingEvidenceSha256: string;
  classification: UnmatchedFindingClassification;
  reason: "variant-disagreement" | "unmatched-high" | "candidate-new" | "agreement-audit";
  evidence: string;
}

export function parseAdjudicationRecords(value: unknown, source = "adjudication ledger"): AdjudicationRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const root = value as Record<string, unknown>;
  if (Object.keys(root).some((key) => !["schemaVersion", "records"].includes(key)) || root.schemaVersion !== 1 || !Array.isArray(root.records)) {
    throw new Error(`${source} must contain only schemaVersion 1 and records`);
  }
  const seen = new Set<string>();
  return root.records.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.records[${index}] must be an object`);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["findingEvidenceSha256", "classification", "reason", "evidence"].includes(key))) {
      throw new Error(`${source}.records[${index}] has unknown fields`);
    }
    if (typeof record.findingEvidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.findingEvidenceSha256) || seen.has(record.findingEvidenceSha256)) {
      throw new Error(`${source}.records[${index}] has an invalid or duplicate evidence digest`);
    }
    if (record.classification !== "confirmed-new" && record.classification !== "unsupported" && record.classification !== "unresolved") {
      throw new Error(`${source}.records[${index}] has an invalid classification`);
    }
    if (record.reason !== "variant-disagreement" && record.reason !== "unmatched-high" && record.reason !== "candidate-new" && record.reason !== "agreement-audit") {
      throw new Error(`${source}.records[${index}] has an invalid reason`);
    }
    if (typeof record.evidence !== "string" || !record.evidence.trim()) throw new Error(`${source}.records[${index}] needs evidence`);
    seen.add(record.findingEvidenceSha256);
    return record as unknown as AdjudicationRecord;
  });
}

export function readAdjudications(casesDir: string, caseName: string): Map<string, UnmatchedFindingClassification> {
  const root = realpathSync(resolve(casesDir));
  const path = resolve(root, caseName, "adjudication.json");
  if (!path.startsWith(`${root}${sep}`) || !existsSync(path)) return new Map();
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${path} must be a regular file`);
  const real = realpathSync(path);
  if (!real.startsWith(`${root}${sep}`)) throw new Error("adjudication path escapes the case corpus");
  return new Map(parseAdjudicationRecords(JSON.parse(readFileSync(real, "utf8")), real)
    .map((record) => [record.findingEvidenceSha256, record.classification]));
}
