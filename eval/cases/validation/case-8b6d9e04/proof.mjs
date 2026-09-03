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
  return { root, module: await import(`${pathToFileURL(join(root, "src/workspace-service.ts")).href}?${state}`) };
}

const actor = { tenantId: "tenant-a", permissions: ["workspace:manage"] };
const workspace = { id: "w-2", tenantId: "tenant-b", secret: "s", setting: "old" };
const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  for (const operation of [
    () => base.module.readSecret(actor, workspace),
    () => base.module.updateSetting(actor, workspace, "new"),
  ]) {
    let denied = false;
    try { operation(); } catch (error) { denied = error instanceof Error && error.message === "not authorized"; }
    if (!denied) throw new Error("base tenant boundary is not enforced");
  }
  if (head.module.readSecret(actor, workspace) !== "s") throw new Error("head read regression is not observable");
  if (head.module.updateSetting(actor, workspace, "new").setting !== "new") throw new Error("head write regression is not observable");
  console.log(JSON.stringify({ caseId: "case-8b6d9e04", baseGood: true, headDefectObserved: true, symptoms: 2 }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
