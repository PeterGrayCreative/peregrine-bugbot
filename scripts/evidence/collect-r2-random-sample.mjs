import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { capture, capturePages, digest } from "./public-capture-store.mjs";

const root = resolve("docs/validation/artifacts/2026-09-05-r2-candidate-inventory");
const protocol = JSON.parse(readFileSync(join(root, "collection-protocol.json"), "utf8"));
const store = join(root, "raw");
const receipts = [];
const pools = protocol.repositories.map(({ repository, family }) => {
  const metadata = capture(store, `repos/${repository}`);
  if (metadata.value.private !== false) throw new Error(`public source required: ${repository}`);
  receipts.push(metadata.receipt);
  const q = `repo:${repository} is:pr is:merged merged:${protocol.randomSampleWindow}`;
  const pages = capturePages(store, "search/issues", { q, sort: "created", order: "asc" });
  receipts.push(...pages.map((p) => p.receipt));
  const candidates = pages.flatMap((p) => p.value.items);
  if (new Set(candidates.map((p) => p.id)).size !== candidates.length || candidates.length !== pages[0].value.total_count) {
    throw new Error(`unstable search pagination: ${repository}`);
  }
  return candidates.map((pr) => ({ repository, family, number: pr.number, sourceUrl: pr.html_url,
    createdAt: pr.created_at, updatedAt: pr.updated_at, authorType: pr.user?.type ?? "unknown",
    rank: digest(`${protocol.seed}:${repository}:${pr.number}`) })).sort((a, b) => a.rank.localeCompare(b.rank));
});

// Round-robin stratification prevents the largest repository dominating the sample.
const selected = [];
for (let index = 0; selected.length < 25; index++) {
  let added = false;
  for (const pool of pools) {
    if (pool[index] && selected.length < 25) { selected.push(pool[index]); added = true; }
  }
  if (!added) throw new Error("insufficient random sampling frame; revise protocol before expanding");
}
const inventory = { schemaVersion: 1, protocolSha256: digest(readFileSync(join(root, "collection-protocol.json"))),
  evidenceClass: "historical-candidate", admittedCases: 0,
  frameSizes: protocol.repositories.map((repo, index) => ({ ...repo, count: pools[index].length })),
  requests: receipts, candidates: selected.map((candidate, index) => ({
    candidateId: `r2-random-${String(index + 1).padStart(3, "0")}`, ...candidate,
    sourceStratum: "sampled-without-comment-selection", status: "awaiting-source-review",
    truthStatus: "unknown", partition: "unassigned", duplicateFamily: "unassessed",
    limitation: "Sampling does not establish historical validity, a defect, or a safe comparison." })) };
const bytes = `${JSON.stringify(inventory, null, 2)}\n`;
const path = join(root, "random-sample-v1.json");
if (existsSync(path)) {
  if (readFileSync(path, "utf8") !== bytes) throw new Error("immutable inventory conflict");
} else writeFileSync(path, bytes, { flag: "wx" });
console.log(`Stored ${selected.length} unadmitted candidates; ${receipts.length} authenticated source responses.`);
