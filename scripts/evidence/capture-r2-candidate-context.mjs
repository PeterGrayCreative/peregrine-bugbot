import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { capture, capturePages, digest } from "./public-capture-store.mjs";

const root = resolve("docs/validation/artifacts/2026-09-05-r2-candidate-inventory");
const inventoryName = process.argv[2] ?? "random-sample-v1.json";
const outputs = { "random-sample-v1.json": "random-context-v1.json", "main-review-candidates-v1.json": "main-review-context-v1.json" };
if (!Object.hasOwn(outputs, inventoryName)) throw new Error("unsupported registered candidate inventory");
const inventoryBytes = readFileSync(join(root, inventoryName));
const inventory = JSON.parse(inventoryBytes);
const store = join(root, "raw");
const records = [];
for (const candidate of inventory.candidates) {
  const prefix = `repos/${candidate.repository}`;
  const pull = `${prefix}/pulls/${candidate.number}`;
  const metadata = capture(store, pull);
  const value = metadata.value;
  if (value.base?.repo?.private !== false) throw new Error("public repository required");
  const captures = [metadata];
  for (const endpoint of [`${pull}/comments`, `${pull}/reviews`, `${prefix}/issues/${candidate.number}/comments`, `${pull}/commits`, `${pull}/files`]) {
    captures.push(...capturePages(store, endpoint));
  }
  const files = captures.filter((entry) => entry.receipt.request.endpoint === `${pull}/files`).flatMap((entry) => entry.value);
  if (files.length !== value.changed_files || new Set(files.map((file) => file.filename)).size !== files.length) {
    throw new Error(`changed-file coverage incomplete: ${candidate.candidateId}`);
  }
  const receipts = captures.map((entry) => entry.receipt);
  records.push({ candidateId: candidate.candidateId, requests: receipts,
    currentApiBase: value.base.sha, currentApiHead: value.head.sha,
    historicalRevisionStatus: "unverified-current-api-values-are-only-leads",
    createdAt: value.created_at, updatedAt: value.updated_at, mergedAt: value.merged_at,
    changedFiles: value.changed_files, additions: value.additions, deletions: value.deletions,
    sourceLicenseStatus: "requires-license-at-historical-revision",
    linkedFixStatus: "requires-curator-review", truthStatus: "unknown" });
  console.log(`${candidate.candidateId}: captured ${receipts.length} source pages`);
}
const output = `${JSON.stringify({ schemaVersion: 1, inventorySha256: digest(inventoryBytes), records }, null, 2)}\n`;
const target = join(root, outputs[inventoryName]);
if (existsSync(target)) {
  if (readFileSync(target, "utf8") !== output) throw new Error("immutable context conflict");
} else writeFileSync(target, output, { flag: "wx" });
