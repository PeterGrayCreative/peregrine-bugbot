import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const caseDir = dirname(fileURLToPath(import.meta.url));
async function moduleFor(state) {
  const root = mkdtempSync(join(tmpdir(), "pg-proof-"));
  cpSync(join(caseDir, "fixture"), root, { recursive: true });
  if (state === "base") {
    const applied = spawnSync("git", ["apply", "--reverse", join(caseDir, "diff.patch")], { cwd: root, encoding: "utf8" });
    if (applied.status !== 0) throw new Error(applied.stderr);
  }
  return { root, module: await import(`${pathToFileURL(join(root, "src/inventory-service.ts")).href}?${state}`) };
}

function failedReservation(candidate) {
  const stock = new Map([
    ["sku-a", { sku: "sku-a", available: 5 }],
    ["sku-b", { sku: "sku-b", available: 1 }],
  ]);
  try { candidate.reserve(stock, [{ sku: "sku-a", quantity: 2 }, { sku: "sku-b", quantity: 2 }]); } catch {}
  return [stock.get("sku-a").available, stock.get("sku-b").available];
}
const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  if (JSON.stringify(failedReservation(base.module)) !== JSON.stringify([5, 1])) throw new Error("base failure is not atomic");
  if (JSON.stringify(failedReservation(head.module)) !== JSON.stringify([3, 1])) throw new Error("head partial reservation is not observable");
  console.log(JSON.stringify({ caseId: "case-d3f8026e", baseGood: true, headDefectObserved: true }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
