import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { digest } from "./public-capture-store.mjs";

// Read-only integrity replay. No provider or GitHub calls.
const root = resolve("docs/validation/artifacts/2026-09-05-r2-candidate-inventory");
let receipts = 0;
let objects = 0;
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`unexpected symlink: ${path}`);
    if (entry.isDirectory()) scan(path);
    else if (!entry.isFile()) throw new Error(`unexpected entry: ${path}`);
    else if (directory.endsWith("/objects")) {
      if (`${digest(readFileSync(path))}.json` !== entry.name) throw new Error(`object digest mismatch: ${path}`);
      objects++;
    } else if (directory.endsWith("/requests")) {
      const receipt = JSON.parse(readFileSync(path));
      if (!/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error(`invalid object reference: ${path}`);
      const bytes = readFileSync(join(directory, "..", "objects", `${receipt.sha256}.json`));
      if (digest(bytes) !== receipt.sha256 || bytes.length !== receipt.bytes ||
        `${digest(JSON.stringify(receipt.request))}.json` !== entry.name) {
        throw new Error(`request binding mismatch: ${path}`);
      }
      receipts++;
    }
  }
}
scan(join(root, "raw"));
scan(join(root, "screening-sources"));
const inventory = JSON.parse(readFileSync(join(root, "candidate-inventory-v1.json")));
for (const source of inventory.sourceManifests) {
  if (source.path.startsWith("/") || source.path.split("/").includes("..") || source.path.includes("\\")) {
    throw new Error("unsafe inventory source path");
  }
  if (digest(readFileSync(join(root, source.path))) !== source.sha256) throw new Error(`inventory source changed: ${source.path}`);
}
if (inventory.candidates.length !== 100 || inventory.admittedCases !== 0 ||
  inventory.candidates.some((candidate) => candidate.truthStatus !== "unknown" || candidate.partition !== "unassigned")) {
  throw new Error("unexpected initial inventory admission state");
}
console.log(JSON.stringify({ status: "verified", receipts, objects, candidateSlots: 100, admittedCases: 0 }));
