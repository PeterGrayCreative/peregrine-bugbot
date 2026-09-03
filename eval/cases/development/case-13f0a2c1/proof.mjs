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
  return { root, module: await import(`${pathToFileURL(join(root, "src/invoice-service.ts")).href}?${state}`) };
}

const session = { userId: "u-1", tenantId: "tenant-a", roles: ["billing-approver"] };
const invoice = { id: "inv-9", tenantId: "tenant-b", totalCents: 2500 };
const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  if (base.module.canApproveInvoice(session, invoice) !== false) throw new Error("base tenant boundary is not enforced");
  if (head.module.canApproveInvoice(session, invoice) !== true) throw new Error("head regression is not observable");
  console.log(JSON.stringify({ caseId: "case-13f0a2c1", baseGood: true, headDefectObserved: true }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
