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
  return { root, module: await import(`${pathToFileURL(join(root, "src/shipment-service.ts")).href}?${state}`) };
}

const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  if (base.module.routingKey("us-acme-retail-0042") !== "us/acme-retail/0042") throw new Error("base key is not preserved");
  if (head.module.routingKey("us-acme-retail-0042") !== "us/acme/retail") throw new Error("head misrouting is not observable");
  console.log(JSON.stringify({ caseId: "case-a8073f5d", baseGood: true, headDefectObserved: true }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
