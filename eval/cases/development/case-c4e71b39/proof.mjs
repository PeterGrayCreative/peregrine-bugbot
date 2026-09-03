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
  return { root, module: await import(`${pathToFileURL(join(root, "src/report-service.ts")).href}?${state}`) };
}

const sameTenant = { tenantId: "tenant-a", scopes: ["report:read"] };
const otherTenant = { tenantId: "tenant-b", scopes: ["report:admin"] };
const report = { tenantId: "tenant-a", status: "published" };
const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  for (const candidate of [base.module, head.module]) {
    if (!candidate.canReadReport(sameTenant, report)) throw new Error("same-tenant reader was denied");
    if (candidate.canReadReport(otherTenant, report)) throw new Error("cross-tenant reader was admitted");
  }
  console.log(JSON.stringify({ caseId: "case-c4e71b39", baseGood: true, headGood: true }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
