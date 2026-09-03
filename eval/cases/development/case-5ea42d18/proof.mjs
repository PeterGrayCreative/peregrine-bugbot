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
  return { root, module: await import(`${pathToFileURL(join(root, "src/member-service.ts")).href}?${state}`) };
}

const base = await moduleFor("base");
const head = await moduleFor("head");
try {
  for (const candidate of [base.module, head.module]) {
    const id = candidate.parseMemberId(" mem-000042 ");
    if (id !== "MEM-000042") throw new Error("canonical identifier changed");
    if (candidate.memberCacheKey("ab", id) === candidate.memberCacheKey("a", candidate.parseMemberId("mem-000042"))) throw new Error("cache key boundary is ambiguous");
  }
  console.log(JSON.stringify({ caseId: "case-5ea42d18", baseGood: true, headGood: true }));
} finally {
  rmSync(base.root, { recursive: true, force: true });
  rmSync(head.root, { recursive: true, force: true });
}
