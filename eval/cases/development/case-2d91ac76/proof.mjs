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
  return { root, module: await import(`${pathToFileURL(join(root, "src/customer-service.ts")).href}?${state}`) };
}

const records = [
  { externalId: "00123", displayName: "First" },
  { externalId: "123", displayName: "Second" },
];
const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  if (base.module.indexCustomers(records).size !== 2) throw new Error("base identities do not remain distinct");
  if (head.module.indexCustomers(records).size !== 1) throw new Error("head collision is not observable");
  console.log(JSON.stringify({ caseId: "case-2d91ac76", baseGood: true, headDefectObserved: true }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
