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
  return { root, module: await import(`${pathToFileURL(join(root, "src/quota-service.ts")).href}?${state}`) };
}

function exercise(candidate) {
  const current = new Map([["workspace-a", 5]]);
  let rejected = false;
  try { candidate.applyQuotaChanges(current, [{ workspaceId: "workspace-a", delta: 2 }, { workspaceId: "workspace-a", delta: -10 }]); }
  catch { rejected = true; }
  return { rejected, current: current.get("workspace-a"), updated: candidate.applyQuotaChanges(current, [{ workspaceId: "workspace-a", delta: 2 }]).get("workspace-a") };
}
const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  for (const result of [exercise(base.module), exercise(head.module)]) {
    if (!result.rejected || result.current !== 5 || result.updated !== 7) throw new Error("atomic quota semantics changed");
  }
  console.log(JSON.stringify({ caseId: "case-7ab54e20", baseGood: true, headGood: true }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
