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
  return { root, module: await import(`${pathToFileURL(join(root, "src/ledger-service.ts")).href}?${state}`) };
}

function lockedTransfer(candidate) {
  const accounts = new Map([
    ["source", { id: "source", balanceCents: 1000 }],
    ["locked-target", { id: "locked-target", balanceCents: 200 }],
  ]);
  try { candidate.transfer(accounts, "source", "locked-target", 300); } catch {}
  return [...accounts.values()].map((account) => account.balanceCents);
}
const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  if (JSON.stringify(lockedTransfer(base.module)) !== JSON.stringify([1000, 200])) throw new Error("base failure is not atomic");
  if (JSON.stringify(lockedTransfer(head.module)) !== JSON.stringify([700, 200])) throw new Error("head partial mutation is not observable");
  console.log(JSON.stringify({ caseId: "case-6c19f4ab", baseGood: true, headDefectObserved: true }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
